import type { PlatformId } from './platforms';
import type { ContentKind } from './types';

/** Automation rule configuration. Defaults are conservative on purpose. */
export interface RuleConfig {
  /** When to create content. */
  schedule: { weekdays: number[]; time: string; timezone: string };
  /** What and how much to generate per run. */
  generate: { itemsPerRun: number; formats: ContentKind[]; platforms: PlatformId[]; topicHint: string };
  /** Who approves. If `required` is false, items still pass quality checks before scheduling. */
  approval: { required: boolean; approverIds: string[] };
  /** When to place publications. */
  publish: { mode: 'draft_only' | 'schedule_after_approval'; slots: string[]; minGapMinutes: number };
  /** What to do on error. */
  onError: { retries: number; notify: boolean };
  /** Hard safety limits. */
  limits: { maxRunsPerDay: number; maxItemsPerDay: number; pauseAfterFailures: number; requireConfirmAbove: number };
}

export const DEFAULT_RULE: RuleConfig = {
  schedule: { weekdays: [1, 3, 5], time: '09:00', timezone: 'Europe/Moscow' },
  generate: { itemsPerRun: 2, formats: ['post'], platforms: ['telegram'], topicHint: '' },
  approval: { required: true, approverIds: [] },
  publish: { mode: 'schedule_after_approval', slots: ['10:00', '18:00'], minGapMinutes: 120 },
  onError: { retries: 2, notify: true },
  limits: { maxRunsPerDay: 1, maxItemsPerDay: 6, pauseAfterFailures: 3, requireConfirmAbove: 10 },
};

/** Validation that blocks unsafe configurations (mass generation without limits). */
export function validateRule(c: RuleConfig): string[] {
  const errs: string[] = [];
  if (!c.schedule.weekdays.length) errs.push('Выберите хотя бы один день недели');
  if (!/^\d{2}:\d{2}$/.test(c.schedule.time)) errs.push('Время запуска должно быть в формате ЧЧ:ММ');
  if (c.generate.itemsPerRun < 1 || c.generate.itemsPerRun > 20) errs.push('За запуск можно создать от 1 до 20 материалов');
  if (!c.generate.formats.length) errs.push('Выберите хотя бы один формат');
  if (!c.generate.platforms.length) errs.push('Выберите хотя бы одну площадку');
  if (c.limits.maxRunsPerDay < 1 || c.limits.maxRunsPerDay > 4) errs.push('Запусков в день: от 1 до 4');
  if (c.limits.maxItemsPerDay > 40) errs.push('Больше 40 материалов в день — слишком много для одного правила');
  if (c.limits.pauseAfterFailures < 1) errs.push('Правило должно останавливаться после ошибок');
  if (c.publish.slots.some((s) => !/^\d{2}:\d{2}$/.test(s))) errs.push('Слоты публикации — в формате ЧЧ:ММ');
  if (c.approval.required === false && c.publish.mode === 'schedule_after_approval' && c.generate.itemsPerRun > c.limits.requireConfirmAbove) {
    errs.push(`Без согласования нельзя автоматически планировать больше ${c.limits.requireConfirmAbove} материалов за запуск`);
  }
  return errs;
}
