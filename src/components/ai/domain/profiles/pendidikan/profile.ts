// Bidang teks dan batas ukuran data profil CS Lembaga Pendidikan.
import type { RowDataPacket } from 'mysql2/promise';
import { documentDescription } from './store.js';

export const eduLimits = {
  lembaga: 4000,
  jadwal: 8000,
  faq: 4000,
  programs: 50,
  programName: 150,
  programDescription: 4000,
  contacts: 30,
  contactPart: 100,
  contact: 150,
  contactDescription: 300,
  documents: 20,
  documentDescription: 300,
  imageBytes: 5 * 1024 * 1024,
  documentBytes: 10 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
} as const;
// Bidang teks data profil CS Lembaga Pendidikan, disimpan di ai_data_profiles; FAQ memakai profil_faq seperti CS.
export const eduTextFields = {
  edu_lembaga: { column: 'edu_lembaga', max: eduLimits.lembaga, label: 'Profil lembaga' },
  edu_jadwal: { column: 'edu_jadwal', max: eduLimits.jadwal, label: 'Jadwal' },
} as const;
export function eduView(row: RowDataPacket) {
  return { lembaga: String(row.edu_lembaga ?? ''), jadwal: String(row.edu_jadwal ?? '') };
}
// Keterangan tentang lembaga yang diberikan ke router dan specialist; sisanya ada di teks-teksnya sendiri.
export function eduIdentity(name: string) {
  return `Anda melayani lembaga pendidikan "${name}".`;
}
