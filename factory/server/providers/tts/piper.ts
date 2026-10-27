import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../../config';
import { ExternalError } from '../../lib/errors';
import type { TtsProvider } from '../types';
import { wavDurationMs } from './wav';

/**
 * Piper — free, offline neural TTS (https://github.com/rhasspy/piper). Installed by
 * `npm run tts:setup`. Runs as a subprocess; no network, no key.
 */

function voices(): { id: string; label: string }[] {
  try {
    return fs
      .readdirSync(config.piper.voicesDir)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => ({ id: f.replace(/\.onnx$/, ''), label: f.replace(/\.onnx$/, '') }));
  } catch {
    return [];
  }
}

export function piperAvailable(): boolean {
  return fs.existsSync(config.piper.bin) && voices().length > 0;
}

export const piperTts: TtsProvider = {
  info: {
    id: 'piper',
    kind: 'tts',
    name: 'Piper (локально, бесплатно)',
    setup: 'Выполните `npm run tts:setup` — скрипт установит Piper и русский голос irina. Работает без интернета и ключей.',
    docsUrl: 'https://github.com/rhasspy/piper',
    defaultModel: 'ru-irinia-medium',
    needsKey: false,
    local: true,
    fields: [{ key: 'speed', label: 'Темп речи', placeholder: '1.0', help: '0.8 — быстрее, 1.2 — медленнее' }],
  },

  async voices() {
    return voices();
  },

  async check() {
    if (!fs.existsSync(config.piper.bin)) throw new ExternalError('Piper', 'not_installed', 'Piper не установлен. Выполните npm run tts:setup', false);
    const v = voices();
    if (!v.length) throw new ExternalError('Piper', 'no_voice', 'Не найден ни один голос Piper', false);
    return `Piper установлен, голоса: ${v.map((x) => x.id).join(', ')}`;
  },

  async synthesize(rt, req) {
    const voice = req.voice || rt.model || voices()[0]?.id;
    if (!voice || !fs.existsSync(config.piper.bin)) throw new ExternalError('Piper', 'not_installed', 'Piper не установлен. Выполните npm run tts:setup', false);
    const model = path.join(config.piper.voicesDir, `${voice}.onnx`);
    if (!fs.existsSync(model)) throw new ExternalError('Piper', 'no_voice', `Голос ${voice} не найден`, false);
    const out = path.join(os.tmpdir(), `piper-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const lengthScale = String(req.speed ?? (Number(rt.settings.speed) || 1.0));
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(config.piper.bin, ['-m', model, '-f', out, '--length-scale', lengthScale, '--sentence-silence', '0.25'], { stdio: ['pipe', 'ignore', 'pipe'] });
        let err = '';
        const timer = setTimeout(() => p.kill('SIGKILL'), 120_000);
        p.stderr.on('data', (d) => (err += d.toString()));
        p.on('error', (e) => reject(e));
        p.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new ExternalError('Piper', 'failed', `Piper завершился с кодом ${code}: ${err.slice(-300)}`, true));
        });
        p.stdin.end(req.text);
      });
      const data = await fsp.readFile(out);
      return { data, mime: 'audio/wav', durationMs: wavDurationMs(data), voice: `piper:${voice}` };
    } finally {
      await fsp.rm(out, { force: true });
    }
  },
};
