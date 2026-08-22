defmodule MeerkatDaemon.Ports do
  @moduledoc """
  Which TCP ports a job is listening on.

  Two callers, one question. `jobs` reports the ports so a frontend can show
  that job 2 is the thing holding :8000, and `Connection.terminate/2` asks the
  same question to decide whether a job outlives the window that started it: a
  process with a listening socket is serving something, and killing it because a
  pane closed is exactly the loss this daemon exists to prevent. Nothing else
  gets that reprieve — an editor left in a closed pane is unreachable, so it
  still dies with its pty.

  The pid handed out by erlexec is the pipeline's `sh -c`, and the listener is
  usually its child, so every lookup walks the process tree first. That tree
  comes from `ps`, which is the same shape on macOS and Linux; the sockets do
  not, so there are two implementations:

    * Linux reads `/proc` — the listening sockets from `/proc/net/tcp{,6}`,
      keyed by inode, matched against the `socket:[inode]` links in
      `/proc/<pid>/fd`. No dependency to be missing.
    * Everywhere else shells out to `lsof`, which macOS ships.

  Both are asked for a specific set of pids rather than for the whole machine,
  since the caller always knows which jobs it cares about.
  """

  @doc """
  Listening ports for each of `roots` and its descendants, keyed by root pid.

  One `ps` and one socket lookup for the whole batch, so reporting twenty jobs
  costs what reporting one does.
  """
  @spec listening_by_root([pos_integer()]) :: %{pos_integer() => [pos_integer()]}
  def listening_by_root([]), do: %{}

  def listening_by_root(roots) do
    children = child_index()
    trees = Map.new(roots, fn root -> {root, tree(root, children)} end)

    by_pid =
      trees
      |> Map.values()
      |> Enum.concat()
      |> Enum.uniq()
      |> ports_for()

    Map.new(trees, fn {root, pids} ->
      {root, pids |> Enum.flat_map(&Map.get(by_pid, &1, [])) |> Enum.uniq() |> Enum.sort()}
    end)
  end

  @doc "Listening ports for one job's process tree."
  @spec listening(pos_integer() | nil) :: [pos_integer()]
  def listening(nil), do: []

  def listening(root) when is_integer(root) do
    Map.get(listening_by_root([root]), root, [])
  end

  ## The process tree ---------------------------------------------------

  # %{ppid => [pid]}. Same `ps` invocation as meerkat-app's RSS walk, and for
  # the same reason: erlexec puts every job it spawns in the port program's one
  # process group, so a group query would answer for all of them at once.
  defp child_index do
    case cmd("ps", ["-axo", "pid=,ppid="]) do
      {:ok, out} ->
        out
        |> String.split("\n", trim: true)
        |> Enum.reduce(%{}, fn line, acc ->
          case line |> String.split() |> Enum.map(&Integer.parse/1) do
            [{pid, ""}, {ppid, ""}] -> Map.update(acc, ppid, [pid], &[pid | &1])
            _ -> acc
          end
        end)

      :error ->
        %{}
    end
  end

  # Breadth-first, with a seen set: a pid table read line by line is not a
  # guaranteed-acyclic snapshot, and a cycle here would loop forever.
  defp tree(root, children), do: tree([root], children, MapSet.new())

  defp tree([], _children, seen), do: MapSet.to_list(seen)

  defp tree([pid | rest], children, seen) do
    if MapSet.member?(seen, pid) do
      tree(rest, children, seen)
    else
      tree(rest ++ Map.get(children, pid, []), children, MapSet.put(seen, pid))
    end
  end

  ## The sockets --------------------------------------------------------

  defp ports_for([]), do: %{}

  defp ports_for(pids) do
    if File.dir?("/proc"), do: proc_ports(pids), else: lsof_ports(pids)
  end

  # Linux. /proc/net/tcp gives the listening sockets but names them by inode,
  # not by pid; the owner is whichever process has a socket:[inode] link in its
  # fd directory. Both files are read once and the fd walk is limited to the
  # pids asked about.
  defp proc_ports(pids) do
    by_inode = listening_inodes()

    if by_inode == %{} do
      %{}
    else
      Map.new(pids, fn pid -> {pid, socket_ports(pid, by_inode)} end)
    end
  end

  defp listening_inodes do
    ["/proc/net/tcp", "/proc/net/tcp6"]
    |> Enum.map(fn path ->
      case File.read(path) do
        {:ok, body} -> parse_proc_net_tcp(body)
        {:error, _} -> %{}
      end
    end)
    |> Enum.reduce(%{}, &Map.merge(&2, &1))
  end

  @doc """
  Listening sockets in one `/proc/net/tcp` file, as `%{inode => port}`.

  Public only so it can be tested from a fixture: the file it parses does not
  exist on the machine most of this is developed on.
  """
  @spec parse_proc_net_tcp(String.t()) :: %{pos_integer() => pos_integer()}
  def parse_proc_net_tcp(body) do
    body
    |> String.split("\n", trim: true)
    # The header row.
    |> Enum.drop(1)
    |> Enum.reduce(%{}, fn line, acc ->
      # sl local_address rem_address st ... inode, whitespace-separated; "0A"
      # is TCP_LISTEN.
      fields = String.split(line)

      with ["0A", local, inode] <- [Enum.at(fields, 3), Enum.at(fields, 1), Enum.at(fields, 9)],
           {:ok, port} <- hex_port(local),
           {inode_n, ""} <- Integer.parse(inode) do
        Map.put(acc, inode_n, port)
      else
        _ -> acc
      end
    end)
  end

  # "0100007F:1F90" — the port is the hex after the colon.
  defp hex_port(local) do
    case String.split(local, ":") do
      [_addr, hex] ->
        case Integer.parse(hex, 16) do
          {port, ""} -> {:ok, port}
          _ -> :error
        end

      _ ->
        :error
    end
  end

  defp socket_ports(pid, by_inode) do
    case File.ls("/proc/#{pid}/fd") do
      {:ok, fds} ->
        fds
        |> Enum.flat_map(fn fd ->
          case File.read_link("/proc/#{pid}/fd/#{fd}") do
            {:ok, "socket:[" <> rest} ->
              with {inode, "]"} <- Integer.parse(rest),
                   port when is_integer(port) <- Map.get(by_inode, inode) do
                [port]
              else
                _ -> []
              end

            _ ->
              []
          end
        end)
        |> Enum.uniq()

      # A job that exited between the ps and here, or someone else's process.
      {:error, _} ->
        []
    end
  end

  # macOS and anything else with lsof. -F is its parseable output: one field per
  # line, tagged by its first character, `p` for a pid and `n` for the address a
  # file is bound to. Fields belong to the last `p` seen.
  defp lsof_ports(pids) do
    args = ["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-F", "pn", "-p", Enum.join(pids, ",")]

    case cmd("lsof", args) do
      {:ok, out} -> parse_lsof(out)
      :error -> %{}
    end
  end

  @doc """
  `lsof -F pn` output, as `%{pid => [port]}`.

  Public for the same reason as `parse_proc_net_tcp/1`: the shape of this output
  is worth a test that does not depend on what happens to be listening.
  """
  @spec parse_lsof(String.t()) :: %{pos_integer() => [pos_integer()]}
  def parse_lsof(out) do
    out
    |> String.split("\n", trim: true)
    |> Enum.reduce({%{}, nil}, fn line, {acc, pid} ->
      case line do
        "p" <> digits ->
          case Integer.parse(digits) do
            {parsed, ""} -> {acc, parsed}
            _ -> {acc, nil}
          end

        "n" <> name when pid != nil ->
          case address_port(name) do
            {:ok, port} -> {Map.update(acc, pid, [port], &Enum.uniq([port | &1])), pid}
            :error -> {acc, pid}
          end

        _ ->
          {acc, pid}
      end
    end)
    |> elem(0)
  end

  # "*:8000", "127.0.0.1:8000", "[::1]:8000" — the port is what follows the
  # last colon. "*:*" and the like carry no port.
  defp address_port(name) do
    case name |> String.split(":") |> List.last() do
      nil ->
        :error

      tail ->
        case Integer.parse(tail) do
          {port, ""} -> {:ok, port}
          _ -> :error
        end
    end
  end

  # Every shell-out here is bounded and forgiving, because of where it runs:
  # `Connection.terminate/2` asks this question while a client is disconnecting,
  # and `lsof` is the kind of tool that can sit for a long time on an
  # unresponsive mount. A slow or missing answer is treated as "nothing is
  # listening" — that job then dies with its pane, which is what happened before
  # any of this existed. A hung disconnect would be the new failure.
  #
  # The raise is caught inside the task rather than around it: Task.async links,
  # so a task exiting abnormally would take an untrapped caller with it.
  @timeout 2_000

  defp cmd(exe, args) do
    task =
      Task.async(fn ->
        try do
          {out, _status} = System.cmd(exe, args, stderr_to_stdout: false)
          {:ok, out}
        rescue
          # No such executable — lsof is not installed.
          ErlangError -> :error
        end
      end)

    case Task.yield(task, @timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, result} -> result
      _timeout_or_crash -> :error
    end
  end
end
