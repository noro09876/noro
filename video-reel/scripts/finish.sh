#!/bin/bash
# Step 5. Mux the rendered picture with the mastered sound -> out/final.mp4
#   H.264 High, 1080x1920, 30 fps, yuv420p, bt709, AAC 48 kHz, faststart (Reels / TikTok / Shorts ready)
set -e
cd "$(dirname "$0")/.."
ffmpeg -v error -y -i out/reel_video.mp4 -i out/audio_master.wav \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset slow -crf 16 -maxrate 16M -bufsize 32M -profile:v high -level 4.2 \
  -pix_fmt yuv420p -r 30 -g 60 -bf 2 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 256k -ar 48000 -ac 2 \
  -movflags +faststart -shortest out/final.mp4
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate -of default=nw=1 out/final.mp4
