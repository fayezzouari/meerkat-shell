defmodule MeerkatDaemon.ShellEnvTest do
  use ExUnit.Case, async: true

  alias MeerkatDaemon.ShellEnv

  describe "parse/1" do
    test "reads NUL-separated pairs after the marker" do
      out = "\0__MEERKAT_ENV__\0PATH=/a:/b\0TERM=xterm\0"
      assert ShellEnv.parse(out) == %{"PATH" => "/a:/b", "TERM" => "xterm"}
    end

    test "discards whatever the rc files printed before the marker" do
      out = "Welcome!\nPATH=/not/this\n\0__MEERKAT_ENV__\0PATH=/real\0"
      assert ShellEnv.parse(out) == %{"PATH" => "/real"}
    end

    test "a value may itself contain '=' and newlines" do
      out = "\0__MEERKAT_ENV__\0PS1=a=b\nc\0X=1\0"
      assert ShellEnv.parse(out) == %{"PS1" => "a=b\nc", "X" => "1"}
    end

    test "uses the last marker if the rc happened to print one" do
      out = "\0__MEERKAT_ENV__\0FAKE=1\0\0__MEERKAT_ENV__\0REAL=1\0"
      assert ShellEnv.parse(out) == %{"REAL" => "1"}
    end

    test "no marker means nothing was captured" do
      assert ShellEnv.parse("PATH=/a\0") == %{}
      assert ShellEnv.parse("") == %{}
    end
  end

  describe "with_defaults/1" do
    test "supplies a TERM when the shell had none" do
      assert ShellEnv.with_defaults(%{})["TERM"] == "xterm-256color"
    end

    test "leaves an existing TERM alone" do
      assert ShellEnv.with_defaults(%{"TERM" => "screen"})["TERM"] == "screen"
    end
  end

  describe "exec_env/1" do
    test "lays extras over the base and yields charlist pairs" do
      env = Map.new(ShellEnv.exec_env([{"PAGER", "cat"}]))
      assert env[~c"PAGER"] == ~c"cat"
      assert is_list(env[~c"TERM"])
      assert env[~c"PATH"] != nil
    end
  end

  describe "load/0" do
    test "captures the login shell's environment" do
      assert :ok = ShellEnv.load()
      env = Map.new(ShellEnv.exec_env())
      assert env[~c"HOME"] == String.to_charlist(System.get_env("HOME"))
    end
  end
end
