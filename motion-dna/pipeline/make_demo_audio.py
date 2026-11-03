"""Synthesises the demo music bed (no samples, no licensing questions).

100 BPM, 4/4, 16.8 s: 2 bars of intro (hats + soft kick), riser, full groove
from bar 3, one-beat break before the last bar, end hit.
Ground truth is written next to the wav so analyze_audio.py can be checked.

Usage: python3 -I pipeline/make_demo_audio.py public/music.wav data/music.truth.json
"""
import json
import sys
import wave

import numpy as np

SR = 48000
BPM = 100
BEAT = 60 / BPM
BARS = 7
DUR = BARS * 4 * BEAT
rng = np.random.default_rng(7)
out = np.zeros(int(DUR * SR) + SR)


def add(sig, t, gain=1.0):
    i = int(t * SR)
    out[i:i + len(sig)] += sig[: max(0, len(out) - i)] * gain


def env(n, decay):
    return np.exp(-np.arange(n) / (decay * SR))


def kick():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 85 * np.exp(-t / 0.045)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.16)


def snare():
    n = int(0.3 * SR)
    noise = rng.standard_normal(n) * env(n, 0.07)
    tone = np.sin(2 * np.pi * 185 * np.arange(n) / SR) * env(n, 0.05)
    return 0.55 * noise + 0.5 * tone


def hat(open_=False):
    n = int((0.25 if open_ else 0.05) * SR)
    x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))  # crude high-pass
    return x * env(n, 0.08 if open_ else 0.012) * 0.35


def bass(freq, length):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, 6))
    return s * env(n, length * 0.6) * 0.32


def pad(freqs, length):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * f * t + i) for i, f in enumerate(freqs)) / len(freqs)
    a = np.minimum(1, t / 0.4) * np.minimum(1, (length - t) / 0.4)
    return s * a * 0.12


truth = {"bpm": BPM, "beats": [], "downbeats": [], "drop": 2 * 4 * BEAT, "break": None, "end_hit": None}
roots = [55.0, 55.0, 43.65, 49.0]  # A1 A1 F1 G1
chords = [[220, 261.6, 329.6], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]

for bar in range(BARS):
    t0 = bar * 4 * BEAT
    full = bar >= 2
    add(pad(chords[bar % 4], 4 * BEAT), t0)
    for b in range(4):
        tb = t0 + b * BEAT
        is_break = bar == BARS - 2 and b == 3
        truth["beats"].append(round(tb, 4))
        if b == 0:
            truth["downbeats"].append(round(tb, 4))
        if is_break:
            truth["break"] = round(tb, 4)
            continue
        if full or b in (0, 2):
            add(kick(), tb, 0.9 if full else 0.45)
        if full and b in (1, 3):
            add(snare(), tb, 0.8)
        add(hat(), tb + BEAT / 2, 0.8 if full else 0.5)
        if full:
            add(hat(), tb, 0.5)
            add(bass(roots[bar % 4], BEAT * 0.9), tb)
    if bar == 1:  # riser into the drop
        n = int(4 * BEAT * SR)
        x = rng.standard_normal(n) * np.linspace(0, 1, n) ** 2 * 0.25
        add(np.diff(np.concatenate([[0], x])), t0)

end_t = BARS * 4 * BEAT
truth["end_hit"] = round(end_t - 4 * BEAT, 4)
add(kick(), end_t - 4 * BEAT, 1.0)
add(hat(True), end_t - 4 * BEAT, 1.2)

out = out[: int((DUR + 0.6) * SR)]
out /= np.max(np.abs(out)) * 1.12
pcm = (np.stack([out, out], axis=1) * 32767).astype("<i2")
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
with open(sys.argv[2], "w") as f:
    json.dump(truth, f, indent=1)
print(f"wrote {sys.argv[1]} {DUR + 0.6:.2f}s")
