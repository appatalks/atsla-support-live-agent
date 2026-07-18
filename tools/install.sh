#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"
VOICE_MODULE_DIR="${VOICE_CLONE_MODULE_PATH:-$ROOT_DIR/vendor/voice_clone_module}"
INSTALL_VOICE="${VOICE_BRIDGE_INSTALL_VOICE:-true}"
INSTALL_WHISPER="${VOICE_BRIDGE_INSTALL_WHISPER:-true}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    return 1
  }
}

install_macos_prerequisites() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required on macOS. Install it from https://brew.sh, then rerun tools/install.sh." >&2
    exit 1
  fi
  brew install node python@3.11 ffmpeg jq cmake
  if ! system_profiler SPAudioDataType 2>/dev/null | grep -qi 'BlackHole'; then
    cat <<'EOF'
Install BlackHole and create a Multi-Output Device in Audio MIDI Setup that includes your speakers and BlackHole. Configure your communication application to use the BlackHole device for Agent microphone turns.
EOF
  fi
}

check_linux_prerequisites() {
  for command in node npm python3 ffmpeg jq cmake pactl pw-cat; do
    if ! command -v "$command" >/dev/null 2>&1; then
      echo "Missing $command. Install Node.js, Python 3.11+, FFmpeg, jq, CMake, and PipeWire/PulseAudio compatibility packages, then rerun." >&2
      exit 1
    fi
  done
}

setup_voice_module() {
  [[ "$INSTALL_VOICE" == "true" ]] || return
  if [[ ! -f "$VOICE_MODULE_DIR/install.sh" ]]; then
    if command -v gh >/dev/null 2>&1; then
      mkdir -p "$(dirname "$VOICE_MODULE_DIR")"
      gh repo clone appatalks/voice_clone_module "$VOICE_MODULE_DIR"
    else
      echo "voice_clone_module is required at $VOICE_MODULE_DIR. Set VOICE_CLONE_MODULE_PATH or install and authenticate gh." >&2
      exit 1
    fi
  fi
  need uv || {
    echo "Install uv from https://docs.astral.sh/uv/, then rerun." >&2
    exit 1
  }
  bash "$VOICE_MODULE_DIR/install.sh"
}

main() {
  case "$OS" in
    Linux) check_linux_prerequisites ;;
    Darwin) install_macos_prerequisites ;;
    *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
  esac
  need node
  need npm
  need git
  need curl
  cd "$ROOT_DIR"
  npm install
  setup_voice_module
  if [[ "$INSTALL_WHISPER" == "true" ]]; then
    bash "$ROOT_DIR/tools/bootstrap-whisper.sh"
  fi
  cat <<'EOF'
Installation complete.

Start: npm run app:start
Status: npm run app:status
Stop: npm run app:stop
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: ./install.sh

Environment options:
  VOICE_CLONE_MODULE_PATH     Existing private voice_clone_module checkout.
  VOICE_BRIDGE_INSTALL_VOICE  Set false to skip voice module setup.
  VOICE_BRIDGE_INSTALL_WHISPER Set false to skip local Whisper bootstrap.
EOF
  exit 0
fi

main "$@"
