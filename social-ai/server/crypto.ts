import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Secrets (platform tokens) are encrypted at rest with AES-256-GCM.
 * The key comes from NORO_MASTER_KEY or is generated once into <data>/master.key (mode 0600).
 * The key file is never included in backups: losing it means re-connecting accounts, not leaking them.
 */
export class Vault {
  private readonly key: Buffer;

  constructor(dataDir: string, envKey: string | null) {
    if (envKey) {
      this.key = crypto.createHash('sha256').update(envKey).digest();
      return;
    }
    const file = path.join(dataDir, 'master.key');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    this.key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (this.key.length !== 32) throw new Error('master.key повреждён: ожидается 32 байта в base64');
  }

  encrypt(value: unknown): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  }

  decrypt<T>(blob: string | null | undefined): T | null {
    if (!blob) return null;
    const [v, iv, tag, data] = blob.split('.');
    if (v !== 'v1') throw new Error('Неизвестный формат секрета');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
    return JSON.parse(out.toString('utf8')) as T;
  }

  /** HMAC used for unguessable public media links (Instagram must fetch images by URL). */
  sign(value: string): string {
    return crypto.createHmac('sha256', this.key).update(value).digest('base64url').slice(0, 32);
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');

/** Shows only the tail of a secret so the user can tell tokens apart. */
export function mask(secret: string | undefined | null): string {
  if (!secret) return '';
  return secret.length <= 8 ? '••••' : `••••${secret.slice(-4)}`;
}
