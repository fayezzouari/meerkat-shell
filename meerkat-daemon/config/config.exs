import Config

# erlexec's port program refuses to run as root unless explicitly told
# it's allowed to — a sane default, since running arbitrary commands
# as root is exactly the kind of thing you don't want silently
# permitted. Real deployments should run meerkat-daemon as a normal
# user and never hit this branch at all. This exists purely so the
# daemon also works in root-only environments (containers, some CI
# sandboxes) without every new contributor tripping over the same
# "Not allowed to run as root" crash.
if System.get_env("USER") == "root" or match?({"0\n", 0}, System.cmd("id", ["-u"])) do
  config :erlexec, root: true, user: "root", limit_users: ["root"]
end

# Which kind of engine this is, for Identity: a release (prod) or a dev/test
# run from a checkout. Baked in at build time, which is what makes it true.
config :meerkat_daemon, flavor: config_env()

# Per-environment overrides. Only test has any, but the import has to be here
# for it to be read at all.
if File.exists?(Path.join(__DIR__, "#{config_env()}.exs")) do
  import_config "#{config_env()}.exs"
end
