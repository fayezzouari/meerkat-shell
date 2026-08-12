defmodule MeerkatDaemon.Parser do
  @moduledoc """
  Tokenizes a line (respecting single/double quotes) and splits it into
  pipeline stages on `|`, plus a trailing `&` for background jobs. Every
  pipeline stage execs as one OS process group, which is what job control
  (`fg`/`bg`/`kill`/`stop`) attaches to.
  """

  @type stage :: {String.t(), [String.t()]}
  @type mode :: :foreground | :background

  @spec parse(String.t()) :: {:ok, [stage], mode} | {:error, String.t()}
  def parse(line) do
    with {:ok, tokens} <- tokenize(line),
         {:ok, tokens, mode} <- take_background_marker(tokens) do
      group(tokens, mode)
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

  defp tokenize([?& | rest], word, tokens) do
    tokenize(rest, [], [:background | flush(word, tokens)])
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

  # Only a trailing `&` is the background marker; anywhere else is a parse
  # error rather than something surprising.
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

  defp group([], mode), do: {:ok, [], mode}

  defp group(tokens, mode) do
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
      {:ok, stages} -> {:ok, Enum.reverse(stages), mode}
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
