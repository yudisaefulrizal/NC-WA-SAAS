// File untuk field File/gambar koleksi profil: unggah dari dashboard, unduh, salin saat duplikasi, dan
// hapus saat record atau data profilnya dihapus. Batasnya sama dengan dokumen profil lain.
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PoolConnection } from 'mysql2/promise';
import { db } from '../../../../libraries/db.js';
import { ApiError } from '../../../../libraries/errors.js';
import { documentFileType } from '../../../../libraries/media-type.js';
import { storagePaths } from '../../../../libraries/storage.js';
import { transaction, lockAccount } from '../transaction.js';
import * as filesSql from '../../data-access/record-files-queries.js';

export const recordFileLimits = {
  imageBytes: 5 * 1024 * 1024,
  documentBytes: 10 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
} as const;
export interface RecordFile {
  id: string;
  filename: string;
  mimetype: string;
  media_type: 'image' | 'document';
  size_bytes: number;
}
const root = () => storagePaths().recordFiles;
const dir = (account: string) => join(root(), account);
const fileId = (v: string) => /^[0-9a-f-]{36}$/.test(v);
export const recordFile = (row: import('mysql2/promise').RowDataPacket): RecordFile => ({
  id: String(row.id),
  filename: String(row.filename),
  mimetype: String(row.mimetype),
  media_type: row.media_type,
  size_bytes: Number(row.size_bytes),
});
function filename(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 255)
    throw new ApiError(400, 'invalid_request', 'Nama file wajib diisi, maksimal 255 karakter.');
  return value.trim().replace(/[\\/\0\r\n]/g, '_');
}
// Unggahan baru belum menjadi milik record; baru terikat saat record disimpan dengan ID file ini.
export async function uploadRecordFile(account: string, profile: string, name: unknown, content: Buffer) {
  const file = filename(name);
  if (!content.length) throw new ApiError(400, 'invalid_request', 'File kosong');
  if (content.length > recordFileLimits.documentBytes)
    throw new ApiError(413, 'document_too_large', 'Ukuran file melebihi 10 MB');
  const type = documentFileType(content.subarray(0, 64), file);
  if (type.media_type === 'image' && content.length > recordFileLimits.imageBytes)
    throw new ApiError(413, 'document_too_large', 'Ukuran gambar melebihi 5 MB');
  await purgeStale(account);
  const id = randomUUID(),
    temporary = join(dir(account), id + '.part');
  await mkdir(dir(account), { recursive: true, mode: 0o700 });
  try {
    await new Promise<void>((done, fail) => {
      const out = createWriteStream(temporary, { mode: 0o600, flags: 'wx' });
      out.on('error', fail);
      out.end(content, () => done());
    });
    await rename(temporary, join(dir(account), id));
    await transaction(async c => {
      await lockAccount(c, account);
      const [usage] = await filesSql.sumBytes(c, [account, profile]);
      if (Number(usage[0].bytes) + content.length > recordFileLimits.totalBytes)
        throw new ApiError(409, 'storage_limit_exceeded', 'Total file per data profil maksimal 100 MB.');
      await filesSql.insert(c, [id, account, profile, null, file, type.mimetype, type.media_type, content.length]);
    });
  } catch (error) {
    await rm(join(dir(account), id), { force: true });
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return { id, filename: file, mimetype: type.mimetype, media_type: type.media_type, size_bytes: content.length };
}
// Metadata tanpa membuka file; dipakai node Kirim media untuk memastikan file milik data profil ini.
export async function recordFileInfo(account: string, profile: string, id: string) {
  if (!fileId(id)) return null;
  const [rows] = await filesSql.find(db, [account, profile, id]);
  return rows[0] ? recordFile(rows[0]) : null;
}
export async function recordFilePath(account: string, profile: string, id: string) {
  const missing = new ApiError(404, 'file_not_found', 'File tidak ditemukan.');
  if (!fileId(id)) throw missing;
  const [rows] = await filesSql.find(db, [account, profile, id]);
  if (!rows[0]) throw missing;
  const path = join(dir(account), id);
  try {
    await stat(path);
  } catch {
    throw missing;
  }
  return { path, ...recordFile(rows[0]) };
}
// Dipanggil di dalam transaksi tulis record: file harus milik data profil ini dan belum dipakai record lain.
export async function claimFiles(c: PoolConnection, account: string, profile: string, record: string, ids: string[]) {
  for (const id of ids) {
    const [rows] = fileId(id) ? await filesSql.lock(c, [account, profile, id]) : [[]];
    const row = rows[0];
    if (!row || (row.record_id && row.record_id !== record))
      throw new ApiError(400, 'invalid_file', 'File tidak ditemukan. Unggah ulang filenya.');
    await filesSql.attach(c, [record, account, profile, id]);
  }
}
// Melepas file record yang tidak dipakai lagi; mengembalikan ID yang filenya perlu dihapus setelah commit.
export async function releaseFiles(
  c: PoolConnection,
  account: string,
  profile: string,
  record: string,
  keep: string[],
) {
  const [rows] = await filesSql.listByRecord(c, [account, profile, record]);
  const removed = rows.map(r => String(r.id)).filter(id => !keep.includes(id));
  for (const id of removed) await filesSql.deleteById(c, [account, profile, id]);
  return removed;
}
export async function copyRecordFile(
  c: PoolConnection,
  account: string,
  from: string,
  to: string,
  record: string,
  id: string,
  copied: string[],
) {
  const [rows] = fileId(id) ? await filesSql.find(c, [account, from, id]) : [[]];
  if (!rows[0]) return id;
  const next = randomUUID();
  await copyFile(join(dir(account), id), join(dir(account), next));
  copied.push(next);
  await filesSql.insert(c, [
    next,
    account,
    to,
    record,
    rows[0].filename,
    rows[0].mimetype,
    rows[0].media_type,
    rows[0].size_bytes,
  ]);
  return next;
}
export async function profileFiles(c: PoolConnection, account: string, profile: string) {
  const [rows] = await filesSql.listByProfile(c, [account, profile]);
  return rows.map(r => String(r.id));
}
export async function removeRecordFiles(account: string, ids: readonly string[]) {
  for (const id of ids) await rm(join(dir(account), id), { force: true }).catch(() => {});
}
async function purgeStale(account: string) {
  const stale = await transaction(async c => {
    const [rows] = await filesSql.lockStalePending(c, [account]);
    if (rows.length) await filesSql.deleteStalePending(c, [account]);
    return rows.map(r => String(r.id));
  });
  await removeRecordFiles(account, stale);
}
