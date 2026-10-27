import { describe, expect, it } from 'vitest';
import { decrypt, decryptJson, encrypt, encryptJson, hashPassword, mask, verifyPassword } from '../../server/lib/crypto';
import { backoffMs } from '../../server/services/publisher';
import { idempotencyKey } from '../../server/services/posts';

describe('secret encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const blob = encrypt('vk1.a.secret-token-value');
    expect(blob).not.toContain('secret-token-value');
    expect(decrypt(blob)).toBe('vk1.a.secret-token-value');
    expect(decryptJson<{ a: number }>(encryptJson({ a: 1 }))).toEqual({ a: 1 });
  });
  it('uses a fresh IV each time and detects tampering', () => {
    const a = encrypt('x');
    expect(encrypt('x')).not.toBe(a);
    const parts = a.split('.');
    parts[3] = Buffer.from('y').toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('masks secrets', () => {
    expect(mask('sk-1234567890abcd')).toBe('••••abcd');
    expect(mask('short')).toBe('••••');
  });
  it('hashes passwords', async () => {
    const h = await hashPassword('correct horse');
    expect(h).not.toContain('correct');
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

describe('publishing backoff', () => {
  it('grows exponentially and is capped at 3 hours', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(240_000);
    expect(backoffMs(3)).toBe(960_000);
    expect(backoffMs(10)).toBe(3 * 3600 * 1000);
  });
  it('honours Retry-After', () => {
    expect(backoffMs(1, 600)).toBe(600_000);
  });
});

describe('idempotency key', () => {
  it('is stable for the same item, version, platform and account', () => {
    expect(idempotencyKey('i', 'v', 'telegram', 'a')).toBe(idempotencyKey('i', 'v', 'telegram', 'a'));
    expect(idempotencyKey('i', 'v', 'telegram', 'a')).not.toBe(idempotencyKey('i', 'v2', 'telegram', 'a'));
    expect(idempotencyKey('i', 'v', 'telegram', null)).not.toBe(idempotencyKey('i', 'v', 'telegram', 'a'));
  });
});
