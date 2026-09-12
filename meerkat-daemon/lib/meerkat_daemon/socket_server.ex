defmodule MeerkatDaemon.SocketServer do
  @moduledoc """
  Listens on a Unix domain socket and hands each accepted connection to a
  supervised `MeerkatDaemon.Connection`. Lazy-start clients should treat
  "connection refused / no such file" as "spawn the daemon, then retry".

  `packet: 4` rather than `packet: :line`, because pty output can't safely be
  split on "\\n" (see `Connection`).
  """
  use GenServer
  require Logger

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  # Configured path first, then the environment, then the default. The config
  # layer exists for `mix test`: the app starts before the tests do, and binding
  # the default path meant a test run deleted the socket of whatever engine the
  # developer had running and left it unreachable — with their jobs still inside
  # it. Tests get their own path (config/test.exs) and cannot do that.
  #
  # The default depends on what this engine is. A release listens on
  # meerkat.sock; a `mix run` from a checkout listens on dev.sock, so a
  # developer's engine and their installed one never meet on the same path —
  # which is how the installed app used to end up talking to the dev engine, or
  # replacing its socket out from under it.
  def socket_path do
    Application.get_env(:meerkat_daemon, :socket_path) ||
      env_socket() ||
      Path.expand("~/.meerkat/#{default_socket_name()}")
  end

  # `MEERKAT_SOCK=` (set but empty) means "not set": binding "" is :einval,
  # which is a worse answer than the default.
  defp env_socket do
    case System.get_env("MEERKAT_SOCK") do
      nil -> nil
      "" -> nil
      path -> path
    end
  end

  defp default_socket_name do
    case Application.get_env(:meerkat_daemon, :flavor, :dev) do
      :prod -> "meerkat.sock"
      _ -> "dev.sock"
    end
  end

  @impl true
  def init(_opts) do
    path = socket_path()
    File.mkdir_p!(Path.dirname(path))

    # A socket file outlives the process that bound it, so a leftover has to
    # be removed before binding — but only a leftover. If something answers
    # on it, that is another engine, and unlinking its socket would leave it
    # running with no way to reach it while this one took over its address.
    # Refusing is the only correct move; the caller sees a clear reason.
    case listening?(path) do
      true ->
        Logger.error("another engine is already listening on #{path}; refusing to replace it")
        {:stop, {:socket_in_use, path}}

      false ->
        File.rm(path)
        listen(path)
    end
  end

  defp listen(path) do
    {:ok, listen_socket} =
      :gen_tcp.listen(0, [
        :binary,
        packet: 4,
        active: false,
        reuseaddr: true,
        ifaddr: {:local, path}
      ])

    Logger.info(
      "meerkat-daemon #{MeerkatDaemon.Identity.version()} (#{MeerkatDaemon.Identity.flavor()}) " <>
        "instance #{MeerkatDaemon.Identity.instance()} listening on #{path}"
    )

    {:ok, _acceptor} = Task.start_link(fn -> accept_loop(listen_socket) end)
    {:ok, %{listen_socket: listen_socket, path: path}}
  end

  @doc "Whether a process is accepting connections on the socket at path."
  @spec listening?(Path.t()) :: boolean()
  def listening?(path) do
    if File.exists?(path) do
      case :gen_tcp.connect({:local, path}, 0, [:binary, active: false], 1_000) do
        {:ok, socket} ->
          :gen_tcp.close(socket)
          true

        {:error, _} ->
          false
      end
    else
      false
    end
  end

  defp accept_loop(listen_socket) do
    {:ok, client_socket} = :gen_tcp.accept(listen_socket)

    {:ok, pid} =
      DynamicSupervisor.start_child(
        MeerkatDaemon.ConnectionSupervisor,
        {MeerkatDaemon.Connection, client_socket}
      )

    :ok = :gen_tcp.controlling_process(client_socket, pid)
    send(pid, :socket_ready)
    accept_loop(listen_socket)
  end

  @impl true
  def terminate(_reason, state) do
    File.rm(state.path)
    :ok
  end
end
