import Config

# Never the real socket. `mix test` starts the application, and the socket
# server binds whatever path it is given — which, on the default path, means
# deleting the socket file of a daemon the developer is actually using and
# leaving it unreachable while it still holds their jobs. Short, because a Unix
# socket path is limited to ~104 bytes.
config :meerkat_daemon, socket_path: "/tmp/meerkat-test.sock"
