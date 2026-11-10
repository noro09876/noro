#!/bin/bash
# QA helper: render given frames at half size and tile them into one contact sheet.
#   scripts/sheet.sh out/qa_a.jpg 20,50,100
set -e
OUT=$1; FR=$2; D=out/_qa_frames; rm -rf $D
npx remotion render Reel $D --frames=$FR --image-format=jpeg --scale=0.5 --sequence --log=error >/dev/null 2>&1
N=$(ls $D | wc -l)
ffmpeg -v error -y -pattern_type glob -i "$D/*.jpeg" -vf "tile=${N}x1" -q:v 3 $OUT
rm -rf $D
