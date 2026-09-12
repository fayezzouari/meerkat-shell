defmodule MeerkatDaemon.Identity do
  @moduledoc """
  Who this engine is, for anyone who connects to it.

  Two engines can be on one machine at once — the installed release and a
  `mix run` from a checkout, or two installs under different prefixes — and
  from the socket alone they look identical. So every connection is told, right
  after the working directory, which engine answered: its version, whether it
  is a release or a dev build, a random instance id minted at boot, its OS pid,
  node name and socket path. The `engine` builtin prints the same for a human.

  The instance id is the part that is unique by construction. Version and
  flavor can collide (two installs of 0.3.1); pids recycle; the id does not,
  short of a restart — which is exactly the event it is there to make visible.
  """

  @key {__MODULE__, :instance}

  @doc "Random per-boot id, eight hex characters. Stable for the life of the VM."
  @spec instance() :: String.t()
  def instance do
    case :persistent_term.get(@key, nil) do
      nil ->
        id = :rand.bytes(4) |> Base.encode16(case: :lower)
        :persistent_term.put(@key, id)
        id

      id ->
        id
    end
  end

  @doc "The version from mix.exs, which reads the repository's VERSION file."
  @spec version() :: String.t()
  def version do
    case Application.spec(:meerkat_daemon, :vsn) do
      nil -> "0.0.0"
      vsn -> to_string(vsn)
    end
  end

  @doc """
  "release" for a built OTP release (MIX_ENV=prod), otherwise the Mix
  environment it was started in: "dev" for `mix run`, "test" under `mix test`.
  """
  @spec flavor() :: String.t()
  def flavor do
    case Application.get_env(:meerkat_daemon, :flavor, :dev) do
      :prod -> "release"
      other -> to_string(other)
    end
  end

  @spec fields() :: [{String.t(), String.t()}]
  def fields do
    [
      {"version", version()},
      {"flavor", flavor()},
      {"instance", instance()},
      {"pid", to_string(System.pid())},
      {"node", to_string(node())},
      {"sock", MeerkatDaemon.SocketServer.socket_path()}
    ]
  end

  @doc """
  One line of `key=value` pairs, space separated, for the `H` frame. The socket
  path goes last because it is the one value that may itself contain a space.
  """
  @spec line() :: String.t()
  def line do
    Enum.map_join(fields(), " ", fn {k, v} -> "#{k}=#{v}" end)
  end

  @doc "Parses `line/0`'s format back into a map. Tolerates unknown keys."
  @spec parse(String.t()) :: %{String.t() => String.t()}
  def parse(line) do
    # Everything up to "sock=" splits on spaces; the socket path is the rest.
    {head, sock} =
      case :binary.match(line, "sock=") do
        {pos, len} ->
          {binary_part(line, 0, pos), binary_part(line, pos + len, byte_size(line) - pos - len)}

        :nomatch ->
          {line, nil}
      end

    map =
      head
      |> String.split(" ", trim: true)
      |> Enum.reduce(%{}, fn pair, acc ->
        case String.split(pair, "=", parts: 2) do
          [k, v] -> Map.put(acc, k, v)
          _ -> acc
        end
      end)

    if sock, do: Map.put(map, "sock", String.trim(sock)), else: map
  end

  @doc "What the `engine` builtin prints."
  @spec describe() :: [String.t()]
  def describe do
    [
      "meerkat engine #{version()} (#{flavor()}) instance #{instance()}",
      "  pid    #{System.pid()}",
      "  node   #{node()}",
      "  socket #{MeerkatDaemon.SocketServer.socket_path()}"
    ]
  end
end
