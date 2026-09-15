defmodule MeerkatDaemon.JobManager do
  @moduledoc """
  Owns the job table that `fg`/`bg`/`kill`/`stop` read and act on.

  `output` accumulates tagged chunks so `fg` on an already-finished background
  job can replay what it produced. A `waiters` entry is just the caller's pid,
  woken with a plain `send/2` from `finish_job/2`.
  """
  use GenServer

  @table :meerkat_jobs

  # Lines of captured output kept per background job, newest first.
  @max_output_lines 2000

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  def new_job(cmd_string), do: GenServer.call(__MODULE__, {:new_job, cmd_string})
  def set_handle(id, pid, os_pid), do: GenServer.cast(__MODULE__, {:set_handle, id, pid, os_pid})
  def set_status(id, status), do: GenServer.cast(__MODULE__, {:set_status, id, status})

  def append_output(id, tag, text),
    do: GenServer.cast(__MODULE__, {:append_output, id, tag, text})

  def finish_job(id, exit_code), do: GenServer.cast(__MODULE__, {:finish_job, id, exit_code})

  @doc """
  Drops a job from the table.

  For foreground commands once they finish: their output already went to the
  pty, so there is nothing to replay, and a `jobs` listing that grows by one
  `done` row per `ls` ever typed hides the background jobs it exists for.
  Anyone blocked in `await/2` is woken as if the job had exited 143.
  """
  def remove(id), do: GenServer.cast(__MODULE__, {:remove, id})

  @doc """
  Marks a job as outliving the connection that started it.

  Set when a client disconnects and its foreground job is left running (see
  `MeerkatDaemon.Connection.terminate/2`). Nothing about the job changes — it is
  a label, so `jobs` can say the thing on :8000 has no window behind it any more
  and a frontend can offer to kill it.
  """
  def detach(id), do: GenServer.cast(__MODULE__, {:detach, id})

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
    |> Enum.map(&reconcile/1)
  end

  # A job whose erlexec process is gone is finished, whatever the table says:
  # if the owning Connection died first, nothing ever delivers the :DOWN that
  # finish_job/2 normally runs off, and the entry reads `running` forever.
  # Correcting on read also unblocks anything waiting in await/2.
  defp reconcile({id, %{pid: pid, status: status} = job})
       when is_pid(pid) and status in [:running, :stopped] do
    if Process.alive?(pid) do
      {id, job}
    else
      # 143 (128 + SIGTERM) is a stand-in — the real exit status was never
      # observed, only that the process is gone.
      finish_job(id, 143)
      {id, %{job | status: :done, exit_code: 143}}
    end
  end

  defp reconcile(entry), do: entry

  # Blocks the caller until job `id` finishes; a no-op if it already has.
  def await(id, timeout \\ :infinity) do
    case get_job(id) do
      %{status: :done, exit_code: code} ->
        {:ok, code}

      %{} ->
        # The status read above was outside the GenServer, so the job may have
        # finished in between; add_waiter re-checks inside it and answers
        # directly rather than registering a waiter nothing would ever wake.
        case GenServer.call(__MODULE__, {:add_waiter, id, self()}) do
          {:done, code} ->
            {:ok, code}

          :waiting ->
            receive do
              {:job_done, ^id, code} -> {:ok, code}
            after
              timeout -> {:error, :timeout}
            end
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
      detached: false,
      output: []
    }

    :ets.insert(@table, {id, job})
    {:reply, id, %{state | next_id: id + 1}}
  end

  def handle_call({:add_waiter, id, caller}, _from, state) do
    case :ets.lookup(@table, id) do
      [{^id, %{status: :done, exit_code: code}}] ->
        {:reply, {:done, code}, state}

      _ ->
        waiters = Map.update(state.waiters, id, [caller], &[caller | &1])
        {:reply, :waiting, %{state | waiters: waiters}}
    end
  end

  @impl true
  def handle_cast({:set_handle, id, pid, os_pid}, state) do
    update(id, &(&1 |> Map.put(:pid, pid) |> Map.put(:os_pid, os_pid)))
    {:noreply, state}
  end

  def handle_cast({:detach, id}, state) do
    update(id, &Map.put(&1, :detached, true))
    {:noreply, state}
  end

  def handle_cast({:set_status, id, status}, state) do
    update(id, &Map.put(&1, :status, status))
    {:noreply, state}
  end

  # Newest first, capped: a server left running for a day would otherwise keep
  # every line it ever logged, and `fg` would replay all of it.
  def handle_cast({:append_output, id, tag, text}, state) do
    update(id, fn job ->
      output = [{tag, text} | Map.get(job, :output, [])]
      output = if length(output) > @max_output_lines, do: Enum.take(output, @max_output_lines), else: output
      Map.put(job, :output, output)
    end)

    {:noreply, state}
  end

  def handle_cast({:finish_job, id, exit_code}, state) do
    update(id, &(&1 |> Map.put(:status, :done) |> Map.put(:exit_code, exit_code)))
    {:noreply, wake_waiters(state, id, exit_code)}
  end

  def handle_cast({:remove, id}, state) do
    :ets.delete(@table, id)
    {:noreply, wake_waiters(state, id, 143)}
  end

  defp wake_waiters(state, id, exit_code) do
    {waiting, waiters} = Map.pop(state.waiters, id, [])
    Enum.each(waiting, &send(&1, {:job_done, id, exit_code}))
    %{state | waiters: waiters}
  end

  defp update(id, fun) do
    case :ets.lookup(@table, id) do
      [{^id, job}] -> :ets.insert(@table, {id, fun.(job)})
      [] -> :ok
    end
  end
end
