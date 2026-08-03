defmodule MeerkatDaemonTest do
  use ExUnit.Case
  doctest MeerkatDaemon

  test "greets the world" do
    assert MeerkatDaemon.hello() == :world
  end
end
