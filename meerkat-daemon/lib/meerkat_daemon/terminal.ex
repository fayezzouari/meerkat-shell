defmodule MeerkatDaemon.Terminal do
  @moduledoc """
  One pty per connection, shared by every command that runs on it.

  The obvious way to give a command a terminal is to let erlexec allocate one
  per process, which is what this used to do. It costs `sudo`. A process can
  only claim a controlling terminal by first becoming a session leader, so a
  pty per command is a *session* per command — and `sudo`'s timestamp record is
  keyed on the terminal plus the start time of that session's leader. A new
  leader every command means the record is always stale, so every `sudo` asks
  for a password again, which is not what a terminal does.

  So the pty is opened once and the commands are pointed at it:

      anchor:   sh -c "tty; trap '' INT; exec sleep ..."   :pty, session leader
      command:  {stdin, /dev/ttysNNN}, {stdout, ...}, {stderr, ...}   no pty

  The anchor exists only to own the session and hold the pty open. Every command
  gets the slave device on fds 0/1/2, so `isatty` is true and programs behave as
  they do on a terminal, but none of them calls `setsid` — they stay in the port
  program's session, whose leader outlives them all. `sudo` sees one terminal
  and one session for the life of the connection, and caches accordingly.

  Two things follow from the commands not owning the terminal, both handled by
  `MeerkatDaemon.Connection`:

    * The line discipline's signals have nobody to go to — the pty's foreground
      process group is the anchor's, not the command's. `^C` is therefore
      delivered as an explicit SIGINT rather than as a byte, and the anchor
      ignores SIGINT so a stray one cannot take the session down.
    * The terminal has to outlive a detached job. A job left running when its
      client disconnects still holds these fds; closing the pty under it would
      make its next write fail with EIO, which for a chatty server means death
      by logging. `outlive/2` keeps the anchor for exactly as long as the job.
  """

  require Logger

  @type t :: %{pid: pid(), os_pid: pos_integer(), tty: String.t()}

  # The `tty` at the front is how the slave device gets named: erlexec reports
  # no pty path, and the process itself is the only thing that can see it.
  # `exec` so that the shell is replaced rather than left waiting on a child.
  @anchor ~c"tty; trap '' INT; exec sleep 2147483647"

  # The anchor prints its device immediately; anything slower than this is a
  # machine in trouble, and a connection is better off failing than hanging.
  @tty_timeout 5_000

  @doc """
  Opens the connection's terminal and returns it once its device is known.

  Runs in the caller's process, so the anchor's output arrives in the caller's
  mailbox — `Connection` forwards it to the client as pty output. The selective
  receive here only takes the anchor's own messages; anything else waiting
  (client input, for one) is left where it is.
  """
  @spec open({non_neg_integer(), non_neg_integer()}) :: {:ok, t} | {:error, term()}
  def open({rows, cols}) do
    case :exec.run(@anchor, [
           :stdin,
           :stdout,
           :stderr,
           :monitor,
           :pty,
           :pty_echo,
           {:winsz, {rows, cols}}
         ]) do
      {:ok, pid, os_pid} -> await_tty(pid, os_pid, "")
      {:error, reason} -> {:error, reason}
    end
  end

  # Either stream: a pty merges stdout and stderr onto one fd, and which tag
  # erlexec reports it under is its own business — in practice, :stderr.
  defp await_tty(pid, os_pid, acc) do
    receive do
      {stream, ^os_pid, data} when stream in [:stdout, :stderr] ->
        acc = acc <> data

        case Regex.run(~r{/dev/[[:alnum:]/]+}, acc) do
          [tty] -> {:ok, %{pid: pid, os_pid: os_pid, tty: tty}}
          nil -> await_tty(pid, os_pid, acc)
        end

      {:DOWN, ^os_pid, :process, ^pid, reason} ->
        {:error, {:anchor_exited, reason}}
    after
      @tty_timeout ->
        :exec.stop(pid)
        {:error, :no_tty}
    end
  end

  @doc "Raw bytes to the terminal, as if typed on it."
  @spec write(t, binary()) :: any()
  def write(%{os_pid: os_pid}, data), do: :exec.send(os_pid, data)

  @doc "Tells the pty its new size, which is what raises SIGWINCH."
  @spec resize(t, non_neg_integer(), non_neg_integer()) :: any()
  def resize(%{os_pid: os_pid}, rows, cols), do: :exec.winsz(os_pid, rows, cols)

  @doc """
  Puts the terminal back into a sane mode.

  Only needed because the terminal now outlives the commands on it. A program
  that sets raw mode restores it on the way out, but one killed by a signal
  never gets to — and where that used to take its private pty with it, it now
  leaves this one with no echo and no line editing for whatever runs next.
  Fire-and-forget: nothing waits on the result, and a terminal that cannot be
  reset is not worth failing a command over.
  """
  @spec restore(t) :: any()
  def restore(%{tty: tty}) do
    :exec.run(~c"stty sane", [{:stdin, tty}, {:stdout, tty}, {:stderr, tty}])
  end

  @doc "Closes the terminal. Any command still holding its fds loses them."
  @spec close(t) :: any()
  def close(%{pid: pid}), do: :exec.stop(pid)

  @doc """
  Keeps the terminal open until `job_pid` is gone, then closes it.

  For a job that outlived its client: it is still writing to these fds. The
  watcher is unlinked and polls rather than monitoring, because the job's
  erlexec handle reports to whoever started it and that process is on its way
  out — the same reason `JobManager.reconcile/1` checks liveness on read.
  """
  @spec outlive(t, pid()) :: pid()
  def outlive(term, job_pid) do
    spawn(fn -> watch(term, job_pid) end)
  end

  # Ten seconds: nothing is waiting on this, and a detached job usually runs for
  # a great deal longer than the poll interval.
  defp watch(term, job_pid) do
    if Process.alive?(job_pid) do
      Process.sleep(10_000)
      watch(term, job_pid)
    else
      Logger.debug("closing the terminal held for a detached job")
      close(term)
    end
  end
end
