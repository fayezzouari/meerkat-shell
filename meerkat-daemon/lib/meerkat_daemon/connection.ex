defmodule MeerkatDaemon.Connection do
  @moduledoc """
  One process per connected client.

  Protocol (`packet: 4` on the socket — Erlang handles the 4-byte
  length-prefix framing for us on both send and receive; each frame's
  first byte is a type tag, the rest is payload):

    client -> daemon:
      "L" <> line   one full line of shell input. Lines that arrive while a
                    foreground job is running are queued and run in order
                    once it finishes — never concurrently on the same pty
      "I" <> bytes  raw bytes typed on the connection's terminal (only
                    meaningful while a job is running; ignored otherwise).
                    A lone 0x03 is delivered to the running job as SIGINT
                    rather than written through — see forward_input/2
      "R" <> <<rows::16, cols::16>>   terminal resize
      "K"           terminate the current foreground job outright; ignored
                    if no job is running

    daemon -> client:
      "O" <> text   stdout line (builtins only — jobs/errors, not pty output)
      "E" <> text   stderr line (builtins only)
      "D" <> cwd    sent on connect, and again whenever `cd` changes it
      "H" <> text   sent once after the first "D": which engine this is
      "P" <> bytes  raw pty output, unbuffered — curses programs redraw with
                    "\\r" and escapes that may never contain a "\\n"
      "X" <> code   command complete, exit code as text

  Every message is self-describing by its type byte, so there's no out-of-band
  "raw mode" phase; the client infers its own editing-vs-passthrough mode from
  whether an "X" is still outstanding.

  Foreground jobs run non-blocking, attached to one pty shared by every command
  on this connection (`MeerkatDaemon.Terminal`, which explains why it is shared
  rather than one per command). Their output arrives as the terminal's
  `:stdout`, and their `:DOWN` lands here directly, interleaved with `:tcp`
  messages — which is what lets a keystroke reach a running program instead of
  blocking here for the command's lifetime.
  """
  use GenServer
  require Logger
  alias MeerkatDaemon.{Parser, Evaluator, Identity, JobManager, Ports, Terminal}

  def start_link(socket), do: GenServer.start_link(__MODULE__, socket)

  def child_spec(socket) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [socket]}, restart: :temporary}
  end

  @impl true
  def init(socket) do
    # Without this, a supervisor-initiated shutdown kills this process
    # outright, terminate/2 never runs, and the foreground job leaks.
    Process.flag(:trap_exit, true)

    {:ok,
     %{
       socket: socket,
       cwd: System.get_env("HOME", "/"),
       # Where `cd -` goes back to; nil until the first `cd`.
       oldpwd: nil,
       current: nil,
       # Lines received while `current` was set, oldest first.
       pending: [],
       winsz: {24, 80},
       # Opened on the first foreground command, not here: a connection that
       # only ever runs builtins never needs a pty. See ensure_terminal/1.
       term: nil
     }}
  end

  # Sent by the acceptor once :gen_tcp.controlling_process/2 completed — only
  # then is it safe to touch socket options here.
  @impl true
  def handle_info(:socket_ready, state) do
    :inet.setopts(state.socket, active: :once)
    send_frame(state.socket, ?D, state.cwd)
    # After the cwd, not before: clients that predate it read the first frame
    # as the cwd, and those that know it pick it up from the stream.
    send_frame(state.socket, ?H, Identity.line())
    {:noreply, state}
  end

  def handle_info({:tcp, socket, packet}, state) do
    case packet do
      # A second line while a job holds the pty would start another command on
      # the same terminal, and its :DOWN would then be the one `current` tracks
      # — the first job's exit would never produce an "X". Queue it instead;
      # run_pending/1 picks it up from the :DOWN handler.
      <<?L, line::binary>> when state.current != nil ->
        :inet.setopts(socket, active: :once)
        {:noreply, %{state | pending: state.pending ++ [line]}}

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
        forward_input(data, state)
        :inet.setopts(socket, active: :once)
        {:noreply, state}

      <<?R, rows::16, cols::16>> ->
        # Stored either way: a terminal opened later starts at the right size,
        # which is what stops a program's first frame being drawn to 24x80.
        if state.term, do: Terminal.resize(state.term, rows, cols)
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

  # Everything written to this connection's terminal, by whichever command holds
  # it. The anchor is what erlexec reports to, since the commands write to the
  # pty as a file rather than through erlexec. A pty merges stdout and stderr
  # onto one fd, so :stderr shouldn't normally fire, but it is handled the same
  # way defensively.
  def handle_info({:stdout, os_pid, data}, %{term: %{os_pid: os_pid}} = state) do
    send_frame(state.socket, ?P, data)
    {:noreply, state}
  end

  def handle_info({:stderr, os_pid, data}, %{term: %{os_pid: os_pid}} = state) do
    send_frame(state.socket, ?P, data)
    {:noreply, state}
  end

  def handle_info(
        {:DOWN, os_pid, :process, pid, reason},
        %{current: %{os_pid: os_pid, pid: pid, id: id}} = state
      ) do
    exit_code = Evaluator.decode_exit(reason)
    # A finished foreground command has nothing left to say: its output went to
    # the pty as it ran, and `jobs` listing every `ls` ever typed as `done`
    # buries the background jobs the table is for.
    JobManager.remove(id)
    # 128+n means a signal, so the program did not run its own cleanup — and the
    # terminal it may have put into raw mode is shared now, and stays behind.
    if exit_code >= 128 and state.term, do: Terminal.restore(state.term)
    send_frame(state.socket, ?X, Integer.to_string(exit_code))
    run_pending(%{state | current: nil})
  end

  # The anchor holding this connection's pty is gone — killed by hand, or the
  # pty was torn down. Forget the terminal rather than handing its stale device
  # to the next command: macOS recycles ttys numbers, so that path may by then
  # belong to someone else's terminal. ensure_terminal/1 opens a fresh one.
  def handle_info(
        {:DOWN, os_pid, :process, pid, reason},
        %{term: %{os_pid: os_pid, pid: pid}} = state
      ) do
    Logger.warning("terminal anchor exited (#{inspect(reason)}); reopening on the next command")
    {:noreply, %{state | term: nil}}
  end

  # Stale messages from a job we no longer track — ignore rather than crash.
  def handle_info(_msg, state), do: {:noreply, state}

  # The client is gone. Its foreground job was attached to that pane's pty, and
  # for most jobs that is the end of them: an editor or a pager with no window
  # left to draw into can never be reached again, so it dies with the pane.
  #
  # A job holding a listening socket is the exception, and the reason this
  # daemon exists — a dev server should not go down because someone closed the
  # window they started it from. It is left running and labelled `detached`, so
  # `jobs` still reports it, meerkat-app's sidebar can show what it is serving,
  # and `kill <id>` from any connection can still end it.
  #
  # Orphaning is safe because nothing links the OS process to this pid: erlexec
  # kills a job when a *linked* owner dies, and these are started with
  # `:monitor`. The output it goes on producing is delivered to a dead pid and
  # dropped, and once it exits, JobManager.reconcile/1 notices the erlexec
  # handle is gone and closes the entry out on the next read. Background jobs
  # were already left alone.
  @impl true
  def terminate(_reason, state) do
    detached =
      case state.current do
        nil ->
          nil

        %{id: id, pid: pid, os_pid: os_pid} ->
          case Ports.listening(os_pid) do
            [] ->
              :exec.stop(pid)
              JobManager.remove(id)
              nil

            _ports ->
              JobManager.detach(id)
              pid
          end
      end

    # The detached job is still holding this terminal's fds. Closing it now
    # would make the job's next write fail with EIO — for a server that logs
    # each request, a slow death by logging. So the terminal is handed to a
    # watcher that closes it when the job is finally gone.
    case {state.term, detached} do
      {nil, _} -> :ok
      {term, nil} -> Terminal.close(term)
      {term, job_pid} -> Terminal.outlive(term, job_pid)
    end

    :ok
  end

  # ^C arrives as a byte and leaves as a signal. The commands on this terminal
  # are not its foreground process group — they are not session leaders, which
  # is exactly what keeps sudo's credentials valid across commands — so the line
  # discipline has nothing to signal. Delivering it here is what a terminal
  # would have done anyway: to the job's whole process group, so a pipeline's
  # every stage gets it and not just the shell waiting on them.
  defp forward_input(<<3>>, %{current: %{os_pid: os_pid}}) do
    Evaluator.signal_group(os_pid, :sigint)
  end

  # Only while something is running: with no job, the client is echoing locally,
  # and bytes written to the pty would come back doubled.
  defp forward_input(data, %{current: current, term: term}) when current != nil and term != nil do
    Terminal.write(term, data)
  end

  defp forward_input(_data, _state), do: :ok

  # A foreground command needs the terminal; a builtin or a background job does
  # not. Failing to open one is reported and survivable — the connection keeps
  # working for everything that does not need a pty.
  defp ensure_terminal(%{term: nil} = state) do
    case Terminal.open(state.winsz) do
      {:ok, term} ->
        %{state | term: term}

      {:error, reason} ->
        Logger.error("could not open a terminal for this connection: #{inspect(reason)}")
        state
    end
  end

  defp ensure_terminal(state), do: state

  # Runs the next queued line, if any. Called with `current` already cleared.
  # A queued `exit` closes the socket the same way a typed one does.
  defp run_pending(%{pending: []} = state), do: {:noreply, state}

  defp run_pending(%{pending: [line | rest]} = state) do
    case dispatch(line, %{state | pending: rest}) do
      {:continue, %{current: nil} = state} ->
        run_pending(state)

      {:continue, state} ->
        {:noreply, state}

      {:stop, state} ->
        :gen_tcp.close(state.socket)
        {:stop, :normal, state}
    end
  end

  defp dispatch(line, state) do
    case Parser.parse(line) do
      {:error, reason} ->
        send_frame(state.socket, ?E, "parse error: #{reason}")
        send_frame(state.socket, ?X, "1")
        {:continue, state}

      {:ok, %{command: ""}} ->
        send_frame(state.socket, ?X, "0")
        {:continue, state}

      {:ok, parsed} ->
        emit = fn
          :stdout, text -> send_frame(state.socket, ?O, text)
          :stderr, text -> send_frame(state.socket, ?E, text)
        end

        state =
          if parsed.mode == :foreground and not Evaluator.builtin?(parsed),
            do: ensure_terminal(state),
            else: state

        case Evaluator.run(parsed, state.cwd, emit, state.term, oldpwd: state.oldpwd) do
          {:exit, _cwd, _code} ->
            send_frame(state.socket, ?X, "0")
            {:stop, state}

          {:ok, new_cwd, code} ->
            state =
              if new_cwd != state.cwd do
                send_frame(state.socket, ?D, new_cwd)
                %{state | cwd: new_cwd, oldpwd: state.cwd}
              else
                state
              end

            send_frame(state.socket, ?X, Integer.to_string(code))
            {:continue, state}

          {:running, id, pid, os_pid, cwd} ->
            {:continue, %{state | current: %{id: id, pid: pid, os_pid: os_pid}, cwd: cwd}}
        end
    end
  end

  defp send_frame(socket, type, payload) when is_integer(type) and is_binary(payload) do
    :gen_tcp.send(socket, <<type, payload::binary>>)
  end
end
