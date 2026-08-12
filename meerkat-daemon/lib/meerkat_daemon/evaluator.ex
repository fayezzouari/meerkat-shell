defmodule MeerkatDaemon.Evaluator do
  @moduledoc """
  Executes a parsed pipeline via erlexec rather than a plain `Port`, which
  is what makes job control possible: erlexec hands back an OS pid real
  signals can be delivered to, where a `Port` can only be closed.

  Builtins: `cd`, `exit`/`quit`, `jobs`, `fg`, `bg`, `kill`, `stop`.
  Everything else runs through `sh -c`, one OS process group per pipeline —
  the unit `fg`/`bg`/`kill`/`stop` operate on.

  Foreground pipelines run attached to a pty and return immediately, since
  `Connection` must keep handling client messages while the job runs; it owns
  the erlexec message loop directly and reuses `decode_exit/1`. Background
  jobs get no pty and run through the blocking `stream/5` loop inside a Task,
  capturing output into `JobManager`.

  `fg` blocks until the job finishes and then replays its *captured* output;
  it does not re-route the job's live stdout/stderr, which would mean
  redirecting erlexec's message target mid-flight.
  """

  alias MeerkatDaemon.JobManager

  @type emit :: (:stdout | :stderr, String.t() -> :ok)
  @type winsz :: {rows :: non_neg_integer(), cols :: non_neg_integer()}

  @builtins ~w(cd exit quit jobs fg bg kill stop)

  @spec run([MeerkatDaemon.Parser.stage()], String.t(), MeerkatDaemon.Parser.mode(), emit, winsz) ::
          {:ok, String.t(), non_neg_integer()}
          | {:exit, String.t(), non_neg_integer()}
          | {:running, pos_integer(), pid(), non_neg_integer(), String.t()}
  def run(stages, cwd, mode, emit, winsz \\ {24, 80}) do
    case stages do
      [{cmd, args}] when cmd in @builtins -> builtin(cmd, args, cwd, emit)
      _ -> exec_pipeline(stages, cwd, mode, emit, winsz)
    end
  end

  ## Builtins ---------------------------------------------------------

  defp builtin("cd", args, cwd, emit) do
    target =
      case args do
        [] -> System.get_env("HOME", "/")
        [path | _] -> Path.expand(path, cwd)
      end

    if File.dir?(target) do
      {:ok, target, 0}
    else
      emit.(:stderr, "cd: no such directory: #{target}")
      {:ok, cwd, 1}
    end
  end

  defp builtin("jobs", _args, cwd, emit) do
    case JobManager.list_jobs() do
      [] ->
        emit.(:stdout, "no jobs")

      jobs ->
        Enum.each(jobs, fn {id, job} ->
          suffix = if job.exit_code, do: " (exit #{job.exit_code})", else: ""
          # The trailing os_pid lets meerkat-app's ListJobs measure the OS
          # process without a protocol message of its own.
          emit.(:stdout, "[#{id}] #{job.status}#{suffix}\t#{job.cmd}\t#{job.os_pid}")
        end)
    end

    {:ok, cwd, 0}
  end

  defp builtin(word, _args, cwd, _emit) when word in ["exit", "quit"] do
    {:exit, cwd, 0}
  end

  defp builtin("fg", args, cwd, emit), do: with_job(args, cwd, emit, &do_fg/3)
  defp builtin("bg", args, cwd, emit), do: with_job(args, cwd, emit, &do_bg/3)
  defp builtin("kill", args, cwd, emit), do: with_job(args, cwd, emit, &do_kill/3)
  defp builtin("stop", args, cwd, emit), do: with_job(args, cwd, emit, &do_stop/3)

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
    if job.status == :stopped, do: :exec.kill(job.os_pid, :sigcont)
    if job.status != :done, do: JobManager.set_status(id, :running)

    case JobManager.await(id, 30_000) do
      {:ok, exit_code} ->
        replay_output(id, emit)
        exit_code

      {:error, :timeout} ->
        emit.(:stderr, "[#{id}] still running — fg gave up waiting after 30s")
        0
    end
  end

  defp do_bg(id, job, emit) do
    if job.status == :stopped do
      :exec.kill(job.os_pid, :sigcont)
      JobManager.set_status(id, :running)
      emit.(:stdout, "[#{id}] resumed in background")
      0
    else
      emit.(:stderr, "[#{id}] is not stopped")
      1
    end
  end

  defp do_kill(id, job, emit) do
    if job.pid do
      :exec.stop(job.pid)
      emit.(:stdout, "[#{id}] killed")
      0
    else
      emit.(:stderr, "[#{id}] has no live handle (already finished?)")
      1
    end
  end

  defp do_stop(id, job, emit) do
    if job.status == :running and job.os_pid do
      :exec.kill(job.os_pid, :sigstop)
      JobManager.set_status(id, :stopped)
      emit.(:stdout, "[#{id}] stopped")
      0
    else
      emit.(:stderr, "[#{id}] is not running")
      1
    end
  end

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

  ## Pipeline execution -------------------------------------------------

  # Returns immediately without streaming: erlexec's messages land in the
  # caller's (Connection's) mailbox, interleaved with client :tcp messages,
  # which is what lets keystrokes reach the running program.
  #
  # pty_echo is on because the client stops echoing locally while a job runs.
  #
  # PAGER/GIT_PAGER/MANPAGER are forced to `cat`: with a real pty, isatty()
  # succeeds and git/man reach for `less`, which then blocks on keystrokes and
  # looks exactly like a hung command. Directly-invoked pagers still work.
  defp exec_pipeline(stages, cwd, :foreground, _emit, {rows, cols}) do
    cmd_string = render(stages)
    id = JobManager.new_job(cmd_string)

    {:ok, pid, os_pid} =
      :exec.run(cmd_string, [
        :stdin,
        :stdout,
        :stderr,
        :monitor,
        :pty,
        :pty_echo,
        {:cd, cwd},
        {:winsz, {rows, cols}},
        {:env, [{"PAGER", "cat"}, {"GIT_PAGER", "cat"}, {"MANPAGER", "cat"}]}
      ])

    JobManager.set_handle(id, pid, os_pid)
    {:running, id, pid, os_pid, cwd}
  end

  defp exec_pipeline(stages, cwd, :background, emit, _winsz) do
    cmd_string = render(stages)
    id = JobManager.new_job(cmd_string)

    Task.start(fn ->
      {:ok, pid, os_pid} = :exec.run(cmd_string, [:stdout, :stderr, :monitor, {:cd, cwd}])
      JobManager.set_handle(id, pid, os_pid)

      capture = fn tag, text -> JobManager.append_output(id, tag, text) end
      stream(id, pid, os_pid, "", "", capture)
    end)

    emit.(:stdout, "[#{id}] started in background")
    {:ok, cwd, 0}
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

  def decode_exit(:normal), do: 0

  def decode_exit({:exit_status, raw}) do
    case :exec.status(raw) do
      {:status, code} -> code
      # Bash convention: 128+signum. Unmapped signals fall back to 1.
      {:signal, sig, _core_dumped} -> 128 + signal_number(sig)
    end
  end

  def decode_exit(_other), do: 1

  @signals %{sighup: 1, sigint: 2, sigquit: 3, sigkill: 9, sigsegv: 11, sigpipe: 13, sigterm: 15}
  defp signal_number(sig), do: Map.get(@signals, sig, 1)

  defp split_lines(data) do
    parts = String.split(data, "\n")
    {complete, [remainder]} = Enum.split(parts, -1)
    {complete, remainder}
  end

  defp render(stages), do: Enum.map_join(stages, " | ", &render_stage/1)
  defp render_stage({cmd, args}), do: Enum.map_join([cmd | args], " ", &shell_quote/1)
  defp shell_quote(arg), do: "'" <> String.replace(arg, "'", "'\\''") <> "'"
end
