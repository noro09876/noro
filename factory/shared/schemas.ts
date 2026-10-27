import { z } from 'zod';
import { PLATFORM_IDS } from './platforms';
import { CONTENT_KINDS } from './types';

/** Runtime schemas: validate model output, API input and manual edits with the same rules. */

export const platformSchema = z.enum(PLATFORM_IDS);
export const kindSchema = z.enum(CONTENT_KINDS);

export const visualSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stat'), value: z.string().max(16), label: z.string().max(80) }),
  z.object({ type: z.literal('steps'), items: z.array(z.string().max(60)).min(2).max(5) }),
  z.object({ type: z.literal('chart'), points: z.array(z.number()).min(3).max(12), label: z.string().max(60) }),
  z.object({
    type: z.literal('ui'),
    title: z.string().max(40),
    rows: z.array(z.object({ label: z.string().max(40), value: z.string().max(24), tone: z.enum(['good', 'warn', 'bad']).optional() })).min(2).max(5),
  }),
  z.object({ type: z.literal('quote'), text: z.string().max(200), author: z.string().max(60) }),
]);

export const briefSchema = z.object({
  task: z.string().trim().min(10, 'Опишите задачу хотя бы в одном предложении').max(4000),
  audience: z.string().trim().min(3, 'Укажите целевую аудиторию').max(1000),
  goal: z.string().trim().min(3, 'Укажите цель кампании').max(500),
  platforms: z.array(platformSchema).min(1, 'Выберите хотя бы одну площадку'),
  formats: z.array(kindSchema).min(1, 'Выберите хотя бы один формат'),
  frequency: z.number().int().min(1).max(14),
  constraints: z.string().max(2000).default(''),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weeks: z.number().int().min(1).max(8),
  timezone: z.string().min(3).max(64),
});

export const strategyOutputSchema = z.object({
  strategy: z.object({
    summary: z.string().min(20),
    positioning: z.string().min(10),
    pillars: z.array(z.object({ name: z.string().min(2), description: z.string().min(5) })).min(2).max(5),
    keyMessages: z.array(z.string().min(5)).min(2).max(6),
    audienceInsights: z.array(z.string().min(5)).min(2).max(6),
    tone: z.string().min(5),
    kpis: z.array(z.string().min(3)).min(1).max(6),
  }),
  plan: z
    .array(
      z.object({
        day: z.number().int().min(0).max(60),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        kind: kindSchema,
        pillar: z.string(),
        topic: z.string().min(5),
        angle: z.string().min(5),
        platforms: z.array(platformSchema).min(1),
      }),
    )
    .min(1)
    .max(60),
});

export const postSchema = z.object({
  headline: z.string().trim().min(3).max(140),
  body: z.string().trim().min(20).max(6000),
  cta: z.string().trim().max(240),
  hashtags: z.array(z.string().max(40)).max(12),
  visualBrief: z.string().max(400).optional(),
});

export const slideSchema = z.object({
  kicker: z.string().max(40).optional(),
  title: z.string().trim().min(2).max(90),
  body: z.string().max(320),
  visual: visualSchema.optional(),
});

export const carouselSchema = z.object({
  title: z.string().trim().min(3).max(120),
  caption: z.string().trim().min(10).max(2200),
  hashtags: z.array(z.string().max(40)).max(12),
  slides: z.array(slideSchema).min(3).max(10),
});

export const graphicSchema = z.object({
  headline: z.string().trim().min(3).max(90),
  subline: z.string().max(160),
  caption: z.string().trim().min(10).max(2200),
  visual: visualSchema,
  imagePrompt: z.string().max(600).optional(),
});

export const sceneSchema = z.object({
  id: z.string().min(1).max(24),
  kind: z.enum(['hook', 'problem', 'ui', 'chart', 'feature', 'stat', 'steps', 'cta']),
  title: z.string().trim().min(2).max(70),
  text: z.string().max(140).optional(),
  voiceover: z.string().trim().min(3).max(400),
  durationSec: z.number().min(1.5).max(15),
  visual: visualSchema.optional(),
  transition: z.enum(['slide', 'fade', 'wipe', 'zoom']).optional(),
});

export const videoScriptSchema = z.object({
  title: z.string().trim().min(3).max(100),
  hook: z.string().trim().min(3).max(140),
  scenes: z.array(sceneSchema).min(3).max(10),
  caption: z.string().trim().min(10).max(2200),
  hashtags: z.array(z.string().max(40)).max(10),
  musicMood: z.string().max(80).optional(),
});

export const brandSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).default(''),
  product: z.string().max(2000).default(''),
  audience: z.string().max(2000).default(''),
  goals: z.array(z.string().max(200)).max(10).default([]),
  tone: z.string().max(1000).default(''),
  vocabulary: z.object({ preferred: z.array(z.string().max(60)).max(40), avoid: z.array(z.string().max(60)).max(40) }).default({ preferred: [], avoid: [] }),
  visual: z.object({
    colors: z.object({
      primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    fonts: z.object({ display: z.string().max(60), body: z.string().max(60) }),
    style: z.string().max(600),
  }),
  forbidden: z.array(z.string().max(120)).max(60).default([]),
  examplesGood: z.array(z.string().max(2000)).max(10).default([]),
  examplesBad: z.array(z.string().max(2000)).max(10).default([]),
});

export const SCHEMA_BY_KIND = {
  post: postSchema,
  carousel: carouselSchema,
  graphic: graphicSchema,
  video_script: videoScriptSchema,
  video: videoScriptSchema,
} as const;
