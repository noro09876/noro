"""Синтез музыкальной подложки и SFX + сведение с голосом.
usage: sound.py short|long timeline.json voice.wav out.wav"""
import json, sys, numpy as np, soundfile as sf

SR = 44100
rng = np.random.default_rng(7)


def t_(d):
    return np.arange(int(d * SR)) / SR


def env_ad(n, a, d):
    e = np.ones(n)
    na = max(1, int(a * SR)); e[:na] = np.linspace(0, 1, na)
    e *= np.exp(-np.arange(n) / SR / max(d, 1e-4))
    return e


def lowpass(x, cutoff):
    # однополюсный ФНЧ (cutoff может быть массивом)
    if np.ndim(cutoff) == 0:
        from scipy.signal import lfilter
        a = np.exp(-2 * np.pi * cutoff / SR)
        return lfilter([1 - a], [1, -a], x)
    a = np.exp(-2 * np.pi * np.asarray(cutoff) / SR) * np.ones(len(x))
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc; y[i] = acc
    return y


def note(f):
    return 440 * 2 ** ((f - 69) / 12)

# ───────────── SFX ─────────────

def whoosh(d=0.45, up=True):
    n = int(d * SR); x = rng.standard_normal(n)
    k = np.linspace(0, 1, n)
    cut = 300 + 5000 * (k if up else 1 - k) ** 1.5
    y = lowpass(x, cut) - lowpass(x, cut * 0.25)
    e = np.sin(np.pi * k) ** 1.6
    return y * e * 0.9


def pop(f=900):
    tt = t_(0.09)
    return np.sin(2 * np.pi * (f * tt - 2600 * tt ** 2)) * env_ad(len(tt), 0.002, 0.025) * 0.55


def tick():
    tt = t_(0.03)
    return np.sin(2 * np.pi * 2400 * tt) * env_ad(len(tt), 0.0005, 0.006) * 0.35


def impact():
    tt = t_(1.2)
    boom = np.sin(2 * np.pi * (55 * tt + 30 * (1 - np.exp(-tt * 12)) / 12)) * env_ad(len(tt), 0.003, 0.35)
    noise = lowpass(rng.standard_normal(len(tt)), 1200) * env_ad(len(tt), 0.001, 0.08)
    return (boom * 0.9 + noise * 0.6) * 0.9


def ding():
    tt = t_(1.0)
    return (np.sin(2 * np.pi * 1318.5 * tt) + 0.5 * np.sin(2 * np.pi * 1975.5 * tt)) * env_ad(len(tt), 0.002, 0.25) * 0.28


def rise(d=0.8):
    tt = t_(d); k = tt / d
    x = lowpass(rng.standard_normal(len(tt)), 400 + 6000 * k ** 2)
    return x * k ** 2 * 0.6

SFX = {'whoosh': whoosh, 'pop': pop, 'tick': tick, 'impact': impact, 'ding': ding, 'rise': rise}

# ───────────── Музыка ─────────────

def music(dur, bpm=100, prog=((57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)), seed=1):
    """Тёплая электронная подложка: пэд, бас, мягкий кик, шейкер. Сайдчейн-пампинг от кика."""
    n = int(dur * SR); out = np.zeros(n); beat = 60 / bpm; bar = beat * 4
    tt = np.arange(n) / SR
    # пэд: детюн-пилы, фильтрованные
    pad = np.zeros(n); bass = np.zeros(n)
    for b in range(int(dur / bar) + 1):
        ch = prog[b % len(prog)]
        s, e = int(b * bar * SR), min(n, int((b + 1) * bar * SR) + int(0.3 * SR))
        if s >= n: break
        seg = tt[s:e] - b * bar
        a = np.minimum(1, seg / 0.4) * np.minimum(1, (bar + 0.3 - seg) / 0.3).clip(0)
        for m in ch:
            for det in (-0.08, 0.08):
                f = note(m + 12) * (1 + det / 100 * 12)
                ph = (f * seg) % 1
                pad[s:e] += (2 * ph - 1) * a * 0.05
        fb = note(ch[0] - 12)
        for q in range(8):  # восьмые басом
            qs = int((b * bar + q * beat / 2) * SR); qe = min(n, qs + int(beat / 2 * SR * 0.9))
            if qs >= n: break
            st = (np.arange(qe - qs)) / SR
            bass[qs:qe] += np.sin(2 * np.pi * fb * st) * env_ad(qe - qs, 0.005, 0.18) * 0.22
    pad = lowpass(pad, 1400)
    kick = np.zeros(n); hat = np.zeros(n); duck = np.ones(n)
    for k in range(int(dur / beat) + 1):
        s = int(k * beat * SR)
        if s >= n: break
        kt = t_(0.35); kk = np.sin(2 * np.pi * (48 * kt + 90 * (1 - np.exp(-kt * 30)) / 30)) * env_ad(len(kt), 0.002, 0.11)
        e = min(n, s + len(kk)); kick[s:e] += kk[:e - s] * 0.5
        dl = int(beat * SR); de = min(n, s + dl)
        duck[s:de] = np.minimum(duck[s:de], 1 - 0.45 * np.exp(-np.arange(de - s) / SR / 0.09))
        hs = int((k * beat + beat / 2) * SR)
        if hs < n:
            hx = rng.standard_normal(int(0.05 * SR)); hx = hx - lowpass(hx, 6000)
            he = min(n, hs + len(hx)); hat[hs:he] += (hx * env_ad(len(hx), 0.001, 0.015))[:he - hs] * 0.12
    out = pad * duck + bass * duck + kick + hat
    fade = np.minimum(1, tt / 1.0) * np.minimum(1, (dur - tt) / 2.0).clip(0)
    return out * fade


def place(buf, x, at, gain=1.0):
    s = int(at * SR)
    if s < 0: x = x[-s:]; s = 0
    e = min(len(buf), s + len(x))
    if e > s: buf[s:e] += x[:e - s] * gain


def short_events(tl):
    sc = {s['id']: s for s in tl['scenes']}
    L = lambda i, k: [l['start'] for l in tl['lines'] if l['scene'] == i][k]
    W = lambda pre: next(w['start'] for w in tl['words'] if w['w'].lower().startswith(pre))
    ev = [('impact', 0.0, 0.8), ('pop', 0.62, 0.7), ('impact', L('hook', 1), 0.55)]
    for s in tl['scenes'][1:]:
        ev.append(('whoosh', s['start'] - 0.28, 0.55))
    for k in ['сайт', 'директ', 'телеграм', 'звонки']:
        ev.append(('pop', W(k) - 0.1, 0.6))
    for k in range(3): ev.append(('pop', L('leaks', k) + 0.05, 0.5))
    a = L('leaks', 2) + 0.2
    for i in range(14): ev.append(('tick', a + i * 0.13, 0.6))
    ev.append(('impact', sc['unify']['start'], 0.7))
    for i in range(6): ev.append(('pop', L('unify', 1) + 0.1 + i * 0.16, 0.35))
    for k in range(3): ev.append(('pop', L('flow', k), 0.55))
    ev.append(('ding', L('flow', 2) + 1.6, 0.6))
    for m in [0.7, 0.9, 1.1, 1.5, 1.7, 2.0, 2.4, 2.6]: ev.append(('pop', sc['pipeline']['start'] + m, 0.3))
    ev.append(('rise', sc['cta']['start'] - 0.8, 0.5))
    ev.append(('impact', L('cta', 1) - 0.1, 0.7))
    return ev


def long_events(tl):
    ev = []
    for s in tl['scenes'][1:]:
        if s['id'].startswith('ch'):
            ev += [('rise', s['start'] - 1.2, 0.45), ('impact', s['start'] - 0.45, 0.5)]
        else:
            ev.append(('whoosh', s['start'] - 0.28, 0.45))
    for l in tl['lines']:
        ev.append(('pop', l['start'] - 0.02, 0.18))
    ev.append(('impact', 0.0, 0.7))
    return ev


def main(kind, tl_path, voice_path, out_path):
    tl = json.load(open(tl_path))
    v, vsr = sf.read(voice_path, dtype='float64')
    if vsr != SR:
        v = np.interp(np.linspace(0, len(v) - 1, int(len(v) * SR / vsr)), np.arange(len(v)), v)
    dur = tl['duration']; n = int(dur * SR)
    voice = np.zeros(n); voice[:min(n, len(v))] = v[:n]
    mus = music(dur, bpm=100 if kind == 'short' else 92)
    # ducking музыки под голос (огибающая голоса, сглаженная)
    from scipy.ndimage import uniform_filter1d
    env = uniform_filter1d(np.abs(voice), int(0.12 * SR))
    env = uniform_filter1d((env > 0.01).astype(float), int(0.3 * SR))
    duck = 1 - 0.72 * np.clip(env * 1.4, 0, 1)
    mus_gain = 0.8 if kind == 'short' else 0.5
    sfx = np.zeros(n)
    for name, at, g in (short_events(tl) if kind == 'short' else long_events(tl)):
        place(sfx, SFX[name](), at, g)
    mix = voice * 1.0 + mus * duck * mus_gain + sfx * 0.55
    mix /= max(1e-9, np.abs(mix).max()) / 0.9
    sf.write(out_path, np.stack([mix, mix], 1).astype(np.float32), SR, subtype='PCM_24')
    print('ok', out_path, round(dur, 2))


if __name__ == '__main__':
    main(*sys.argv[1:5])
