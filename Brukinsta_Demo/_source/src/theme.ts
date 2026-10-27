import {continueRender, delayRender, staticFile} from 'remotion';

export const C = {
  bg: '#11100C',
  surface: '#1B1A15',
  surface2: '#26241D',
  line: '#3A372D',
  text: '#F4F0E6',
  muted: '#9C968A',
  accent: '#D7FF3A',
  danger: '#FF5B37',
  info: '#7CB8FF',
};

export const F = {
  display: '"Unbounded", sans-serif',
  body: '"Manrope", sans-serif',
  mono: '"JetBrains Mono", monospace',
};

const CYR = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const LAT = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2190-2199, U+2212, U+2215, U+2713, U+2714';
const files: [string, string, number][] = [
  ['Unbounded', 'unbounded', 800], ['Unbounded', 'unbounded', 900],
  ['Manrope', 'manrope', 500], ['Manrope', 'manrope', 600], ['Manrope', 'manrope', 700], ['Manrope', 'manrope', 800],
  ['JetBrains Mono', 'jetbrains-mono', 500], ['JetBrains Mono', 'jetbrains-mono', 700],
];

let loaded = false;
export const loadFonts = () => {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  const h = delayRender('fonts');
  const faces = files.flatMap(([family, file, w]) => [
    new FontFace(family, `url(${staticFile(`fonts/${file}-cyrillic-${w}-normal.woff2`)}) format('woff2')`, {weight: String(w), unicodeRange: CYR}),
    new FontFace(family, `url(${staticFile(`fonts/${file}-latin-${w}-normal.woff2`)}) format('woff2')`, {weight: String(w), unicodeRange: LAT}),
  ]);
  Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))))
    .then(() => continueRender(h))
    .catch((e) => { console.error(e); continueRender(h); });
};
