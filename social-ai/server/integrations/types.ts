import type { Platform } from '../settings.ts';

export type ErrorKind =
  | 'auth' // token invalid or expired: account needs re-authorization
  | 'permission' // token fine, but no right to post here
  | 'rate_limit' // platform limit; retry after a pause
  | 'transient' // network/5xx before the post could have been created; safe to retry
  | 'ambiguous' // failed after the request may have reached the platform; never auto-retry (could duplicate)
  | 'invalid' // the request itself is wrong (format, size, text)
  | 'payment' // platform requires a paid plan or credits
  | 'unavailable'; // integration cannot work in the current setup (e.g. no public URL)

export class IntegrationError extends Error {
  readonly kind: ErrorKind;
  readonly retryAfterSec: number | null;
  readonly code: string | null;

  constructor(kind: ErrorKind, message: string, opts: { retryAfterSec?: number | null; code?: string | number | null } = {}) {
    super(message);
    this.kind = kind;
    this.retryAfterSec = opts.retryAfterSec ?? null;
    this.code = opts.code == null ? null : String(opts.code);
  }

  get retryable() {
    return this.kind === 'transient' || this.kind === 'rate_limit';
  }
}

export interface FieldSpec {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface OutgoingImage {
  path: string;
  /** Public URL (only for platforms that fetch by URL, i.e. Instagram). */
  url: string | null;
  mime: string;
  bytes: number;
}

export interface OutgoingPost {
  publicationId: number;
  text: string;
  followUps: string[];
  html: boolean;
  images: OutgoingImage[];
}

export interface PublishResult {
  externalId: string;
  url: string | null;
  warnings: string[];
}

export interface CheckResult {
  ok: boolean;
  remoteName: string | null;
  message: string;
  details: Record<string, unknown>;
}

export interface MetricsResult {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface Ctx<C = Record<string, string>> {
  credentials: C;
  config: Record<string, string>;
  apiBase: string;
  /** Persist refreshed credentials (OAuth refresh). */
  saveCredentials: (c: C) => void;
  fetch: typeof fetch;
}

export interface Integration {
  platform: Platform;
  label: string;
  /** Honest description of what the platform requires before publishing can work. */
  requirements: string[];
  /** Is the integration usable without paid plans? */
  cost: string;
  credentialFields: FieldSpec[];
  configFields: FieldSpec[];
  oauth: boolean;
  metricsNote: string;
  check(ctx: Ctx): Promise<CheckResult>;
  publish(ctx: Ctx, post: OutgoingPost): Promise<PublishResult>;
  metrics(ctx: Ctx, externalId: string): Promise<MetricsResult | null>;
}
