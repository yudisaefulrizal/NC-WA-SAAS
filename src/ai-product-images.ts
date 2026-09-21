import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir, rename, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';
import {db} from './db.js';
import {ApiError} from './engine/sessions.js';
import {sniffMediaType} from './engine/assets.js';

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_WIDTH = 1920;

export class ProductImageStore {
 constructor(private root: string) {}
 private dir(accountId: string) { return join(this.root, accountId); }
 async save(accountId: string, session: string, filename: string, body: Readable) {
  const id = randomUUID();
  const dir = this.dir(accountId);
  await mkdir(dir, {recursive: true, mode: 0o700});
  const temporary = join(dir, `${id}.part`);
  try {
   let size = 0;
   const chunks: Buffer[] = [];
   // Read the upload directly (no dangling Transform as the pipeline's tail): a Transform with
   // no writable destination never drains, so it stalls under backpressure on anything past a
   // few KB and only surfaces as a 30s abort -- small test uploads happened to fit its internal
   // buffer and never hit that path, which is why only large photos appeared to fail.
   for await (const chunk of body) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) throw new ApiError(413, 'image_too_large', 'Ukuran foto melebihi batas 12 MB');
    chunks.push(chunk);
   }
   const original = Buffer.concat(chunks);
   const sniffed = sniffMediaType(original.subarray(0, 64), filename);
   if (!sniffed || sniffed.mediaType !== 'image') throw new ApiError(400, 'unsupported_file_type', 'Foto harus berupa gambar (PNG/JPEG/WEBP)');
   // Re-encode to JPEG so every stored photo is a flat, predictable format regardless of the source,
   // and downscale so oversized uploads never bloat storage or WhatsApp delivery.
   const compressed = await sharp(original).rotate().resize({width: MAX_WIDTH, withoutEnlargement: true}).jpeg({quality: 82}).toBuffer();
   await pipeline(Readable.from(compressed), createWriteStream(temporary, {mode: 0o600, flags: 'wx'}));
   await rename(temporary, join(dir, id));
   await db.execute('INSERT INTO ai_product_images(id,account_id,session_id,size_bytes) VALUES (?,?,?,?)', [id, accountId, session, compressed.length]);
   return {id, mimetype: 'image/jpeg', sizeBytes: compressed.length};
  } catch (error) {
   if (error instanceof ApiError) throw error;
   throw new ApiError(400, 'invalid_request', 'Gagal menyimpan foto');
  } finally {
   await rm(temporary, {force: true});
  }
 }
 path(accountId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404, 'image_not_found', 'Foto tidak ditemukan');
  return join(this.dir(accountId), id);
 }
 async get(accountId: string, id: string) {
  const [rows] = await db.execute<any[]>('SELECT id FROM ai_product_images WHERE account_id=? AND id=?', [accountId, id]);
  if (!rows[0]) throw new ApiError(404, 'image_not_found', 'Foto tidak ditemukan');
  const path = this.path(accountId, id);
  try { await stat(path); } catch { throw new ApiError(404, 'image_not_found', 'Foto tidak ditemukan'); }
  return {path, mimetype: 'image/jpeg'};
 }
 async remove(accountId: string, id: string) {
  await rm(this.path(accountId, id), {force: true});
  await db.execute('DELETE FROM ai_product_images WHERE account_id=? AND id=?', [accountId, id]);
 }
}
