defmodule MeerkatDaemon.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      MeerkatDaemon.JobManager,
      {DynamicSupervisor, name: MeerkatDaemon.ConnectionSupervisor, strategy: :one_for_one},
      MeerkatDaemon.SocketServer
    ]

    opts = [strategy: :one_for_one, name: MeerkatDaemon.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
