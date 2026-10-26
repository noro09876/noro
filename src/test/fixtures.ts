import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function demoFile(name: string): string {
  return readFileSync(join(process.cwd(), 'public', 'demo', name), 'utf-8');
}

export function demoBuffer(name: string): ArrayBuffer {
  const b = readFileSync(join(process.cwd(), 'public', 'demo', name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
