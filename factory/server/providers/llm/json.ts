import type { z } from 'zod';
import { ExternalError } from '../../lib/errors';

/** Extracts the first JSON object from model output and validates it against the schema. */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>, service: string): T {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) raw = fence[1].trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ExternalError(service, 'invalid_json', 'Модель вернула не JSON. Повторите генерацию.', true);
  }
  const r = schema.safeParse(parsed);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new ExternalError(service, 'schema_mismatch', `Ответ модели не прошёл проверку структуры (${first?.path.join('.') || 'корень'}: ${first?.message}). Повторите генерацию.`, true);
  }
  return r.data;
}
