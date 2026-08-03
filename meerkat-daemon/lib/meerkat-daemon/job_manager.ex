defmodule MeerkatDaemon.JobManager do
  @moduledoc """
  Owns the job table. Phase 1 jobs are always foreground and short-lived,
  but the table shape (id, os_pid, status, cmd) is exactly what `jobs`,
  `bg`, `fg`, and signal delivery will read/write from in the job-control
  phase — this exists now so that phase doesn't require a redesign.
  """
  use GenServer

  @table :meerkat_daemon_jobs

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  def new_job(cmd_string), do: GenServer.call(__MODULE__, {:new_job, cmd_string})
  def set_os_pid(id, os_pid), do: GenServer.cast(__MODULE__, {:set_os_pid, id, os_pid})
  def finish_job(id, exit_code), do: GenServer.cast(__MODULE__, {:finish_job, id, exit_code})

  def list_jobs do
    @table
    |> :ets.tab2list()
    |> Enum.sort_by(fn {id, _job} -> id end)
  end

  @impl true
  def init(:ok) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{next_id: 1}}
  end

  @impl true
  def handle_call({:new_job, cmd_string}, _from, state) do
    id = state.next_id
    job = %{cmd: cmd_string, status: :running, os_pid: nil, exit_code: nil}
    :ets.insert(@table, {id, job})
    {:reply, id, %{state | next_id: id + 1}}
  end

  @impl true
  def handle_cast({:set_os_pid, id, os_pid}, state) do
    update(id, &Map.put(&1, :os_pid, os_pid))
    {:noreply, state}
  end

  def handle_cast({:finish_job, id, exit_code}, state) do
    update(id, &(&1 |> Map.put(:status, :done) |> Map.put(:exit_code, exit_code)))
    {:noreply, state}
  end

  defp update(id, fun) do
    case :ets.lookup(@table, id) do
      [{^id, job}] -> :ets.insert(@table, {id, fun.(job)})
      [] -> :ok
    end
  end
end
