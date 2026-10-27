// archiver 8 ships ESM classes without bundled types; only what the exporter uses.
declare module 'archiver' {
  import type { Readable, Transform } from 'node:stream';
  export class ZipArchive extends Transform {
    constructor(options?: { zlib?: { level?: number } });
    append(source: string | Buffer | Readable, data: { name: string; date?: Date }): this;
    file(filepath: string, data: { name: string }): this;
    finalize(): Promise<void>;
  }
}
