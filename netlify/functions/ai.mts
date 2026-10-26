import type { Config } from '@netlify/functions';
import { handleAi } from '../../src/server/ai';

export default (req: Request) => handleAi(req, process.env);

export const config: Config = {
  path: ['/api/ai', '/api/ai/status'],
  method: ['GET', 'POST'],
  rateLimit: { windowSize: 60, windowLimit: 20, aggregateBy: ['ip', 'domain'] },
};
