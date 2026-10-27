import type { PlatformId } from '../../shared/platforms';

/**
 * Contract for a social platform adapter. Each platform has its own module; the
 * publisher (services/publisher.ts) owns idempotency, retries and journaling,
 * adapters only talk to the platform's official API.
 */

export interface Credentials {
  accessToken?: string;
  refreshToken?: string;
  botToken?: string;
  /** Platform user id returned on login (Instagram/Threads user id, TikTok open_id …). */
  userId?: string;
  /** VK ID device id, required for token refresh. */
  deviceId?: string;
}

export interface AccountCtx {
  id: string;
  creds: Credentials;
  meta: Record<string, unknown>;
  externalId: string | null;
}

export interface MediaRef {
  kind: 'image' | 'video';
  mime: string;
  /** Local file path (always available to the worker). */
  path: string;
  /** Public HTTPS URL when available (required by Meta and TikTok PULL). */
  url: string | null;
  bytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  /** Cover image for videos. */
  cover?: MediaRef;
}

export interface PublishInput {
  postId: string;
  title?: string | null;
  text: string;
  media: MediaRef[];
  /** Progress saved by a previous attempt of this same post (multi-step publishing). */
  progress: Record<string, unknown>;
  saveProgress: (p: Record<string, unknown>) => Promise<void>;
}

export interface PublishResult {
  externalId: string;
  url: string | null;
  /** Extra facts worth keeping (visibility, message ids …). */
  meta?: Record<string, unknown>;
}

export interface VerifyResult {
  displayName: string;
  externalId: string;
  scopes: string[];
  expiresAt?: Date | null;
  meta?: Record<string, unknown>;
  warnings?: string[];
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  userId?: string;
  scopes?: string[];
  deviceId?: string;
}

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface MetricsResult {
  values: Record<string, number>;
  unavailable: Record<string, string>;
}

export interface ConnectField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  help?: string;
}

export interface PlatformAdapter {
  id: PlatformId;
  /** token: user pastes a bot token; oauth: redirect flow; manual: nothing to connect. */
  connect: 'token' | 'oauth' | 'manual';
  /** Fields for token-based connection. */
  fields?: ConnectField[];
  /** How to obtain the credentials, step by step. */
  setupSteps: string[];
  /** Fields of the OAuth application (Settings → Integrations). */
  appFields?: ConnectField[];
  authorizeUrl?(app: OAuthApp, state: string, codeChallenge: string): string;
  exchangeCode?(app: OAuthApp, code: string, codeVerifier: string, extra: Record<string, string>): Promise<TokenSet>;
  refresh?(app: OAuthApp, creds: Credentials): Promise<TokenSet>;
  /** Validates credentials and permissions; returns what the account can do. */
  verify(creds: Credentials, meta: Record<string, unknown>, app?: OAuthApp): Promise<VerifyResult>;
  /** For OAuth platforms where one login gives access to several targets (VK groups). */
  listTargets?(creds: Credentials): Promise<{ id: string; name: string }[]>;
  publish(account: AccountCtx, input: PublishInput): Promise<PublishResult>;
  metrics?(account: AccountCtx, externalId: string): Promise<MetricsResult>;
}
