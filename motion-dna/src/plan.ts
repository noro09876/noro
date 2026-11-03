// Types of the motion plan produced by pipeline/compile_plan.py.
export type Bezier = [number, number, number, number];
export type Track = { prop: string; keys: [number, number][]; ease: Bezier | 'hold' };
export type Fx = { technique: string; start: number; dur: number; tracks: Track[] };
export type Unit = 'char' | 'word' | 'line' | 'block' | 'layer';

export type Anim = {
  technique: string;
  dur: number;
  hit: number;
  unit: Unit;
  start?: number;
  tracks?: Track[];
  mask?: boolean;
  draw?: string;
  origin?: string;
  text_delay?: number;
  params: Record<string, number>;
  stagger?: { frames: number | string; order: string } | null;
  word?: number;
  value?: number;
  decimals?: number;
};

export type TextLayer = {
  id: string;
  role: string;
  from: number;
  to: number;
  lines: number;
  words: { text: string; line: number; word: number; at: number }[];
  box: { x: number; y: number; w: number; align: 'left' | 'center' | 'right' };
  rotate: number;
  enter: Anim;
  exit: Anim | null;
  plate: Anim | null;
  emphasis: Anim[];
  type: {
    family: string;
    weight: number;
    size_px: number;
    tracking?: number;
    leading?: number;
    align?: string;
    color: string;
  };
};

export type Plan = {
  style: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  audio: string;
  palette: Record<string, string>;
  finish: { grain?: number; vignette?: number; dim_footage?: number; footage_blur?: number };
  textShadow: { blur?: number; opacity?: number };
  clips: { id: string; src: string; scroll: [number, number]; from: number; to: number; fx: Fx[] }[];
  texts: TextLayer[];
  overlays: (Fx & { color: string })[];
};
