defmodule MeerkatDaemon.Connection do
  @moduledoc """
  One process per connected client.

  Protocol (newline-delimited, `packet: :line` on the socket):

    client -> daemon:  one line of shell input
    daemon -> client:  zero or more "O:<text>" / "E:<text>" lines,
                        an optional "D:<cwd>" line when the directory
                        changed, then a terminating "X:<exit code>" line

  Deliberately plain text instead of JSON so the client stays dependency
  free. A framed/JSON protocol is the natural upgrade once messages grow
  richer (job control commands, structured-pipe payloads).
  """
  use GenServer
  alias MeerkatDaemon.{Parser, Evaluator}

  def start_link(socket), do: GenServer.start_link(__MODULE__, socket)

  def child_spec(socket) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [socket]}, restart: :temporary}
  end

  @impl true
  def init(socket) do
    {:ok, %{socket: socket, cwd: System.get_env("HOME", "/")}}
  end

  # Sent by the acceptor once :gen_tcp.controlling_process/2 has completed —
  # only then is it safe for this process to touch socket options.
  @impl true
  def handle_info(:socket_ready, state) do
    :inet.setopts(state.socket, active: :once)
    send_line(state.socket, "D:" <> state.cwd)
    {:noreply, state}
  end

  def handle_info({:tcp, socket, line}, state) do
    line = String.trim_trailing(line, "\n")

    case dispatch(line, state) do
      {:continue, state} ->
        :inet.setopts(socket, active: :once)
        {:noreply, state}

      {:stop, state} ->
        :gen_tcp.close(socket)
        {:stop, :normal, state}
    end
  end

  def handle_info({:tcp_closed, _socket}, state), do: {:stop, :normal, state}
  def handle_info({:tcp_error, _socket, _reason}, state), do: {:stop, :normal, state}

  defp dispatch("", state) do
    send_line(state.socket, "X:0")
    {:continue, state}
  end

  defp dispatch(line, state) do
    case Parser.parse(line) do
      {:error, reason} ->
        send_line(state.socket, "E:parse error: #{reason}")
        send_line(state.socket, "X:1")
        {:continue, state}

      {:ok, []} ->
        send_line(state.socket, "X:0")
        {:continue, state}

      {:ok, stages} ->
        emit = fn
          :stdout, text -> send_line(state.socket, "O:" <> text)
          :stderr, text -> send_line(state.socket, "E:" <> text)
        end

        case Evaluator.run(stages, state.cwd, emit) do
          {:exit, _cwd, _code} ->
            send_line(state.socket, "X:0")
            {:stop, state}

          {:ok, new_cwd, code} ->
            if new_cwd != state.cwd, do: send_line(state.socket, "D:" <> new_cwd)
            send_line(state.socket, "X:#{code}")
            {:continue, %{state | cwd: new_cwd}}
        end
    end
  end

  defp send_line(socket, text), do: :gen_tcp.send(socket, text <> "\n")
end
