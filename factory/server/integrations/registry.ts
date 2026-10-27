import type { PlatformId } from '../../shared/platforms';
import { dzen, teletype, vcru } from './manual';
import { max } from './max';
import { instagram, threads } from './meta';
import { telegram } from './telegram';
import { tiktok } from './tiktok';
import type { PlatformAdapter } from './types';
import { vk } from './vk';
import { youtube } from './youtube';

/** One adapter per platform. */
export const ADAPTERS: Record<PlatformId, PlatformAdapter> = { telegram, vk, max, instagram, threads, youtube, tiktok, dzen, teletype, vcru };

export function adapter(id: PlatformId): PlatformAdapter {
  return ADAPTERS[id];
}
