#!/bin/bash
# Full rebuild from the raw materials. Run from the project root:  bash scripts/build.sh
#   needs: ffmpeg, node >= 20, python3 with  numpy scipy opencv-contrib-python-headless ai-edge-litert
set -e
cd "$(dirname "$0")/.."
bash scripts/fetch_models.sh             # 0. segmentation + upscale models (only if missing)
python3 scripts/prepare_client.py        # 1. client footage: upscale, grade, speaker cut-out  (~10 min CPU)
python3 scripts/prepare_broll.py         # 2. stock photos -> vertical plates
python3 scripts/make_audio.py            # 3. voice clean-up, music, sfx, master
npx remotion render Reel out/reel_video.mp4 --codec=h264 --crf=13 --muted   # 4. picture
bash scripts/finish.sh                   # 5. final MP4
