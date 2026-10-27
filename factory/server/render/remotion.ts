import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition, ensureBrowser } from '@remotion/renderer';
import { config, ROOT } from '../config';
import { logger } from '../lib/logger';

/**
 * Programmatic rendering with Remotion. The video project (video/) is bundled once per
 * process; renders run in headless Chromium. Local media (voiceover) is exposed to the
 * renderer through a short-lived loopback file server, so nothing is copied into the bundle.
 */

let bundlePromise: Promise<string> | null = null;

export function getBundle(): Promise<string> {
  if (!bundlePromise) {
    const started = Date.now();
    bundlePromise = bundle({
      entryPoint: path.join(ROOT, 'video/index.ts'),
      outDir: path.join(config.dataDir, 'remotion-bundle'),
      onProgress: () => undefined,
    })
      .then((url) => {
        logger.info({ ms: Date.now() - started }, 'Remotion bundle ready');
        return url;
      })
      .catch((e) => {
        bundlePromise = null;
        throw e;
      });
  }
  return bundlePromise;
}

function browserExecutable(): string | undefined {
  if (config.chromium) return config.chromium;
  // Prefer a pre-installed headless shell (Playwright layout) when present.
  const roots = ['/opt/pw-browsers'];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const dir = fs.readdirSync(r).find((d) => d.startsWith('chromium_headless_shell'));
    if (dir) {
      const sub = fs.readdirSync(path.join(r, dir)).find((d) => d.startsWith('chrome-'));
      const bin = sub ? path.join(r, dir, sub, 'chrome-headless-shell') : '';
      if (bin && fs.existsSync(bin)) return bin;
    }
  }
  return undefined;
}

let browserReady: Promise<void> | null = null;
async function prepareBrowser() {
  if (browserExecutable()) return;
  if (!browserReady) browserReady = ensureBrowser().then(() => undefined);
  await browserReady;
}

const concurrency = Math.max(1, Math.min(8, os.cpus().length));

/** Serves files from `dir` on 127.0.0.1 for the duration of `fn`. */
export async function withAssetServer<T>(dir: string, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\/+/, '');
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const type = file.endsWith('.wav') ? 'audio/wav' : file.endsWith('.mp3') ? 'audio/mpeg' : file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
    const stat = fs.statSync(file);
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : stat.size - 1;
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'access-control-allow-origin': '*' });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

export async function renderStillPng(compositionId: 'Slide' | 'Graphic', inputProps: Record<string, unknown>, output: string) {
  await prepareBrowser();
  const serveUrl = await getBundle();
  const composition = await selectComposition({ serveUrl, id: compositionId, inputProps, browserExecutable: browserExecutable() ?? null, logLevel: 'error' });
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await renderStill({ serveUrl, composition, inputProps, output, imageFormat: 'png', browserExecutable: browserExecutable() ?? null, logLevel: 'error' });
  return { width: composition.width, height: composition.height };
}

export async function renderPromoMp4(inputProps: Record<string, unknown>, output: string, onProgress?: (p: number) => void) {
  await prepareBrowser();
  const serveUrl = await getBundle();
  const composition = await selectComposition({ serveUrl, id: 'Promo', inputProps, browserExecutable: browserExecutable() ?? null, logLevel: 'error' });
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    audioCodec: 'aac',
    // Platform-friendly output: yuv420p, ~8 Mbit/s for 1080×1920, faststart for streaming.
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    videoBitrate: '8M',
    audioBitrate: '192k',
    outputLocation: output,
    concurrency,
    browserExecutable: browserExecutable() ?? null,
    logLevel: 'error',
    timeoutInMilliseconds: 120_000,
    onProgress: ({ progress }) => onProgress?.(progress),
  });
  return { width: composition.width, height: composition.height, frames: composition.durationInFrames, fps: composition.fps };
}
