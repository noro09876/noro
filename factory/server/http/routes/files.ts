import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db/client';
import { AppError, notFound } from '../../lib/errors';
import { campaignZip, itemZip } from '../../services/export';
import { verifyMediaSig } from '../../services/media';
import { storage } from '../../storage';
import type { Asset } from '../../services/content';
import { idParam, requireUser, requireWs } from '../context';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'audio/wav': 'wav', 'text/vtt': 'vtt', 'application/x-subrip': 'srt' };

function disposition(name: string, inline: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Sends a stored file with HTTP Range support (video seeking). */
async function sendAsset(reply: FastifyReply, a: Asset, range: string | undefined, download: boolean) {
  reply.header('content-type', a.mime);
  reply.header('accept-ranges', 'bytes');
  reply.header('cache-control', 'private, max-age=3600');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('content-disposition', disposition(`${a.role ?? 'file'}.${EXT[a.mime] ?? 'bin'}`, !download));
  const local = storage().localPath(a.storageKey);
  const size = a.bytes;
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (local && m && size) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      reply.header('content-range', `bytes */${size}`);
      return reply.code(416).send();
    }
    reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1);
    return reply.send(fs.createReadStream(local, { start, end }));
  }
  if (size) reply.header('content-length', size);
  return reply.send(await storage().get(a.storageKey));
}

export async function fileRoutes(app: FastifyInstance) {
  /** Authenticated access: the user must be a member of the asset's workspace. */
  app.get('/api/assets/:id', async (req, reply) => {
    const user = requireUser(req);
    const [a] = await db.select().from(schema.assets).where(eq(schema.assets.id, idParam(req)));
    if (!a) throw notFound('Файл');
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, a.workspaceId), eq(schema.memberships.userId, user.id)));
    if (!m) throw notFound('Файл');
    return sendAsset(reply, a, req.headers.range, (req.query as { download?: string }).download === '1');
  });

  /** Signed, time-limited public links (for Meta/TikTok servers that pull media by URL). */
  app.get('/media/:id/:exp/:sig/:name', async (req, reply) => {
    const p = req.params as { id: string; exp: string; sig: string };
    if (!verifyMediaSig(p.id, Number(p.exp), p.sig)) throw new AppError(403, 'bad_signature', 'Ссылка недействительна или устарела');
    const [a] = await db.select().from(schema.assets).where(eq(schema.assets.id, p.id));
    if (!a) throw notFound('Файл');
    return sendAsset(reply, a, req.headers.range, false);
  });

  app.get('/api/ws/:ws/campaigns/:id/export', async (req, reply) => {
    const { ws } = await requireWs(req);
    const { stream, filename } = await campaignZip(idParam(req), ws.id);
    reply.header('content-type', 'application/zip').header('content-disposition', disposition(filename, false));
    return reply.send(stream);
  });

  app.get('/api/ws/:ws/items/:id/export', async (req, reply) => {
    const { ws } = await requireWs(req);
    const { stream, filename } = await itemZip(idParam(req), ws.id).catch(() => {
      throw notFound('Материал');
    });
    reply.header('content-type', 'application/zip').header('content-disposition', disposition(filename, false));
    return reply.send(stream);
  });
}
