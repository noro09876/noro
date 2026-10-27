import { PLATFORMS, type PlatformId } from '../../shared/platforms';
import { ExternalError } from '../lib/errors';
import type { PlatformAdapter } from './types';

/**
 * Platforms without an official publishing API (Дзен, Teletype, VC.ru).
 * Nothing is sent anywhere: the post becomes «Ждёт ручной публикации», the user gets a
 * ready package (text, title, images, video) and marks the post as placed with its URL.
 */
function manualAdapter(id: PlatformId, steps: string[]): PlatformAdapter {
  return {
    id,
    connect: 'manual',
    setupSteps: steps,
    async verify() {
      return { displayName: PLATFORMS[id].name, externalId: id, scopes: [], meta: {} };
    },
    async publish() {
      throw new ExternalError(PLATFORMS[id].name, 'manual_only', `${PLATFORMS[id].name} не предоставляет API публикации — материал подготовлен для ручного размещения`, false);
    },
  };
}

export const dzen = manualAdapter('dzen', [
  'Откройте Студию Дзена (dzen.ru/profile/editor) и создайте статью или видео.',
  'Скопируйте заголовок и текст из пакета публикации, загрузите обложку (16:9) и иллюстрации.',
  'После публикации вставьте ссылку на материал в фабрике и отметьте «Размещено вручную».',
]);

export const teletype = manualAdapter('teletype', [
  'Откройте teletype.in и создайте новую статью в своём блоге.',
  'Вставьте заголовок и текст из пакета, добавьте обложку и изображения.',
  'После публикации вставьте ссылку в фабрике и отметьте «Размещено вручную».',
]);

export const vcru = manualAdapter('vcru', [
  'Откройте редактор vc.ru (кнопка «Написать») в профиле или блоге компании.',
  'Вставьте заголовок, текст и изображения из пакета публикации.',
  'После модерации и публикации вставьте ссылку в фабрике и отметьте «Размещено вручную».',
]);
