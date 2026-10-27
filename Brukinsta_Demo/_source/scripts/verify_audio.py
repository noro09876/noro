"""Проверка итогового видео: распознаём речь в окнах реплик из таймлайна и сравниваем с текстом.
usage: verify_audio.py video.mp4 timeline.json"""
import json, sys, subprocess, difflib, re, numpy as np
import sherpa_onnx
A = "/tmp/claude-0/-home-claude-noro/91b20d94-e1c8-5e3d-9c07-3ea267313e0b/scratchpad/sherpa-onnx-zipformer-ru-2024-09-18"
rec = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=f"{A}/encoder.int8.onnx", decoder=f"{A}/decoder.onnx", joiner=f"{A}/joiner.int8.onnx", tokens=f"{A}/tokens.txt", num_threads=4)
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
x = np.frombuffer(raw, np.float32)
tl = json.load(open(sys.argv[2]))
norm = lambda s: re.sub(r"[^а-яa-z0-9 ]", "", s.lower().replace("ё", "е"))
sims = []
for l in tl["lines"]:
    a, b = int((l["start"] - 0.1) * 16000), int((l["end"] + 0.15) * 16000)
    st = rec.create_stream(); st.accept_waveform(16000, np.concatenate([x[max(0, a):b], np.zeros(8000, np.float32)])); rec.decode_stream(st)
    r = difflib.SequenceMatcher(a=norm(l["text"]), b=norm(st.result.text)).ratio(); sims.append(r)
    if r < 0.85: print(f"{r:.2f} | {l['text']} | {st.result.text}")
print(f"lines={len(sims)} mean_similarity={np.mean(sims):.3f} min={np.min(sims):.3f}; audio_len={len(x)/16000:.2f}s")
