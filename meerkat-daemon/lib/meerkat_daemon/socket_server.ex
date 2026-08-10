defmodule MeerkatDaemon.SocketServer do
  @moduledoc """
  Listens on a Unix domain socket and hands each accepted connection to
  a supervised `MeerkatDaemon.Connection`. This is the piece a client dials
  into — lazy-start clients should treat "connection refused / no such
  file" on this path as "spawn the daemon, then retry".

  `packet: 4` (4-byte length-prefixed framing) rather than `packet: :line`:
  pty output can't safely be split on "\\n" (see `Connection`'s
  moduledoc), so every message is now a discrete length-prefixed frame
  with a leading type byte instead of a text line.
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
