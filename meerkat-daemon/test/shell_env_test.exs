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
    test "lays extras over the base and yields binary pairs" do
      env = Map.new(ShellEnv.exec_env([{"PAGER", "cat"}]))
      assert env["PAGER"] == "cat"
      assert is_binary(env["TERM"])
      assert env["PATH"] != nil
      assert Enum.all?(ShellEnv.exec_env(), fn {k, v} -> is_binary(k) and is_binary(v) end)
    end

    test "erlexec accepts it: empty and non-Latin-1 values included" do
      # The regression: a value with a character past Latin-1 (an em dash in a
      # prompt variable) or an empty one made erlexec refuse the whole env — and
      # with it every foreground command. Prove a command actually runs.
      env =
        ShellEnv.exec_env([
          {"MEERKAT_EMPTY", ""},
          {"MEERKAT_UNICODE", "café — 🦡"},
          {"MEERKAT_PROBE", "yes"}
        ])

      {:ok, [stdout: out]} =
        :exec.run(
          ~c"printf '%s|%s|%s' \"$MEERKAT_PROBE\" \"${MEERKAT_EMPTY-unset}\" \"$MEERKAT_UNICODE\"",
          [:sync, :stdout, {:env, env}]
        )

      # Empty arrives as unset: erlexec has no encoding for "set to nothing".
      assert IO.iodata_to_binary(out) == "yes|unset|café — 🦡"
    end
  end

  describe "load/0" do
    test "captures the login shell's environment" do
      assert :ok = ShellEnv.load()
      env = Map.new(ShellEnv.exec_env())
      assert env["HOME"] == System.get_env("HOME")
    end
  end
end
