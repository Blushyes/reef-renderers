#!/bin/sh
set -eu

# Start Node with the login environment so scriptctl and FFmpeg share its PATH.
# Keep renderer JSON on dedicated descriptors while shell startup uses stderr.
exec /bin/zsh -ilc '
  node_executable=$(whence -p node) || exit 127
  exec "$node_executable" "$@" <&3 >&4
' reef-script-renderer "$@" 3<&0 4>&1 </dev/null 1>&2
