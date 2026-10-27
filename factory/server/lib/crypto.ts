import crypto from 'node:crypto';
import { config } from '../config';

/**
 * AES-256-GCM envelope for secrets at rest (social tokens, provider API keys).
 * Format: v1.<iv b64>.<tag b64>.<ciphertext b64>. The key is derived from MASTER_KEY
 * with scrypt so any sufficiently long string works; rotate by re-encrypting.
 */

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = crypto.scryptSync(config.masterKey, 'noro-factory/secrets/v1', 32);
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

export function encryptJson(v: unknown): string {
  return encrypt(JSON.stringify(v));
}
export function decryptJson<T>(blob: string): T {
  return JSON.parse(decrypt(blob)) as T;
}

/** Shows only the last 4 characters of a secret. */
export function mask(secret: string): string {
  if (secret.length <= 8) return '••••';
  return `••••${secret.slice(-4)}`;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/* ---- Password hashing (scrypt, no native deps) ---- */

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(password, salt, 64, SCRYPT, (e, k) => (e ? rej(e) : res(k))),
  );
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(password, Buffer.from(salt, 'base64'), expected.length, { ...SCRYPT, N: Number(n) }, (e, k) => (e ? rej(e) : res(k))),
  );
  return crypto.timingSafeEqual(expected, got);
}

/** PKCE helpers for OAuth 2.x */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
