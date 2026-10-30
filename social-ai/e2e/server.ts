// E2E server: NORO with a fresh data dir, wired to local imitations of the platform APIs and Ollama.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, createServices } from '../server/app.ts';
import { anglesAnswer, carouselAnswer, MockApis } from '../tests/mock-apis.ts';

const mock = await new MockApis().start();
let n = 0;
mock.ollamaAnswer = (body) => {
  const user = (body.messages as { content: string }[])[1].content;
  if (user.startsWith('Составь')) return anglesAnswer(body);
  const a = carouselAnswer((n++ % 2) + 1);
  return user.includes('Формат: карусель') ? a : { ...a, slides: [] };
};
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noro-e2e-'));
const s = createServices({
  dataDir, masterKey: 'e2e', publicBaseUrl: null, isTest: true,
  apiBase: { telegram: `${mock.base}/tg`, vk: `${mock.base}/vk`, instagram: `${mock.base}/ig`, facebook: `${mock.base}/fb`, x: `${mock.base}/x` },
});
s.settings.update({ ai: { provider: 'ollama', baseUrl: `${mock.base}/ollama`, model: '' } });
const app = await buildApp(s);
await app.listen({ host: '127.0.0.1', port: Number(process.env.E2E_PORT ?? 4400) });
console.log(`e2e server ready, ollama mock at ${mock.base}/ollama`);
