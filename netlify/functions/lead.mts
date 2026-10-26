import type { Config } from '@netlify/functions';
import { handleLead } from '../../src/server/lead';

export default (req: Request) => handleLead(req, process.env);

export const config: Config = {
  path: '/api/lead',
  method: ['POST'],
  rateLimit: { windowSize: 60, windowLimit: 5, aggregateBy: ['ip', 'domain'] },
};
