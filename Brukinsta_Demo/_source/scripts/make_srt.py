"""SRT из таймлайна (та же логика группировки, что в Captions.tsx). usage: make_srt.py timeline.json out.srt [maxWords maxChars]"""
import json, re, sys
tl = json.load(open(sys.argv[1])); mw = int(sys.argv[3]) if len(sys.argv) > 3 else 3; mc = int(sys.argv[4]) if len(sys.argv) > 4 else 20
ws = [w for w in tl["words"] if w["w"] not in ("—", "–")]
chunks, cur = [], []
for i, w in enumerate(ws):
    if cur and (len(cur) >= mw or len(" ".join(x["w"] for x in cur)) + len(w["w"]) + 1 > mc):
        chunks.append(cur); cur = []
    cur.append(w); nxt = ws[i + 1] if i + 1 < len(ws) else None
    if re.search(r"[.,!?:;]$", w["w"]) or not nxt or nxt["start"] - w["end"] > 0.25:
        chunks.append(cur); cur = []
if cur: chunks.append(cur)
f = lambda t: f"{int(t//3600):02}:{int(t%3600//60):02}:{int(t%60):02},{int(round(t%1*1000)):03}"
with open(sys.argv[2], "w") as o:
    for i, c in enumerate(chunks):
        end = min(chunks[i + 1][0]["start"] if i + 1 < len(chunks) else c[-1]["end"] + 0.5, c[-1]["end"] + 0.5)
        o.write(f"{i+1}\n{f(c[0]['start'])} --> {f(end)}\n{' '.join(x['w'] for x in c)}\n\n")
print(len(chunks), "cues")
