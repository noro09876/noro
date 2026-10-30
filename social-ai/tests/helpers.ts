import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServices, type Services } from '../server/app.ts';
import type { AppConfig } from '../server/config.ts';
import type { MockApis } from './mock-apis.ts';

export function tempDir(prefix = 'noro-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function servicesFor(mock: MockApis, dataDir = tempDir(), extra: Partial<AppConfig> = {}): Services {
  const s = createServices({
    dataDir,
    isTest: true,
    masterKey: 'test-master-key',
    publicBaseUrl: null,
    apiBase: { telegram: `${mock.base}/tg`, vk: `${mock.base}/vk`, instagram: `${mock.base}/ig`, facebook: `${mock.base}/fb`, x: `${mock.base}/x` },
    ...extra,
  });
  return s;
}

export const TG_TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijk';

export function useOllama(s: Services, mock: MockApis, model = 'qwen2.5:7b') {
  s.settings.update({ ai: { provider: 'ollama', baseUrl: `${mock.base}/ollama`, model, timeoutMs: 5000 } });
}
