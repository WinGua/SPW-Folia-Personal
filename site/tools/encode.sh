#!/usr/bin/env bash
# Encode the promo-site video assets from the captures made by the other tools
# in this directory. Run from the repo root after capture-hero.mjs,
# capture-scenes.mjs and tour.mjs have produced $RAW/*.webm and
# $SITE_RAW/tour.webm.
#
# Needs a full ffmpeg (libx264). Set FFMPEG to point at one; by default we look
# next to the repo in .tmp-capture/bin (where the capture toolchain puts it) and
# then fall back to whatever is on PATH.
set -euo pipefail
cd "$(dirname "$0")/../.."

FF="${FFMPEG:-$( [ -x .tmp-capture/bin/ffmpeg.exe ] && echo .tmp-capture/bin/ffmpeg.exe || command -v ffmpeg )}"
if [ -z "$FF" ]; then
  echo "encode.sh: no ffmpeg found — set FFMPEG=/path/to/ffmpeg (needs libx264)" >&2
  exit 1
fi
echo "ffmpeg: $FF"

RAW=".tmp-capture/raw"
SITE_RAW=".tmp-capture/site-raw"
OUT="site/assets/video"
mkdir -p "$OUT"

echo "== hero (single loop, 15s) =="
"$FF" -y -hide_banner -loglevel error -ss 4.5 -t 15 -i "$RAW/hero.webm" \
  -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -preset slow -crf 24 \
  -pix_fmt yuv420p -movflags +faststart -an "$OUT/hero.mp4"
"$FF" -y -hide_banner -loglevel error -ss 6.0 -i "$RAW/hero.webm" -frames:v 1 \
  -vf "scale=1280:720:flags=lanczos" -q:v 4 "$OUT/hero-poster.jpg"

echo "== montage reel (6 scenes, xfade) =="
"$FF" -y -hide_banner -loglevel error \
  -ss 5.0 -t 4.8 -i "$RAW/hero.webm" \
  -ss 5.0 -t 4.8 -i "$RAW/s2-aurora.webm" \
  -ss 5.0 -t 4.8 -i "$RAW/s5-diorama.webm" \
  -ss 5.0 -t 4.8 -i "$RAW/s6-pendolo.webm" \
  -ss 5.0 -t 4.8 -i "$RAW/sonnet.webm" \
  -ss 5.0 -t 4.8 -i "$RAW/s7-overlay.webm" \
  -filter_complex "\
[0:v]setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,fps=30[v0];\
[1:v]setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,fps=30[v1];\
[2:v]setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,fps=30[v2];\
[3:v]setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,fps=30[v3];\
[4:v]setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,fps=30[v4];\
[5:v]setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,fps=30[v5];\
[v0][v1]xfade=transition=fade:duration=0.8:offset=4.0[x1];\
[x1][v2]xfade=transition=fade:duration=0.8:offset=8.0[x2];\
[x2][v3]xfade=transition=fade:duration=0.8:offset=12.0[x3];\
[x3][v4]xfade=transition=fade:duration=0.8:offset=16.0[x4];\
[x4][v5]xfade=transition=fade:duration=0.8:offset=20.0[out]" \
  -map "[out]" -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart -an "$OUT/reel.mp4"
"$FF" -y -hide_banner -loglevel error -i "$OUT/reel.mp4" -frames:v 1 -q:v 4 "$OUT/reel-poster.jpg"

echo "== overlay demo (lyrics on desktop, 10s) =="
"$FF" -y -hide_banner -loglevel error -ss 4.5 -t 10 -i "$RAW/s7-overlay.webm" \
  -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -preset slow -crf 24 \
  -pix_fmt yuv420p -movflags +faststart -an "$OUT/overlay.mp4"
"$FF" -y -hide_banner -loglevel error -ss 6.0 -i "$RAW/s7-overlay.webm" -frames:v 1 \
  -vf "scale=1280:720:flags=lanczos" -q:v 4 "$OUT/overlay-poster.jpg"

echo "== site tour (the page itself, 1080p, no captions) =="
"$FF" -y -hide_banner -loglevel error -i "$SITE_RAW/tour.webm" \
  -vf "fade=t=in:st=0:d=0.9,fade=t=out:st=47.2:d=1.6" \
  -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart -an "$OUT/tour.mp4"
"$FF" -y -hide_banner -loglevel error -ss 1.2 -i "$SITE_RAW/tour.webm" -frames:v 1 \
  -q:v 4 "$OUT/tour-poster.jpg"

ls -la "$OUT"
