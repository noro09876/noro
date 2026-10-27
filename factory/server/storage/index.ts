import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config';

/**
 * File storage behind one interface. `local` keeps files under DATA_DIR/files,
 * `s3` works with any S3-compatible storage (AWS, Yandex Object Storage, MinIO, R2).
 * Keys are opaque paths like `ws/<id>/items/<id>/<file>`; nothing user-controlled ends up in them.
 */
export interface Storage {
  put(key: string, body: Buffer | Readable, mime: string): Promise<void>;
  putFile(key: string, filePath: string, mime: string): Promise<void>;
  get(key: string): Promise<Readable>;
  readBuffer(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Local filesystem path if available (used by the renderer and ffmpeg). */
  localPath(key: string): string | null;
  /**
   * Public URL that a third party (Meta, TikTok) can download, or null when the
   * storage is private. For local storage this is a signed app URL.
   */
  publicUrl(key: string): string | null;
}

const SAFE_KEY = /^[a-zA-Z0-9/_.-]+$/;
function assertKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.startsWith('/')) throw new Error(`Unsafe storage key: ${key}`);
}

export class LocalStorage implements Storage {
  constructor(private root: string) {}
  private p(key: string) {
    assertKey(key);
    return path.join(this.root, key);
  }
  async put(key: string, body: Buffer | Readable, _mime: string) {
    const file = this.p(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    if (Buffer.isBuffer(body)) await fsp.writeFile(file, body);
    else await new Promise<void>((res, rej) => body.pipe(fs.createWriteStream(file)).on('finish', () => res()).on('error', rej));
  }
  async putFile(key: string, filePath: string, _mime: string) {
    const file = this.p(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.copyFile(filePath, file);
  }
  async get(key: string) {
    return fs.createReadStream(this.p(key));
  }
  async readBuffer(key: string) {
    return fsp.readFile(this.p(key));
  }
  async exists(key: string) {
    return fsp.access(this.p(key)).then(() => true, () => false);
  }
  async delete(key: string) {
    await fsp.rm(this.p(key), { force: true });
  }
  localPath(key: string) {
    return this.p(key);
  }
  publicUrl(_key: string) {
    // Local files are served only through authenticated or signed routes (see http/routes/files.ts).
    return null;
  }
}

export class S3Storage implements Storage {
  private client: S3Client;
  constructor(private opts: typeof config.storage.s3) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: !!opts.endpoint,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }
  async put(key: string, body: Buffer | Readable, mime: string) {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: mime }));
  }
  async putFile(key: string, filePath: string, mime: string) {
    await this.put(key, fs.createReadStream(filePath), mime);
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    return r.Body as Readable;
  }
  async readBuffer(key: string) {
    const s = await this.get(key);
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(Buffer.from(c as Uint8Array));
    return Buffer.concat(chunks);
  }
  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
  localPath() {
    return null;
  }
  publicUrl(key: string) {
    return this.opts.publicBaseUrl ? `${this.opts.publicBaseUrl.replace(/\/$/, '')}/${key}` : null;
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (!instance) {
    instance = config.storage.driver === 's3' ? new S3Storage(config.storage.s3) : new LocalStorage(path.join(config.dataDir, 'files'));
  }
  return instance;
}

/** Copies a stored object to a local temp file when the backend is remote (renderer needs paths). */
export async function materialize(key: string, tmpDir: string): Promise<string> {
  const s = storage();
  const local = s.localPath(key);
  if (local) return local;
  const file = path.join(tmpDir, key.replace(/\//g, '_'));
  await fsp.mkdir(tmpDir, { recursive: true });
  await fsp.writeFile(file, await s.readBuffer(key));
  return file;
}
