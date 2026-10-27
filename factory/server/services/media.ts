import crypto from 'node:crypto';
import { config } from '../config';
import { storage } from '../storage';
import type { Asset } from './content';

/**
 * Public, time-limited links to media files. Meta and TikTok download media by URL,
 * so the factory signs `/media/<asset>/<exp>/<sig>` links (HMAC-SHA256 with SESSION_SECRET).
 * Links are only produced when PUBLIC_URL is a real HTTPS origin.
 */

function sign(assetId: string, exp: number) {
  return crypto.createHmac('sha256', config.sessionSecret).update(`media:${assetId}:${exp}`).digest('base64url').slice(0, 32);
}

export function verifyMediaSig(assetId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = sign(assetId, exp);
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export function publicHttpsOrigin(): string | null {
  try {
    const u = new URL(config.publicUrl);
    if (u.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function publicMediaUrl(asset: Pick<Asset, 'id' | 'storageKey' | 'mime'>, ttlSec = 24 * 3600): string | null {
  const direct = storage().publicUrl(asset.storageKey);
  if (direct) return direct;
  const origin = publicHttpsOrigin();
  if (!origin) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const ext = asset.mime === 'video/mp4' ? 'mp4' : asset.mime === 'image/png' ? 'png' : 'jpg';
  return `${origin}/media/${asset.id}/${exp}/${sign(asset.id, exp)}/file.${ext}`;
}
