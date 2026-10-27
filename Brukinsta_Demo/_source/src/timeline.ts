import type {Word} from './components/Captions';

export type Timeline = {
  duration: number;
  scenes: {id: string; start: number; voiceEnd: number; end: number; title?: string}[];
  lines: {scene: string; text: string; start: number; end: number}[];
  words: Word[];
};

/** Доступ к таймингам одной сцены в её локальном времени. */
export const sceneTiming = (tl: Timeline, id: string, over = 0.15) => {
  const sc = tl.scenes.find((s) => s.id === id)!;
  // сцена (кроме первой) монтируется на `over` секунд раньше своего старта — сдвигаем локальное время
  const off = tl.scenes[0].id === id ? 0 : over;
  const L = tl.lines.filter((l) => l.scene === id).map((l) => l.start - sc.start + off);
  const Lend = tl.lines.filter((l) => l.scene === id).map((l) => l.end - sc.start + off);
  const words = tl.words.filter((w) => w.scene === id);
  /** время начала слова (по префиксу, n-е совпадение) */
  const W = (prefix: string, n = 0) => {
    const m = words.filter((w) => w.w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '').startsWith(prefix.toLowerCase()));
    const hit = m[n] ?? m[m.length - 1];
    return hit ? hit.start - sc.start + off : off;
  };
  return {sc, L, Lend, W, dur: sc.end - sc.start};
};
