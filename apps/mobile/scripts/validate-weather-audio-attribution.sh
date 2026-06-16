#!/usr/bin/env bash
# Validates that every .mp3/.wav in assets/audio/weather/ has an entry in ATTRIBUTION.md
set -euo pipefail

ATTRIBUTION="src/features/weatheraudio/licenses/ATTRIBUTION.md"
AUDIO_DIR="assets/audio/weather"

if [ ! -f "$ATTRIBUTION" ]; then
  echo "ERROR: $ATTRIBUTION not found"
  exit 1
fi

if [ -d "$AUDIO_DIR" ]; then
  for f in "$AUDIO_DIR"/*.mp3 "$AUDIO_DIR"/*.wav; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    if ! grep -q "$name" "$ATTRIBUTION"; then
      echo "MISSING ATTRIBUTION: $name"
      echo "Add entry to $ATTRIBUTION and SOUND_ATTRIBUTIONS in freeSounds.ts"
      exit 1
    fi
  done
fi

echo "OK: All weather audio assets have attribution"
