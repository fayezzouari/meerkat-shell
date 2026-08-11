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
      "K"           terminate the current foreground job outright (same as
                    the `kill <id>` builtin, just addressed at "whatever's
                    running now" instead of a job id — this is what the
                    client's Ctrl+Z sends, since without a wired-up
                    fg/bg this app has no use for a real suspend; ignored
                    if no job is running)

    daemon -> client:
      "O" <> text   stdout line (builtins only — jobs/errors, not pty output)
      "E" <> text   stderr line (builtins only)
      "D" <> cwd    sent on connect, and again whenever `cd` changes it
      "P" <> bytes  raw pty output, forwarded the instant it arrives —
                    no line buffering, since curses programs and
                    progress bars redraw with "\\r" and cursor escapes
                    that may never contain a "\\n"
      "X" <> code   command complete, exit code as text

  No separate "raw mode" phase needed on the wire: every message is
  self-describing by its type byte, so client and daemon never have to
  agree out-of-band on whether we're mid-pty-passthrough. The client
  infers its own local editing-vs-passthrough mode from whether an "X"
  is still outstanding for the line it last sent.

  Foreground jobs run attached to a pty (see `Evaluator.start_foreground/3`)
  and, critically, run non-blocking: erlexec's `:stdout`/`:stderr`/`:DOWN`
  messages land in *this* process's own mailbox (since this process is
  the one that indirectly called `:exec.run/2`), interleaved with
  incoming `:tcp` messages — that's what lets a keystroke (including
  Ctrl+C) reach a running program instead of this process being stuck in
  a blocking receive loop for the command's whole lifetime, which is how
  it worked before pty support.
  """
  use GenServer
  alias MeerkatDaemon.{Parser, Evaluator, JobManager}

  def start_link(socket), do: GenServer.start_link(__MODULE__, socket)

  def child_spec(socket) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [socket]}, restart: :temporary}
  end

  @impl true
  def init(socket) do
    # Without trapping exits, a supervisor-initiated shutdown (the daemon
    # itself stopping) kills this process outright and terminate/2 below
    # never runs — leaking the foreground job exactly the way a closed
    # client socket used to. Trapping turns that into a normal shutdown
    # that runs terminate/2 first.
    Process.flag(:trap_exit, true)
    {:ok, %{socket: socket, cwd: System.get_env("HOME", "/"), current: nil, winsz: {24, 80}}}
  end

  # Sent by the acceptor once :gen_tcp.controlling_process/2 has completed —
  # only then is it safe for this process to touch socket options.
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
        # Same :exec.stop/1 the `kill <id>` builtin uses — graceful SIGTERM,
        # escalating to SIGKILL if the process doesn't go quietly. The
        # actual "job's done" signal (the "X" frame) comes the normal way,
        # through the :DOWN message once the process actually exits.
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


  # Raw pty output from the current foreground job — forwarded immediately,
  # unbuffered. A pty merges stdin/stdout/stderr onto one fd, so :stderr
  # shouldn't normally fire for a pty'd process, but it's handled the same
  # way defensively.
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

  # Stale/unexpected messages (e.g. from a job we're no longer tracking) —
  # ignore rather than crash the connection.
  def handle_info(_msg, state), do: {:noreply, state}

  # The client for this connection is gone — its pane/tab was closed, or
  # the app quit. A foreground job belongs to that pane specifically: it
  # was attached to the pane's pty and there is no longer anything to read
  # its output or feed it input, so it has to go too.
  #
  # Without this it survives as an orphan of the erlexec port process,
  # still holding its memory, still `running` in `jobs` output (and so in
  # the GUI's overlay) forever — nothing will ever deliver its :DOWN,
  # because the Connection that would have handled it is this one.
  #
  # Background jobs are deliberately left alone: `cmd &` is detached by
  # definition and outliving the pane that launched it is the point.
  @impl true
  def terminate(_reason, state) do
    if state.current do
      :exec.stop(state.current.pid)
      # 143 = 128 + SIGTERM, the conventional shell exit code for it —
      # :exec.stop/1 sends SIGTERM before escalating.
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
