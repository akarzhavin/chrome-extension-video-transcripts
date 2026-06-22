#!/usr/bin/env bash
# Batch localized screenshots on a real YouTube page.
#
# Prereq: the unpacked extension (apps/youtube/build) is installed by hand once
# into the persistent profile below (Chrome 138+ ignores --load-extension).
# This script relaunches that profile once per locale with the macOS
# -AppleLanguages override (the only thing that actually changes Chrome's UI
# language on macOS), then drives capture-live.mjs over CDP.
#
# Usage:
#   apps/youtube/screenshots/run-all.sh "en,de,es,fr,ja,ar" "onboarding,sidebar"
#   VIDEO=<id> apps/youtube/screenshots/run-all.sh "de,fr"
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROFILE="/tmp/yt-shots-profile"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT="9222"
VIDEO="${VIDEO:-dQw4w9WgXcQ}"
LANGS="${1:-en,de,es,fr,ja,ar}"
SCENES="${2:-onboarding,sidebar}"

# Per-locale subtitle pair for the `sidebar` scene: secondary = the locale's
# language (so the native track matches the UI), primary = English (learning).
# English locale flips to learning Spanish so both tracks have text.
pair_for() {
  local base="${1%%_*}"
  if [ "$base" = "en" ]; then echo "es en"; else echo "en $base"; fi
}

IFS=',' read -ra L <<< "$LANGS"
for lang in "${L[@]}"; do
  echo "──────── $lang ────────"
  pkill -f "user-data-dir=$PROFILE" 2>/dev/null || true
  sleep 2
  "$CHROME" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check --window-size=1300,900 \
    -AppleLanguages "(${lang//_/-})" about:blank >/tmp/chrome-shots.log 2>&1 &
  sleep 4
  read -r learn native <<< "$(pair_for "$lang")"
  IFS=',' read -ra S <<< "$SCENES"
  for scene in "${S[@]}"; do
    node "$HERE/capture-live.mjs" --scene "$scene" --lang "$lang" \
      --video "$VIDEO" --learn "$learn" --native "$native" || echo "  (failed: $scene/$lang)"
  done
done

pkill -f "user-data-dir=$PROFILE" 2>/dev/null || true
echo "All done → $HERE/out-live"
