#!/usr/bin/env python3
"""Step 3. Sound: clean the voice, synthesise a royalty-free music bed + whooshes/hits, mix and master.

  source/client.mp4 (audio) -> out/audio_master.wav   (-14 LUFS, true peak -1 dB, 48 kHz stereo)
  Stems are kept in out/stems/ (voice.wav, music.wav, sfx.wav) for re-mixing.

Everything is generated here from scratch (numpy), so there are no music-licence issues.
SFX times follow the cut list in src/Reel.tsx — keep them in sync if you move cuts.
"""
import os, subprocess, numpy as np
from scipy.signal import butter, sosfilt, sosfiltfilt
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
DUR = 36.8                      # = DURATION / FPS in src/config.ts
N = int(SR * DUR)
os.makedirs(os.path.join(ROOT, "out/stems"), exist_ok=True)
rng = np.random.default_rng(3)

def filt(x, kind, fc, order=2):
    return sosfilt(butter(order, fc, btype=kind, fs=SR, output="sos"), x, axis=0)

def place(buf, sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= len(buf): return
    if i < 0: sig = sig[-i:]; i = 0
    sig = sig[: len(buf) - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(sig), 0] += sig * gain * l * 1.414
    buf[i:i + len(sig), 1] += sig * gain * r * 1.414

# ───────────────────────── 1. VOICE ─────────────────────────
voice_path = os.path.join(ROOT, "out/stems/voice.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(ROOT, "source/client.mp4"), "-vn", "-af",
    ",".join([
        "highpass=f=95:poles=2",                      # wind / handling rumble
        "afftdn=nr=11:nf=-42:tn=1",                   # broadband noise, gentle so the voice stays natural
        "equalizer=f=220:t=q:w=1.1:g=-1.5",           # a little mud out
        "equalizer=f=3600:t=q:w=1.2:g=2.0",           # presence
        "highshelf=f=9000:g=1.5",
        "acompressor=threshold=-22dB:ratio=2.6:attack=8:release=140:makeup=2.5",
        "alimiter=limit=0.89:attack=4:release=60:level=disabled",
        "aresample=48000", "apad=whole_dur=%.2f" % DUR, "atrim=0:%.2f" % DUR,
    ]), "-ac", "2", "-c:a", "pcm_s16le", voice_path], check=True)
_, v = wavfile.read(voice_path); voice = v.astype(np.float32)[:N] / 32768
if len(voice) < N: voice = np.vstack([voice, np.zeros((N - len(voice), 2), np.float32)])
voice[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[:, None]

# ───────────────────────── 2. MUSIC ─────────────────────────
BEAT = 0.576                    # 104.2 BPM → bar downbeats land on the main cuts (2.3 s, 25.3 s …)
BAR = 4 * BEAT
midi = lambda m: 440.0 * 2 ** ((m - 69) / 12)
CHORDS = [  # (bass, chord tones) — Am7 · Fmaj7 · Cmaj7 · G6
    (45, [57, 60, 64, 67]), (41, [57, 60, 64, 65]), (48, [55, 59, 60, 64]), (43, [55, 59, 62, 64])]
nbars = int(np.ceil(DUR / BAR)) + 1
def section(b):                 # arrangement per bar
    if b == 0: return "intro"
    if b in (9, 10): return "break"
    if b >= 15: return "outro"
    return "groove"

music = np.zeros((N, 2), np.float32)
t_all = np.arange(N) / SR

def saw(f, n, ph=0.0):
    p = (f * np.arange(n) / SR + ph) % 1.0
    return 2 * p - 1

# pad
pad = np.zeros((N, 2), np.float32)
for b in range(nbars):
    bass, tones = CHORDS[b % 4]
    n = int((BAR + 0.9) * SR); env = np.ones(n); a = int(0.5 * SR); r = int(0.9 * SR)
    env[:a] = np.linspace(0, 1, a) ** 1.5; env[-r:] = np.linspace(1, 0, r) ** 1.5
    for ch, det in ((0, -6), (1, 6)):
        s = sum(saw(midi(m) * 2 ** (det / 1200), n, rng.random()) + saw(midi(m) * 2 ** (-det * 1.7 / 1200), n, rng.random()) for m in tones) / 8
        i = int(b * BAR * SR); s = (s * env)[: max(0, N - i)]
        pad[i:i + len(s), ch] += s
pad = filt(pad, "low", 1100, 2); pad = filt(pad, "high", 180, 1)
music += pad * 0.20

# pluck arpeggio (8th notes) with a dotted-8th echo
pl = np.zeros((N, 2), np.float32)
ARP = [0, 2, 1, 3, 2, 1, 3, 2]
for b in range(nbars):
    sec_ = section(b); _, tones = CHORDS[b % 4]
    for k in range(8):
        if sec_ == "break" and k % 2: continue
        if sec_ == "outro" and k > 0: continue
        f = midi(tones[ARP[k]] + 12); n = int(0.5 * SR); tt = np.arange(n) / SR
        s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt) + 0.12 * np.sin(6 * np.pi * f * tt)) * np.exp(-tt * 9)
        s[:48] *= np.linspace(0, 1, 48)
        vel = (0.9 if k % 2 == 0 else 0.6) * (0.6 if sec_ == "intro" else 1.0)
        place(pl, s.astype(np.float32), b * BAR + k * BEAT / 2, 0.10 * vel, pan=0.35 * (-1) ** k)
d = int(0.75 * BEAT * SR)
for rep, g in ((1, 0.38), (2, 0.16)):
    pl[rep * d:] += pl[: N - rep * d][:, ::-1] * g
music += filt(pl, "low", 5200, 1)

# drums + bass
def kick():
    n = int(0.32 * SR); tt = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(46 + 95 * np.exp(-tt * 38)) / SR
    return (np.sin(ph) * np.exp(-tt * 13)).astype(np.float32)
def clap():
    n = int(0.16 * SR); tt = np.arange(n) / SR
    s = filt(rng.normal(0, 1, n), "band", [1100, 3800], 2) * (np.exp(-tt * 34) + 0.6 * np.exp(-np.abs(tt - 0.012) * 300))
    return s.astype(np.float32)
def hat(decay=75):
    n = int(0.07 * SR); tt = np.arange(n) / SR
    return (filt(rng.normal(0, 1, n), "high", 7500, 2) * np.exp(-tt * decay)).astype(np.float32)
drums = np.zeros((N, 2), np.float32); bassb = np.zeros((N, 2), np.float32); duck = np.ones(N, np.float32)
for b in range(nbars):
    if section(b) != "groove": continue
    root, _ = CHORDS[b % 4]
    for beat in range(4):
        t0 = b * BAR + beat * BEAT
        place(drums, kick(), t0, 0.50)
        i = int(t0 * SR); m = int(0.26 * SR)
        if i < N: duck[i:i + m] = np.minimum(duck[i:i + m], (0.42 + 0.58 * np.linspace(0, 1, m) ** 1.6)[: max(0, N - i)])
        if beat in (1, 3): place(drums, clap(), t0, 0.13)
        place(drums, hat(), t0 + BEAT / 2, 0.055, pan=0.2)
        if beat % 2: place(drums, hat(110), t0 + BEAT * 0.75, 0.028, pan=-0.3)
    for (bt, ln) in ((0.5, 1.3), (2.5, 0.9), (3.5, 0.45)):
        n = int(ln * BEAT * SR); tt = np.arange(n) / SR; f = midi(root - 12 if root > 44 else root)
        s = np.tanh(1.6 * np.sin(2 * np.pi * f * tt)) * np.minimum(1, tt * 60) * np.exp(-tt * 2.2)
        s[-200:] *= np.linspace(1, 0, 200)
        place(bassb, s.astype(np.float32), b * BAR + bt * BEAT, 0.20)
music = music * (0.55 + 0.45 * duck[:, None]) + drums + bassb * duck[:, None]

# section shaping: soft intro, break before "моря", outro tail
g = np.ones(N, np.float32)
def ramp(t0, t1, a, b_):
    i0, i1 = int(t0 * SR), min(N, int(t1 * SR)); g[i0:i1] = np.linspace(a, b_, i1 - i0)
ramp(0, 0.05, 0, 0.8); ramp(0.05, BAR, 0.8, 1.0)
ramp(35.3, DUR, 1.0, 0.0)
music *= g[:, None]

# ───────────────────────── 3. SFX ─────────────────────────
sfx = np.zeros((N, 2), np.float32)
def whoosh(dur=0.42, f0=500, f1=5200, peak=0.62):
    n = int(dur * SR); x = rng.normal(0, 1, n); out = np.zeros(n); tt = np.linspace(0, 1, n)
    # time-varying band-pass by cross-fading a bank of fixed bands
    bands = np.geomspace(f0, f1, 7)
    for j, fc in enumerate(bands):
        w = np.exp(-((tt * 6 - j) ** 2) / 1.6)
        out += filt(x, "band", [fc * 0.72, fc * 1.38], 2) * w
    env = np.where(tt < peak, (tt / peak) ** 2.2, ((1 - tt) / (1 - peak)) ** 1.6)
    return (out * env / (np.abs(out).max() + 1e-9)).astype(np.float32)
def impact():
    n = int(0.9 * SR); tt = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(38 + 70 * np.exp(-tt * 22)) / SR
    s = np.sin(ph) * np.exp(-tt * 5.5) + 0.25 * filt(rng.normal(0, 1, n), "low", 900, 2) * np.exp(-tt * 30)
    return s.astype(np.float32)
def pop(f=880):
    n = int(0.09 * SR); tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * (f + 900 * tt) * tt) * np.exp(-tt * 55) * np.minimum(1, tt * 900)).astype(np.float32)
def riser(dur=1.0):
    n = int(dur * SR); tt = np.linspace(0, 1, n)
    s = filt(rng.normal(0, 1, n), "high", 2500, 2) * tt ** 2.4 * 0.7 + 0.25 * np.sin(2 * np.pi * np.cumsum(220 + 660 * tt ** 2) / SR) * tt ** 2
    s[-300:] *= np.linspace(1, 0, 300)
    return s.astype(np.float32)
def ticks(dur=0.5, n_t=11):
    out = np.zeros(int(dur * SR), np.float32)
    for k in range(n_t):
        p_ = pop(1500 + 60 * k) * 0.5; i = int(k / n_t * dur * SR); out[i:i + len(p_)] += p_[: len(out) - i]
    return out

CUTS = [2.28, 4.70, 6.88, 9.22, 11.86, 15.56, 17.46, 21.18, 25.32, 26.20, 27.66, 29.00, 29.86, 33.95]
for i, c in enumerate(CUTS):                               # whoosh peaks exactly on the cut
    place(sfx, whoosh(), c - 0.26, 0.16, pan=0.5 * (-1) ** i)
for t0, gdb in ((2.70, 0.55), (16.62, 0.42), (18.86, 0.42), (25.32, 0.70), (32.90, 0.55), (34.08, 0.40)):
    place(sfx, impact(), t0, gdb)                          # sub hits under the giant titles
for t0, f in ((5.50, 880), (5.92, 1320), (6.20, 990), (6.56, 1480), (13.10, 780), (13.98, 1175), (31.68, 880), (32.30, 1100)):
    place(sfx, pop(f), t0, 0.14)                           # pills / calendar pops
place(sfx, ticks(), 16.62, 0.10)                           # count-up
place(sfx, riser(1.0), 24.32, 0.20)                        # pause before «…моря»
place(sfx, riser(0.6), 1.70, 0.10)

# ───────────────────────── 4. MIX + MASTER ─────────────────────────
def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
active = np.abs(voice).max(1) > 0.02
v_db = rms_db(voice[active])
music *= 10 ** ((v_db - 21.0 - rms_db(music[int(3 * SR):int(20 * SR)])) / 20)   # bed sits ~21 dB under the voice
# duck the bed a bit more while he speaks, let it come up in gaps and on the end card
env = np.abs(voice).max(1); env = sosfiltfilt(butter(2, 6, fs=SR, output="sos"), env)
dk = 1.0 - 0.30 * np.clip(env / (np.percentile(env, 90) + 1e-9), 0, 1)
tail = np.clip((t_all - 35.0) / 0.5, 0, 1); dk = dk * (1 + 0.9 * tail)
mix = voice + music * dk[:, None] + sfx * 10 ** ((v_db + 9) / 20)
for name, stem in (("music", music * dk[:, None]), ("sfx", sfx * 10 ** ((v_db + 9) / 20))):
    wavfile.write(os.path.join(ROOT, f"out/stems/{name}.wav"), SR, (np.clip(stem, -1, 1) * 32767).astype(np.int16))
tmp = os.path.join(ROOT, "out/stems/_premaster.wav")
wavfile.write(tmp, SR, (np.clip(mix * 0.7, -1, 1) * 32767).astype(np.int16))
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-af", "loudnorm=I=-14:TP=-1.0:LRA=9,aresample=48000", "-c:a", "pcm_s16le",
                os.path.join(ROOT, "out/audio_master.wav")], check=True)
os.remove(tmp)
print("voice rms %.1f dB | music %.1f dB | done" % (v_db, rms_db((music * dk[:, None])[int(3 * SR):int(20 * SR)])))
