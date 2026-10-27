import React, {useMemo} from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, F} from '../theme';

export type Word = {w: string; start: number; end: number; scene: string};
type Chunk = {words: Word[]; start: number; end: number};

/** Группировка слов в субтитры: ≤ maxWords слов и ≤ maxChars символов, разрыв после знаков препинания. */
export const chunkWords = (words: Word[], maxWords = 3, maxChars = 20): Chunk[] => {
  const out: Chunk[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({words: cur, start: cur[0].start, end: cur[cur.length - 1].end});
    cur = [];
  };
  words.forEach((w, i) => {
    if (w.w === '—' || w.w === '–') return;
    const len = cur.map((x) => x.w).join(' ').length + w.w.length + 1;
    if (cur.length >= maxWords || (cur.length && len > maxChars)) flush();
    cur.push(w);
    const next = words[i + 1];
    if (/[.,!?:;]$/.test(w.w) || !next || next.start - w.end > 0.25) flush();
  });
  // каждый чанк держится до начала следующего (без мигания), но не дольше +0.5 с
  return out.map((c, i) => ({...c, end: Math.min(out[i + 1]?.start ?? c.end + 0.5, c.end + 0.5)}));
};

export const Captions: React.FC<{words: Word[]; y: number; size?: number; maxWords?: number; maxChars?: number; width?: number}> = ({words, y, size = 60, maxWords = 3, maxChars = 20, width = 960}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const chunks = useMemo(() => chunkWords(words, maxWords, maxChars), [words, maxWords, maxChars]);
  const c = chunks.find((x) => t >= x.start - 0.05 && t < x.end);
  if (!c) return null;
  const s = spring({frame: frame - Math.round((c.start - 0.05) * fps), fps, config: {damping: 14, stiffness: 220, mass: 0.6}});
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: y, display: 'flex', justifyContent: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          maxWidth: width, textAlign: 'center', fontFamily: F.body, fontWeight: 800, fontSize: size, lineHeight: 1.15, color: C.text,
          transform: `translateY(${(1 - s) * 18}px) scale(${0.92 + s * 0.08})`, opacity: Math.min(1, s * 1.5),
          textShadow: '0 4px 24px #000000E0, 0 0 2px #000',
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: size * 0.26,
        }}
      >
        {c.words.map((w, i) => {
          const active = t >= w.start - 0.03;
          return (
            <span key={i} style={{color: active ? C.text : `${C.text}66`, position: 'relative'}}>
              {w.w.replace(/[—–]/g, '')}
              {t >= w.start - 0.03 && t < w.end && (
                <span style={{position: 'absolute', left: -6, right: -6, bottom: size * 0.02, height: size * 0.16, background: C.accent, borderRadius: 4, zIndex: -1, opacity: 0.9}} />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
};
