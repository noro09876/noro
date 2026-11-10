#!/bin/bash
# Downloads the two small neural models used by the prep scripts (not stored in git).
set -e
cd "$(dirname "$0")/.."; mkdir -p models
[ -f models/selfie_multiclass.tflite ] || curl -L -o models/selfie_multiclass.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite
[ -f models/EDSR_x2.pb ] || curl -L -o models/EDSR_x2.pb \
  https://raw.githubusercontent.com/Saafke/EDSR_Tensorflow/master/models/EDSR_x2.pb
