#!/usr/bin/env bash
set -euo pipefail

# The meeting app owns all client context. Do not allow an ACP caller to resume
# a Copilot session or opt into Copilot's memory feature.
for argument in "$@"; do
  case "$argument" in
    --continue|--resume|--resume=*|-r|--enable-memory|--enable-memory=*|--session-id|--session-id=*)
      echo "Copilot session persistence is disabled for Voice Bridge." >&2
      exit 2
      ;;
  esac
done

runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/voice-bridge-copilot"
mkdir -p "$runtime_dir"

exec copilot \
  --no-custom-instructions \
  --disable-builtin-mcps \
  --no-remote \
  --no-remote-export \
  --no-bash-env \
  --log-dir "$runtime_dir/logs" \
  "$@"