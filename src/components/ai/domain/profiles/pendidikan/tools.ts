// Tool AI profil CS Lembaga Pendidikan: membaca profil lembaga, program, jadwal, kontak, dan dokumen, lalu
// memilih dokumen untuk dikirim. Tool ini membaca data profil saat dipanggil; tidak ada yang menulis.
import { db } from '../../../../../libraries/db.js';
import { ApiError } from '../../../../../libraries/errors.js';
import type { ToolContext } from '../../pipeline/runner.js';
import { EduProgram, EduContact, filename, EduStore } from './store.js';
import * as dataProfilesSql from '../../../data-access/data-profiles-queries.js';
export const eduToolNames = [
  'get_profil_lembaga',
  'get_program',
  'get_jadwal',
  'get_kontak',
  'get_dokumen',
  'kirim_dokumen',
] as const;
export type EduToolName = (typeof eduToolNames)[number];
export interface EduSnapshot {
  lembaga: string;
  faq: string;
  jadwal: string;
  programs: readonly Pick<EduProgram, 'name' | 'description'>[];
  contacts: readonly Omit<EduContact, 'id'>[];
  documents: readonly { id: string; filename: string; media_type: 'image' | 'document'; description: string }[];
}
const todayJakarta = () =>
  new Date().toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
// Dipakai runtime WhatsApp (data sungguhan) dan AI Studio (data simulasi), jadi keduanya menjawab dengan cara sama.
export function eduTool(name: EduToolName, query: string, data: EduSnapshot, sent: readonly string[] = []): unknown {
  const q = query.trim().toLowerCase();
  if (name === 'get_profil_lembaga')
    return { profil_lembaga: data.lembaga || '(belum diisi)', faq: data.faq || '(belum diisi)' };
  if (name === 'get_jadwal') return { hari_ini: todayJakarta(), jadwal: data.jadwal || '(belum diisi)' };
  if (name === 'get_kontak')
    return { kontak: data.contacts.map(c => ({ bagian: c.bagian, kontak: c.kontak, deskripsi: c.deskripsi })) };
  if (name === 'get_program') {
    // Daftar nama dan awal deskripsi menjaga hasil tetap ringkas; program yang disebut namanya mengembalikan
    // deskripsi lengkapnya.
    const matched = q
      ? data.programs.filter(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()))
      : [];
    if (matched.length)
      return { program: matched.slice(0, 3).map(p => ({ nama: p.name, deskripsi: p.description || '(belum diisi)' })) };
    return {
      daftar_program: data.programs.map(p => ({ nama: p.name, ringkasan: p.description.slice(0, 160) })),
      catatan: q
        ? 'Tidak ada program bernama "' + query.trim() + '". Pilih dari daftar_program.'
        : 'Panggil get_program dengan nama program untuk deskripsi lengkapnya.',
    };
  }
  if (name === 'get_dokumen')
    return {
      dokumen: data.documents.map(d => ({
        nama_file: d.filename,
        jenis: d.media_type === 'image' ? 'gambar' : 'dokumen',
        deskripsi: d.description,
        sudah_dikirim: sent.includes(d.filename),
      })),
    };
  const document = data.documents.find(d => d.filename === query.trim());
  if (!document)
    return { available: false, reason: 'Dokumen tidak ditemukan. Gunakan nama_file persis dari get_dokumen.' };
  if (sent.includes(document.filename))
    return {
      available: false,
      reason: 'Dokumen ini sudah dikirim dalam percakapan ini; rujuk dokumen yang sudah dikirim.',
    };
  return {
    available: true,
    nama_file: document.filename,
    document_id: document.id,
    jenis: document.media_type === 'image' ? 'gambar' : 'dokumen',
  };
}
export class EduData {
  constructor(public store = new EduStore()) {}
  async snapshot(account: string, profile: string): Promise<EduSnapshot> {
    const [rows] = await dataProfilesSql.findEduContent(db, [profile, account]);
    if (!rows[0]) throw new ApiError(409, 'profile_mismatch', 'Data profil CS Lembaga Pendidikan tidak ditemukan.');
    const [programs, contacts, documents] = await Promise.all([
      this.store.programs(account, profile),
      this.store.contacts(account, profile),
      this.store.documents(account, profile),
    ]);
    return {
      lembaga: String(rows[0].edu_lembaga ?? ''),
      jadwal: String(rows[0].edu_jadwal ?? ''),
      faq: String(rows[0].profil_faq ?? ''),
      programs,
      contacts,
      documents,
    };
  }
  async execute(name: EduToolName, query: string, scope: ToolContext) {
    return eduTool(name, query, await this.snapshot(scope.account, scope.profile), scope.sentDocuments);
  }
}
export const eduData = new EduData();
// Dokumen yang terkirim diingat di memori AI sebagai baris ini, supaya model melihatnya dan tool bisa menolak
// pengiriman ulang.
export const documentMarker = (filename: string) => '[Dokumen terkirim: ' + filename + ']';
export function sentDocuments(messages: readonly { role: string; content: string }[]) {
  return messages
    .filter(m => m.role === 'assistant')
    .map(m => /^\[Dokumen terkirim: (.+)\]$/.exec(m.content)?.[1])
    .filter((name): name is string => Boolean(name));
}
