import { fmtBytes } from './format';

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileValidationError';
  }
}

export interface FileRules {
  /** Allowed lowercase extensions without dot, e.g. ['csv', 'txt'] */
  extensions: readonly string[];
  maxBytes: number;
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Validates type/size before any parsing. Throws FileValidationError with a user-facing message. */
export function validateFile(file: { name: string; size: number }, rules: FileRules): string {
  const ext = fileExtension(file.name);
  if (!rules.extensions.includes(ext)) {
    throw new FileValidationError(
      `Формат «.${ext || '?'}» не поддерживается. Подходят: ${rules.extensions.map((e) => '.' + e).join(', ')}.`,
    );
  }
  if (file.size === 0) {
    throw new FileValidationError('Файл пустой (0 байт). Проверьте, что выбран правильный файл.');
  }
  if (file.size > rules.maxBytes) {
    throw new FileValidationError(
      `Файл слишком большой: ${fmtBytes(file.size)}. В демоверсии лимит ${fmtBytes(rules.maxBytes)} — обработка идёт в браузере.`,
    );
  }
  return ext;
}

/**
 * Decodes bytes as UTF-8; if invalid, falls back to Windows-1251 (typical for
 * CSV saved by Russian Excel). Strips the BOM.
 */
export function decodeText(buf: ArrayBuffer): { text: string; encoding: 'utf-8' | 'windows-1251' } {
  const bytes = new Uint8Array(buf);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.replace(/^\uFEFF/, ''), encoding: 'utf-8' };
  } catch {
    const text = new TextDecoder('windows-1251').decode(bytes);
    return { text, encoding: 'windows-1251' };
  }
}

export async function readFileBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Не удалось прочитать файл'));
    r.readAsArrayBuffer(file);
  });
}

/** Detects binary content mistakenly given as text (e.g. a renamed .xlsx). */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 2000);
  if (!sample) return false;
  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return ctrl / sample.length > 0.05;
}
