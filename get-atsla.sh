#!/usr/bin/env bash
set -euo pipefail

# Public curl bootstrap for ATSLA. It creates a durable local checkout, then
# delegates dependency setup to the versioned installer in that checkout.
REPOSITORY="https://github.com/appatalks/atsla-support-live-agent.git"
INSTALL_DIR="${ATSLA_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/atsla-support-live-agent}"

usage() {
  cat <<'EOF'
Usage: curl -fsSL https://raw.githubusercontent.com/appatalks/atsla-support-live-agent/main/get-atsla.sh | bash

Environment options:
  ATSLA_INSTALL_DIR  Install or update ATSLA in this directory.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $argument" >&2; exit 2 ;;
  esac
done

command -v git >/dev/null 2>&1 || { echo "ATSLA needs git. Install git, then retry." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ATSLA needs curl. Install curl, then retry." >&2; exit 1; }

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Updating ATSLA in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
elif [[ -e "$INSTALL_DIR" ]]; then
  echo "Install directory exists but is not an ATSLA checkout: $INSTALL_DIR" >&2
  exit 1
else
  echo "Cloning ATSLA into $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPOSITORY" "$INSTALL_DIR"
fi

exec bash "$INSTALL_DIR/tools/install.sh"