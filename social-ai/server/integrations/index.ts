import type { Platform } from '../settings.ts';
import { instagram } from './instagram.ts';
import { telegram } from './telegram.ts';
import type { Integration } from './types.ts';
import { vk } from './vk.ts';
import { x } from './x.ts';

/** Registry. A new platform = one module implementing Integration + an entry here. */
export const INTEGRATIONS: Record<Platform, Integration> = { telegram, vk, instagram, x };
