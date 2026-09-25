// Memvalidasi kiriman dashboard untuk kontak, template, dan jadwal, lalu membentuk baris untuk disimpan.
import { randomInt } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../../libraries/errors.js';
import { recipient } from '../../whatsapp/index.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { encrypt, decrypt } from '../../../libraries/crypto.js';
import { tidyNoteInput } from './tidy.js';
import { decodeHeaders, parsePlaceholders, sourceInput, type SourceHeaders } from './source.js';
export const invalid = (message: string) => new ApiError(400, 'invalid_request', message);
export function contactInput(body: unknown) {
  const input = object(body);
  const raw = typeof input.nomor === 'string' ? input.nomor.trim().replace(/@s\.whatsapp\.net$/, '') : input.nomor;
  const nomor = recipient(raw);
  const nama = input.nama ?? null;
  if (nama !== null && (typeof nama !== 'string' || nama.trim().length > 100))
    throw invalid('Nama kontak maksimal 100 karakter');
  const group = input.kelompkontak ?? '';
  if (typeof group !== 'string' || group.trim().length > 100) throw invalid('Kelompok kontak maksimal 100 karakter');
  return { nomor, nama: typeof nama === 'string' && nama.trim() ? nama.trim() : null, kelompkontak: group.trim() };
}
export function strings(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > 500 ||
    value.some(v => typeof v !== 'string' || !v.trim() || v.length > 100)
  )
    throw invalid('Daftar tujuan tidak valid (maksimal 500 pilihan)');
  return [...new Set(value.map(v => (v as string).trim()))];
}
export function templateInput(body: unknown) {
  const b = object(body),
    name = requiredString(b.name, 'Nama', 100);
  const type = b.media_type ?? 'text';
  if (typeof type !== 'string' || !['text', 'image', 'video', 'document', 'audio'].includes(type))
    throw invalid('Jenis template tidak valid');
  const message = type === 'text' ? requiredString(b.message, 'Pesan', 10000) : (b.message ?? '');
  if (typeof message !== 'string' || message.length > 10000) throw invalid('Caption maksimal 10000 karakter');
  if (type === 'audio' && message.trim())
    throw invalid('Audio tidak mendukung caption; gunakan template teks terpisah');
  const source = sourceInput(b);
  // Audio tidak punya caption, jadi nilai dari sumber tidak punya tempat untuk ditulis.
  if (source.mode === 'endpoint' && type === 'audio') throw invalid('Template audio tidak mendukung sumber data');
  if (source.media === 'endpoint' && type === 'text')
    throw invalid('Sumber media endpoint memerlukan template gambar, video, atau dokumen');
  const placeholders = parsePlaceholders(message);
  // Tanpa ini template diam-diam mengirim "{{jumlah}}" apa adanya.
  if (source.mode === 'none' && placeholders.length)
    throw invalid('Teks memakai {{' + placeholders[0] + '}}; pilih sumber data endpoint terlebih dahulu');
  const assetId = type !== 'text' && source.media === 'asset' ? requiredString(b.asset_id, 'Asset', 36) : null;
  if (b.tidy !== undefined && typeof b.tidy !== 'boolean') throw invalid('Pilihan rapikan otomatis tidak valid');
  const tidy = b.tidy === true;
  let tidyNote = '';
  try {
    tidyNote = tidyNoteInput(b.tidy_note);
  } catch {
    throw invalid('Catatan perapihan maksimal 500 karakter');
  }
  // Teks statis lebih murah dirapikan sekali secara manual daripada di setiap kirim, jadi perapian hanya
  // ditawarkan bila teks disusun baru setiap kali.
  if (tidy && source.mode !== 'endpoint')
    throw invalid('Rapikan otomatis hanya untuk template dengan sumber data endpoint');
  if (tidy && type === 'audio') throw invalid('Template audio tidak memiliki teks untuk dirapikan');
  return { name, message, type, assetId, source, tidy, tidyNote };
}
export function jobInput(body: unknown, now = Date.now()) {
  const b = object(body),
    name = requiredString(b.name, 'Nama', 100),
    session = requiredString(b.session_id, 'Sesi', 64);
  const contacts = strings(b.contacts ?? []),
    groups = strings(b.groups ?? []),
    templates = strings(b.template_ids ?? []);
  if (!templates.length) throw invalid('Pilih minimal satu template');
  if (!contacts.length && !groups.length) throw invalid('Pilih kontak atau kelompok tujuan');
  if (typeof b.enabled !== 'boolean') throw invalid('Status jadwal tidak valid');
  const interval = b.interval_minutes ?? 0;
  if (typeof interval !== 'number' || !Number.isSafeInteger(interval) || interval < 0 || interval > 525600)
    throw invalid('Interval harus 0 (sekali kirim) atau 1–525600 menit');
  if (b.next_at !== null && b.next_at !== undefined && typeof b.next_at !== 'string')
    throw invalid('Waktu jadwal tidak valid');
  const next = b.next_at ? new Date(b.next_at) : null;
  if (next && !Number.isFinite(next.getTime())) throw invalid('Waktu jadwal tidak valid');
  if (b.enabled && (!next || next.getTime() <= now)) throw invalid('Jadwal aktif harus memiliki waktu di masa depan');
  return { name, session, templates, contacts, groups, enabled: b.enabled, next, interval };
}
export const randomDelay = () => randomInt(1000, 3001);
export function nextSchedule(due: Date, minutes: number, now: Date) {
  if (!minutes) return null;
  const step = minutes * 60000;
  return new Date(due.getTime() + (Math.max(0, Math.floor((now.getTime() - due.getTime()) / step)) + 1) * step);
}
export const jsonArray = (v: unknown): string[] => (typeof v === 'string' ? JSON.parse(v) : (v as string[]));
// Header yang tersimpan dipertahankan bila endpoint tidak berubah dan tidak ada header baru; dibuang begitu
// endpoint berubah, supaya secret tidak pernah terkirim ke host yang bukan tujuannya.
export function secretFor(source: ReturnType<typeof sourceInput>, previous: Record<string, unknown> | null) {
  if (source.mode === 'none') return null;
  const kept =
    previous && previous.source_secret && previous.source_endpoint === source.endpoint
      ? (previous.source_secret as string)
      : null;
  if (source.headers === undefined) return kept;
  const stored = decodeHeaders(kept ? decrypt(kept) : '');
  // Nilai kosong berarti "pakai secret yang tersimpan untuk header ini", jadi tidak perlu diketik ulang.
  const merged: SourceHeaders = {};
  for (const [name, value] of Object.entries(source.headers)) merged[name] = value || stored[name] || '';
  const present = Object.entries(merged).filter(([, value]) => value);
  return present.length ? encrypt(JSON.stringify(Object.fromEntries(present))) : null;
}
export function expose(r: RowDataPacket) {
  return {
    ...r,
    contacts: jsonArray(r.contacts),
    groups: jsonArray(r.groups_json),
    enabled: !!r.enabled,
    template_ids: jsonArray(r.template_ids),
  };
}
