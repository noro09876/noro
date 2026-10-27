import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExternalError } from '../../lib/errors';
import { httpError, readJson, xfetch } from '../../lib/http';
import type { TtsProvider } from '../types';
import { probeDurationMs } from './wav';

async function mp3Duration(data: Buffer): Promise<number> {
  const f = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  await fsp.writeFile(f, data);
  try {
    return await probeDurationMs(f);
  } finally {
    await fsp.rm(f, { force: true });
  }
}

/** OpenAI Text-to-Speech (`/v1/audio/speech`). */
export const openaiTts: TtsProvider = {
  info: {
    id: 'openai_tts',
    kind: 'tts',
    name: 'OpenAI TTS',
    setup: 'Нужен API-ключ OpenAI (platform.openai.com → API keys).',
    docsUrl: 'https://platform.openai.com/docs/guides/text-to-speech',
    defaultModel: 'gpt-4o-mini-tts',
    needsKey: true,
    fields: [
      { key: 'apiKey', label: 'API-ключ', secret: true, required: true },
      { key: 'voice', label: 'Голос', placeholder: 'alloy' },
      { key: 'instructions', label: 'Манера речи', placeholder: 'Спокойно, уверенно, деловой тон' },
    ],
  },
  async voices() {
    return ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].map((id) => ({ id, label: id }));
  },
  async check(rt) {
    const res = await xfetch('https://api.openai.com/v1/models', { service: 'OpenAI', timeoutMs: 15_000, headers: { authorization: `Bearer ${rt.apiKey}` } });
    if (res.status === 401) throw new ExternalError('OpenAI', 'auth', 'Ключ OpenAI недействителен', false, undefined, 401);
    if (!res.ok) throw httpError('OpenAI', res, `OpenAI: HTTP ${res.status}`);
    return 'Ключ работает';
  },
  async synthesize(rt, req) {
    if (!rt.apiKey) throw new ExternalError('OpenAI', 'no_key', 'Не задан API-ключ OpenAI', false);
    const voice = req.voice || rt.settings.voice || 'alloy';
    const res = await xfetch('https://api.openai.com/v1/audio/speech', {
      service: 'OpenAI TTS',
      timeoutMs: 120_000,
      method: 'POST',
      headers: { authorization: `Bearer ${rt.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: rt.model, voice, input: req.text, response_format: 'mp3', instructions: rt.settings.instructions || undefined, speed: req.speed }),
    });
    if (!res.ok) {
      const b = await readJson<{ error?: { message?: string } }>(res);
      throw httpError('OpenAI TTS', res, `OpenAI TTS: ${b?.error?.message ?? res.statusText}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    return { data, mime: 'audio/mpeg', durationMs: await mp3Duration(data), voice: `openai:${voice}` };
  },
};

/** ElevenLabs Text-to-Speech (multilingual voices, good Russian). */
export const elevenTts: TtsProvider = {
  info: {
    id: 'elevenlabs',
    kind: 'tts',
    name: 'ElevenLabs',
    setup: 'Ключ API в профиле elevenlabs.io → Developers → API Keys. ID голоса — в библиотеке голосов (Voice ID).',
    docsUrl: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert',
    defaultModel: 'eleven_multilingual_v2',
    needsKey: true,
    fields: [
      { key: 'apiKey', label: 'API-ключ', secret: true, required: true },
      { key: 'voice', label: 'Voice ID', required: true },
    ],
  },
  async voices(rt) {
    const res = await xfetch('https://api.elevenlabs.io/v1/voices', { service: 'ElevenLabs', timeoutMs: 15_000, headers: { 'xi-api-key': rt.apiKey ?? '' } });
    if (!res.ok) return [];
    const b = await readJson<{ voices?: { voice_id: string; name: string }[] }>(res);
    return (b?.voices ?? []).map((v) => ({ id: v.voice_id, label: v.name }));
  },
  async check(rt) {
    const res = await xfetch('https://api.elevenlabs.io/v1/user', { service: 'ElevenLabs', timeoutMs: 15_000, headers: { 'xi-api-key': rt.apiKey ?? '' } });
    if (res.status === 401) throw new ExternalError('ElevenLabs', 'auth', 'Ключ ElevenLabs недействителен', false, undefined, 401);
    if (!res.ok) throw httpError('ElevenLabs', res, `ElevenLabs: HTTP ${res.status}`);
    return 'Ключ работает';
  },
  async synthesize(rt, req) {
    if (!rt.apiKey) throw new ExternalError('ElevenLabs', 'no_key', 'Не задан API-ключ ElevenLabs', false);
    const voice = req.voice || rt.settings.voice;
    if (!voice) throw new ExternalError('ElevenLabs', 'no_voice', 'Не указан Voice ID', false);
    const res = await xfetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      service: 'ElevenLabs',
      timeoutMs: 120_000,
      method: 'POST',
      headers: { 'xi-api-key': rt.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: req.text, model_id: rt.model }),
    });
    if (!res.ok) {
      const b = await readJson<{ detail?: { message?: string } | string }>(res);
      const msg = typeof b?.detail === 'string' ? b.detail : b?.detail?.message;
      throw httpError('ElevenLabs', res, `ElevenLabs: ${msg ?? res.statusText}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    return { data, mime: 'audio/mpeg', durationMs: await mp3Duration(data), voice: `elevenlabs:${voice}` };
  },
};
