defmodule MeerkatDaemon.ShellEnv do
  @moduledoc """
  The environment commands run in — the user's, not the engine's.

  Every pipeline is `sh -c` under erlexec, and erlexec hands it the engine's
  own environment. That is fine while the engine was started from a terminal,
  because a terminal's environment is the user's: `.zshrc` has run, PATH has
  `~/.local/bin` and friends on it, TERM is set. It is not fine once the engine
  is started by Meerkat.app opened from Spotlight — `open` gives a bundle the
  launchd environment, which is `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, no TERM,
  and nothing the user ever exported. Then `claude` is "command not found",
  `clear` says "TERM environment variable not set", and the engine outlives the
  window, so it stays that way until somebody restarts it from a real shell.

  So the engine asks the user's shell once, at startup, what its environment
  is: `$SHELL -ilc 'env -0'`. Interactive *and* login, because zsh reads
  `.zshrc` only when interactive and bash reads `.bashrc` only when
  interactive, while `.zprofile`/`.bash_profile` want login — and PATH exports
  live in whichever one the user happened to pick. The answer is cached in
  `:persistent_term` and laid over erlexec's inherited environment for every
  command, so a command sees what it would see in a terminal.

  An interactive rc file can print things — banners, fortune, a fetch tool —
  and that output lands on the same stdout as `env -0`. A NUL-framed marker is
  printed first and the parse starts after its last occurrence, so anything
  the rc says is discarded rather than mistaken for a variable.

  Best-effort throughout. A shell that hangs (an rc waiting on a keystroke) or
  fails leaves the engine's own environment in place, with TERM defaulted, and
  the engine still starts.
  """

  @key {__MODULE__, :env}
  @marker "__MEERKAT_ENV__"
  @timeout_ms 5_000
  @default_term "xterm-256color"

  @doc """
  Captures the user's shell environment and caches it. Called once from
  `Application.start/2`; safe to call again to refresh.
  """
  @spec load() :: :ok
  def load do
    env =
      case capture() do
        {:ok, env} when map_size(env) > 0 -> env
        _ -> System.get_env()
      end

    :persistent_term.put(@key, with_defaults(env))
    :ok
  end

  @doc """
  The cached environment as erlexec's `{:env, ...}` list, with `extra` laid on
  top. Falls back to the engine's own environment if `load/0` never ran.
  """
  @spec exec_env([{String.t(), String.t()}]) :: [{charlist(), charlist()}]
  def exec_env(extra \\ []) do
    base = :persistent_term.get(@key, nil) || with_defaults(System.get_env())

    extra
    |> Enum.reduce(base, fn {k, v}, acc -> Map.put(acc, k, v) end)
    |> Enum.map(fn {k, v} -> {String.to_charlist(k), String.to_charlist(v)} end)
  end

  @doc false
  @spec with_defaults(%{String.t() => String.t()}) :: %{String.t() => String.t()}
  def with_defaults(env), do: Map.put_new(env, "TERM", @default_term)

  @doc """
  Parses `env -0` output that may be preceded by anything the rc files printed.
  Only what follows the last marker counts; without a marker, nothing does.
  """
  @spec parse(binary()) :: %{String.t() => String.t()}
  def parse(output) when is_binary(output) do
    case :binary.matches(output, @marker <> "\0") do
      [] ->
        %{}

      matches ->
        {pos, len} = List.last(matches)

        output
        |> binary_part(pos + len, byte_size(output) - pos - len)
        |> String.split("\0", trim: true)
        |> Enum.reduce(%{}, fn entry, acc ->
          case String.split(entry, "=", parts: 2) do
            [k, v] when k != "" -> Map.put(acc, k, v)
            _ -> acc
          end
        end)
    end
  end

  ## Capture ------------------------------------------------------------

  defp capture do
    shell = user_shell()
    script = "printf '\\0#{@marker}\\0'; env -0"

    # A Port rather than System.cmd so the wait can time out: an rc file that
    # blocks on input would otherwise hold the engine's startup hostage.
    # Interactive shells want a TERM even to start cleanly, so give them one
    # when the engine has none.
    port =
      Port.open({:spawn_executable, shell}, [
        :binary,
        :exit_status,
        :stderr_to_stdout,
        args: ["-ilc", script],
        env: [{~c"TERM", String.to_charlist(System.get_env("TERM", @default_term))}]
      ])

    collect(port, "")
  rescue
    _ -> :error
  end

  defp collect(port, acc) do
    receive do
      {^port, {:data, data}} ->
        collect(port, acc <> data)

      {^port, {:exit_status, 0}} ->
        {:ok, parse(acc)}

      {^port, {:exit_status, _}} ->
        # A non-zero exit can still carry a full listing — a failing rc line
        # sets `$?` and the shell reports it — so keep what parsed.
        {:ok, parse(acc)}
    after
      @timeout_ms ->
        Port.close(port)
        :error
    end
  end

  defp user_shell do
    case System.get_env("SHELL") do
      shell when is_binary(shell) and shell != "" ->
        if File.exists?(shell), do: shell, else: "/bin/sh"

      _ ->
        "/bin/sh"
    end
  end
end
