#!/usr/bin/env python3
"""Step 2. Stock photos -> vertical 9:16 b-roll plates.

  assets/photos_raw/*.jpg -> public/broll/*.jpg  (1296x2304, 2x neural upscale (EDSR), crop, grade)

CROPS: source photo + horizontal/vertical centre of the 9:16 window (0..1) + zoom.
Usage: prepare_broll.py [plate ...]   (no args = all plates)
"""
import os, sys, numpy as np, cv2
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_W, OUT_H = 1296, 2304
CROPS = {              # plate name: (source photo, cx, cy, zoom)
    "tower_white":  ("tower_white",  0.50, 0.50, 1.00),
    "towers_glass": ("towers_glass", 0.50, 0.50, 1.00),
    "apartments":   ("apartments",   0.60, 0.50, 1.00),
    "sea_condos":   ("sea_condos",   0.80, 0.50, 1.00),
    "sea_condos_b": ("sea_condos",   0.20, 0.50, 1.00),   # second framing of the same photo
    "coast_green":  ("coast_green",  0.30, 0.50, 1.00),
    "resort":       ("resort",       0.20, 0.50, 1.00),
}
sr = cv2.dnn_superres.DnnSuperResImpl_create()
sr.readModel(os.path.join(ROOT, "models/EDSR_x2.pb")); sr.setModel("edsr", 2)
os.makedirs(os.path.join(ROOT, "public/broll"), exist_ok=True)
only = sys.argv[1:]
for name, (srcname, cx, cy, zoom) in CROPS.items():
    if only and name not in only: continue
    img = cv2.imread(os.path.join(ROOT, f"assets/photos_raw/{srcname}.jpg"))
    h, w = img.shape[:2]
    ch = h / zoom; cw = ch * 9 / 16
    if cw > w: cw = w; ch = cw * 16 / 9
    x0 = int(round(min(max(cx * w - cw / 2, 0), w - cw))); y0 = int(round(min(max(cy * h - ch / 2, 0), h - ch)))
    crop = img[y0:y0 + int(ch), x0:x0 + int(cw)]
    crop = cv2.fastNlMeansDenoisingColored(crop, None, 2, 2, 5, 15)      # tame JPEG noise before SR
    up = sr.upsample(crop)                                              # neural 2x
    up = cv2.resize(up, (OUT_W, OUT_H), interpolation=cv2.INTER_LANCZOS4)
    f = up.astype(np.float32) / 255
    f = np.clip(f + 0.5 * (f - cv2.GaussianBlur(f, (0, 0), 2.0)), 0, 1)  # local contrast
    f = f + 0.18 * (f - 0.5) * (1 - np.abs(2 * f - 1))                   # soft S-curve
    g = f.mean(-1, keepdims=True); f = np.clip(g + (f - g) * 1.08, 0, 1)
    rng = np.random.default_rng(7); f = np.clip(f + rng.normal(0, 0.012, f.shape[:2] + (1,)).astype(np.float32), 0, 1)  # fine grain hides upscale softness
    cv2.imwrite(os.path.join(ROOT, f"public/broll/{name}.jpg"), (f * 255 + .5).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 93])
    print(name, crop.shape, "->", up.shape)
