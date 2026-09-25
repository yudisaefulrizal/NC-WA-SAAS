import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {ApiError} from '../../../libraries/errors.js';
import {ShareMediaType,sniffMediaType} from '../../../libraries/media-type.js';

export interface AssetQuota { maxCount: number; maxBytes: number }

export class AssetStore {
  constructor(public root: string, private db: { execute: PoolConnection['execute']; getConnection: () => Promise<PoolConnection> }, private maxFileBytes = 32 * 1024 * 1024) {}
  private dir(accountId: string) { return join(this.root, accountId); }
  async save(accountId: string, filename: string, body: Readable, quota: AssetQuota) {
    // Temporary run assets carry a run_id and are excluded here, so a source-fed broadcast never
    // consumes the plan's gallery quota.
    const [[usage]] = await this.db.execute<RowDataPacket[]>('SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes),0) AS bytes FROM share_assets WHERE account_id=? AND run_id IS NULL', [accountId]);
    if (Number(usage.count) >= quota.maxCount) throw new ApiError(409, 'asset_limit_exceeded', 'Jumlah asset sudah mencapai batas paket');
    const remaining = quota.maxBytes - Number(usage.bytes);
    if (remaining <= 0) throw new ApiError(409, 'storage_limit_exceeded', 'Penyimpanan asset sudah mencapai batas paket');
    return this.write(accountId, filename, body, Math.min(this.maxFileBytes, remaining), null);
  }
  // Media pulled from a template source lives only for one run: no quota check, a tighter size cap,
  // and a run_id that keeps it out of the gallery and its usage totals.
  async saveTemporary(accountId: string, runId: string, filename: string, body: Readable, maxBytes: number) {
    return this.write(accountId, filename, body, Math.min(this.maxFileBytes, maxBytes), runId);
  }
  private async write(accountId: string, filename: string, body: Readable, maxBytes: number, runId: string | null) {
    const id = randomUUID();
    const dir = this.dir(accountId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = join(dir, `${id}.part`);
    let size = 0;
    let sniffed: ReturnType<typeof sniffMediaType> = null;
    let headBuffer = Buffer.alloc(0);
    const limit = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        size += chunk.length;
        if (size > maxBytes) { callback(new ApiError(413, 'asset_too_large', 'Ukuran file melebihi batas')); return; }
        if (headBuffer.length < 64) {
          headBuffer = Buffer.concat([headBuffer, chunk]).subarray(0, 64);
          if (!sniffed) sniffed = sniffMediaType(headBuffer, filename);
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(body, limit, createWriteStream(temporary, { mode: 0o600, flags: 'wx' }), { signal: AbortSignal.timeout(30_000) });
      if (!sniffed) sniffed = sniffMediaType(headBuffer, filename);
      if (!sniffed) throw new ApiError(400, 'unsupported_file_type', 'Jenis file tidak didukung');
      await rename(temporary, join(dir, id));
      await this.db.execute('INSERT INTO share_assets(id,account_id,filename,mimetype,media_type,size_bytes,run_id) VALUES (?,?,?,?,?,?,?)', [id, accountId, filename.slice(0, 255), sniffed.mimetype, sniffed.mediaType, size, runId]);
      return { id, filename: filename.slice(0, 255), mimetype: sniffed.mimetype, mediaType: sniffed.mediaType, sizeBytes: size };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, 'invalid_request', 'Gagal menyimpan asset');
    } finally {
      await rm(temporary, { force: true });
    }
  }
  path(accountId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404, 'asset_not_found', 'Asset tidak ditemukan');
    return join(this.dir(accountId), id);
  }
  async get(accountId: string, id: string) {
    const [rows] = await this.db.execute<RowDataPacket[]>('SELECT filename,mimetype,media_type,size_bytes FROM share_assets WHERE account_id=? AND id=?', [accountId, id]);
    if (!rows[0]) throw new ApiError(404, 'asset_not_found', 'Asset tidak ditemukan');
    const path = this.path(accountId, id);
    try { await stat(path); } catch { throw new ApiError(404, 'asset_not_found', 'Asset tidak ditemukan'); }
    return { path, filename: rows[0].filename as string, mimetype: rows[0].mimetype as string, mediaType: rows[0].media_type as ShareMediaType };
  }
  async remove(accountId: string, id: string) {
    await rm(this.path(accountId, id), { force: true });
  }
  // Drops every temporary asset of one run, file first so a failed DELETE never orphans bytes.
  async removeRunAssets(runId: string) {
    const [rows] = await this.db.execute<RowDataPacket[]>('SELECT id,account_id FROM share_assets WHERE run_id=?', [runId]);
    for (const row of rows) await this.remove(row.account_id as string, row.id as string).catch(() => {});
    if (rows.length) await this.db.execute('DELETE FROM share_assets WHERE run_id=?', [runId]);
    return rows.length;
  }
  // Safety net for a crash between saveTemporary and the run settling: anything whose run is gone
  // or no longer active can never be sent again, so its file is dead weight.
  async sweepTemporary() {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT a.id,a.account_id FROM share_assets a LEFT JOIN auto_share_runs r ON r.id=a.run_id WHERE a.run_id IS NOT NULL AND (r.id IS NULL OR r.status NOT IN ('queued','running'))");
    for (const row of rows) await this.remove(row.account_id as string, row.id as string).catch(() => {});
    if (rows.length) await this.db.execute('DELETE FROM share_assets WHERE id IN (' + rows.map(() => '?').join(',') + ')', rows.map(r => r.id));
    return rows.length;
  }
  // Enables/disables anonymous access to one asset via a random token distinct from its id,
  // so an id leaked elsewhere (logs, a template payload) never doubles as a public link.
  async setPublic(accountId: string, id: string, isPublic: boolean) {
    const [owned] = await this.db.execute<RowDataPacket[]>('SELECT id FROM share_assets WHERE account_id=? AND id=?', [accountId, id]);
    if (!owned.length) throw new ApiError(404, 'asset_not_found', 'Asset tidak ditemukan');
    if (!isPublic) { await this.db.execute('UPDATE share_assets SET public_token=NULL WHERE account_id=? AND id=?', [accountId, id]); return null; }
    const token = randomBytes(24).toString('base64url');
    await this.db.execute('UPDATE share_assets SET public_token=? WHERE account_id=? AND id=?', [token, accountId, id]);
    return token;
  }
  async getByToken(token: string) {
    if (!/^[\w-]{20,64}$/.test(token)) throw new ApiError(404, 'asset_not_found', 'Asset tidak ditemukan');
    const [rows] = await this.db.execute<RowDataPacket[]>('SELECT account_id,id,filename,mimetype FROM share_assets WHERE public_token=?', [token]);
    if (!rows[0]) throw new ApiError(404, 'asset_not_found', 'Asset tidak ditemukan');
    const path = this.path(rows[0].account_id, rows[0].id);
    try { await stat(path); } catch { throw new ApiError(404, 'asset_not_found', 'Asset tidak ditemukan'); }
    return { path, filename: rows[0].filename as string, mimetype: rows[0].mimetype as string };
  }
}
