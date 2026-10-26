import { describe, expect, it } from 'vitest';
import { buildLeadMessage, isPlausibleContact, validateLead } from './lead';

describe('order form validation', () => {
  const ok = { name: 'Анна', contact: '@anna_k', task: 'Нужно разбирать 300 заявок в день', consent: true };

  it('accepts a minimal valid lead', () => {
    expect(validateLead(ok)).toEqual({});
  });

  it('requires name, contact, task and consent', () => {
    const e = validateLead({});
    expect(Object.keys(e).sort()).toEqual(['consent', 'contact', 'name', 'task']);
  });

  it('checks contact plausibility', () => {
    expect(isPlausibleContact('@anna_k')).toBe(true);
    expect(isPlausibleContact('anna@firm.example')).toBe(true);
    expect(isPlausibleContact('+7 (900) 123-45-67')).toBe(true);
    expect(isPlausibleContact('позвоните мне')).toBe(false);
    expect(isPlausibleContact('123')).toBe(false);
    expect(validateLead({ ...ok, contact: 'abc' }).contact).toBeTruthy();
  });

  it('enforces length limits', () => {
    expect(validateLead({ ...ok, task: 'x'.repeat(3001) }).task).toMatch(/Слишком длинное/);
  });

  it('builds a readable message for the fallback channel', () => {
    const m = buildLeadMessage({ ...ok, product: 'support', budget: 'Пока не знаю' });
    expect(m).toContain('Контакт: @anna_k');
    expect(m).toContain('Support');
    expect(m).toContain('Нужно разбирать 300 заявок в день');
  });
});
