defmodule MeerkatDaemon.Connection do
  @moduledoc """
  One process per connected client.

  Protocol (`packet: 4` on the socket — Erlang handles the 4-byte
  length-prefix framing for us on both send and receive; each frame's
  first byte is a type tag, the rest is payload):

    client -> daemon:
      "L" <> line   one full line of shell input
      "I" <> bytes  raw bytes forwarded to the current foreground job's
                    pty stdin (only meaningful while a job is running;
                    ignored otherwise)
      "R" <> <<rows::16, cols::16>>   terminal resize
      "K"           terminate the current foreground job outright; ignored
                    if no job is running

    daemon -> client:
      "O" <> text   stdout line (builtins only — jobs/errors, not pty output)
      "E" <> text   stderr line (builtins only)
      "D" <> cwd    sent on connect, and again whenever `cd` changes it
      "P" <> bytes  raw pty output, unbuffered — curses programs redraw with
                    "\\r" and escapes that may never contain a "\\n"
      "X" <> code   command complete, exit code as text

  Every message is self-describing by its type byte, so there's no out-of-band
  "raw mode" phase; the client infers its own editing-vs-passthrough mode from
  whether an "X" is still outstanding.

  Foreground jobs run attached to a pty and non-blocking: erlexec's
  `:stdout`/`:stderr`/`:DOWN` messages land in this process's mailbox
  interleaved with `:tcp` messages, which is what lets a keystroke reach a
  running program instead of blocking here for the command's lifetime.
  """
  use GenServer
  alias MeerkatDaemon.{Parser, Evaluator, JobManager}

  def start_link(socket), do: GenServer.start_link(__MODULE__, socket)

  def child_spec(socket) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [socket]}, restart: :temporary}
  end

  @impl true
  def init(socket) do
    # Without this, a supervisor-initiated shutdown kills this process
    # outright, terminate/2 never runs, and the foreground job leaks.
    Process.flag(:trap_exit, true)
    {:ok, %{socket: socket, cwd: System.get_env("HOME", "/"), current: nil, winsz: {24, 80}}}
  end

  # Sent by the acceptor once :gen_tcp.controlling_process/2 completed — only
  # then is it safe to touch socket options here.
  @impl true
  def handle_info(:socket_ready, state) do
    :inet.setopts(state.socket, active: :once)
    send_frame(state.socket, ?D, state.cwd)
    {:noreply, state}
  end

  def handle_info({:tcp, socket, packet}, state) do
    case packet do
      <<?L, line::binary>> ->
        case dispatch(line, state) do
          {:continue, state} ->
            :inet.setopts(socket, active: :once)
            {:noreply, state}

          {:stop, state} ->
            :gen_tcp.close(socket)
            {:stop, :normal, state}
        end

      <<?I, data::binary>> ->
        if state.current, do: :exec.send(state.current.os_pid, data)
        :inet.setopts(socket, active: :once)
        {:noreply, state}

      <<?R, rows::16, cols::16>> ->
        if state.current, do: :exec.winsz(state.current.os_pid, rows, cols)
        :inet.setopts(socket, active: :once)
        {:noreply, %{state | winsz: {rows, cols}}}

      <<?K>> ->
        # The "X" frame still comes the normal way, via :DOWN.
        if state.current, do: :exec.stop(state.current.pid)
        :inet.setopts(socket, active: :once)
        {:noreply, state}

      _unknown ->
        :inet.setopts(socket, active: :once)
        {:noreply, state}
    end
  end

  def handle_info({:tcp_closed, _socket}, state), do: {:stop, :normal, state}
  def handle_info({:tcp_error, _socket, _reason}, state), do: {:stop, :normal, state}


  # A pty merges stdout/stderr onto one fd, so :stderr shouldn't normally fire
  # here, but it's handled the same way defensively.
  def handle_info({:stdout, os_pid, data}, %{current: %{os_pid: os_pid}} = state) do
    send_frame(state.socket, ?P, data)
    {:noreply, state}
  end

  def handle_info({:stderr, os_pid, data}, %{current: %{os_pid: os_pid}} = state) do
    send_frame(state.socket, ?P, data)
    {:noreply, state}
  end

  def handle_info(
        {:DOWN, os_pid, :process, pid, reason},
        %{current: %{os_pid: os_pid, pid: pid, id: id}} = state
      ) do
    exit_code = Evaluator.decode_exit(reason)
    JobManager.finish_job(id, exit_code)
    send_frame(state.socket, ?X, Integer.to_string(exit_code))
    {:noreply, %{state | current: nil}}
  end

  # Stale messages from a job we no longer track — ignore rather than crash.
  def handle_info(_msg, state), do: {:noreply, state}

  # The client is gone, so its foreground job — attached to that pane's pty —
  # has to go too. Left running, it orphans onto the erlexec port process and
  # reads `running` forever, since this Connection is what would have handled
  # its :DOWN. Background jobs are deliberately left alone.
  @impl true
  def terminate(_reason, state) do
    if state.current do
      :exec.stop(state.current.pid)
      # 143 = 128 + SIGTERM, which :exec.stop/1 sends before escalating.
      JobManager.finish_job(state.current.id, 143)
    end

    :ok
  end

  defp dispatch("", state) do
    send_frame(state.socket, ?X, "0")
    {:continue, state}
  end

  defp dispatch(line, state) do
    case Parser.parse(line) do
      {:error, reason} ->
        send_frame(state.socket, ?E, "parse error: #{reason}")
        send_frame(state.socket, ?X, "1")
        {:continue, state}

      {:ok, [], _mode} ->
        send_frame(state.socket, ?X, "0")
        {:continue, state}

      {:ok, stages, mode} ->
        emit = fn
          :stdout, text -> send_frame(state.socket, ?O, text)
          :stderr, text -> send_frame(state.socket, ?E, text)
        end

        case Evaluator.run(stages, state.cwd, mode, emit, state.winsz) do
          {:exit, _cwd, _code} ->
            send_frame(state.socket, ?X, "0")
            {:stop, state}

          {:ok, new_cwd, code} ->
            if new_cwd != state.cwd, do: send_frame(state.socket, ?D, new_cwd)
            send_frame(state.socket, ?X, Integer.to_string(code))
            {:continue, %{state | cwd: new_cwd}}

          {:running, id, pid, os_pid, cwd} ->
            {:continue, %{state | current: %{id: id, pid: pid, os_pid: os_pid}, cwd: cwd}}
        end
    end
  end

  defp send_frame(socket, type, payload) when is_integer(type) and is_binary(payload) do
    :gen_tcp.send(socket, <<type, payload::binary>>)
  end
end
