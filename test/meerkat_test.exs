defmodule MeerkatTest do
  use ExUnit.Case
  doctest Meerkat

  test "greets the world" do
    assert Meerkat.hello() == :world
  end
end
