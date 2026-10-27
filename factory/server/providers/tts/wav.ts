import { spawn } from 'node:child_process';

/** Duration of a PCM WAV buffer from its header (fmt + data chunks). */
export function wavDurationMs(buf: Buffer): number {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return 0;
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') {
      const dataSize = Math.min(size, buf.length - off - 8);
      return byteRate ? Math.round((dataSize / byteRate) * 1000) : 0;
    }
    off += 8 + size + (size % 2);
  }
  return 0;
}

/** Duration of any media file via ffprobe (MP3, MP4 …). */
export function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve(0));
    p.on('close', () => resolve(Math.round((parseFloat(out) || 0) * 1000)));
  });
}
