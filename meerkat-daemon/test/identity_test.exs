defmodule MeerkatDaemon.IdentityTest do
  use ExUnit.Case, async: true

  alias MeerkatDaemon.Identity

  test "instance id is eight hex chars and stable" do
    assert Identity.instance() =~ ~r/^[0-9a-f]{8}$/
    assert Identity.instance() == Identity.instance()
  end

  test "line round-trips through parse, socket path with spaces included" do
    parsed = Identity.parse(Identity.line())
    assert parsed["version"] == Identity.version()
    assert parsed["instance"] == Identity.instance()
    assert parsed["flavor"] == "test"
    assert parsed["sock"] == MeerkatDaemon.SocketServer.socket_path()

    assert Identity.parse(
             "version=1.2.3 flavor=release instance=abcd1234 pid=42 node=x@y sock=/a b/c.sock"
           ) ==
             %{
               "version" => "1.2.3",
               "flavor" => "release",
               "instance" => "abcd1234",
               "pid" => "42",
               "node" => "x@y",
               "sock" => "/a b/c.sock"
             }
  end

  test "the test engine listens on its configured socket, and says so" do
    assert MeerkatDaemon.SocketServer.listening?(MeerkatDaemon.SocketServer.socket_path())
    refute MeerkatDaemon.SocketServer.listening?("/tmp/meerkat-nothing-here.sock")
  end

  test "version comes from the repository's VERSION file" do
    expected = File.read!(Path.expand("../../VERSION", __DIR__)) |> String.trim()
    assert Identity.version() == expected
  end
end
