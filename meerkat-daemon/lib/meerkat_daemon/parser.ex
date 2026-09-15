defmodule MeerkatDaemon.Parser do
  @moduledoc """
  Decides what a line *is* — a builtin, a command for the shell, or a parse
  error — and whether it runs in the background. It does not interpret shell
  syntax beyond that: everything that is not a builtin is handed to `/bin/sh -c`
  verbatim, so `$HOME`, globs, redirections, `&&`, `;` and subshells all mean
  what they mean in a shell rather than being silently passed as literal
  arguments.

  Tokenizing still happens, for three things: to know the first word (is it a
  builtin?), to give builtins their arguments with quotes and backslash escapes
  honoured (`cd "My Dir"`, `cd My\\ Dir`), and to catch an unterminated quote
  before the shell does. A line containing a control operator (`|`, `&&`, `||`,
  `;`) can never be a builtin, so its words are not kept.

  Only a trailing `&` is the background marker. A lone `&` anywhere else is a
  parse error rather than something surprising.
  """

  @type mode :: :foreground | :background
  @type t :: %{words: [String.t()] | nil, command: String.t(), mode: mode}

  @spec parse(String.t()) :: {:ok, t} | {:error, String.t()}
  def parse(line) when is_binary(line) do
    if String.valid?(line) do
      with {:ok, tokens} <- tokenize(String.to_charlist(line), [], []),
           {:ok, tokens, mode} <- take_background_marker(tokens) do
        {:ok, %{words: words(tokens), command: command_text(line, mode), mode: mode}}
      end
    else
      {:error, "input is not valid UTF-8"}
    end
  end

  # The text the shell sees: the line with a trailing `&` removed.
  defp command_text(line, :foreground), do: String.trim(line)

  defp command_text(line, :background) do
    line |> String.trim() |> String.replace_suffix("&", "") |> String.trim()
  end

  # `nil` when a control operator is present — the whole line belongs to the
  # shell then, and no builtin can claim it.
  defp words(tokens) do
    if Enum.any?(tokens, &match?({:op, _}, &1)) do
      nil
    else
      Enum.map(tokens, fn {:word, w} -> w end)
    end
  end

  ## Tokenizer -------------------------------------------------------------

  defp tokenize([], [], tokens), do: {:ok, Enum.reverse(tokens)}
  defp tokenize([], word, tokens), do: {:ok, Enum.reverse([finish(word) | tokens])}

  defp tokenize([c | rest], word, tokens) when c in [?\s, ?\t] do
    tokenize(rest, [], flush(word, tokens))
  end

  defp tokenize([?&, ?& | rest], word, tokens), do: tokenize(rest, [], [{:op, "&&"} | flush(word, tokens)])
  defp tokenize([?|, ?| | rest], word, tokens), do: tokenize(rest, [], [{:op, "||"} | flush(word, tokens)])
  defp tokenize([?| | rest], word, tokens), do: tokenize(rest, [], [{:op, "|"} | flush(word, tokens)])
  defp tokenize([?; | rest], word, tokens), do: tokenize(rest, [], [{:op, ";"} | flush(word, tokens)])
  defp tokenize([?& | rest], word, tokens), do: tokenize(rest, [], [:background | flush(word, tokens)])

  # A backslash outside quotes escapes the next character; a trailing one is
  # kept literally rather than rejected — the shell will have its own opinion.
  defp tokenize([?\\, c | rest], word, tokens), do: tokenize(rest, [c | word], tokens)
  defp tokenize([?\\], word, tokens), do: tokenize([], [?\\ | word], tokens)

  defp tokenize([?" | rest], word, tokens) do
    case take_quoted(rest, ?") do
      {:ok, content, rest2} -> tokenize(rest2, Enum.reverse(content) ++ word, tokens)
      :error -> {:error, "unterminated \" quote"}
    end
  end

  defp tokenize([?' | rest], word, tokens) do
    case take_quoted(rest, ?') do
      {:ok, content, rest2} -> tokenize(rest2, Enum.reverse(content) ++ word, tokens)
      :error -> {:error, "unterminated ' quote"}
    end
  end

  defp tokenize([c | rest], word, tokens), do: tokenize(rest, [c | word], tokens)

  defp take_quoted(chars, quote_char), do: take_quoted(chars, quote_char, [])
  defp take_quoted([], _q, _acc), do: :error
  defp take_quoted([q | rest], q, acc), do: {:ok, Enum.reverse(acc), rest}
  defp take_quoted([?\\, q | rest], q, acc), do: take_quoted(rest, q, [q | acc])
  defp take_quoted([c | rest], q, acc), do: take_quoted(rest, q, [c | acc])

  defp flush([], tokens), do: tokens
  defp flush(word, tokens), do: [finish(word) | tokens]

  defp finish(word), do: {:word, word |> Enum.reverse() |> List.to_string()}

  defp take_background_marker(tokens) do
    case List.last(tokens) do
      :background ->
        rest = List.delete_at(tokens, -1)

        if :background in rest do
          {:error, "'&' is only supported at the end of a command"}
        else
          {:ok, rest, :background}
        end

      _ ->
        if :background in tokens do
          {:error, "'&' is only supported at the end of a command"}
        else
          {:ok, tokens, :foreground}
        end
    end
  end
end
