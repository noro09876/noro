/**
 * Subtitle timing. Voiceover is synthesized per scene, so each scene's start and
 * duration are exact. Inside a scene, words are distributed proportionally to their
 * length (plus pauses after punctuation) — an approximation that stays within a
 * fraction of a second for TTS speech. Providers that return word timestamps can
 * replace `words` with real values without changing consumers.
 */

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
  words: CaptionWord[];
}

export interface TimedSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

const PAUSE_WEIGHT = 3; // extra "characters" after , . ! ? : —

export function timeWords(seg: TimedSegment, leadMs = 80, tailMs = 180): CaptionWord[] {
  const words = seg.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1 + (/[,.!?:;—]$/.test(w) ? PAUSE_WEIGHT : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(200, seg.durationMs - leadMs - tailMs);
  let t = seg.startMs + leadMs;
  return words.map((w, i) => {
    const d = (weights[i]! / total) * span;
    const out = { text: w, startMs: Math.round(t), endMs: Math.round(t + d) };
    t += d;
    return out;
  });
}

/** Groups words into readable cues: at most `maxChars` characters, break after sentence ends. */
export function buildCues(segments: TimedSegment[], maxChars = 32): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const seg of segments) {
    let cur: CaptionWord[] = [];
    const flush = () => {
      if (!cur.length) return;
      cues.push({ startMs: cur[0]!.startMs, endMs: cur[cur.length - 1]!.endMs, text: cur.map((w) => w.text).join(' '), words: cur });
      cur = [];
    };
    for (const w of timeWords(seg)) {
      const len = cur.map((x) => x.text).join(' ').length;
      if (cur.length && len + 1 + w.text.length > maxChars) flush();
      cur.push(w);
      if (/[.!?]$/.test(w.text)) flush();
    }
    flush();
  }
  return cues;
}

const pad = (n: number, l = 2) => String(n).padStart(l, '0');
function stamp(ms: number, sep: ',' | '.') {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: CaptionCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.startMs, ',')} --> ${stamp(c.endMs, ',')}\n${c.text}\n`).join('\n');
}

export function toVtt(cues: CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.startMs, '.')} --> ${stamp(c.endMs, '.')}\n${c.text}\n`).join('\n')}`;
}
