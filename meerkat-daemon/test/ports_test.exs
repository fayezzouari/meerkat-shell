defmodule MeerkatDaemon.PortsTest do
  use ExUnit.Case, async: true

  alias MeerkatDaemon.Ports

  describe "parse_proc_net_tcp/1 (Linux)" do
    # Real shape, trimmed to the columns that matter: sl, local_address,
    # rem_address, st, ..., inode. 0A is TCP_LISTEN; 01 is ESTABLISHED.
    @proc_net_tcp """
      sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
       0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41231 1 0000 100
       1: 00000000:1F91 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41232 1 0000 100
       2: 0100007F:8AE2 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 41233 1 0000 100
    """

    test "keeps listening sockets, by inode, with the port in decimal" do
      assert Ports.parse_proc_net_tcp(@proc_net_tcp) == %{41231 => 8080, 41232 => 8081}
    end

    test "an established socket is not a listener" do
      refute Map.has_key?(Ports.parse_proc_net_tcp(@proc_net_tcp), 41233)
    end

    test "a file with only a header, or junk, yields nothing" do
      assert Ports.parse_proc_net_tcp("  sl  local_address rem_address   st\n") == %{}
      assert Ports.parse_proc_net_tcp("") == %{}
      assert Ports.parse_proc_net_tcp("header\nnot a row at all\n") == %{}
    end
  end

  describe "parse_lsof/1 (macOS)" do
    test "assigns each address to the pid above it" do
      out = """
      p4711
      n*:8000
      n127.0.0.1:5432
      p4712
      n[::1]:3000
      """

      assert Ports.parse_lsof(out) == %{4711 => [5432, 8000], 4712 => [3000]}
    end

    test "skips addresses with no port, and the same port twice" do
      out = """
      p4711
      n*:*
      n*:8000
      n127.0.0.1:8000
      """

      assert Ports.parse_lsof(out) == %{4711 => [8000]}
    end

    test "no matches at all is an empty map, not a crash" do
      assert Ports.parse_lsof("") == %{}
      # An address before any pid line has nothing to belong to.
      assert Ports.parse_lsof("n*:8000\n") == %{}
    end
  end

  describe "listening/1" do
    test "no pid, no ports" do
      assert Ports.listening(nil) == []
    end

    test "finds a port through the sh -c the pipeline actually runs under" do
      # The shape of a real job: erlexec hands back the `sh -c` pid, and the
      # listener is its child — so this only passes if the tree is walked.
      port = 49_181

      {:ok, _pid, listener} = :exec.run(~c"sh -c 'nc -l #{port} > /dev/null 2>&1'", [:monitor])

      on_exit(fn -> System.cmd("pkill", ["-f", "nc -l #{port}"], stderr_to_stdout: true) end)

      # The socket is not bound the instant the shell starts.
      assert eventually(fn -> Ports.listening(listener) == [port] end),
             "expected #{port} in #{inspect(Ports.listening(listener))}"
    end
  end

  # A freshly spawned shell has not bound its socket yet, and how long that takes
  # is the listener's business, not ours.
  defp eventually(fun, attempts \\ 40) do
    Enum.reduce_while(1..attempts, false, fn _, _ ->
      if fun.() do
        {:halt, true}
      else
        Process.sleep(50)
        {:cont, false}
      end
    end)
  end
end
