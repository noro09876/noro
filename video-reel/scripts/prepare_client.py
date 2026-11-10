#!/usr/bin/env python3
"""Step 1. Client footage -> 1080x1920 graded master + person cut-out sequence.

  source/client.mp4  ->  public/client.mp4          (graded, upscaled, no audio)
                         public/fg/f_0000.webp ...  (speaker cut-out with alpha, same grade)

The cut-out lets Remotion put titles/gradients BETWEEN the background and the speaker.
"""
import os, subprocess, sys, numpy as np, cv2
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from matte_lib import Matter

W, H, FPS = 1080, 1920, 30
SRC = os.path.join(ROOT, "source/client.mp4")
os.makedirs(os.path.join(ROOT, "public/fg"), exist_ok=True)

# gentle denoise of the 3 Mbps source before the upscale, lanczos upscale 720->1080
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", SRC, "-vf",
                        f"hqdn3d=1.2:1.2:3:3,scale={W}:{H}:flags=lanczos+accurate_rnd,fps={FPS}",
                        "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                        "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "13", "-g", "15",
                        "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                        "-movflags", "+faststart", os.path.join(ROOT, "public/client.mp4")], stdin=subprocess.PIPE)

# --- grade LUTs -------------------------------------------------------------
x = np.arange(256, dtype=np.float32) / 255.0
def scurve(v, k):               # soft filmic contrast around mid grey
    return v + k * (v - 0.5) * (1 - np.abs(2 * v - 1))
lut_all = np.clip(scurve(x, 0.22), 0, 1)
lut_fg = np.clip(scurve(x, 0.22) ** 0.93, 0, 1)   # speaker: lift mids (face is slightly back-lit)

def sat(img, s):
    g = img.mean(-1, keepdims=True)
    return g + (img - g) * s

m = Matter(os.path.join(ROOT, "models/selfie_multiclass.tflite"))
prev = None; n = 0
while True:
    buf = dec.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    bgr = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    a = m.matte(bgr)
    if prev is not None: a = 0.8 * a + 0.2 * prev      # light temporal smoothing against flicker
    prev = a
    # unsharp (after upscale, very mild to avoid halos on the face)
    f = bgr.astype(np.float32) / 255.0
    f = np.clip(f + 0.35 * (f - cv2.GaussianBlur(f, (0, 0), 1.3)), 0, 1)
    idx = (f * 255).astype(np.uint8)
    bg = sat(lut_all[idx], 1.05)
    fg = sat(lut_fg[idx], 1.06) * np.array([0.985, 1.0, 1.018], np.float32)   # tiny warmth (BGR)
    a3 = a[..., None]
    out = np.clip(bg * (1 - a3) + fg * a3, 0, 1)
    out8 = (out * 255 + 0.5).astype(np.uint8)
    enc.stdin.write(out8.tobytes())
    # cut-out: slightly contracted matte so no bright sky fringe survives
    ac = np.clip((a - 0.56) * 2.4 + 0.5, 0, 1)
    rgba = np.dstack([out8, (ac * 255 + 0.5).astype(np.uint8)])
    cv2.imwrite(os.path.join(ROOT, f"public/fg/f_{n:04d}.webp"), rgba, [cv2.IMWRITE_WEBP_QUALITY, 90])
    n += 1
    if n % 60 == 0: print("frames", n, flush=True)
enc.stdin.close(); enc.wait(); dec.wait()
print("done", n)
