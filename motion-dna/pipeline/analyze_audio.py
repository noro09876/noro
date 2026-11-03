"""Audio -> rhythm grid for the motion compiler (numpy only).

Output (beats.json):
  bpm, beats[], downbeats[]              seconds
  onsets[{t, strength 0..1, band}]       band: low | mid | high
  events[{t, type}]                      type: drop | break | hit
  beat_energy[]                          RMS per beat, 0..1

In production the same contract can be filled by librosa / madmom; the
compiler only depends on this JSON shape.

Usage: python3 -I pipeline/analyze_audio.py public/music.wav data/beats.json [data/music.truth.json]
"""
import json
import sys
import wave

import numpy as np

HOP = 512
NFFT = 2048


def load(path):
    with wave.open(path) as w:
        sr, ch = w.getframerate(), w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    return x.reshape(-1, ch).mean(axis=1), sr


def stft_mag(x):
    win = np.hanning(NFFT)
    n = 1 + (len(x) - NFFT) // HOP
    frames = np.lib.stride_tricks.as_strided(x, (n, NFFT), (x.strides[0] * HOP, x.strides[0]))
    return np.abs(np.fft.rfft(frames * win, axis=1))


def flux(mag):
    lm = np.log1p(100 * mag)
    d = np.maximum(0, np.diff(lm, axis=0))
    return np.concatenate([[0], d.sum(axis=1)])


def main(src, dst, truth_path=None):
    x, sr = load(src)
    fps = sr / HOP
    off = NFFT / 2 / sr  # a frame's flux peaks when the onset reaches the window centre
    mag = stft_mag(x)
    freqs = np.fft.rfftfreq(NFFT, 1 / sr)
    bands = {"low": freqs < 150, "mid": (freqs >= 150) & (freqs < 4000), "high": freqs >= 4000}
    env = flux(mag)
    band_env = {k: flux(mag[:, m]) for k, m in bands.items()}
    env = env / (env.max() + 1e-9)

    # Tempo: autocorrelation of the onset envelope, 70-180 BPM, mild prior around 110.
    e = env - env.mean()
    ac = np.correlate(e, e, "full")[len(e) - 1:]
    lags = np.arange(len(ac))
    bpm_of = 60 * fps / np.maximum(lags, 1)
    ok = (bpm_of >= 70) & (bpm_of <= 180)
    prior = np.exp(-0.5 * (np.log2(np.maximum(bpm_of, 1) / 110) / 0.6) ** 2)
    score = np.where(ok, ac * prior, -np.inf)
    lag = int(np.argmax(score))
    # Parabolic refinement for sub-frame period.
    a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
    period = lag + 0.5 * (a - c) / (a - 2 * b + c)
    bpm = 60 * fps / period

    # Phase: offset that collects the most onset energy on the grid.
    n_frames = len(env)
    best_phase, best = 0.0, -1.0
    for ph in np.arange(0, period, 0.25):
        idx = np.round(np.arange(ph, n_frames, period)).astype(int)
        s = env[idx[idx < n_frames]].sum()
        if s > best:
            best, best_phase = s, ph
    grid = np.arange(best_phase, n_frames - 1, period)
    beats = []
    for g in grid:  # snap each beat to the local onset peak (+-40 ms)
        lo, hi = int(max(0, g - 0.04 * fps)), int(min(n_frames, g + 0.04 * fps + 1))
        k = lo + int(np.argmax(env[lo:hi]))
        beats.append((k if env[k] > 0.25 else g) / fps + off)
    beats = np.array(beats)

    # Beat energy (RMS) and downbeats: phase of 4 with the strongest low band.
    rms = []
    for i, t in enumerate(beats):
        t1 = beats[i + 1] if i + 1 < len(beats) else t + period / fps
        seg = x[int(t * sr):int(t1 * sr)]
        rms.append(float(np.sqrt(np.mean(seg ** 2))) if len(seg) else 0.0)
    rms = np.array(rms) / (max(rms) + 1e-9)
    low = band_env["low"]
    low_at = np.array([low[min(n_frames - 1, int(round((t - off) * fps)))] for t in beats])
    phase4 = int(np.argmax([low_at[p::4].mean() + rms[p::4].mean() for p in range(4)]))
    downbeats = beats[phase4::4]

    # Onsets: adaptive threshold peak picking.
    w = int(0.1 * fps)
    onsets = []
    for i in range(1, n_frames - 1):
        lo, hi = max(0, i - w), min(n_frames, i + w + 1)
        if env[i] == env[lo:hi].max() and env[i] > np.median(env[lo:hi]) + 0.12:
            rel = {k: band_env[k][i] / (band_env[k].max() + 1e-9) for k in band_env}
            # a kick under a hat is still a kick: low wins when clearly present
            band = "low" if rel["low"] >= 0.4 else max(("mid", "high"), key=lambda k: rel[k])
            onsets.append({"t": round(i / fps + off, 3), "strength": round(float(env[i]), 3), "band": band})

    # Structural events from beat energy.
    events = []
    med = np.median(rms)
    # drop: energy of the next bar vs the previous bar, local maximum of the ratio
    # measured on the low band (kick + bass entering), so risers do not fake a drop
    low_mag = mag[:, bands["low"]].sum(axis=1)
    lo_e = np.array([low_mag[int((t - off) * fps):int((t - off) * fps + period)].mean() for t in beats])
    ratio = np.array([lo_e[i:i + 4].mean() / (lo_e[max(0, i - 4):i].mean() + 1e-9) if i >= 4 else 0 for i in range(len(lo_e))])
    for i in range(1, len(rms)):
        if rms[i] < 0.35 * med and rms[i - 1] > 0.6 * med:
            events.append({"t": round(float(beats[i]), 3), "type": "break"})
        elif ratio[i] > 1.4 and ratio[i] == ratio[max(0, i - 2):i + 3].max():
            events.append({"t": round(float(beats[i]), 3), "type": "drop"})
    for o in onsets:
        if o["strength"] > 0.85:
            events.append({"t": o["t"], "type": "hit"})
    events.sort(key=lambda e: e["t"])

    res = {
        "source": src,
        "duration": round(len(x) / sr, 3),
        "bpm": round(float(bpm), 2),
        "beats": [round(float(t), 3) for t in beats],
        "downbeats": [round(float(t), 3) for t in downbeats],
        "beat_energy": [round(float(v), 3) for v in rms],
        "onsets": onsets,
        "events": events,
    }
    with open(dst, "w") as f:
        json.dump(res, f, indent=1)
    print(f"bpm {res['bpm']}, {len(beats)} beats, {len(downbeats)} downbeats, {len(onsets)} onsets, events {events[:6]}")

    if truth_path:
        truth = json.load(open(truth_path))
        tb = np.array(truth["beats"])
        err = [np.min(np.abs(tb - b)) * 1000 for b in beats if b <= tb[-1] + 0.1]
        dterr = [np.min(np.abs(np.array(truth["downbeats"]) - d)) * 1000 for d in downbeats if d <= tb[-1] + 0.1]
        print(f"check vs truth: bpm {truth['bpm']} vs {res['bpm']}; beat err mean {np.mean(err):.1f} ms, max {np.max(err):.1f} ms; "
              f"downbeat err max {np.max(dterr):.1f} ms; truth drop {truth['drop']:.2f}s break {truth['break']:.2f}s")


if __name__ == "__main__":
    main(*sys.argv[1:])
