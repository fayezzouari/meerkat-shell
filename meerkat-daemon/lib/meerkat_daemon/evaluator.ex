defmodule MeerkatDaemon.Evaluator do
  @moduledoc """
  Executes a parsed line via erlexec rather than a plain `Port`, which is what
  makes job control possible: erlexec hands back an OS pid real signals can be
  delivered to, where a `Port` can only be closed.

  Builtins: `cd`, `exit`/`quit`, `jobs`, `fg`, `bg`, `kill`, `stop`, `engine`.
  Everything else is handed to `/bin/sh -c` as typed — one shell, one OS process
  group per line. The group is the unit `fg`/`bg`/`kill`/`stop` and `^C`
  operate on: every signal goes to `-pgid`, so a pipeline's stages and anything
  the shell forked all get it, not just the shell that is waiting on them.

  `/bin/sh` explicitly, not `$SHELL`: erlexec's default for a string command is
  whatever `SHELL` the engine itself inherited, which is unset under launchd and
  is `fish` or `nu` for some users, neither of which speaks the syntax this
  module (and the terminal anchor) relies on.

  Foreground pipelines run attached to a pty and return immediately, since
  `Connection` must keep handling client messages while the job runs; it owns
  the erlexec message loop directly and reuses `decode_exit/1`. Background
  jobs get no pty and run through the blocking `stream/5` loop inside a Task,
  capturing output into `JobManager`.

  `fg` blocks until the job finishes and then replays its *captured* output;
  it does not re-route the job's live stdout/stderr, which would mean
  redirecting erlexec's message target mid-flight.
  """

  import Bitwise

  alias MeerkatDaemon.{JobManager, Parser, Ports, ShellEnv}

  @type emit :: (:stdout | :stderr, String.t() -> :ok)

  @builtins ~w(cd exit quit jobs fg bg kill stop engine)

  @shell "/bin/sh"

  @doc "Whether the line is one this module answers itself, without a shell or a pty."
  @spec builtin?(Parser.t()) :: boolean()
  def builtin?(%{words: [cmd | _]}) when cmd in @builtins, do: true
  def builtin?(_), do: false

  @doc """
  Runs one parsed line.

  `opts[:oldpwd]` is the previous working directory, for `cd -`.
  """
  @spec run(Parser.t(), String.t(), emit, MeerkatDaemon.Terminal.t() | nil, keyword()) ::
          {:ok, String.t(), non_neg_integer()}
          | {:exit, String.t(), non_neg_integer()}
          | {:running, pos_integer(), pid(), non_neg_integer(), String.t()}
  def run(parsed, cwd, emit, terminal \\ nil, opts \\ []) do
    case parsed do
      %{words: [cmd | args]} when cmd in @builtins -> builtin(cmd, args, cwd, emit, opts)
      %{command: command, mode: mode} -> exec(command, cwd, mode, emit, terminal)
    end
  end

  ## Builtins ---------------------------------------------------------

  defp builtin("cd", args, cwd, emit, opts) do
    target =
      case args do
        [] -> System.get_env("HOME", "/")
        ["-" | _] -> opts[:oldpwd] || cwd
        [path | _] -> Path.expand(path, cwd)
      end

    cond do
      not File.dir?(target) ->
        emit.(:stderr, "cd: no such directory: #{target}")
        {:ok, cwd, 1}

      # File.dir? is true for a directory we cannot enter, and then every command
      # after it would fail with erlexec's "Cannot chdir" instead of this one.
      match?({:error, _}, File.ls(target)) ->
        emit.(:stderr, "cd: permission denied: #{target}")
        {:ok, cwd, 1}

      true ->
        # Shells print the directory `cd -` landed in, since nothing else says.
        if match?(["-" | _], args), do: emit.(:stdout, target)
        {:ok, target, 0}
    end
  end

  # Which engine this is. The answer to "am I talking to the installed one or
  # the checkout's?", which the prompt does not show and the socket path only
  # implies.
  defp builtin("engine", _args, cwd, emit, _opts) do
    Enum.each(MeerkatDaemon.Identity.describe(), &emit.(:stdout, &1))
    {:ok, cwd, 0}
  end

  # Tab-separated after the status, because everything a frontend wants about a
  # job it cannot see arrives on this one line: os_pid so meerkat-app can measure
  # the process, the listening ports so a server can be recognised as the thing
  # holding :8000, and `detached` for a job whose window is already gone. Ports
  # are asked for in one batch — see MeerkatDaemon.Ports.
  defp builtin("jobs", _args, cwd, emit, _opts) do
    case JobManager.list_jobs() do
      [] ->
        emit.(:stdout, "no jobs")

      jobs ->
        ports = job_ports(jobs)

        Enum.each(jobs, fn {id, job} ->
          suffix = if job.exit_code, do: " (exit #{job.exit_code})", else: ""
          port_list = ports |> Map.get(job.os_pid, []) |> Enum.join(",")
          flags = if job.detached, do: "detached", else: ""

          emit.(
            :stdout,
            "[#{id}] #{job.status}#{suffix}\t#{job.cmd}\t#{job.os_pid}\t#{port_list}\t#{flags}"
          )
        end)
    end

    {:ok, cwd, 0}
  end

  defp builtin(word, _args, cwd, _emit, _opts) when word in ["exit", "quit"] do
    {:exit, cwd, 0}
  end

  defp builtin("fg", args, cwd, emit, _opts), do: with_job(args, cwd, emit, &do_fg/3)
  defp builtin("bg", args, cwd, emit, _opts), do: with_job(args, cwd, emit, &do_bg/3)
  defp builtin("kill", args, cwd, emit, _opts), do: with_job(args, cwd, emit, &do_kill/3)
  defp builtin("stop", args, cwd, emit, _opts), do: with_job(args, cwd, emit, &do_stop/3)

  defp with_job(args, cwd, emit, fun) do
    case parse_job_id(args) do
      {:ok, id} ->
        case JobManager.get_job(id) do
          nil ->
            emit.(:stderr, "no such job: #{id}")
            {:ok, cwd, 1}

          job ->
            code = fun.(id, job, emit)
            {:ok, cwd, code}
        end

      :error ->
        emit.(:stderr, "usage: <command> <job id>")
        {:ok, cwd, 1}
    end
  end

  defp parse_job_id([arg | _]) do
    case Integer.parse(arg) do
      {id, ""} -> {:ok, id}
      _ -> :error
    end
  end

  defp parse_job_id(_), do: :error

  defp do_fg(id, job, emit) do
    if job.status == :stopped, do: signal_group(job.os_pid, :sigcont)
    if job.status != :done, do: JobManager.set_status(id, :running)

    case JobManager.await(id, 30_000) do
      {:ok, exit_code} ->
        replay_output(id, emit)
        exit_code

      {:error, :timeout} ->
        emit.(:stderr, "[#{id}] still running — fg gave up waiting after 30s")
        # 124 is what `timeout(1)` exits with; 0 would claim the job finished.
        124

      {:error, :no_such_job} ->
        emit.(:stderr, "no such job: #{id}")
        1
    end
  end

  defp do_bg(id, job, emit) do
    if job.status == :stopped do
      signal_group(job.os_pid, :sigcont)
      JobManager.set_status(id, :running)
      emit.(:stdout, "[#{id}] resumed in background")
      0
    else
      emit.(:stderr, "[#{id}] is not stopped")
      1
    end
  end

  # `:exec.stop/1` on a job started with `:kill_group` is SIGTERM to the group,
  # escalating to SIGKILL after a timeout if the processes ignore it.
  defp do_kill(id, job, emit) do
    cond do
      job.status == :done ->
        emit.(:stderr, "[#{id}] has already finished")
        1

      job.pid == nil ->
        emit.(:stderr, "[#{id}] has no live handle")
        1

      true ->
        # A stopped process cannot act on SIGTERM; wake it so it can die.
        if job.status == :stopped, do: signal_group(job.os_pid, :sigcont)

        case :exec.stop(job.pid) do
          :ok ->
            emit.(:stdout, "[#{id}] killed")
            0

          {:error, reason} ->
            emit.(:stderr, "[#{id}] could not be killed: #{inspect(reason)}")
            1
        end
    end
  end

  defp do_stop(id, job, emit) do
    if job.status == :running and job.os_pid do
      signal_group(job.os_pid, :sigstop)
      JobManager.set_status(id, :stopped)
      emit.(:stdout, "[#{id}] stopped")
      0
    else
      emit.(:stderr, "[#{id}] is not running")
      1
    end
  end

  @doc """
  Delivers a signal to a job's whole process group.

  Jobs are started with `{:group, 0}`, which makes the shell's pid the group id,
  so `-os_pid` reaches every stage of a pipeline and everything they forked.
  Through `kill(1)` rather than `:exec.kill/2`: erlexec refuses negative pids
  ("Not allowed to send signal to all processes") and only signals its own
  direct children — the shell, never what the shell is waiting on.
  """
  @spec signal_group(pos_integer(), :sigint | :sigstop | :sigcont) :: any()
  def signal_group(os_pid, signal) when is_integer(os_pid) and os_pid > 0 do
    name = signal |> Atom.to_string() |> String.upcase() |> String.replace_prefix("SIG", "")
    System.cmd("/bin/kill", ["-s", name, "--", "-#{os_pid}"], stderr_to_stdout: true)
  end

  def signal_group(_, _), do: :ok

  defp replay_output(id, emit) do
    case JobManager.get_job(id) do
      %{output: output} ->
        output
        |> Enum.reverse()
        |> Enum.each(fn {tag, text} -> emit.(tag, text) end)

      _ ->
        :ok
    end
  end

  # Only jobs that could still be holding a socket: a finished job's os_pid
  # refers to nothing, and asking about it would be one `ps` walk for an answer
  # that is always empty.
  defp job_ports(jobs) do
    jobs
    |> Enum.filter(fn {_id, job} ->
      job.status in [:running, :stopped] and is_integer(job.os_pid)
    end)
    |> Enum.map(fn {_id, job} -> job.os_pid end)
    |> Enum.uniq()
    |> Ports.listening_by_root()
  end

  ## Shell execution ------------------------------------------------------

  # A foreground command is given the connection's terminal rather than one of
  # its own — the slave device on all three fds. See MeerkatDaemon.Terminal for
  # why: a pty per command is a session per command, and `sudo` will not carry
  # credentials across sessions.
  #
  # It returns immediately without streaming. The command's output goes to the
  # pty, so it reaches Connection through the terminal's anchor rather than as
  # this process's :stdout messages; what still lands here is the :DOWN, which
  # is how the exit code gets back.
  #
  # PAGER/GIT_PAGER/MANPAGER are forced to `cat`: with a real pty, isatty()
  # succeeds and git/man reach for `less`, which then blocks on keystrokes and
  # looks exactly like a hung command. Directly-invoked pagers still work.
  #
  # The rest of the environment is the user's shell's, not the engine's — see
  # MeerkatDaemon.ShellEnv for why an engine started by the app has neither
  # the user's PATH nor a TERM.
  defp exec(command, cwd, :foreground, emit, terminal) do
    case terminal do
      %{tty: tty} ->
        id = JobManager.new_job(command)

        start(command, [
          {:stdin, tty},
          {:stdout, tty},
          {:stderr, tty},
          {:cd, cwd},
          {:env, ShellEnv.exec_env([{"PAGER", "cat"}, {"GIT_PAGER", "cat"}, {"MANPAGER", "cat"}])}
        ])
        |> case do
          {:ok, pid, os_pid} ->
            JobManager.set_handle(id, pid, os_pid)
            {:running, id, pid, os_pid, cwd}

          {:error, reason} ->
            report_start_failure(id, reason, emit)
            {:ok, cwd, 127}
        end

      nil ->
        emit.(:stderr, "no terminal for this connection — cannot run a foreground command")
        {:ok, cwd, 1}
    end
  end

  # Started inside the Task, not here: erlexec reports to the process that
  # called `:exec.run`, and the Task is the one that loops on those messages.
  # A start failure is therefore recorded in the job (visible via `fg`/`jobs`)
  # rather than reported on this connection — the line has already returned.
  defp exec(command, cwd, :background, emit, _terminal) do
    id = JobManager.new_job(command)

    Task.start(fn ->
      capture = fn tag, text -> JobManager.append_output(id, tag, text) end

      case start(command, [:stdout, :stderr, {:cd, cwd}, {:env, ShellEnv.exec_env()}]) do
        {:ok, pid, os_pid} ->
          JobManager.set_handle(id, pid, os_pid)
          stream(id, pid, os_pid, "", "", capture)

        {:error, reason} ->
          report_start_failure(id, reason, capture)
      end
    end)

    emit.(:stdout, "[#{id}] started in background")
    {:ok, cwd, 0}
  end

  defp start(command, opts) do
    :exec.run([@shell, "-c", command], [:monitor, {:group, 0}, :kill_group | opts])
  end

  defp report_start_failure(id, reason, emit) do
    emit.(:stderr, "could not start command: #{inspect(reason)}")
    JobManager.finish_job(id, 127)
  end

  # Owns the erlexec message loop for one background job: streams lines to
  # `emit` as they arrive, then records the exit status on :DOWN.
  defp stream(id, pid, os_pid, out_buf, err_buf, emit) do
    receive do
      {:stdout, ^os_pid, data} ->
        {lines, rest} = split_lines(out_buf <> data)
        Enum.each(lines, &emit.(:stdout, &1))
        stream(id, pid, os_pid, rest, err_buf, emit)

      {:stderr, ^os_pid, data} ->
        {lines, rest} = split_lines(err_buf <> data)
        Enum.each(lines, &emit.(:stderr, &1))
        stream(id, pid, os_pid, out_buf, rest, emit)

      {:DOWN, ^os_pid, :process, ^pid, reason} ->
        if out_buf != "", do: emit.(:stdout, out_buf)
        if err_buf != "", do: emit.(:stderr, err_buf)
        exit_code = decode_exit(reason)
        JobManager.finish_job(id, exit_code)
        exit_code
    end
  end

  @doc """
  The exit code for an erlexec `:DOWN` reason, using the shell convention for
  signals: 128 + the signal number, as this OS numbers it.

  Decoded from the raw wait status rather than through `:exec.status/1`, whose
  signal atoms follow one platform's numbering and would be wrong for `SIGBUS`
  or `SIGUSR1` on another.
  """
  def decode_exit(:normal), do: 0

  def decode_exit({:exit_status, raw}) when is_integer(raw) do
    case raw &&& 0x7F do
      0 -> raw >>> 8 &&& 0xFF
      signal -> 128 + signal
    end
  end

  def decode_exit(_other), do: 1

  defp split_lines(data) do
    parts = String.split(data, "\n")
    {complete, [remainder]} = Enum.split(parts, -1)
    {complete, remainder}
  end
end
