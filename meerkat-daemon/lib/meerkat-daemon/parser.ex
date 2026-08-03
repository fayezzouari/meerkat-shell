defmodule MeerkatDaemon.Parser do
  @moduledoc """
  Phase 1 parser.

  Tokenizes a line (respecting single/double quotes) and splits it into
  pipeline stages on `|`. This is intentionally close to POSIX shell
  syntax for now — the plan is to introduce a distinct structured-pipe
  token (e.g. `|>`) later that routes into decoded Elixir terms instead
  of another OS process. Keeping the raw `|` behavior first means every
  pipeline stage can still be exec'd as one OS process group, which is
  what job control (Ctrl+Z, bg, fg) needs to attach to later.
  """

  @type stage :: {String.t(), [String.t()]}

  @spec parse(String.t()) :: {:ok, [stage]} | {:error, String.t()}
  def parse(line) do
    case tokenize(line) do
      {:ok, tokens} -> group(tokens)
      {:error, reason} -> {:error, reason}
    end
  end

  defp tokenize(line), do: tokenize(String.to_charlist(line), [], [])

  defp tokenize([], [], tokens), do: {:ok, Enum.reverse(tokens)}
  defp tokenize([], word, tokens), do: {:ok, Enum.reverse([finish(word) | tokens])}

  defp tokenize([c | rest], word, tokens) when c in [?\s, ?\t] do
    tokenize(rest, [], flush(word, tokens))
  end

  defp tokenize([?| | rest], word, tokens) do
    tokenize(rest, [], [:pipe | flush(word, tokens)])
  end

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

  defp group([]), do: {:ok, []}

  defp group(tokens) do
    tokens
    |> split_on_pipe()
    |> Enum.reduce_while({:ok, []}, fn stage_tokens, {:ok, acc} ->
      case stage_tokens do
        [] ->
          {:halt, {:error, "empty pipeline stage"}}

        [{:word, cmd} | rest] ->
          args = Enum.map(rest, fn {:word, w} -> w end)
          {:cont, {:ok, [{cmd, args} | acc]}}
      end
    end)
    |> case do
      {:ok, stages} -> {:ok, Enum.reverse(stages)}
      error -> error
    end
  end

  defp split_on_pipe(tokens) do
    Enum.chunk_while(
      tokens,
      [],
      fn
        :pipe, acc -> {:cont, Enum.reverse(acc), []}
        token, acc -> {:cont, [token | acc]}
      end,
      fn acc -> {:cont, Enum.reverse(acc), []} end
    )
  end
end
