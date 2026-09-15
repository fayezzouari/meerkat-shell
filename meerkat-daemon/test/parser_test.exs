defmodule MeerkatDaemon.ParserTest do
  use ExUnit.Case, async: true

  alias MeerkatDaemon.Parser

  test "a plain command keeps its words and the line" do
    assert {:ok, %{words: ["ls", "-la"], command: "ls -la", mode: :foreground}} =
             Parser.parse("ls -la")
  end

  test "quotes and backslashes are honoured for builtin arguments" do
    assert {:ok, %{words: ["cd", "My Dir"]}} = Parser.parse(~S(cd "My Dir"))
    assert {:ok, %{words: ["cd", "My Dir"]}} = Parser.parse(~S(cd 'My Dir'))
    assert {:ok, %{words: ["cd", "My Dir"]}} = Parser.parse(~S(cd My\ Dir))
    assert {:ok, %{words: ["echo", ~S(say "hi")]}} = Parser.parse(~S(echo "say \"hi\""))
  end

  test "the command text is the line as typed, so the shell sees shell syntax" do
    line = ~S(echo $HOME > out.txt; ls *.md)
    assert {:ok, %{words: nil, command: ^line}} = Parser.parse(line)
  end

  test "control operators mean the line can never be a builtin" do
    for line <- ["cd /tmp && ls", "cd /tmp; ls", "cd /tmp || true", "cd /tmp | cat"] do
      assert {:ok, %{words: nil}} = Parser.parse(line), line
    end
  end

  test "a trailing & runs in the background and is stripped from the command" do
    assert {:ok, %{words: ["sleep", "5"], command: "sleep 5", mode: :background}} =
             Parser.parse("sleep 5 &")

    assert {:ok, %{command: "sleep 5", mode: :background}} = Parser.parse("  sleep 5&  ")
    assert {:ok, %{words: nil, command: "a | b", mode: :background}} = Parser.parse("a | b &")
  end

  test "a lone & anywhere else is an error, but && is an operator" do
    assert {:error, "'&' is only supported at the end of a command"} = Parser.parse("a & b")
    assert {:error, _} = Parser.parse("a & b &")
    assert {:ok, %{words: nil, mode: :foreground}} = Parser.parse("a && b")
  end

  test "unterminated quotes are rejected before the shell sees them" do
    assert {:error, "unterminated ' quote"} = Parser.parse("echo 'x")
    assert {:error, "unterminated \" quote"} = Parser.parse(~S(echo "x))
  end

  test "blank input parses to an empty command" do
    assert {:ok, %{words: [], command: ""}} = Parser.parse("")
    assert {:ok, %{words: [], command: ""}} = Parser.parse("   \t ")
  end

  test "invalid UTF-8 is a parse error, not a crash" do
    assert {:error, "input is not valid UTF-8"} = Parser.parse(<<"caf", 0xE9>>)
  end
end
