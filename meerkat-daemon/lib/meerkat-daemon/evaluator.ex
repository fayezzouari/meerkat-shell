defmodule MeerkatDaemon.Evaluator do
  @moduledoc """
  Executes a parsed pipeline.

  Builtins (`cd`, `exit`, `jobs`) are handled in-process because a child
  OS process can never change the daemon connection's working directory
  or close its own socket. Everything else is joined back into a shell
  command string and run through `sh -c` via a Port, one OS process
  group per pipeline — the same unit a real shell would suspend/resume
  as a single job.

  Note: stdout and stderr are currently merged (`:stderr_to_stdout`) for
  simplicity. Swapping this Port-based exec for `erlexec` in the
  job-control phase gets you separate streams, process-group signals
  (SIGTSTP/SIGCONT/SIGINT), and pty support — this module is the one
  piece designed to be replaced wholesale at that point.
  """

  alias MeerkatDaemon.JobManager

  @type emit :: (:stdout | :stderr, String.t() -> :ok)

  @spec run([MeerkatDaemon.Parser.stage()], String.t(), emit) ::
          {:ok, String.t(), non_neg_integer()} | {:exit, String.t(), non_neg_integer()}
  def run(stages, cwd, emit) do
    case stages do
      [{cmd, args}] when cmd in ["cd", "exit", "quit", "jobs"] ->
        builtin(cmd, args, cwd, emit)

      _ ->
        exec_pipeline(stages, cwd, emit)
    end
  end

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
      [] -> emit.(:stdout, "no jobs")
      jobs -> Enum.each(jobs, fn {id, job} -> emit.(:stdout, "[#{id}] #{job.status}\t#{job.cmd}") end)
    end

    {:ok, cwd, 0}
  end

  defp builtin(word, _args, cwd, _emit) when word in ["exit", "quit"] do
    {:exit, cwd, 0}
  end

  defp exec_pipeline(stages, cwd, emit) do
    cmd_string = Enum.map_join(stages, " | ", &render_stage/1)
    id = JobManager.new_job(cmd_string)
    sh = System.find_executable("sh")

    port =
      Port.open({:spawn_executable, sh}, [
        :binary,
        :exit_status,
        :stderr_to_stdout,
        args: ["-c", cmd_string],
        cd: cwd
      ])

    case Port.info(port, :os_pid) do
      {:os_pid, os_pid} -> JobManager.set_os_pid(id, os_pid)
      _ -> :ok
    end

    exit_code = stream(port, "", emit)
    JobManager.finish_job(id, exit_code)
    {:ok, cwd, exit_code}
  end

  defp stream(port, buffer, emit) do
    receive do
      {^port, {:data, data}} ->
        {complete_lines, remainder} = split_lines(buffer <> data)
        Enum.each(complete_lines, &emit.(:stdout, &1))
        stream(port, remainder, emit)

      {^port, {:exit_status, status}} ->
        if buffer != "", do: emit.(:stdout, buffer)
        status
    end
  end

  defp split_lines(data) do
    parts = String.split(data, "\n")
    {complete, [remainder]} = Enum.split(parts, -1)
    {complete, remainder}
  end

  defp render_stage({cmd, args}), do: Enum.map_join([cmd | args], " ", &shell_quote/1)

  defp shell_quote(arg), do: "'" <> String.replace(arg, "'", "'\\''") <> "'"
end
