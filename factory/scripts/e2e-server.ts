/**
 * Starts the app for Playwright on a clean database (TEST_DATABASE_URL, NODE_ENV=test).
 * The labelled test LLM provider is available in this mode, so the full pipeline runs
 * without paid API keys and every generated text is marked «[ТЕСТ]».
 */
import { resetDb } from '../tests/integration/helpers';

if (process.env.NODE_ENV !== 'test') throw new Error('e2e-server is for NODE_ENV=test only');
await resetDb();
await import('../server/main');
