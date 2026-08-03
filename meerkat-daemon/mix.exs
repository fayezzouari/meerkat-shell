defmodule MeerkatDaemon.MixProject do
  use Mix.Project

  def project do
    [
      app: :meerkat_daemon,
      version: "0.1.0",
      elixir: "~> 1.14",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger],
      mod: {MeerkatDaemon.Application, []}
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      # Fetched via git rather than {:erlexec, "~> 2.0"} from Hex — both
      # work identically once you have normal internet access; git was
      # what this environment's network allowlist permitted while
      # building this. Feel free to switch to the Hex version.
      {:erlexec, git: "https://github.com/saleyn/erlexec.git", tag: "2.0.6"}
    ]
  end
end
