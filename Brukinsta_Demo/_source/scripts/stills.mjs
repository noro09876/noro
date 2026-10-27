// usage: node scripts/stills.mjs outDir id1 id2 ...  (бандл один раз, затем PNG для каждой Still)
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import path from 'node:path';
const BROWSER = '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const [outDir, ...ids] = process.argv.slice(2);
const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts'), publicDir: path.resolve('public')});
const opts = {serveUrl, browserExecutable: BROWSER, chromiumOptions: {gl: 'angle'}};
for (const id of ids) {
  const [name, file] = id.split(':');
  const composition = await selectComposition({...opts, id: name});
  await renderStill({...opts, composition, frame: 0, output: `${outDir}/${file ?? name}.png`, imageFormat: 'png'});
  console.log('ok', name);
}
