"""Озвучка сценария Piper + выравнивание слов по ASR (sherpa-onnx) -> wav + timeline JSON.
usage: voice.py script.json out.wav out_timeline.json"""
import json, sys, re, difflib, numpy as np, soundfile as sf
from piper import PiperVoice, SynthesisConfig
import sherpa_onnx

SCR = "/tmp/claude-0/-home-claude-noro/91b20d94-e1c8-5e3d-9c07-3ea267313e0b/scratchpad"
VOICE = f"{SCR}/voices/vits-piper-ru_RU-denis-medium/ru_RU-denis-medium.onnx"
ASR = f"{SCR}/sherpa-onnx-zipformer-ru-2024-09-18"
SR = 22050
# отображаемое слово -> как его произносить (1:1 по словам, чтобы субтитры совпадали)
SAY = {"Brukinsta": "Брук-Инста", "CRM": "сиаэрэм", "CRM-системе": "сиаэрэм-системе", "ИИ": "ии", "ИИ-агент": "ии-агент",
       "API": "апиай", "n8n": "эн-восемь-эн", "ИИ-слой": "ии-слой", "ИИ-слоя": "ии-слоя", "ИИ-модель": "ии-модель"}

def norm(w):
    return re.sub(r"[^а-яёa-z0-9-]", "", w.lower()).replace("ё", "е")

def say_text(line):
    return " ".join(SAY.get(re.sub(r"[^\w-]", "", w), w) if re.sub(r"[^\w-]", "", w) in SAY else w for w in line.split())

def main(script_path, out_wav, out_json, length_scale=1.0):
    S = json.load(open(script_path))
    voice = PiperVoice.load(VOICE)
    cfg = SynthesisConfig(length_scale=length_scale, noise_scale=0.6, noise_w_scale=0.75)
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=f"{ASR}/encoder.int8.onnx", decoder=f"{ASR}/decoder.onnx",
                                                        joiner=f"{ASR}/joiner.int8.onnx", tokens=f"{ASR}/tokens.txt", num_threads=4)
    pieces, t = [], S.get("lead_in", 0.3)
    pieces.append(np.zeros(int(t * SR), np.float32))
    scenes, words_all, report, lines_all = [], [], [], []
    for sc in S["scenes"]:
        s0 = t
        for i, line in enumerate(sc["lines"]):
            audio = np.concatenate([c.audio_int16_array for c in voice.synthesize(say_text(line), cfg)]).astype(np.float32) / 32768
            # обрезка тишины по краям (порог -45 дБ), с запасом 30 мс
            env = np.abs(audio) > 10 ** (-45 / 20)
            idx = np.where(env)[0]
            a, b = max(idx[0] - int(.03 * SR), 0), min(idx[-1] + int(.06 * SR), len(audio))
            audio = audio[a:b]
            dur = len(audio) / SR
            # ASR -> пословные таймкоды
            x16 = np.concatenate([np.interp(np.linspace(0, len(audio) - 1, int(len(audio) * 16000 / SR)), np.arange(len(audio)), audio), np.zeros(12000)]).astype(np.float32)
            st = rec.create_stream(); st.accept_waveform(16000, x16); rec.decode_stream(st)
            toks, ts = st.result.tokens, st.result.timestamps
            asr_words = []
            for tok, tt in zip(toks, ts):
                if tok.startswith((" ", "▁")) or not asr_words:
                    asr_words.append([tok.strip().lstrip("▁"), tt])
                else:
                    asr_words[-1][0] += tok
            disp = line.split()
            dn = [norm(say_text(w)) for w in disp]
            an = [norm(w) for w, _ in asr_words]
            starts = [None] * len(disp)
            sm = difflib.SequenceMatcher(a=dn, b=an, autojunk=False)
            for blk in sm.get_matching_blocks():
                for k in range(blk.size):
                    starts[blk.a + k] = asr_words[blk.b + k][1]
            # мягкое сопоставление для несовпавших слов с одинаковым числом в блоке замены
            for op, i1, i2, j1, j2 in sm.get_opcodes():
                if op == "replace" and i2 - i1 == j2 - j1:
                    for k in range(i2 - i1):
                        starts[i1 + k] = asr_words[j1 + k][1]
            # интерполяция оставшихся по количеству символов
            known = [(-1, 0.0)] + [(k, s) for k, s in enumerate(starts) if s is not None] + [(len(disp), dur)]
            for (ka, sa), (kb, sb) in zip(known, known[1:]):
                if kb - ka > 1:
                    lens = [len(disp[k]) + 1 for k in range(ka + 1, kb)]
                    base = sa if ka >= 0 else 0.0
                    span = (sb - base); tot = sum(lens) + (len(disp[ka]) + 1 if ka >= 0 else 0)
                    acc = (len(disp[ka]) + 1) if ka >= 0 else 0
                    for n, k in enumerate(range(ka + 1, kb)):
                        starts[k] = base + span * acc / max(tot, 1); acc += lens[n]
            starts = [max(0.0, min(s, dur)) for s in starts]
            for k, w in enumerate(disp):
                end = starts[k + 1] if k + 1 < len(disp) else dur
                words_all.append({"w": w, "start": round(t + starts[k], 3), "end": round(t + end, 3), "scene": sc["id"]})
            ratio = difflib.SequenceMatcher(a=" ".join(dn), b=" ".join(an)).ratio()
            report.append({"line": line, "asr": " ".join(an), "similarity": round(ratio, 3), "dur": round(dur, 2)})
            lines_all.append({"scene": sc["id"], "text": line, "start": round(t, 3), "end": round(t + dur, 3)})
            pieces.append(audio); t += dur
            pause = S.get("line_gap", 0.28) if i < len(sc["lines"]) - 1 else sc.get("gap", 0.4)
            pieces.append(np.zeros(int(pause * SR), np.float32)); t += pause
        scenes.append({"id": sc["id"], "start": round(s0, 3), "voiceEnd": round(t - sc.get("gap", 0.4), 3), "end": round(t, 3), **({"title": sc["title"]} if "title" in sc else {})})
    tail = S.get("tail", 1.5)
    pieces.append(np.zeros(int(tail * SR), np.float32)); t += tail
    scenes[-1]["end"] = round(t, 3)
    wav = np.concatenate(pieces)
    sf.write(out_wav, wav, SR, subtype="PCM_16")
    json.dump({"duration": round(t, 3), "scenes": scenes, "lines": lines_all, "words": words_all}, open(out_json, "w"), ensure_ascii=False, indent=1)
    json.dump(report, open(out_json.replace(".json", "_asr.json"), "w"), ensure_ascii=False, indent=1)
    worst = sorted(report, key=lambda r: r["similarity"])[:6]
    print("duration", round(t, 2))
    for r in worst: print(r["similarity"], "|", r["line"], "|", r["asr"])

if __name__ == "__main__":
    main(*sys.argv[1:4], length_scale=float(sys.argv[4]) if len(sys.argv) > 4 else 1.0)
