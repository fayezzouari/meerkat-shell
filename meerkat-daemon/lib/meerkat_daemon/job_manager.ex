defmodule MeerkatDaemon.JobManager do
  @moduledoc """
  Owns the job table. Every pipeline invocation registers a job —
  foreground jobs finish almost immediately, background jobs
  (`cmd &`) can run for a while, and `fg`/`bg`/`kill`/`stop` all read
  and act on this table.

  `output` accumulates tagged chunks (`{:stdout, text}` /
  `{:stderr, text}`) so `fg` on an already-finished background job can
  replay what it produced. `waiters` lets `fg` block the calling
  connection process until the job actually completes, without any
  extra GenServer plumbing — the waiter is just the caller's own pid,
  woken with a plain `send/2` from `finish_job/2`.
  """
  use GenServer

  @table :meerkat_jobs

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  def new_job(cmd_string), do: GenServer.call(__MODULE__, {:new_job, cmd_string})
  def set_handle(id, pid, os_pid), do: GenServer.cast(__MODULE__, {:set_handle, id, pid, os_pid})
  def set_status(id, status), do: GenServer.cast(__MODULE__, {:set_status, id, status})
  def append_output(id, tag, text), do: GenServer.cast(__MODULE__, {:append_output, id, tag, text})
  def finish_job(id, exit_code), do: GenServer.cast(__MODULE__, {:finish_job, id, exit_code})

  def get_job(id) do
    case :ets.lookup(@table, id) do
      [{^id, job}] -> job
      [] -> nil
    end
  end

  def list_jobs do
    @table
    |> :ets.tab2list()
    |> Enum.sort_by(fn {id, _job} -> id end)
  end

  # Blocks the caller (a Connection process) until job `id` finishes.
  # Safe to call even if the job has already finished by the time this
  # runs — in that case there's simply no wait.
  def await(id, timeout \\ :infinity) do
    case get_job(id) do
      %{status: :done, exit_code: code} ->
        {:ok, code}

      %{} ->
        GenServer.call(__MODULE__, {:add_waiter, id, self()})

        receive do
          {:job_done, ^id, code} -> {:ok, code}
        after
          timeout -> {:error, :timeout}
        end

      nil ->
        {:error, :no_such_job}
    end
  end

  @impl true
  def init(:ok) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{next_id: 1, waiters: %{}}}
  end

  @impl true
  def handle_call({:new_job, cmd_string}, _from, state) do
    id = state.next_id

    job = %{
      cmd: cmd_string,
      status: :running,
      pid: nil,
      os_pid: nil,
      exit_code: nil,
      output: []
    }

    :ets.insert(@table, {id, job})
    {:reply, id, %{state | next_id: id + 1}}
  end

  def handle_call({:add_waiter, id, caller}, _from, state) do
    waiters = Map.update(state.waiters, id, [caller], &[caller | &1])
    {:reply, :ok, %{state | waiters: waiters}}
  end

  @impl true
  def handle_cast({:set_handle, id, pid, os_pid}, state) do
    update(id, &(&1 |> Map.put(:pid, pid) |> Map.put(:os_pid, os_pid)))
    {:noreply, state}
  end

  def handle_cast({:set_status, id, status}, state) do
    update(id, &Map.put(&1, :status, status))
    {:noreply, state}
  end

  def handle_cast({:append_output, id, tag, text}, state) do
    update(id, &Map.update(&1, :output, [{tag, text}], fn out -> [{tag, text} | out] end))
    {:noreply, state}
  end

  def handle_cast({:finish_job, id, exit_code}, state) do
    update(id, &(&1 |> Map.put(:status, :done) |> Map.put(:exit_code, exit_code)))

    {waiting, waiters} = Map.pop(state.waiters, id, [])
    Enum.each(waiting, &send(&1, {:job_done, id, exit_code}))

    {:noreply, %{state | waiters: waiters}}
  end

  defp update(id, fun) do
    case :ets.lookup(@table, id) do
      [{^id, job}] -> :ets.insert(@table, {id, fun.(job)})
      [] -> :ok
    end
  end
end
