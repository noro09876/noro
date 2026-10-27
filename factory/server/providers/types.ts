import type { z } from 'zod';

/**
 * Provider contracts. Each capability has its own small interface so a provider
 * can be swapped without touching the pipeline. Implementations live next to this file
 * and register themselves in registry.ts.
 */

export interface ProviderField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  help?: string;
}

export interface ProviderInfo {
  id: string;
  kind: 'llm' | 'image' | 'tts';
  name: string;
  /** Where to get credentials, in plain Russian. */
  setup: string;
  docsUrl?: string;
  defaultModel?: string;
  models?: string[];
  needsKey: boolean;
  local?: boolean;
  /** Only available when ALLOW_TEST_PROVIDERS=1; outputs are labelled as test data. */
  testOnly?: boolean;
  fields: ProviderField[];
  pricing?: string;
}

export interface ProviderRuntime {
  apiKey?: string;
  model: string;
  settings: Record<string, string>;
}

export interface LlmRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** JSON Schema derived from `schema`, passed to providers that support constrained output. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
  /** Structured inputs; used only by the deterministic test provider. */
  context?: Record<string, unknown>;
}

export interface LlmResult<T> {
  data: T;
  model: string;
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface LlmProvider {
  info: ProviderInfo;
  generate<T>(rt: ProviderRuntime, req: LlmRequest<T>): Promise<LlmResult<T>>;
  /** Cheap call that proves the credentials work. */
  check(rt: ProviderRuntime): Promise<string>;
}

export interface ImageResult {
  data: Buffer;
  mime: string;
  model: string;
}

export interface ImageProvider {
  info: ProviderInfo;
  generate(rt: ProviderRuntime, req: { prompt: string; size: '1024x1024' | '1024x1536' | '1536x1024' }): Promise<ImageResult>;
  check(rt: ProviderRuntime): Promise<string>;
}

export interface TtsResult {
  /** WAV or MP3 audio. */
  data: Buffer;
  mime: 'audio/wav' | 'audio/mpeg';
  durationMs: number;
  voice: string;
}

export interface TtsProvider {
  info: ProviderInfo;
  synthesize(rt: ProviderRuntime, req: { text: string; voice?: string; speed?: number }): Promise<TtsResult>;
  voices(rt: ProviderRuntime): Promise<{ id: string; label: string }[]>;
  check(rt: ProviderRuntime): Promise<string>;
}
