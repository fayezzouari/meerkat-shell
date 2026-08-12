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

  def socket_path do
    System.get_env("MEERKAT_SOCK") || Path.expand("~/.meerkat/meerkat.sock")
  end

  @impl true
  def init(_opts) do
    path = socket_path()
    File.mkdir_p!(Path.dirname(path))
    File.rm(path)

    {:ok, listen_socket} =
      :gen_tcp.listen(0, [
        :binary,
        packet: 4,
        active: false,
        reuseaddr: true,
        ifaddr: {:local, path}
      ])

    Logger.info("meerkat-daemon listening on #{path}")
    {:ok, _acceptor} = Task.start_link(fn -> accept_loop(listen_socket) end)
    {:ok, %{listen_socket: listen_socket, path: path}}
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
