#!/bin/sh
set -eu

# Finder does not load zsh's PATH or nvm. Resolve Node through the user's terminal
# configuration, with startup output on stderr and stdin reserved for renderer JSON.
node_executable=$(/bin/zsh -ilc 'whence -p node >&3' 3>&1 1>&2 </dev/null) || {
  printf '%s\n' 'Node.js was not found in your zsh environment. Check command -v node in Terminal.' >&2
  exit 127
}
exec "$node_executable" "$@"
