// Data CS Lembaga Pendidikan: program, kontak, dan dokumen sebuah data profil, beserta isinya untuk AI. Profil ini
// menjawab calon siswa, orang tua, dan siswa aktif dari tulisan lembaga, dan mengirim dokumennya. Profil ini tidak
// pernah mencatat data pribadi siapa pun; pendaftaran, tes, dan kunjungan mengikuti mekanisme yang ditulis lembaga.
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import type { PoolConnection } from 'mysql2/promise';
import { db } from '../../../../../libraries/db.js';
import { ApiError } from '../../../../../libraries/errors.js';
import { sniffMediaType } from '../../../../../libraries/media-type.js';
import { storagePaths } from '../../../../../libraries/storage.js';
import { eduLimits } from './profile.js';
import * as accountsSql from '../../../data-access/accounts-queries.js';
import * as dataProfilesSql from '../../../data-access/data-profiles-queries.js';
import * as eduContactsSql from '../../../data-access/edu-contacts-queries.js';
import * as eduDocumentsSql from '../../../data-access/edu-documents-queries.js';
import * as eduProgramsSql from '../../../data-access/edu-programs-queries.js';
const invalid = (message: string) => new ApiError(400, 'invalid_request', message);
const missing = (message = 'Data tidak ditemukan') => new ApiError(404, 'not_found', message);
function text(value: unknown, max: number, name: string, empty = true) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw invalid(name + ' tidak valid atau terlalu panjang');
  return value.trim();
}
function rowId(value: unknown, name: string) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) throw missing(name + ' tidak ditemukan');
  return value;
}
export interface EduProgram {
  id: string;
  name: string;
  description: string;
}
export interface EduContact {
  id: string;
  bagian: string;
  kontak: string;
  deskripsi: string;
}
export interface EduDocument {
  id: string;
  filename: string;
  mimetype: string;
  media_type: 'image' | 'document';
  size_bytes: number;
  description: string;
  created_at?: unknown;
}
export function programInput(value: unknown) {
  const p = value as Record<string, unknown>;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw invalid('Program wajib valid');
  return {
    name: text(p.name, eduLimits.programName, 'Nama program', false),
    description: text(p.description ?? '', eduLimits.programDescription, 'Deskripsi program'),
  };
}
export function contactInput(value: unknown) {
  const c = value as Record<string, unknown>;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw invalid('Kontak wajib valid');
  return {
    bagian: text(c.bagian, eduLimits.contactPart, 'Bagian', false),
    kontak: text(c.kontak, eduLimits.contact, 'Kontak', false),
    deskripsi: text(c.deskripsi ?? '', eduLimits.contactDescription, 'Deskripsi kontak'),
  };
}
export function documentDescription(value: unknown) {
  return text(value, eduLimits.documentDescription, 'Deskripsi dokumen', false);
}
// Gambar dan file PDF/Word/Excel/PowerPoint; file Office lama (.doc/.xls/.ppt) dikenali dari header OLE ditambah
// ekstensinya, karena wadah itu tidak menyimpan jenis file yang bisa dibaca.
const legacyOffice: Record<string, string> = {
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.ppt': 'application/vnd.ms-powerpoint',
};
export function documentType(head: Buffer, filename: string): { media_type: 'image' | 'document'; mimetype: string } {
  const sniffed = sniffMediaType(head, filename),
    extension = /\.[a-z0-9]+$/i.exec(filename)?.[0].toLowerCase() ?? '';
  if (sniffed?.mediaType === 'image') return { media_type: 'image', mimetype: sniffed.mimetype };
  if (
    sniffed?.mediaType === 'document' &&
    sniffed.mimetype !== 'application/zip' &&
    sniffed.mimetype !== 'application/octet-stream'
  )
    return { media_type: 'document', mimetype: sniffed.mimetype };
  if (
    head.length >= 8 &&
    head.readUInt32BE(0) === 0xd0cf11e0 &&
    head.readUInt32BE(4) === 0xa1b11ae1 &&
    legacyOffice[extension]
  )
    return { media_type: 'document', mimetype: legacyOffice[extension] };
  throw new ApiError(
    400,
    'unsupported_file_type',
    'Dokumen harus PDF, Word, Excel, PowerPoint, atau gambar JPG/PNG/WebP',
  );
}
export function filename(value: unknown) {
  const name = text(value, 255, 'Nama file', false).replace(/[\\/\0\r\n]/g, '_');
  return name;
}
export class EduStore {
  constructor(public root = storagePaths().aiDocuments) {}
  private dir(account: string) {
    return join(this.root, account);
  }
  path(account: string, id: string) {
    return join(this.dir(account), rowId(id, 'Dokumen'));
  }
  async programs(account: string, profile: string): Promise<EduProgram[]> {
    const [rows] = await eduProgramsSql.listByProfile(db, [account, profile]);
    return rows.map(r => ({ id: String(r.id), name: String(r.name), description: String(r.description) }));
  }
  async saveProgram(account: string, profile: string, id: string | null, value: unknown) {
    const input = programInput(value);
    return this.write(account, profile, async c => {
      const [taken] = await eduProgramsSql.findOtherWithName(c, [profile, input.name, ...(id ? [id] : [])], id);
      if (taken[0]) throw new ApiError(409, 'name_taken', 'Nama program sudah dipakai.');
      if (id) {
        const [result] = await eduProgramsSql.update(c, [
          input.name,
          input.description,
          rowId(id, 'Program'),
          account,
          profile,
        ]);
        if (!result.affectedRows) throw missing('Program tidak ditemukan');
        return { id, ...input };
      }
      const [count] = await eduProgramsSql.countAndLastPosition(c, [profile]);
      if (Number(count[0].n) >= eduLimits.programs)
        throw new ApiError(409, 'program_limit', 'Maksimal ' + eduLimits.programs + ' program per data profil.');
      const created = randomUUID();
      await eduProgramsSql.insert(c, [
        created,
        account,
        profile,
        input.name,
        input.description,
        Number(count[0].last) + 1,
      ]);
      return { id: created, ...input };
    });
  }
  async deleteProgram(account: string, profile: string, id: string) {
    return this.write(account, profile, async c => {
      const [result] = await eduProgramsSql.deleteOwned(c, [rowId(id, 'Program'), account, profile]);
      if (!result.affectedRows) throw missing('Program tidak ditemukan');
      return { ok: true };
    });
  }
  async contacts(account: string, profile: string): Promise<EduContact[]> {
    const [rows] = await eduContactsSql.listByProfile(db, [account, profile]);
    return rows.map(r => ({
      id: String(r.id),
      bagian: String(r.bagian),
      kontak: String(r.kontak),
      deskripsi: String(r.deskripsi),
    }));
  }
  async saveContact(account: string, profile: string, id: string | null, value: unknown) {
    const input = contactInput(value);
    return this.write(account, profile, async c => {
      if (id) {
        const [result] = await eduContactsSql.update(c, [
          input.bagian,
          input.kontak,
          input.deskripsi,
          rowId(id, 'Kontak'),
          account,
          profile,
        ]);
        if (!result.affectedRows) throw missing('Kontak tidak ditemukan');
        return { id, ...input };
      }
      const [count] = await eduContactsSql.countAndLastPosition(c, [profile]);
      if (Number(count[0].n) >= eduLimits.contacts)
        throw new ApiError(409, 'contact_limit', 'Maksimal ' + eduLimits.contacts + ' kontak per data profil.');
      const created = randomUUID();
      await eduContactsSql.insert(c, [
        created,
        account,
        profile,
        input.bagian,
        input.kontak,
        input.deskripsi,
        Number(count[0].last) + 1,
      ]);
      return { id: created, ...input };
    });
  }
  async deleteContact(account: string, profile: string, id: string) {
    return this.write(account, profile, async c => {
      const [result] = await eduContactsSql.deleteOwned(c, [rowId(id, 'Kontak'), account, profile]);
      if (!result.affectedRows) throw missing('Kontak tidak ditemukan');
      return { ok: true };
    });
  }
  async documents(account: string, profile: string): Promise<EduDocument[]> {
    const [rows] = await eduDocumentsSql.listByProfile(db, [account, profile]);
    return rows.map(r => ({
      id: String(r.id),
      filename: String(r.filename),
      mimetype: String(r.mimetype),
      media_type: r.media_type,
      size_bytes: Number(r.size_bytes),
      description: String(r.description),
      created_at: r.created_at,
    }));
  }
  // Unggahan dibaca ke memori (maksimal 10 MB), jenis aslinya diperiksa, lalu ditulis dengan id acak.
  private async receive(account: string, name: string, body: Readable) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += chunk.length;
      if (size > eduLimits.documentBytes)
        throw new ApiError(413, 'document_too_large', 'Ukuran dokumen melebihi 10 MB');
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);
    if (!content.length) throw invalid('File kosong');
    const type = documentType(content.subarray(0, 64), name);
    if (type.media_type === 'image' && content.length > eduLimits.imageBytes)
      throw new ApiError(413, 'document_too_large', 'Ukuran gambar melebihi 5 MB');
    const id = randomUUID(),
      dir = this.dir(account),
      temporary = join(dir, id + '.part');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await new Promise<void>((done, fail) => {
        const out = createWriteStream(temporary, { mode: 0o600, flags: 'wx' });
        out.on('error', fail);
        out.end(content, () => done());
      });
      await rename(temporary, join(dir, id));
    } finally {
      await rm(temporary, { force: true });
    }
    return { id, size: content.length, ...type };
  }
  private async quota(c: PoolConnection, profile: string, adding: number, replacing?: string) {
    const [rows] = await eduDocumentsSql.countUsage(c, [profile, ...(replacing ? [replacing] : [])], replacing);
    if (!replacing && Number(rows[0].n) >= eduLimits.documents)
      throw new ApiError(409, 'document_limit', 'Maksimal ' + eduLimits.documents + ' dokumen per data profil.');
    if (Number(rows[0].bytes) + adding > eduLimits.totalBytes)
      throw new ApiError(409, 'storage_limit_exceeded', 'Total dokumen per data profil maksimal 100 MB.');
    return Number(rows[0].last);
  }
  async saveDocument(account: string, profile: string, name: unknown, description: unknown, body: Readable) {
    const file = filename(name),
      about = documentDescription(description),
      stored = await this.receive(account, file, body);
    try {
      return await this.write(account, profile, async c => {
        const last = await this.quota(c, profile, stored.size);
        await eduDocumentsSql.insert(c, [
          stored.id,
          account,
          profile,
          file,
          stored.mimetype,
          stored.media_type,
          stored.size,
          about,
          last + 1,
        ]);
        return {
          id: stored.id,
          filename: file,
          mimetype: stored.mimetype,
          media_type: stored.media_type,
          size_bytes: stored.size,
          description: about,
        } as EduDocument;
      });
    } catch (error) {
      await rm(join(this.dir(account), stored.id), { force: true });
      throw error;
    }
  }
  // Ganti file: file baru mendapat id sendiri di disk; barisnya tetap memakai id lama supaya deskripsi dan rujukannya
  // tidak berubah.
  async replaceDocumentFile(account: string, profile: string, id: string, name: unknown, body: Readable) {
    const documentId = rowId(id, 'Dokumen'),
      file = filename(name),
      stored = await this.receive(account, file, body);
    let previous: string | undefined;
    try {
      const result = await this.write(account, profile, async c => {
        const [rows] = await eduDocumentsSql.lockFile(c, [documentId, account, profile]);
        if (!rows[0]) throw missing('Dokumen tidak ditemukan');
        previous = String(rows[0].file_id ?? documentId);
        await this.quota(c, profile, stored.size, documentId);
        await eduDocumentsSql.replaceFile(c, [
          stored.id,
          file,
          stored.mimetype,
          stored.media_type,
          stored.size,
          documentId,
        ]);
        return {
          id: documentId,
          filename: file,
          mimetype: stored.mimetype,
          media_type: stored.media_type,
          size_bytes: stored.size,
        };
      });
      if (previous) await rm(join(this.dir(account), previous), { force: true });
      return result;
    } catch (error) {
      await rm(join(this.dir(account), stored.id), { force: true });
      throw error;
    }
  }
  async describeDocument(account: string, profile: string, id: string, value: unknown) {
    const about = documentDescription((value as Record<string, unknown> | null)?.description);
    return this.write(account, profile, async c => {
      const [result] = await eduDocumentsSql.updateDescription(c, [about, rowId(id, 'Dokumen'), account, profile]);
      if (!result.affectedRows) throw missing('Dokumen tidak ditemukan');
      return { id, description: about };
    });
  }
  async deleteDocument(account: string, profile: string, id: string) {
    const file = await this.write(account, profile, async c => {
      const [rows] = await eduDocumentsSql.lockFile(c, [rowId(id, 'Dokumen'), account, profile]);
      if (!rows[0]) throw missing('Dokumen tidak ditemukan');
      await eduDocumentsSql.deleteById(c, [id]);
      return String(rows[0].file_id ?? id);
    });
    await rm(join(this.dir(account), file), { force: true });
    return { ok: true };
  }
  // File tersimpan sebuah dokumen, untuk pratinjau di dashboard dan dikirim lewat WhatsApp.
  async file(account: string, id: string, profile?: string) {
    const [rows] = await eduDocumentsSql.findOwned(
      db,
      [rowId(id, 'Dokumen'), account, ...(profile ? [profile] : [])],
      profile,
    );
    if (!rows[0]) throw missing('Dokumen tidak ditemukan');
    const path = join(this.dir(account), String(rows[0].file_id ?? rows[0].id));
    try {
      await stat(path);
    } catch {
      throw missing('Dokumen tidak ditemukan');
    }
    return {
      path,
      filename: String(rows[0].filename),
      mimetype: String(rows[0].mimetype),
      media_type: rows[0].media_type as 'image' | 'document',
    };
  }
  // Menggandakan data profil ikut menyalin program, kontak, dan dokumennya; setiap dokumen menjadi file sendiri.
  async copy(c: PoolConnection, account: string, from: string, to: string, copied: string[]) {
    await eduProgramsSql.copyToProfile(c, [to, account, from]);
    await eduContactsSql.copyToProfile(c, [to, account, from]);
    const [documents] = await eduDocumentsSql.listForCopy(c, [account, from]);
    for (const d of documents) {
      const id = randomUUID();
      await copyFile(join(this.dir(account), String(d.file_id ?? d.id)), join(this.dir(account), id));
      copied.push(id);
      await eduDocumentsSql.insert(c, [
        id,
        account,
        to,
        d.filename,
        d.mimetype,
        d.media_type,
        d.size_bytes,
        d.description,
        d.position,
      ]);
    }
  }
  async files(c: PoolConnection, account: string, profile: string) {
    const [rows] = await eduDocumentsSql.listFiles(c, [account, profile]);
    return rows.map(r => String(r.file));
  }
  async removeFiles(account: string, files: readonly string[]) {
    for (const file of files) await rm(join(this.dir(account), file), { force: true }).catch(() => {});
  }
  private async write<T>(account: string, profile: string, fn: (c: PoolConnection) => Promise<T>) {
    const c = await db.getConnection();
    try {
      await c.beginTransaction();
      const [owner] = await accountsSql.lockSuspended(c, [account]);
      if (!owner[0] || owner[0].suspended) throw new ApiError(403, 'account_unavailable', 'Akun tidak tersedia');
      const [rows] = await dataProfilesSql.lockType(c, [profile, account]);
      if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
      if (rows[0].profile_type !== 'pendidikan')
        throw new ApiError(409, 'profile_mismatch', 'Data ini hanya untuk profil CS Lembaga Pendidikan.');
      await dataProfilesSql.bumpRevision(c, [profile]);
      const result = await fn(c);
      await c.commit();
      return result;
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
}
