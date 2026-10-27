import { config } from '../config';
import { openaiImage } from './image/openai';
import { anthropicLlm } from './llm/anthropic';
import { openaiCompatibleLlm, openaiLlm } from './llm/openai';
import { testLlm } from './llm/test';
import { yandexLlm } from './llm/yandex';
import { elevenTts, openaiTts } from './tts/cloud';
import { piperTts } from './tts/piper';
import type { ImageProvider, LlmProvider, ProviderInfo, TtsProvider } from './types';

/** Adding a provider = implement the interface and add it here. Nothing else changes. */
const LLM: LlmProvider[] = [anthropicLlm, openaiLlm, yandexLlm, openaiCompatibleLlm, testLlm];
const IMAGE: ImageProvider[] = [openaiImage];
const TTS: TtsProvider[] = [piperTts, elevenTts, openaiTts];

const visible = <T extends { info: ProviderInfo }>(list: T[]) => list.filter((p) => !p.info.testOnly || config.allowTestProviders);

export const llmProviders = () => visible(LLM);
export const imageProviders = () => visible(IMAGE);
export const ttsProviders = () => visible(TTS);

export function catalog(): ProviderInfo[] {
  return [...llmProviders(), ...imageProviders(), ...ttsProviders()].map((p) => p.info);
}

export function findLlm(id: string) {
  return llmProviders().find((p) => p.info.id === id);
}
export function findImage(id: string) {
  return imageProviders().find((p) => p.info.id === id);
}
export function findTts(id: string) {
  return ttsProviders().find((p) => p.info.id === id);
}
export function findAny(id: string) {
  return findLlm(id) ?? findImage(id) ?? findTts(id);
}
