defmodule MeerkatDaemon.TerminalTest do
  use ExUnit.Case, async: false

  alias MeerkatDaemon.Terminal

  setup do
    {:ok, term} = Terminal.open({24, 80})
    on_exit(fn -> Terminal.close(term) end)
    %{term: term}
  end

  test "opens a pty and reports its device", %{term: term} do
    assert term.tty =~ ~r{^/dev/[[:alnum:]/]+$}
    assert is_integer(term.os_pid)
    assert Process.alive?(term.pid)
  end

  test "each terminal is its own", %{term: term} do
    {:ok, other} = Terminal.open({24, 80})
    on_exit(fn -> Terminal.close(other) end)
    refute other.tty == term.tty
  end

  describe "what the shared terminal is for" do
    # The whole point: commands pointed at one terminal stay in one session, so
    # sudo's timestamp — keyed on the terminal plus the session leader's start
    # time — is still valid on the second command. A pty per command made every
    # command its own session leader and every sudo ask again.
    test "commands on it share a session, and still see a tty", %{term: term} do
      results = for _ <- 1..3, do: probe(term)

      assert [%{sid: sid} | _] = results
      assert Enum.all?(results, &(&1.sid == sid)), "sessions differed: #{inspect(results)}"
      assert Enum.all?(results, &(&1.tty == term.tty)), "terminals differed: #{inspect(results)}"
      assert Enum.all?(results, & &1.isatty), "not a tty: #{inspect(results)}"
    end

    test "and none of them is the session leader", %{term: term} do
      # If a command were the leader, its sid would be its own pid — which is
      # exactly the state that breaks sudo.
      %{sid: sid, pid: pid} = probe(term)
      refute sid == pid
    end
  end

  # Runs a command on `term` and reads what it printed back off the terminal.
  # The anchor is what erlexec reports the pty's output under, so the answer
  # arrives as the anchor's stream rather than the command's.
  defp probe(%{tty: tty, os_pid: anchor} = _term) do
    code =
      "import os;print('R',os.getpid(),os.getsid(0),os.ttyname(0),os.isatty(0),flush=True)"

    {:ok, _pid, os_pid} =
      :exec.run(
        ~c"python3 -c " ++ String.to_charlist(shell_quote(code)),
        [{:stdin, tty}, {:stdout, tty}, {:stderr, tty}, :monitor]
      )

    assert_down(os_pid)

    line = read_line(anchor)
    [_, pid, sid, ttyname, isatty] = String.split(line)

    %{
      pid: String.to_integer(pid),
      sid: String.to_integer(sid),
      tty: ttyname,
      isatty: isatty == "True"
    }
  end

  defp shell_quote(s), do: "'" <> String.replace(s, "'", "'\\''") <> "'"

  defp assert_down(os_pid) do
    receive do
      {:DOWN, ^os_pid, :process, _pid, reason} -> reason
    after
      10_000 -> flunk("the probe never exited")
    end
  end

  # The terminal echoes as well as prints, so pick out the marked line.
  defp read_line(anchor, acc \\ "") do
    case Enum.find(String.split(acc, ~r/\r?\n/), &String.starts_with?(&1, "R ")) do
      nil ->
        receive do
          {stream, ^anchor, data} when stream in [:stdout, :stderr] ->
            read_line(anchor, acc <> data)
        after
          10_000 -> flunk("no output on the terminal, saw: #{inspect(acc)}")
        end

      line ->
        line
    end
  end
end
