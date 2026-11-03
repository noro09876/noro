"""Compiler checks: python3 -I -m unittest discover -s pipeline -p 'test_*.py' (run from motion-dna/)."""
import copy
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from compile_plan import Compiler, StyleError  # noqa: E402


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


LIB = load("library/techniques.json")
TL = load("data/demo-timeline.json")
BEATS = load("data/beats.json")
STYLES = {n: load(f"styles/{n}.json") for n in ("editorial_mask", "punch_poster")}


def compile_(style):
    return Compiler(style, TL, BEATS, LIB).compile()


class CompileTest(unittest.TestCase):
    def test_deterministic(self):
        for s in STYLES.values():
            self.assertEqual(json.dumps(compile_(s)), json.dumps(compile_(s)))

    def test_seed_changes_result_but_not_structure(self):
        s = copy.deepcopy(STYLES["punch_poster"])
        a = compile_(s)
        s["humanize"]["seed"] += 1
        b = compile_(s)
        self.assertNotEqual(json.dumps(a), json.dumps(b))
        self.assertEqual(len(a["texts"]), len(b["texts"]))

    def test_banned_technique_rejected(self):
        s = copy.deepcopy(STYLES["editorial_mask"])
        s["text"]["enter"].append({"technique": "slam_word"})
        with self.assertRaisesRegex(StyleError, "banned"):
            Compiler(s, TL, BEATS, LIB)

    def test_high_ai_tell_needs_explicit_allow(self):
        s = copy.deepcopy(STYLES["punch_poster"])
        s["bans"].remove("blur_resolve_line")
        s["text"]["enter"].append({"technique": "blur_resolve_line"})
        with self.assertRaisesRegex(StyleError, "ai_tell=high"):
            Compiler(s, TL, BEATS, LIB)
        s["allow_high_tell"] = ["blur_resolve_line"]
        Compiler(s, TL, BEATS, LIB)

    def test_param_out_of_range_rejected(self):
        s = copy.deepcopy(STYLES["punch_poster"])
        s["text"]["enter"][0]["params"]["from_scale"] = 3
        with self.assertRaisesRegex(StyleError, "outside"):
            Compiler(s, TL, BEATS, LIB)

    def test_cuts_on_grid_and_no_repeated_fancy_transition(self):
        for s in STYLES.values():
            plan = compile_(s)
            grid_kind = s["rhythm"]["cut_on"]
            grid = {round(t * 30) for t in (BEATS["downbeats"] if grid_kind == "downbeat" else BEATS["beats"])}
            fancy = []
            for c in plan["clips"][1:]:
                tr = c["fx"][0]
                self.assertIn(tr["start"] + round(LIB_HIT[tr["technique"]] * tr["dur"]), grid)
                if tr["technique"] != "hard_cut":
                    fancy.append(tr["technique"])
            on_drop = {"zoom_punch_cut"}
            for a, b in zip(fancy, fancy[1:]):
                if a == b:
                    self.assertIn(a, on_drop, "only drop-forced transitions may repeat")

    def test_text_never_over_wrong_shot(self):
        for s in STYLES.values():
            plan = compile_(s)
            cuts = [c["from"] for c in plan["clips"][1:]]
            for t in plan["texts"][:-1]:
                inside = [c for c in cuts if t["from"] + 6 < c < t["to"] - 1]
                self.assertEqual(inside, [], f"{s['id']} {t['id']} spans a cut")

    def test_dash_never_starts_a_line(self):
        lines = Compiler.break_lines("Выручка за 90 дней — 12,8 млн ₽".split(), 16)
        self.assertTrue(all(ln[0] != "—" for ln in lines), lines)

    def test_emphasis_budget_per_window(self):
        for s in STYLES.values():
            plan = compile_(s)
            starts = sorted(e["start"] for t in plan["texts"] for e in t["emphasis"])
            for a in starts:
                n = sum(1 for b in starts if a <= b < a + 300)
                self.assertLessEqual(n, s["emphasis"]["budget_per_10s"])

    def test_short_words_do_not_end_lines(self):
        lines = Compiler.break_lines("64 лида и 4 группы дублей".split(), 16)
        for ln in lines[:-1]:
            self.assertGreater(len(ln[-1]), 2, lines)


LIB_HIT = {t["id"]: t.get("hit", 0) for t in LIB["techniques"]}

if __name__ == "__main__":
    unittest.main()
