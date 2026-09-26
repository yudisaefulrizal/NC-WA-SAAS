// Node Ekstrak: meminta model mengubah pesan pelanggan menjadi field terstruktur, lalu menormalkan hasilnya. Nilai
// yang tidak sesuai tipe atau pilihan dianggap tidak disebut (null), dan field wajib yang kosong masuk `missing`.
import type { ExtractField } from './definition.js';
import { normalizePhone, validTime } from './definition.js';
import { systemVariables } from './conditions.js';

const formats: Record<ExtractField['type'], string> = {
  text: 'teks',
  number: 'angka',
  boolean: 'true/false',
  date: 'YYYY-MM-DD',
  time: 'JJ:MM 24 jam',
  datetime: 'YYYY-MM-DDTJJ:MM',
  choice: 'salah satu pilihan',
  multichoice: 'daftar pilihan',
  phone: 'nomor telepon',
};
export function extractInstruction(fields: ExtractField[], extra: string, now = new Date()) {
  const wib = systemVariables(now);
  return (
    (extra.trim() ? extra.trim() + '\n' : '') +
    'Tugas: ambil nilai dari percakapan pelanggan sesuai daftar field. Hari ini ' +
    wib.weekday +
    ', ' +
    wib.today +
    ', pukul ' +
    wib.time +
    ' WIB; ubah tanggal relatif seperti "besok" atau "Senin depan" menjadi tanggal pasti.\n' +
    'Isi null bila pelanggan tidak menyebutkannya atau belum jelas. Jangan menebak dan jangan memakai contoh.\n' +
    'Field: ' +
    JSON.stringify(
      fields.map(f => ({
        id: f.id,
        label: f.label,
        format: formats[f.type],
        wajib: f.required,
        ...(f.hint ? { petunjuk: f.hint } : {}),
        ...(f.options.length ? { pilihan: f.options } : {}),
      })),
    ) +
    '\nBalas hanya satu objek JSON dengan kunci persis id field.'
  );
}
export function extractFormat(fields: ExtractField[]) {
  const property = (f: ExtractField) =>
    f.type === 'number'
      ? { type: ['number', 'null'] }
      : f.type === 'boolean'
        ? { type: ['boolean', 'null'] }
        : f.type === 'choice'
          ? { type: ['string', 'null'], enum: [...f.options, null] }
          : f.type === 'multichoice'
            ? { type: ['array', 'null'], items: { type: 'string', enum: f.options } }
            : { type: ['string', 'null'] };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'ekstrak',
      strict: true,
      schema: {
        type: 'object',
        properties: Object.fromEntries(fields.map(f => [f.id, property(f)])),
        required: fields.map(f => f.id),
        additionalProperties: false,
      },
    },
  };
}
function coerce(f: ExtractField, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  const option = (x: unknown) =>
    typeof x === 'string' ? (f.options.find(o => o.toLowerCase() === x.trim().toLowerCase()) ?? null) : null;
  switch (f.type) {
    case 'text':
      return typeof v === 'string' ? v.trim().slice(0, 2000) || null : typeof v === 'number' ? String(v) : null;
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string' && ['ya', 'true', 'iya'].includes(v.trim().toLowerCase())) return true;
      if (typeof v === 'string' && ['tidak', 'false', 'bukan'].includes(v.trim().toLowerCase())) return false;
      return null;
    case 'date': {
      const d = typeof v === 'string' ? v.trim().slice(0, 10) : '';
      const time = Date.parse(d + 'T00:00:00Z');
      return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === d
        ? d
        : null;
    }
    case 'time': {
      const m = typeof v === 'string' ? v.trim().match(/^(\d{1,2})[.:](\d{2})$/) : null;
      const t = m ? m[1].padStart(2, '0') + ':' + m[2] : '';
      return validTime(t) ? t : null;
    }
    case 'datetime': {
      const m = typeof v === 'string' ? v.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2})[.:](\d{2})/) : null;
      if (!m) return null;
      const date = coerce({ ...f, type: 'date' }, m[1]),
        time = coerce({ ...f, type: 'time' }, m[2] + ':' + m[3]);
      return date && time ? date + 'T' + time : null;
    }
    case 'choice':
      return option(v);
    case 'multichoice': {
      const list = Array.isArray(v) ? [...new Set(v.map(option).filter(x => x !== null))] : [];
      return list.length ? list : null;
    }
    case 'phone':
      return typeof v === 'string' || typeof v === 'number' ? normalizePhone(String(v)) : null;
  }
}
export function parseExtraction(fields: ExtractField[], raw: string) {
  const value = JSON.parse(
    raw
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, ''),
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('ai_invalid_structure');
  const result: Record<string, unknown> = {};
  for (const f of fields) result[f.id] = coerce(f, (value as Record<string, unknown>)[f.id]);
  return { ...result, missing: fields.filter(f => f.required && result[f.id] === null).map(f => f.id) };
}
