// Menjalankan operasi node Data (Cari, Ambil, Buat, Ubah, Hapus, Hitung) terhadap penyimpanan record. Runtime memakai
// database, simulasi memakai memori; keduanya lewat adapter yang sama supaya bentuk keluarannya identik.
import { ApiError } from '../../../../libraries/errors.js';
import { record } from '../../../../libraries/validation.js';
import type { Collection, GraphDefinition, GraphNode, ToolOperation } from './definition.js';
import { filterGroup, filterOperators, sortSpec, type StoredRecord } from './record-query.js';
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
  const extra = input?.filter ?? input?.filters;
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
export async function runRecordTool(
  adapter: RecordAdapter,
  d: GraphDefinition,
  n: GraphNode,
  value: unknown,
  key: string,
) {
  const collection = d.collections.find(c => c.id === n.collection);
  if (!collection) throw new ApiError(404, 'collection_not_found', 'Koleksi tidak ditemukan.');
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
      return adapter.write(collection, n.operation, value, key);
  }
}
// Petunjuk untuk Agent tentang cara mengisi `query` per operasi, termasuk struktur koleksinya.
export function recordToolGuide(d: GraphDefinition, n: GraphNode) {
  const c = d.collections.find(c => c.id === n.collection);
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
  return {
    cara: how[n.operation],
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
