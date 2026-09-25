// Foto produk CS Usaha di storage/files/product-images/<akun>/: diperiksa jenisnya, diubah ke JPEG dan
// diperkecil, serta disalin saat data profil digandakan.
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { db } from '../../../../../libraries/db.js';
import { ApiError } from '../../../../../libraries/errors.js';
import { sniffMediaType } from '../../../../../libraries/media-type.js';
import * as productImagesSql from '../../../data-access/product-images-queries.js';

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_WIDTH = 1920;

export class ProductImageStore {
  constructor(private root: string) {}
  private dir(accountId: string) {
    return join(this.root, accountId);
  }
  // Foto milik sebuah data profil; hanya produk di data profil itu yang boleh memakainya.
  async save(accountId: string, profile: string, filename: string, body: Readable) {
    const id = randomUUID();
    const dir = this.dir(accountId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = join(dir, `${id}.part`);
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      // Unggahan dibaca langsung (tanpa Transform menggantung di ujung pipeline): Transform tanpa tujuan tulis tidak
      // pernah kosong, jadi macet karena backpressure begitu data lewat beberapa KB dan baru terlihat sebagai batal
      // setelah 30 detik. Unggahan kecil saat tes muat di buffer-nya, itu sebabnya hanya foto besar yang gagal.
      for await (const chunk of body) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) throw new ApiError(413, 'image_too_large', 'Ukuran foto melebihi batas 12 MB');
        chunks.push(chunk);
      }
      const original = Buffer.concat(chunks);
      const sniffed = sniffMediaType(original.subarray(0, 64), filename);
      if (!sniffed || sniffed.mediaType !== 'image')
        throw new ApiError(400, 'unsupported_file_type', 'Foto harus berupa gambar (PNG/JPEG/WEBP)');
      // Diubah ke JPEG supaya semua foto tersimpan dalam format yang sama apa pun sumbernya, dan diperkecil supaya
      // unggahan besar tidak membebani penyimpanan atau pengiriman WhatsApp.
      const compressed = await sharp(original)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      await pipeline(Readable.from(compressed), createWriteStream(temporary, { mode: 0o600, flags: 'wx' }));
      await rename(temporary, join(dir, id));
      await productImagesSql.insert(db, [id, accountId, profile, compressed.length]);
      return { id, mimetype: 'image/jpeg', sizeBytes: compressed.length };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, 'invalid_request', 'Gagal menyimpan foto');
    } finally {
      await rm(temporary, { force: true });
    }
  }
  path(accountId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404, 'image_not_found', 'Foto tidak ditemukan');
    return join(this.dir(accountId), id);
  }
  async get(accountId: string, id: string) {
    const [rows] = await productImagesSql.findOwned(db, [accountId, id]);
    if (!rows[0]) throw new ApiError(404, 'image_not_found', 'Foto tidak ditemukan');
    const path = this.path(accountId, id);
    try {
      await stat(path);
    } catch {
      throw new ApiError(404, 'image_not_found', 'Foto tidak ditemukan');
    }
    return { path, mimetype: 'image/jpeg' };
  }
  // Salinan file untuk data profil yang digandakan; pemanggil mencatat id barunya di transaksinya sendiri.
  async copy(accountId: string, id: string) {
    const source = this.path(accountId, id),
      copy = randomUUID();
    await copyFile(source, join(this.dir(accountId), copy));
    return { id: copy, sizeBytes: (await stat(source)).size };
  }
  async removeFile(accountId: string, id: string) {
    await rm(this.path(accountId, id), { force: true });
  }
  async remove(accountId: string, id: string) {
    await rm(this.path(accountId, id), { force: true });
    await productImagesSql.deleteOwned(db, [accountId, id]);
  }
}
