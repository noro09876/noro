#!/bin/bash
# usage: mux.sh silent.mp4 mix.wav out.mp4   — двухпроходная нормализация громкости до -14 LUFS / -1 dBTP
set -e
M=$(ffmpeg -hide_banner -i "$2" -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$M" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
VCODEC_ARGS=${VCODEC_ARGS:-}
ffmpeg -y -hide_banner -loglevel error -i "$1" -i "$2" -map 0:v -map 1:a -c:v ${VCODEC:-copy} $VCODEC_ARGS \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000" \
  -c:a aac -b:a 192k -movflags +faststart -shortest "$3"
