defmodule MeerkatDaemon.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    # Before anything can run a command: what environment commands get. See
    # MeerkatDaemon.ShellEnv. Bounded by its own timeout, so a misbehaving rc
    # file delays startup by a few seconds rather than preventing it.
    MeerkatDaemon.ShellEnv.load()

    children = [
      MeerkatDaemon.JobManager,
      {DynamicSupervisor, name: MeerkatDaemon.ConnectionSupervisor, strategy: :one_for_one},
      MeerkatDaemon.SocketServer
    ]

    opts = [strategy: :one_for_one, name: MeerkatDaemon.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
