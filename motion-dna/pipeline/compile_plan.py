"""Motion DNA compiler: style + timeline + rhythm grid -> motion plan.

    python3 -I pipeline/compile_plan.py styles/editorial_mask.json data/demo-timeline.json \
        data/beats.json library/techniques.json src/plans/editorial_mask.json

The plan is a flat list of layers with absolute frames and resolved keyframe
tracks; any renderer (Remotion, Skia, AE scripting, ffmpeg+Pillow) only has to
interpolate tracks. Every decision is logged with its reason in plan["log"].
Deterministic: the same inputs and humanize.seed give the same plan.
Standard library only.
"""
import json
import math
import random
import sys


class StyleError(Exception):
    pass


class Compiler:
    def __init__(self, style, timeline, beats, library):
        self.s = style
        self.tl = timeline
        self.bt = beats
        self.lib = {t["id"]: t for t in library["techniques"]}
        self.easings = library["easings"]
        self.fps = timeline["fps"]
        self.W, self.H = timeline["width"], timeline["height"]
        self.total = round(timeline["duration"] * self.fps)
        self.hz = style["humanize"]
        self.rng = random.Random(self.hz["seed"])
        self.log = []
        self.bans = set(style.get("bans", []))
        self.validate()

    # ---------- helpers ----------
    def f(self, t):
        return int(round(t * self.fps))

    def note(self, at, what, why):
        self.log.append({"frame": at, "time": round(at / self.fps, 3), "what": what, "why": why})

    def jitter(self):
        lo, hi = self.hz.get("timing_jitter_frames", [0, 0])
        return self.rng.randint(lo, hi)

    def dur(self, tech, shot=None):
        d = tech["dur"]
        if d == "shot":
            return shot
        return max(1, int(round(d * self.fps / 30)))

    def grid(self, kind):
        beats = self.bt["beats"]
        if kind == "downbeat":
            return list(self.bt["downbeats"])
        if kind == "beat":
            return list(beats)
        if kind == "half_beat":
            out = []
            for a, b in zip(beats, beats[1:]):
                out += [a, (a + b) / 2]
            return out + beats[-1:]
        return []

    # ---------- validation ----------
    def iter_picks(self):
        s = self.s
        yield "text_enter", s["text"]["enter"]
        yield "text_exit", s["text"].get("exit", [])
        yield "plate", s["text"].get("plate", [])
        for role, o in s["text"].get("by_role", {}).items():
            yield "text_enter", o.get("enter", [])
            yield "text_exit", o.get("exit", [])
            yield "plate", o.get("plate", [])
        em = s.get("emphasis", {})
        yield "emphasis", em.get("keyword", []) + em.get("number", [])
        tr = s["transitions"]
        yield "transition", tr["default"] + tr.get("on_drop", []) + tr.get("on_section", [])
        cam = s.get("camera", {})
        yield "camera", [p for p in [cam.get("base"), (cam.get("on_onset_low") or {}).get("pick"), cam.get("on_hit")] if p]
        ov = s.get("overlays", {})
        yield "overlay", [ov["on_drop"]] if "on_drop" in ov else []

    def validate(self):
        allow_high = set(self.s.get("allow_high_tell", []))
        for cat, picks in self.iter_picks():
            for p in picks:
                t = self.lib.get(p["technique"])
                if not t:
                    raise StyleError(f"unknown technique {p['technique']}")
                if t["category"] != cat:
                    raise StyleError(f"{t['id']} is {t['category']}, used as {cat}")
                if t["id"] in self.bans:
                    raise StyleError(f"{t['id']} is used but banned by the style")
                if t.get("ai_tell") == "high" and t["id"] not in allow_high:
                    raise StyleError(f"{t['id']} has ai_tell=high; add it to allow_high_tell to use it")
                for k, v in p.get("params", {}).items():
                    spec = t["params"].get(k)
                    if spec is None:
                        raise StyleError(f"{t['id']}: unknown param {k}")
                    if not spec["min"] <= v <= spec["max"]:
                        raise StyleError(f"{t['id']}.{k}={v} outside [{spec['min']}, {spec['max']}]")
        for role in {p["role"] for p in self.tl["phrases"]}:
            if role not in self.s["typography"]["roles"]:
                raise StyleError(f"timeline role {role} has no typography in the style")

    # ---------- technique resolution ----------
    def choose(self, picks, avoid=()):
        pool = [p for p in picks if p["technique"] not in avoid] or picks
        total = sum(p.get("weight", 1) for p in pool)
        r = self.rng.uniform(0, total)
        for p in pool:
            r -= p.get("weight", 1)
            if r <= 0:
                return p
        return pool[-1]

    def resolve(self, pick, shot=None):
        """Technique + style params + humanize jitter -> concrete tracks."""
        t = self.lib[pick["technique"]]
        pj = self.hz.get("param_jitter", 0)
        params = {}
        for k, spec in t["params"].items():
            v = pick.get("params", {}).get(k, spec["default"])
            if pj:
                v *= 1 + self.rng.uniform(-pj, pj)
            params[k] = round(min(spec["max"], max(spec["min"], v)), 4)

        def val(v):
            if isinstance(v, str):
                neg = v.startswith("-")
                x = params[v.lstrip("-$")]
                return -x if neg else x
            return v

        def tracks(src):
            out = []
            for tr in src:
                ease = tr.get("ease", "linear")
                out.append({"prop": tr["prop"], "keys": [[k[0], val(k[1])] for k in tr["keys"]],
                            "ease": "hold" if ease == "step" else self.easings[ease]})
            return out

        d = self.dur(t, shot)
        res = {"technique": t["id"], "dur": d, "hit": t.get("hit", 0), "params": params}
        for key in ("tracks", "a", "b"):
            if key in t:
                res[key] = tracks(t[key])
        for key in ("mask", "draw", "origin", "text_delay"):
            if key in t:
                res[key] = t[key]
        if "text_delay" in res:
            res["text_delay"] = int(round(res["text_delay"] * self.fps / 30))
        res["unit"] = pick.get("unit", t["unit"])
        res["stagger"] = t.get("stagger")
        return res

    # ---------- clips, transitions, camera ----------
    def plan_clips(self, phrases_by_id):
        r = self.s["rhythm"]
        grid = self.grid(r["cut_on"]) if r["cut_on"] != "phrase" else []
        lead = r.get("cut_lead_frames", 0)
        min_shot = self.f(r.get("min_shot_sec", 1.0))
        drops = [e["t"] for e in self.bt["events"] if e["type"] == "drop"]
        clips, cuts = [], [0]
        for i, c in enumerate(self.tl["clips"]):
            if i == 0:
                continue
            first = phrases_by_id[c["phrases"][0]]["words"][0][1]
            target = self.f(first) - lead
            # nearest grid point not later than the phrase start (+2 frames tolerance)
            cands = [self.f(g) for g in grid if self.f(g) <= self.f(first) + 2 and self.f(g) - cuts[-1] >= min_shot]
            best = min(cands, key=lambda g: abs(g - target), default=None)
            if best is not None and abs(best - target) <= self.fps * 0.75:
                cut = best
                self.note(cut, f"cut {c['id']}", f"{r['cut_on']} grid, {cut - target:+d} f from phrase start-lead")
            else:
                cut = max(target, cuts[-1] + min_shot)
                self.note(cut, f"cut {c['id']}", "no grid point within 0.75 s: cut by speech")
            cuts.append(cut)
        cuts.append(self.total)

        tr = self.s["transitions"]
        last_fancy = None
        is_end = [phrases_by_id[c["phrases"][0]]["role"] == "end" for c in self.tl["clips"]]
        for i, c in enumerate(self.tl["clips"]):
            clip = {"id": c["id"], "src": c["src"], "scroll": c["scroll"], "from": cuts[i], "to": cuts[i + 1], "fx": []}
            clips.append(clip)
            if i == 0:
                continue
            cut = cuts[i]
            near_drop = any(abs(self.f(d) - cut) <= 4 for d in drops)
            if near_drop and tr.get("on_drop"):
                pick, why = self.choose(tr["on_drop"]), "cut lands on the drop"
            elif is_end[i] and tr.get("on_section"):
                pick, why = self.choose(tr["on_section"]), "section change (end card)"
            else:
                avoid = {last_fancy} if tr.get("no_repeat") and last_fancy else set()
                pick, why = self.choose(tr["default"], avoid), "weighted pick" + (f", avoiding repeat of {last_fancy}" if avoid else "")
            res = self.resolve(pick)
            start = cut - int(round(res["hit"] * res["dur"]))
            res["start"] = start
            if res["technique"] != "hard_cut":
                last_fancy = res["technique"]
            # incoming clip starts with the transition, outgoing one lasts until it ends
            clip["from"] = min(clip["from"], start)
            clips[i - 1]["to"] = max(clips[i - 1]["to"], start + res["dur"])
            clips[i - 1]["fx"].append({**{k: res[k] for k in ("technique", "start", "dur")}, "tracks": res.get("a", [])})
            clip["fx"].append({**{k: res[k] for k in ("technique", "start", "dur")}, "tracks": res.get("b", [])})
            self.note(start, f"transition {res['technique']} into {c['id']}", why)
        return clips, cuts

    def plan_camera(self, clips, cuts):
        cam = self.s.get("camera", {})
        if cam.get("base"):
            for c in clips:
                res = self.resolve(cam["base"], shot=c["to"] - c["from"])
                c["fx"].append({"technique": res["technique"], "start": c["from"], "dur": res["dur"], "tracks": res["tracks"]})
        drop = min([e["t"] for e in self.bt["events"] if e["type"] == "drop"], default=0)
        ol = cam.get("on_onset_low")
        if ol:
            per_bar = {}
            dbs = self.bt["downbeats"]
            for o in self.bt["onsets"]:
                if o["band"] != "low" or o["strength"] < ol.get("min_strength", 0):
                    continue
                if ol.get("after_drop_only") and o["t"] < drop - 0.05:
                    continue
                fr = self.f(o["t"])
                if any(abs(fr - c) < 5 for c in cuts):
                    continue  # the cut is already the accent
                bar = sum(1 for d in dbs if d <= o["t"] + 0.02)
                if per_bar.get(bar, 0) >= ol.get("max_per_bar", 1):
                    continue
                if self.rng.random() < ol.get("skip_probability", 0):
                    self.note(fr, "skip punch_in", "humanize: skipped on purpose so the pulse is not mechanical")
                    continue
                per_bar[bar] = per_bar.get(bar, 0) + 1
                res = self.resolve(ol["pick"])
                clip = next(c for c in clips if c["from"] <= fr < c["to"])
                clip["fx"].append({"technique": res["technique"], "start": fr, "dur": res["dur"], "tracks": res["tracks"]})
                self.note(fr, f"punch_in on {clip['id']}", f"low onset, strength {o['strength']}")
        if cam.get("on_hit"):
            for e in self.bt["events"]:
                if e["type"] != "hit":
                    continue
                fr = self.f(e["t"])
                clip = next((c for c in clips if c["from"] <= fr < c["to"]), None)
                if clip:
                    res = self.resolve(cam["on_hit"])
                    clip["fx"].append({"technique": res["technique"], "start": fr, "dur": res["dur"], "tracks": res["tracks"]})
                    self.note(fr, "micro_shake", "strong hit in the track")

    def plan_overlays(self):
        ov = self.s.get("overlays", {}).get("on_drop")
        out = []
        if not ov:
            return out
        for e in self.bt["events"]:
            if e["type"] != "drop":
                continue
            res = self.resolve(ov)
            fr = self.f(e["t"]) - int(round(res["hit"] * res["dur"]))
            out.append({"technique": res["technique"], "start": fr, "dur": res["dur"], "tracks": res["tracks"],
                        "color": self.s["palette"].get(ov.get("color", "flash"), "#FFFFFF")})
            self.note(fr, "flash_frame", f"drop at {e['t']} s")
        return out

    # ---------- text ----------
    @staticmethod
    def case(text, mode, first):
        if mode == "upper":
            return text.upper()
        if mode == "lower":
            return text.lower()
        if mode == "sentence" and first:
            return text[:1].upper() + text[1:]
        return text

    @staticmethod
    def break_lines(words, max_chars, forced=()):
        """Greedy by characters; short words (<=2 chars, e.g. Russian prepositions) never end a line.
        forced: word indexes that must start a new line (from the timeline, e.g. a brand name)."""
        if forced:
            out, prev = [], 0
            for b in list(forced) + [len(words)]:
                out += Compiler.break_lines(words[prev:b], max_chars)
                prev = b
            return out
        lines, cur = [], []
        for i, w in enumerate(words):
            length = sum(len(x) for x in cur) + len(cur) + len(w)
            if w in ("—", "–", "-") and cur:
                cur.append(w)  # a dash never starts a line
                continue
            if cur and length > max_chars:
                carry = []
                while len(cur) > 1 and len(cur[-1]) <= 2 and cur[-1] not in ("—", "–", "-"):
                    carry.insert(0, cur.pop())
                lines.append(cur)
                cur = carry
            cur.append(w)
        if cur:
            lines.append(cur)
        return lines

    def snap(self, t):
        sn = self.s["rhythm"].get("text_snap", {"to": "none"})
        g = self.grid(sn.get("to", "none"))
        if not g:
            return t, None
        nearest = min(g, key=lambda b: abs(b - t))
        if abs(nearest - t) * 1000 <= sn.get("window_ms", 0):
            return nearest, nearest
        return t, None

    def plan_texts(self, cuts, shot_starts):
        """cuts: nominal cut frames; shot_starts: frames where the next shot (or its transition) begins."""
        s, r = self.s, self.s["rhythm"]
        phrases = self.tl["phrases"]
        texts, last_pos, streak = [], None, []
        beats = self.bt["beats"]
        period = 60 / self.bt["bpm"]
        em = s.get("emphasis", {})
        budget = em.get("budget_per_10s", 99)
        used_at = []  # frames of placed accents, budget is per sliding 10 s window
        for pi, ph in enumerate(phrases):
            role = ph["role"]
            ty = s["typography"]["roles"][role]
            words = [self.case(w[0], ty.get("case", "as_is"), i == 0) for i, w in enumerate(ph["words"])]
            lines_txt = self.break_lines(words, ty.get("max_chars_per_line", 18), ph.get("breaks", ()))
            t0 = ph["words"][0][1]
            st, snapped = self.snap(t0)
            start = self.f(st) + self.jitter()
            prev_cut = max(c for c in cuts if c <= self.f(t0) + 2)
            start = max(start, prev_cut + 1)
            self.note(start, f"text {ph['id']} in", f"snapped to beat {snapped:.3f}s" if snapped is not None else "kept on speech (no beat within window)")

            by_role = s["text"].get("by_role", {}).get(role, {})
            enter_picks = by_role.get("enter", s["text"]["enter"])
            avoid = set()
            mx = self.hz.get("max_same_enter_streak", 99)
            if len(streak) >= mx and len(set(streak[-mx:])) == 1:
                avoid = {streak[-1]}
            enter = self.resolve(self.choose(enter_picks, avoid))
            streak.append(enter["technique"])

            # per-word anchor frames (relative to start)
            word_rel = []
            for i, w in enumerate(ph["words"]):
                mode = r.get("word_stagger", "speech")
                if mode == "speech":
                    rel = self.f(w[1]) - self.f(t0)
                elif mode == "beat_subdivision":
                    step = period / r.get("subdivision", 2)
                    q = round((w[1] - st) / step)
                    rel = self.f(st + q * step) - self.f(st)
                else:
                    rel = i * (enter.get("stagger") or {}).get("frames", 2)
                if word_rel and rel <= word_rel[-1]:
                    # two words in one slot: beat mode pushes to the next subdivision
                    bump = self.f(period / r.get("subdivision", 2)) if mode == "beat_subdivision" else 1
                    rel = word_rel[-1] + bump
                word_rel.append(max(0, rel))
            if enter["unit"] in ("block",):
                word_rel = [0] * len(words)

            # exit
            nxt = phrases[pi + 1]["words"][0][1] if pi + 1 < len(phrases) else None
            last_word_end = self.f(ph["words"][-1][2]) + r.get("hold_after_last_word_frames", 8)
            if nxt is None:
                end = self.total
            else:
                nxt_f = self.f(self.snap(nxt)[0])
                next_cut = min([c for c in shot_starts if c > start + 2] + [self.total])
                end = min(nxt_f, next_cut)
                if r.get("exit_on") == "beat_before_next":
                    bb = [self.f(b) for b in beats if last_word_end <= self.f(b) <= end]
                    end = bb[-1] if bb else end
                # hold the last word, but never across the next phrase or the next cut
                end = max(end, min(last_word_end, nxt_f, next_cut))
            exit_ = None
            ex_picks = by_role.get("exit", s["text"].get("exit"))
            if ex_picks and nxt is not None:
                exit_ = self.resolve(self.choose(ex_picks))
                exit_["start"] = end - exit_["dur"]

            # layout
            positions = [p for p in s["layout"]["positions"] if role in p.get("roles", [role])]
            if s["layout"].get("no_repeat_position") and last_pos and len(positions) > 1:
                positions = [p for p in positions if p["id"] != last_pos] or positions
            pos = self.choose([{"technique": p["id"], "weight": p.get("weight", 1)} for p in positions])
            pos = next(p for p in s["layout"]["positions"] if p["id"] == pos["technique"])
            last_pos = pos["id"]
            pj = self.hz.get("position_jitter", 0)
            box = {"x": round(pos["x"] + self.rng.uniform(-pj, pj), 4), "y": round(pos["y"] + self.rng.uniform(-pj, pj), 4),
                   "w": s["layout"].get("box_width", 0.8), "align": ty.get("align", "left")}
            rot = self.hz.get("rotation_jitter_deg", 0)

            # plate
            plate = None
            pl_picks = by_role.get("plate") or (s["text"].get("plate") if role in s["text"].get("plate_roles", []) else None)
            if pl_picks:
                plate = self.resolve(self.choose(pl_picks))
                plate["start"] = start - int(round(plate["hit"] * plate["dur"]))

            # emphasis
            emph = []
            for m in ph.get("marks", []):
                if sum(1 for u in used_at if start - u < 10 * self.fps) >= budget:
                    self.note(start, f"skip emphasis {ph['id']}#{m['word']}", f"budget {budget} per 10 s reached")
                    continue
                picks = em.get("keyword" if m["type"] == "keyword" else "number")
                if not picks:
                    continue
                res = self.resolve(self.choose(picks))
                w_in = start + word_rel[m["word"]]
                lo, hi = em.get("delay_frames", [0, 0])
                anchor = w_in + self.rng.randint(lo, hi)
                if self.lib[res["technique"]]["audio"]["anchor"] == "beat":
                    after = [self.f(b) for b in beats if self.f(b) >= w_in + int(res["hit"] * res["dur"])]
                    # land on the next beat, unless that beat is too late to be seen
                    if after and after[0] - w_in <= self.fps * 0.7 and after[0] < end - 8:
                        anchor = after[0]
                res["start"] = max(w_in, anchor - int(round(res["hit"] * res["dur"])))
                res["word"] = m["word"]
                if m["type"] == "number":
                    res["value"] = m["value"]
                    res["decimals"] = m.get("decimals", 0)
                emph.append(res)
                used_at.append(res["start"])
                self.note(res["start"], f"{res['technique']} on '{words[m['word']]}'", f"{m['type']} mark")

            # flatten line/word structure with indexes
            units, wi = [], 0
            for li, ln in enumerate(lines_txt):
                for w in ln:
                    units.append({"text": w, "line": li, "word": wi, "at": word_rel[wi]})
                    wi += 1
            texts.append({
                "id": ph["id"], "role": role, "from": start - int(round(enter["hit"] * enter["dur"])), "to": end,
                "lines": len(lines_txt), "words": units, "box": box, "rotate": round(self.rng.uniform(-rot, rot), 2),
                "enter": enter, "exit": exit_, "plate": plate, "emphasis": emph,
                "type": {**ty, "size_px": round(ty["size"] * self.H, 1),
                         "color": s["palette"][ty.get("color", "ink")]},
            })
        return texts

    def compile(self):
        by_id = {p["id"]: p for p in self.tl["phrases"]}
        clips, cuts = self.plan_clips(by_id)
        self.plan_camera(clips, cuts)
        overlays = self.plan_overlays()
        texts = self.plan_texts(cuts, [c["from"] for c in clips[1:]])
        self.log.sort(key=lambda e: e["frame"])
        return {
            "style": self.s["id"], "fps": self.fps, "width": self.W, "height": self.H,
            "durationInFrames": self.total, "audio": self.tl["audio"],
            "palette": self.s["palette"], "finish": self.s.get("finish", {}),
            "textShadow": self.s["typography"].get("shadow", {}),
            "clips": clips, "texts": texts, "overlays": overlays,
            "rhythm": {"bpm": self.bt["bpm"], "beats": [self.f(b) for b in self.bt["beats"]]},
            "log": self.log,
        }


def main(style_p, tl_p, beats_p, lib_p, out_p):
    load = lambda p: json.load(open(p, encoding="utf-8"))
    plan = Compiler(load(style_p), load(tl_p), load(beats_p), load(lib_p)).compile()
    with open(out_p, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)
    n_fx = sum(len(c["fx"]) for c in plan["clips"])
    print(f"{plan['style']}: {len(plan['clips'])} clips, {len(plan['texts'])} texts, {n_fx} clip fx, "
          f"{sum(len(t['emphasis']) for t in plan['texts'])} emphasis, {len(plan['overlays'])} overlays, {len(plan['log'])} log entries")


if __name__ == "__main__":
    try:
        main(*sys.argv[1:6])
    except StyleError as e:
        sys.exit(f"style error: {e}")
