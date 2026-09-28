// Data contoh koleksi untuk Uji di editor (khusus owner). "Buat data contoh" meminta penyedia AI NC-WA tier Murah
// membuat contoh untuk SEMUA koleksi sekaligus, supaya relasi antarkoleksi saling cocok. Setiap baris punya `_id`
// (misalnya `layanan_1`) dan field relasi berisi `_id` baris koleksi tujuan; simulasi menerjemahkannya ke ID record.
// Tidak ada yang disimpan di sini: editor memasukkan hasilnya ke draft seperti suntingan biasa.
import { ApiError } from '../../../../libraries/errors.js';
import { record } from '../../../../libraries/validation.js';
import type { AITransport } from '../provider.js';
import { tierConfig } from '../pipeline/models.js';
import { transientAIError } from '../pipeline/retry.js';
import { ai } from '../service.js';
import {
  collectionKind,
  parseDefinition,
  validateRecord,
  type Collection,
  type GraphDefinition,
} from './definition.js';

export const sampleIdKey = '_id';
const sampleIdPattern = /^[a-z][a-z0-9_]{0,40}$/;
const rowCount = (c: Collection) => (collectionKind(c) === 'list' ? 3 : 1);
// Koleksi tujuan relasi dibuat lebih dulu; relasi melingkar dibiarkan pada urutan aslinya.
export function sampleOrder(d: GraphDefinition): Collection[] {
  const done: Collection[] = [],
    visiting = new Set<string>();
  const visit = (c: Collection) => {
    if (done.includes(c) || visiting.has(c.id)) return;
    visiting.add(c.id);
    for (const f of c.fields.filter(f => f.type === 'relation')) {
      const target = d.collections.find(x => x.id === f.collection);
      if (target && target !== c) visit(target);
    }
    done.push(c);
  };
  d.collections.forEach(visit);
  return done;
}
// Satu baris contoh: kunci dikenal saja, relasi harus menunjuk `_id` baris contoh koleksi tujuan (ids), file berupa
// nama file contoh. Null bila baris tetap tidak valid.
export function cleanSample(
  c: Collection,
  value: unknown,
  ids: Record<string, string[]>,
  fallbackId: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (collectionKind(c) === 'text')
    return typeof row.text === 'string' && row.text.trim() ? { text: row.text.slice(0, 20000) } : null;
  const relations = c.fields.filter(f => f.type === 'relation');
  const plain = { ...c, fields: c.fields.filter(f => f.type !== 'relation') };
  const picked = Object.fromEntries(Object.entries(row).filter(([k]) => plain.fields.some(f => f.id === k)));
  let data: Record<string, unknown>;
  try {
    data = validateRecord(plain, picked);
  } catch {
    return null;
  }
  for (const f of relations) {
    const v = row[f.id];
    if (typeof v === 'string' && (ids[f.collection] ?? []).includes(v)) data[f.id] = v;
    else if (f.required) return null;
  }
  const own = typeof row[sampleIdKey] === 'string' && sampleIdPattern.test(row[sampleIdKey]) ? row[sampleIdKey] : '';
  return Object.keys(data).length ? { [sampleIdKey]: own || fallbackId, ...data } : null;
}
const fieldLine = (d: GraphDefinition, f: Collection['fields'][number]) =>
  '  - ' +
  f.id +
  ' (' +
  f.label +
  ', ' +
  f.type +
  (f.required ? ', wajib' : '') +
  (f.options.length ? ', pilihan: ' + f.options.join(' | ') : '') +
  (f.type === 'relation'
    ? ', isi dengan _id baris contoh koleksi ' + (d.collections.find(c => c.id === f.collection)?.id ?? f.collection)
    : '') +
  (f.type === 'file' ? ', isi nama file contoh seperti brosur.pdf' : '') +
  ')';
function sampleRequest(d: GraphDefinition, order: Collection[]) {
  const blocks = order.map(c => {
    const kind = collectionKind(c);
    return (
      '- ' +
      c.id +
      ' (' +
      c.name +
      '): ' +
      (kind === 'text'
        ? '1 baris {"text": "…"} berisi teks singkat (maksimal 600 karakter).'
        : rowCount(c) +
          ' baris; setiap baris punya "_id" unik (misalnya "' +
          c.id +
          '_1") dan field:\n' +
          c.fields.map(f => fieldLine(d, f)).join('\n'))
    );
  });
  return (
    'Buat data contoh minimal untuk menguji profil AI WhatsApp "' +
    d.name +
    '"' +
    (d.description ? ' (' + d.description + ')' : '') +
    '. Pakai data yang wajar untuk usaha di Indonesia dan saling cocok antarkoleksi.\n' +
    'Format nilai: number = angka, boolean = true/false, date = YYYY-MM-DD, time = JJ:MM, datetime = YYYY-MM-DDTJJ:MM, phone = 628…, multichoice = daftar pilihan.\n' +
    'Koleksi (urut; relasi menunjuk _id baris koleksi yang sudah dibuat di atasnya):\n' +
    blocks.join('\n') +
    '\nBalas hanya JSON: {"samples": {"<id koleksi>": [baris, ...]}}'
  );
}
export async function generateSamples(value: unknown, transport: AITransport = ai.transport) {
  const body = record(value),
    d = parseDefinition(body.definition);
  if (!d.collections.length) throw new ApiError(400, 'invalid_request', 'Belum ada koleksi untuk diberi data contoh.');
  const order = sampleOrder(d);
  const config = { ...tierConfig(await ai.config(), 'cheap'), call_role: 'builder_samples', max_tokens: 4000 };
  let raw = '';
  for (let attempt = 1; ; attempt++) {
    try {
      raw = await transport(
        config,
        [
          { role: 'system', content: 'Anda membuat data contoh untuk pengujian. Balas hanya satu objek JSON.' },
          { role: 'user', content: sampleRequest(d, order) },
        ],
        2000,
      );
      break;
    } catch (e) {
      if (attempt === 3 || !transientAIError(e)) throw e;
      await new Promise(r => setTimeout(r, attempt * 500));
    }
  }
  let answer: Record<string, unknown>;
  try {
    const source =
      /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1] ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    answer = record((JSON.parse(source) as { samples?: unknown }).samples);
  } catch {
    throw Error('ai_samples_invalid_json');
  }
  // Dibersihkan menurut urutan relasi, jadi relasi hanya boleh menunjuk baris yang lolos.
  const ids: Record<string, string[]> = {},
    samples: Record<string, Record<string, unknown>[]> = {};
  for (const c of order) {
    const rows: Record<string, unknown>[] = [];
    for (const v of Array.isArray(answer[c.id]) ? (answer[c.id] as unknown[]) : []) {
      if (rows.length >= rowCount(c)) break;
      const row = cleanSample(c, v, ids, c.id + '_' + (rows.length + 1));
      if (!row) continue;
      if (row[sampleIdKey] && rows.some(r => r[sampleIdKey] === row[sampleIdKey]))
        row[sampleIdKey] = c.id + '_' + (rows.length + 1);
      rows.push(row);
    }
    ids[c.id] = rows.map(r => String(r[sampleIdKey] ?? '')).filter(Boolean);
    if (rows.length) samples[c.id] = rows;
  }
  if (!Object.keys(samples).length) throw Error('ai_samples_invalid_json');
  return { samples };
}
