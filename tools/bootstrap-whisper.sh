#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHISPER_DIR="${WHISPER_CPP_DIR:-$ROOT_DIR/vendor/whisper.cpp}"
MODEL_NAME="${WHISPER_MODEL_NAME:-base.en}"
WHISPER_CUDA="${WHISPER_CUDA:-auto}"

if [[ "${1:-}" == "--dry-run" ]]; then
  printf 'git clone https://github.com/ggml-org/whisper.cpp %q\n' "$WHISPER_DIR"
  printf 'WHISPER_CUDA=auto tries CUDA first and falls back to CPU if compilation is unsupported.\n'
  printf 'cmake -S %q -B %q/build -DGGML_CUDA=ON\n' "$WHISPER_DIR" "$WHISPER_DIR"
  printf 'cmake -S %q -B %q/build -DGGML_CUDA=OFF\n' "$WHISPER_DIR" "$WHISPER_DIR"
  printf 'cmake --build %q/build --config Release -j\n' "$WHISPER_DIR"
  printf '%q/models/download-ggml-model.sh %q\n' "$WHISPER_DIR" "$MODEL_NAME"
  exit 0
fi

command -v git >/dev/null || { echo "git is required." >&2; exit 1; }
command -v cmake >/dev/null || { echo "cmake is required." >&2; exit 1; }
if [[ ! -d "$WHISPER_DIR/.git" ]]; then git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"; fi

build() {
  local cuda="$1"
  cmake -S "$WHISPER_DIR" -B "$WHISPER_DIR/build" "-DGGML_CUDA=$cuda"
  cmake --build "$WHISPER_DIR/build" --config Release -j
}

if [[ "$WHISPER_CUDA" == "true" ]]; then
  build ON
elif [[ "$WHISPER_CUDA" == "false" ]]; then
  build OFF
elif ! build ON; then
  echo "CUDA build failed; falling back to CPU. Set WHISPER_CUDA=true to require CUDA." >&2
  rm -rf "$WHISPER_DIR/build"
  build OFF
fi
"$WHISPER_DIR/models/download-ggml-model.sh" "$MODEL_NAME"
echo "Set WHISPER_BIN=$WHISPER_DIR/build/bin/whisper-cli"
echo "Set WHISPER_MODEL=$WHISPER_DIR/models/ggml-$MODEL_NAME.bin"