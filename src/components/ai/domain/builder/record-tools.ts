// Menjalankan node data terhadap penyimpanan record: Data tabel (Cari, Ambil, Buat, Ubah, Hapus, Hitung), Data teks
// (baca paragraf yang relevan dari satu teks), dan Data isian (baca/ubah satu isian). Teks dan isian disimpan sebagai
// satu record koleksinya. Runtime memakai database, simulasi memakai memori; keduanya lewat adapter yang sama supaya
// bentuk keluarannya identik.
import { ApiError } from '../../../../libraries/errors.js';
import { record } from '../../../../libraries/validation.js';
import {
  defaultTextChars,
  type Collection,
  type GraphDefinition,
  type GraphNode,
  type ToolOperation,
} from './definition.js';
import { filterGroup, filterOperators, keywords, sortSpec, type StoredRecord } from './record-query.js';
import type { RecordSearch } from './store.js';

export interface RecordAdapter {
  search(collection: Collection, search: RecordSearch): Promise<{ records: StoredRecord[]; has_more: boolean }>;
  count(collection: Collection, search: RecordSearch, sumField: string): Promise<{ count: number; total: number }>;
  get(collection: Collection, id: string): Promise<StoredRecord | null>;
  write(
    collection: Collection,
    operation: 'create' | 'update' | 'delete',
    value: unknown,
    key: string,
  ): Promise<unknown>;
}
export const defaultToolLimit = 10;
const bad = (message: string) => new ApiError(400, 'invalid_request', message);
// Nilai dari AI atau template yang maksudnya jelas dirapikan sebelum diperiksa: label field menjadi id, angka yang
// ditulis sebagai teks ("18.000", "Rp 25.000", "2,5"), ya/tidak, pilihan tanpa peduli huruf besar/kecil, teks tunggal
// untuk multi pilihan, jam "10.30", tanggal "03/10/2026", dan tanggal-jam dengan spasi. Nilai yang meragukan dibiarkan
// supaya pemeriksaan menolaknya dan AI memperbaikinya. Isian dashboard tidak lewat sini dan tetap ketat.
const fieldKey = (v: string) => v.toLowerCase().replace(/[\s_-]+/g, '');
export function fieldIdOf(collection: Collection, key: string) {
  if (collection.fields.some(f => f.id === key)) return key;
  return (
    collection.fields.find(f => fieldKey(f.label) === fieldKey(key) || fieldKey(f.id) === fieldKey(key))?.id ?? key
  );
}
function coerceNumber(v: string) {
  const s = v.replace(/^rp\.?\s*/i, '').replace(/\s/g, '');
  const normal = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)
    ? s.replace(/\./g, '').replace(',', '.')
    : /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)
      ? s.replace(/,/g, '')
      : /^-?\d+,\d+$/.test(s)
        ? s.replace(',', '.')
        : s;
  const n = /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN;
  return Number.isFinite(n) ? n : v;
}
function coerceValue(f: Collection['fields'][number], v: unknown): unknown {
  const option = (x: unknown) =>
    typeof x === 'string' ? (f.options.find(o => o.toLowerCase() === x.trim().toLowerCase()) ?? x) : x;
  if (typeof v !== 'string') {
    if (f.type === 'multichoice' && Array.isArray(v)) return v.map(option);
    return v;
  }
  const t = v.trim();
  switch (f.type) {
    case 'number':
      return coerceNumber(t);
    case 'boolean':
      return /^(true|ya|iya|yes|1)$/i.test(t) ? true : /^(false|tidak|no|0)$/i.test(t) ? false : v;
    case 'choice':
      return option(t);
    case 'multichoice':
      return t ? t.split(',').map(option) : [];
    case 'time': {
      const m = /^(\d{1,2})[.:](\d{2})$/.exec(t);
      return m ? m[1].padStart(2, '0') + ':' + m[2] : v;
    }
    case 'date': {
      const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
      return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : t;
    }
    case 'datetime':
      return t.replace(
        /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2})[.:](\d{2})$/,
        (_, d, h, mi) => d + 'T' + h.padStart(2, '0') + ':' + mi,
      );
    default:
      return v;
  }
}
export function coerceRecordData(collection: Collection, data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => {
      const id = fieldIdOf(collection, k),
        f = collection.fields.find(f => f.id === id);
      return [id, f && v !== null ? coerceValue(f, v) : v];
    }),
  );
}
// Nilai tulis { data } / { id, data } dengan data yang sudah dirapikan.
function coerceWrite(collection: Collection, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  return 'data' in v ? { ...v, data: coerceRecordData(collection, v.data) } : value;
}
function recordId(value: unknown) {
  const id = typeof value === 'string' ? value : value && typeof value === 'object' ? record(value).id : undefined;
  if (typeof id !== 'string' || !id.trim()) throw bad('ID record wajib diisi.');
  return id.trim();
}
// Agent boleh mengirim kata kunci saja, atau objek berisi kata kunci dan filter tambahan. Filter node selalu berlaku.
function search(collection: Collection, n: GraphNode, value: unknown): RecordSearch {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? record(value) : undefined;
  const keyword = input ? (input.kata_kunci ?? input.keyword ?? '') : (value ?? '');
  if (typeof keyword !== 'string') throw bad('Kata kunci harus teks.');
  const given = input?.filter ?? input?.filters;
  // Filter dari AI boleh memakai label field; diubah ke id sebelum diperiksa.
  const extra = Array.isArray(given)
    ? given.map(f =>
        f && typeof f === 'object' && typeof (f as { field?: unknown }).field === 'string'
          ? { ...f, field: fieldIdOf(collection, (f as { field: string }).field) }
          : f,
      )
    : given;
  return {
    keyword,
    groups: [
      ...(n.filters?.length ? [filterGroup(collection, n.filters, n.match ?? 'all')] : []),
      ...(extra !== undefined ? [filterGroup(collection, extra, 'all')] : []),
    ],
    sort: sortSpec(collection, n.sort_field, n.sort_direction),
    limit: n.limit ?? defaultToolLimit,
  };
}
// Satu-satunya record koleksi teks/isian, atau null bila akun belum mengisinya.
export async function singleRecord(adapter: RecordAdapter, collection: Collection) {
  const result = await adapter.search(collection, {
    keyword: '',
    groups: [],
    sort: { field: 'created_at', type: 'created_at', direction: 'asc' },
    limit: 1,
  });
  return result.records[0] ?? null;
}
// Teks panjang dipecah per paragraf; dengan kata kunci hanya paragraf yang memuatnya yang dikirim (urutan asli),
// tanpa kata kunci (atau tanpa paragraf yang cocok) teks dipotong di batas karakter. Hemat kata untuk SOP atau FAQ yang panjang.
export function textExcerpt(text: string, keyword: string, maxChars: number) {
  const words = keywords(keyword.slice(0, 1000));
  if (!words.length) return { text: text.slice(0, maxChars), found: Boolean(text.trim()) };
  const picked: string[] = [];
  let size = 0;
  for (const paragraph of text.split(/\n\s*\n/)) {
    const lower = paragraph.toLowerCase();
    if (!words.some(w => lower.includes(w))) continue;
    if (size + paragraph.length > maxChars) break;
    picked.push(paragraph.trim());
    size += paragraph.length + 2;
  }
  // Tidak ada paragraf yang cocok: kirim awal teks supaya model tetap punya gambaran umum, found=false.
  if (!picked.length) return { text: text.slice(0, maxChars), found: false };
  return { text: picked.join('\n\n'), found: true };
}
export async function runRecordTool(
  adapter: RecordAdapter,
  d: GraphDefinition,
  n: GraphNode,
  value: unknown,
  key: string,
) {
  const collection = d.collections.find(c => c.id === n.collection);
  if (!collection) throw new ApiError(404, 'collection_not_found', 'Koleksi tidak ditemukan.');
  if (n.type === 'data_text') {
    const row = await singleRecord(adapter, collection);
    const keyword = value && typeof value === 'object' ? record(value).kata_kunci : value;
    if (keyword !== undefined && keyword !== null && typeof keyword !== 'string') throw bad('Kata kunci harus teks.');
    return textExcerpt(String(row?.data.text ?? ''), keyword ?? '', n.max_chars ?? defaultTextChars);
  }
  if (n.type === 'data_form') {
    const row = await singleRecord(adapter, collection);
    if (n.operation !== 'update') return { data: row?.data ?? {}, found: Boolean(row) };
    const data = coerceRecordData(collection, record(value).data);
    const saved = row
      ? await adapter.write(collection, 'update', { id: row.id, data }, key)
      : await adapter.write(collection, 'create', { data }, key);
    const out = saved as { data?: unknown; error?: unknown };
    return out.error ? out : { data: out.data ?? data, found: true };
  }
  const found = (records: StoredRecord[], has_more = false) => ({
    records,
    count: records.length,
    first: records[0] ?? null,
    has_more,
  });
  switch (n.operation) {
    case 'search': {
      const result = await adapter.search(collection, search(collection, n, value));
      return found(result.records, result.has_more);
    }
    case 'get': {
      const row = await adapter.get(collection, recordId(value));
      return found(row ? [row] : []);
    }
    case 'count':
      return adapter.count(collection, { ...search(collection, n, value), limit: 1 }, n.sum_field ?? '');
    case 'delete':
      return adapter.write(collection, 'delete', { id: recordId(value) }, key);
    default:
      return adapter.write(collection, n.operation, coerceWrite(collection, value), key);
  }
}
// Petunjuk untuk Agent tentang cara mengisi `query` per operasi, termasuk struktur koleksinya.
// Contoh nilai per tipe field untuk petunjuk tool, supaya AI menulis tipe yang benar (angka tanpa tanda kutip, format
// tanggal/jam, pilihan persis, relasi dari hasil pencarian).
function exampleValue(d: GraphDefinition, f: Collection['fields'][number]): unknown {
  switch (f.type) {
    case 'number':
      return 150000;
    case 'boolean':
      return true;
    case 'date':
      return '2026-10-03';
    case 'time':
      return '09:30';
    case 'datetime':
      return '2026-10-03T09:30';
    case 'choice':
      return f.options[0] ?? '';
    case 'multichoice':
      return f.options.slice(0, 1);
    case 'phone':
      return '6281234567890';
    case 'relation':
      return (
        '<id record dari hasil tool ' + (d.collections.find(c => c.id === f.collection)?.name ?? f.collection) + '>'
      );
    case 'file':
      return '<id file>';
    default:
      return '…';
  }
}
const writeRules =
  'Pakai id field (bukan label). Angka tanpa tanda kutip, tanggal YYYY-MM-DD, jam JJ:MM, pilihan persis salah satu nilai pilihan. Relasi dan ID record harus diambil dari hasil tool pencarian, jangan dikarang. Bila hasil tool berisi error, perbaiki query lalu panggil lagi.';
export function recordToolGuide(d: GraphDefinition, n: GraphNode) {
  const c = d.collections.find(c => c.id === n.collection);
  if (n.type === 'data_text')
    return {
      cara: 'query berisi kata kunci topik yang dicari (boleh kosong); hasil {text, found} berisi paragraf teks yang relevan',
      koleksi: c && { id: c.id, nama: c.name, jenis: 'teks' },
    };
  if (n.type === 'data_form')
    return {
      cara:
        n.operation === 'update'
          ? 'query {"data":{field yang diubah}}; hasil {data}'
          : 'query kosong; hasil {data} berisi isian ' + (c?.name ?? ''),
      koleksi: c && {
        id: c.id,
        nama: c.name,
        jenis: 'isian',
        field: c.fields.map(f => ({ id: f.id, label: f.label, tipe: f.type })),
      },
    };
  const filter =
    '{"kata_kunci":"teks","filter":[{"field":"id_field","operator":"' + filterOperators.join('|') + '","value":"…"}]}';
  const how: Record<ToolOperation, string> = {
    search: 'query berisi kata kunci, atau ' + filter,
    count: 'query berisi kata kunci, atau ' + filter + '; hasil {count,total}',
    get: 'query berisi ID record',
    create: 'query {"data":{field:nilai}}',
    update: 'query {"id":"ID record","data":{field yang diubah}}; nilai null mengosongkan field',
    delete: 'query berisi ID record',
  };
  const writes = ['create', 'update'].includes(n.operation) && c;
  const sample = writes
    ? Object.fromEntries(
        c.fields
          .filter(f => n.operation === 'update' || f.required || c.fields.length <= 4)
          .slice(0, 6)
          .map(f => [f.id, exampleValue(d, f)]),
      )
    : undefined;
  return {
    cara: how[n.operation],
    ...(writes
      ? {
          contoh:
            n.operation === 'update' ? { id: '<id record dari hasil pencarian>', data: sample } : { data: sample },
          aturan: writeRules,
        }
      : {
          aturan:
            'Pakai id field (bukan label) pada filter. Bila hasil tool berisi error, perbaiki query lalu panggil lagi.',
        }),
    koleksi: c && {
      id: c.id,
      nama: c.name,
      milik_pelanggan: c.owner === 'customer',
      field: c.fields.map(f => ({
        id: f.id,
        label: f.label,
        tipe: f.type,
        wajib: f.required,
        ...(f.options.length ? { pilihan: f.options } : {}),
      })),
    },
  };
}
