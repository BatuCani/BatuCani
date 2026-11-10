#!/usr/bin/env bash
# One-off: pack Carbon's four 10-frame sheets into one small WebP that render-contrib.mjs embeds.
# Run it again only when the sheets change; the scheduled render needs node and nothing else.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
assets="$root/assets"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Rows in this order: enter (walk + wave), kick, pause, cheer. Each sheet is 1920x256.
magick "$assets/scene-enter.png" "$assets/scene-kick.png" "$assets/scene-pause.png" "$assets/scene-cheer.png" \
  -append \
  -channel A -level 3%,98% +channel \
  "$tmp/carbon-sheet.png"

# The level step snaps near-clear alpha to 0 and near-solid alpha to 255. The source sheets carry
# alpha noise (1-4 and 252-254) that WebP otherwise stores losslessly at a high cost.
cwebp -quiet -q 70 -alpha_q 100 -alpha_filter best -m 6 -sharp_yuv \
  "$tmp/carbon-sheet.png" -o "$assets/carbon-sheet.webp"

echo "wrote $assets/carbon-sheet.webp ($(wc -c < "$assets/carbon-sheet.webp" | tr -d ' ') bytes)"
