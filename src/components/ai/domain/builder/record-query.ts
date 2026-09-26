// Kontrak pencarian record koleksi: filter per field, kata kunci, urutan, dan batas. Dipakai node Data, dashboard,
// dan simulasi; versi JavaScript di sini wajib bermakna sama dengan query SQL di graph-profiles-queries.ts.
import { ApiError } from '../../../../libraries/errors.js';
import type { Collection, Field } from './definition.js';

export const filterOperators = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater',
  'greater_equal',
  'less',
  'less_equal',
  'exists',
  'empty',
] as const;
export type FilterOperator = (typeof filterOperators)[number];
export interface RecordFilter {
  field: string;
  operator: FilterOperator;
  value: string;
}
export interface FilterGroup {
  match: 'all' | 'any';
  filters: RecordFilter[];
}
// Semua grup harus cocok; di dalam grup berlaku `match`. Tipe field ikut dikirim supaya SQL membandingkan angka
// sebagai angka dan teks tanpa membedakan huruf besar-kecil.
export interface RecordQuery {
  keywords: string[];
  groups: { match: 'all' | 'any'; filters: (RecordFilter & { type: Field['type'] })[] }[];
  sort: { field: string; type: Field['type'] | 'created_at'; direction: 'asc' | 'desc' };
  limit: number;
  offset: number;
  customer?: string;
}
export interface StoredRecord {
  id: string;
  data: Record<string, unknown>;
  revision: number;
  customer?: string | null;
  created_at?: string;
  updated_at?: string;
}
export const maxToolLimit = 100;
const bad = (message: string) => new ApiError(400, 'invalid_request', message);
// Kata kunci dipecah per kata; record cukup memuat salah satu kata dan diurutkan dari yang paling banyak cocok.
export function keywords(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string' || value.length > 1000) throw bad('Kata kunci maksimal 1000 karakter.');
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(word => word.length >= 2),
    ),
  ].slice(0, 8);
}
export function filterGroup(collection: Collection, value: unknown, match: unknown = 'all') {
  if (!Array.isArray(value) || value.length > 20) throw bad('Maksimal 20 filter.');
  if (match !== 'all' && match !== 'any') throw bad('Pilihan kecocokan filter tidak dikenal.');
  return {
    match: match as 'all' | 'any',
    filters: value.map(v => {
      if (!v || typeof v !== 'object') throw bad('Filter tidak valid.');
      const f = v as Record<string, unknown>;
      const field = collection.fields.find(x => x.id === f.field);
      if (!field) throw bad('Field filter tidak ada di koleksi ' + collection.name + '.');
      if (!filterOperators.includes(f.operator as FilterOperator)) throw bad('Operator filter tidak dikenal.');
      const raw = f.value ?? '';
      if (!['string', 'number', 'boolean'].includes(typeof raw) || String(raw).length > 2000)
        throw bad('Nilai filter tidak valid.');
      return { field: field.id, type: field.type, operator: f.operator as FilterOperator, value: String(raw) };
    }),
  };
}
export function sortSpec(collection: Collection, field: unknown, direction: unknown): RecordQuery['sort'] {
  const dir = direction === 'desc' ? 'desc' : 'asc';
  if (!field || field === 'created_at') return { field: 'created_at', type: 'created_at', direction: dir };
  const f = collection.fields.find(x => x.id === field);
  if (!f) throw bad('Field urutan tidak ada di koleksi ' + collection.name + '.');
  return { field: f.id, type: f.type, direction: dir };
}
const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)).toLowerCase();
const missing = (v: unknown) => v === undefined || v === null || v === '';
function compareFilter(value: unknown, f: RecordQuery['groups'][number]['filters'][number]): boolean {
  if (f.operator === 'empty') return missing(value);
  if (missing(value)) return false;
  if (f.operator === 'exists') return true;
  if (f.type === 'boolean') {
    if (!['equals', 'not_equals'].includes(f.operator)) return false;
    const want = ['true', 'ya', '1'].includes(f.value.trim().toLowerCase());
    return f.operator === 'equals' ? value === want : value !== want;
  }
  if (f.type === 'number' && !['contains', 'not_contains'].includes(f.operator)) {
    const a = Number(value),
      b = Number(f.value);
    if (!Number.isFinite(a) || f.value.trim() === '' || !Number.isFinite(b)) return false;
    return {
      equals: a === b,
      not_equals: a !== b,
      greater: a > b,
      greater_equal: a >= b,
      less: a < b,
      less_equal: a <= b,
    }[f.operator as 'equals']!;
  }
  const a = text(value),
    b = f.value.toLowerCase();
  switch (f.operator) {
    case 'equals':
      return a === b;
    case 'not_equals':
      return a !== b;
    case 'contains':
      return a.includes(b);
    case 'not_contains':
      return !a.includes(b);
    case 'greater':
      return a > b;
    case 'greater_equal':
      return a >= b;
    case 'less':
      return a < b;
    default:
      return a <= b;
  }
}
export function keywordScore(r: StoredRecord, words: string[]) {
  const haystack = JSON.stringify(Object.values(r.data)).toLowerCase();
  return words.filter(w => haystack.includes(w)).length;
}
// Padanan JavaScript dari searchRecords/countRecords di SQL, untuk simulasi tanpa database.
export function queryMemory(rows: StoredRecord[], q: RecordQuery) {
  const matched = rows
    .filter(r => q.customer === undefined || r.customer === q.customer)
    .filter(r =>
      q.groups.every(g =>
        g.match === 'all'
          ? g.filters.every(f => compareFilter(r.data[f.field], f))
          : !g.filters.length || g.filters.some(f => compareFilter(r.data[f.field], f)),
      ),
    )
    .map((r, index) => ({ r, index, score: q.keywords.length ? keywordScore(r, q.keywords) : 0 }))
    .filter(x => !q.keywords.length || x.score > 0);
  const key = (x: (typeof matched)[number]) =>
    q.sort.type === 'created_at' ? x.index : (x.r.data[q.sort.field] as string | number | undefined);
  matched.sort((x, y) => {
    if (x.score !== y.score) return y.score - x.score;
    const a = key(x),
      b = key(y);
    if (a === b) return x.r.id < y.r.id ? -1 : 1;
    // Nilai kosong selalu di akhir, sama seperti NULL pada urutan SQL naik.
    if (missing(a)) return 1;
    if (missing(b)) return -1;
    const order =
      q.sort.type === 'number' || q.sort.type === 'created_at'
        ? Number(a) - Number(b)
        : String(a).toLowerCase() < String(b).toLowerCase()
          ? -1
          : 1;
    return q.sort.direction === 'asc' ? order : -order;
  });
  return matched.map(x => x.r);
}
export function sumMemory(rows: StoredRecord[], field: string) {
  return rows.reduce((total, r) => total + (Number.isFinite(Number(r.data[field])) ? Number(r.data[field]) : 0), 0);
}
