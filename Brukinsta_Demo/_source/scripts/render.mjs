// usage: node scripts/render.mjs <compId> video <out.mp4> [--range a-b]
//        node scripts/render.mjs <compId> stills <outDir> <frame,frame,...>
//        node scripts/render.mjs <compId> still <out.png>
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';

const BROWSER = '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const [id, mode, out, extra] = process.argv.slice(2);
const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts'), publicDir: path.resolve('public')});
const opts = {serveUrl, browserExecutable: BROWSER, chromiumOptions: {gl: process.env.GL || 'angle'}};
const composition = await selectComposition({...opts, id});
if (mode === 'video') {
  let frameRange;
  if (extra?.startsWith('--range=')) frameRange = extra.slice(8).split('-').map(Number);
  let last = 0;
  await renderMedia({...opts, composition, codec: 'h264', outputLocation: out, crf: 18, pixelFormat: 'yuv420p', muted: true, concurrency: 4, frameRange,
    onProgress: ({progress}) => { if (progress - last > 0.1) { last = progress; console.log(`${Math.round(progress * 100)}%`); } }});
} else if (mode === 'stills') {
  fs.mkdirSync(out, {recursive: true});
  for (const f of extra.split(',').map(Number)) {
    await renderStill({...opts, composition, frame: f, output: `${out}/${id}_${String(f).padStart(5, '0')}.png`});
  }
} else {
  await renderStill({...opts, composition, frame: 0, output: out});
}
console.log('done', out);
