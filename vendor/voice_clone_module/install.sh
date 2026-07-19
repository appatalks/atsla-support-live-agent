#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PYTHON_VERSION="${VOICE_CLONE_PYTHON_VERSION:-3.11}"
PYTHON="${VENV_DIR}/bin/python"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it from https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

echo "Creating Python ${PYTHON_VERSION} environment..."
uv venv --allow-existing --python "${PYTHON_VERSION}" "${VENV_DIR}"

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "Installing CUDA-enabled PyTorch 2.10.0..."
  uv pip install --python "${PYTHON}" \
    --index-url https://download.pytorch.org/whl/cu128 \
    --extra-index-url https://pypi.org/simple \
    torch==2.10.0 torchaudio==2.10.0
else
  echo "No NVIDIA GPU detected; installing PyTorch 2.10.0 from PyPI..."
  uv pip install --python "${PYTHON}" torch==2.10.0 torchaudio==2.10.0
fi

echo "Installing Chatterbox without its legacy Torch pins..."
uv pip install --python "${PYTHON}" --no-deps chatterbox-tts==0.1.7

echo "Installing pinned voice and demo dependencies..."
uv pip install --python "${PYTHON}" --requirement "${ROOT_DIR}/requirements-demo.txt"
uv pip install --python "${PYTHON}" --no-deps --editable "${ROOT_DIR}"

if ! CHECK_OUTPUT="$(uv pip check --python "${PYTHON}" 2>&1)"; then
  printf '%s\n' "${CHECK_OUTPUT}"
  PACKAGE_COUNT="$(printf '%s\n' "${CHECK_OUTPUT}" | grep -c '^The package' || true)"
  if [[ "${PACKAGE_COUNT}" -ne 6 || "${CHECK_OUTPUT}" != *"chatterbox-tts"* || "${CHECK_OUTPUT}" != *"torch==2.6.0"* || "${CHECK_OUTPUT}" != *"torchaudio==2.6.0"* || "${CHECK_OUTPUT}" != *"transformers==5.2.0"* || "${CHECK_OUTPUT}" != *"diffusers==0.29.0"* || "${CHECK_OUTPUT}" != *"safetensors==0.5.3"* || "${CHECK_OUTPUT}" != *"gradio==6.8.0"* ]]; then
    echo "Unexpected dependency conflicts were found." >&2
    exit 1
  fi
  echo "The only reported conflicts are Chatterbox's known legacy pins; the patched direct pins are intentional."
else
  printf '%s\n' "${CHECK_OUTPUT}"
fi

cat <<EOF

Installation complete.

Set the reference voice and launch the demo:
  export VOICE_CLONE_REFERENCE=/absolute/path/to/reference.wav
  source ${VENV_DIR}/bin/activate
  voice-demo

Then open http://127.0.0.1:8000
EOF
