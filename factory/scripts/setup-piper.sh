#!/usr/bin/env bash
# Installs the local, free Piper neural TTS engine and a Russian voice.
# Piper runs fully offline after this step. Voice: ru_RU-irina-medium (MIT-licensed Piper voice).
set -euo pipefail
cd "$(dirname "$0")/.."
TTS_DIR="${PIPER_HOME:-.data/piper}"
mkdir -p "$TTS_DIR"
if [ ! -x "$TTS_DIR/venv/bin/piper" ]; then
  python3 -m venv "$TTS_DIR/venv"
  "$TTS_DIR/venv/bin/pip" install --quiet piper-tts==1.8.0
fi
if [ ! -f "$TTS_DIR/ru-irinia-medium.onnx" ]; then
  curl -fsSL -o "$TTS_DIR/voice.tar.gz" https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-ru-irinia-medium.tar.gz
  tar -xzf "$TTS_DIR/voice.tar.gz" -C "$TTS_DIR"
  rm "$TTS_DIR/voice.tar.gz"
fi
ls "$TTS_DIR"
echo "Piper ready: PIPER_BIN=$TTS_DIR/venv/bin/piper PIPER_VOICE=$(ls $TTS_DIR/*.onnx | head -1)"
