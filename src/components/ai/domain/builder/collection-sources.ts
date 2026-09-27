// Sumber data per koleksi: tabel aplikasi (bawaan) atau API milik klien. Bila API, semua operasi node Data untuk
// koleksi itu dikirim ke API (action, collection, query, context), lalu hasilnya diperiksa terhadap struktur koleksi
// sebelum dipakai alur.
import type { PoolConnection } from 'mysql2/promise';
import { db } from '../../../../libraries/db.js';
import { encrypt } from '../../../../libraries/crypto.js';
import { digest } from '../../../../libraries/security.js';
import { record } from '../../../../libraries/validation.js';
import { ApiError } from '../../../../libraries/errors.js';
import { transaction, lockAccount } from '../transaction.js';
import { builtinSource, callEndpoint, sourceInput, type DataSource, type EndpointTransport } from '../endpoint.js';
import * as sourcesSql from '../../data-access/collection-sources-queries.js';
import { recordDefinition, type RecordSearch } from './store.js';
import { fieldValue, validateRecord, type Collection } from './definition.js';
import type { RecordAdapter } from './record-tools.js';
import type { StoredRecord } from './record-query.js';
import type { ToolContext } from '../pipeline/scope.js';

export const collectionResponseBytes = 64000;
let transport: EndpointTransport = callEndpoint;
// Tes mengganti pemanggil HTTPS; mengembalikan pemanggil sebelumnya supaya bisa dipulihkan.
export function useCollectionTransport(next: EndpointTransport) {
  const previous = transport;
  transport = next;
  return previous;
}
export async function collectionSource(account: string, profile: string, collection: string): Promise<DataSource> {
  const [rows] = await sourcesSql.find(db, [account, profile, collection]);
  return rows[0]
    ? { mode: 'endpoint', endpoint: String(rows[0].endpoint), secret: String(rows[0].secret) }
    : builtinSource;
}
export async function listCollectionSources(account: string, profile: string) {
  const d = await recordDefinition(account, profile);
  const [rows] = await sourcesSql.listByProfile(db, [account, profile]);
  return d.collections.map(c => {
    const row = rows.find(r => r.collection_id === c.id);
    return {
      collection: c.id,
      mode: row ? ('endpoint' as const) : ('builtin' as const),
      endpoint: row ? String(row.endpoint) : '',
      has_token: Boolean(row?.secret),
    };
  });
}
// Token lama tetap dipakai bila URL sama dan token tidak diisi ulang.
export async function saveCollectionSource(account: string, profile: string, collection: string, body: unknown) {
  const d = await recordDefinition(account, profile);
  if (!d.collections.some(c => c.id === collection))
    throw new ApiError(404, 'collection_not_found', 'Koleksi tidak ditemukan.');
  const input = await sourceInput(body);
  await transaction(async c => {
    await lockAccount(c, account);
    if (input.mode === 'builtin') {
      await sourcesSql.deleteOne(c, [account, profile, collection]);
      return;
    }
    const [rows] = await sourcesSql.find(c, [account, profile, collection]);
    const secret = input.clear_token
      ? ''
      : input.token
        ? encrypt(input.token)
        : rows[0]?.endpoint === input.endpoint
          ? String(rows[0].secret)
          : '';
    await sourcesSql.upsert(c, [account, profile, collection, input.endpoint, secret]);
  });
  return (await listCollectionSources(account, profile)).find(s => s.collection === collection)!;
}
export async function copyCollectionSources(c: PoolConnection, account: string, from: string, to: string) {
  await sourcesSql.copyToProfile(c, [to, account, from]);
}
// Uji dari dashboard: Cari tanpa kata kunci, tanpa pelanggan, 10 record pertama.
export async function testCollectionSource(account: string, profile: string, collection: string) {
  const d = await recordDefinition(account, profile);
  const c = d.collections.find(c => c.id === collection);
  const source = await collectionSource(account, profile, collection);
  if (!c || source.mode !== 'endpoint')
    throw new ApiError(409, 'collection_not_api', 'Koleksi ini memakai tabel aplikasi.');
  const context = { account, profile, session: '', customer: '', requestId: 'test_' + Date.now() };
  return remoteRecords(source, context).search(c, { keyword: '', groups: [], limit: 10 });
}
// Membungkus adapter tabel aplikasi: koleksi yang diganti API diteruskan ke adapter API.
export function sourcedRecords(local: RecordAdapter, scope: ToolContext): RecordAdapter {
  const pick = async (c: Collection) => {
    const source = await collectionSource(scope.account, scope.profile, c.id);
    return source.mode === 'endpoint' ? remoteRecords(source, scope) : local;
  };
  return {
    search: async (c, s) => (await pick(c)).search(c, s),
    count: async (c, s, sum) => (await pick(c)).count(c, s, sum),
    get: async (c, id) => (await pick(c)).get(c, id),
    write: async (c, operation, value, key) => (await pick(c)).write(c, operation, value, key),
  };
}
const endpointError = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  return Error(
    code.startsWith('endpoint_http_')
      ? 'ai_endpoint_http_error'
      : ['endpoint_invalid_json', 'endpoint_response_limit'].includes(code)
        ? 'ai_' + code
        : 'ai_endpoint_failed',
  );
};
// Isi record dari API: field tak dikenal dibuang, nilai yang ada harus sesuai tipe. Field wajib tidak dipaksakan
// saat membaca karena sistem klien yang memegang datanya.
function clean(c: Collection, value: unknown) {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!data) throw Error('ai_endpoint_invalid_record');
  const result: Record<string, unknown> = {};
  for (const f of c.fields) {
    const v = data[f.id];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    try {
      result[f.id] = fieldValue(f, v);
    } catch {
      throw Error('ai_endpoint_invalid_record');
    }
  }
  return result;
}
function stored(c: Collection, value: unknown): StoredRecord {
  const r = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (typeof r.id !== 'string' || !r.id.trim() || r.id.length > 100) throw Error('ai_endpoint_invalid_record');
  return {
    id: r.id,
    data: clean(c, r.data),
    revision: Number.isSafeInteger(r.revision) ? Number(r.revision) : 1,
    ...(typeof r.customer === 'string' && r.customer ? { customer: r.customer } : {}),
  };
}
function remoteRecords(source: DataSource, scope: ToolContext): RecordAdapter {
  const call = async (c: Collection, action: string, query: unknown, key: string) => {
    try {
      return record(
        await transport(
          source,
          {
            action,
            collection: {
              id: c.id,
              name: c.name,
              milik_pelanggan: c.owner === 'customer',
              fields: c.fields.map(f => ({
                id: f.id,
                label: f.label,
                type: f.type,
                required: f.required,
                options: f.options,
              })),
            },
            query,
            context: {
              account_id: scope.account,
              data_profile_id: scope.profile,
              session_id: scope.session || null,
              customer: scope.customer || null,
              request_id: scope.requestId,
            },
          },
          digest(JSON.stringify([scope.account, scope.profile, c.id, action, key])),
          collectionResponseBytes,
        ),
      );
    } catch (error) {
      throw endpointError(error);
    }
  };
  // Koleksi milik pelanggan: record yang jelas milik nomor lain tidak pernah diteruskan ke alur. Uji dari dashboard
  // (tanpa pelanggan) melihat semuanya.
  const visible = (c: Collection, rows: StoredRecord[]) =>
    rows.filter(r => c.owner !== 'customer' || !scope.customer || !r.customer || r.customer === scope.customer);
  const list = (c: Collection, value: Record<string, unknown>, limit: number) => {
    if (!Array.isArray(value.records)) throw Error('ai_endpoint_invalid_record');
    return {
      records: visible(
        c,
        value.records.map(r => stored(c, r)),
      ).slice(0, limit),
      has_more: value.has_more === true || value.records.length > limit,
    };
  };
  const query = (s: RecordSearch) => ({
    keyword: typeof s.keyword === 'string' ? s.keyword : '',
    filters: (s.groups ?? []).map(g => ({
      match: g.match,
      conditions: g.filters.map(f => ({ field: f.field, operator: f.operator, value: f.value })),
    })),
    sort: s.sort ? { field: s.sort.field, direction: s.sort.direction } : null,
    limit: s.limit ?? 100,
  });
  return {
    search: async (c, s) => list(c, await call(c, 'search', query(s), JSON.stringify(query(s))), s.limit ?? 100),
    count: async (c, s, sum) => {
      const r = await call(c, 'count', { ...query(s), sum_field: sum || null }, JSON.stringify([query(s), sum]));
      if (!Number.isSafeInteger(r.count) || Number(r.count) < 0) throw Error('ai_endpoint_invalid_record');
      return { count: Number(r.count), total: Number.isFinite(Number(r.total)) ? Number(r.total) : 0 };
    },
    get: async (c, id) => list(c, await call(c, 'get', { id }, id), 1).records[0] ?? null,
    write: async (c, operation, value, key) => {
      const input = record(value);
      if (operation === 'delete') {
        await call(c, 'delete', { id: String(input.id) }, key);
        return { id: String(input.id), data: {}, revision: 0, deleted: true };
      }
      // Data yang dikirim sudah diperiksa dan diberi nilai bawaan, sama seperti ke tabel aplikasi.
      const data =
        operation === 'create'
          ? validateRecord(c, input.data, true)
          : Object.fromEntries(
              Object.entries(record(input.data)).map(([k, v]) => {
                const f = c.fields.find(f => f.id === k);
                if (!f) throw Error('ai_endpoint_invalid_record');
                return [k, v === null || v === '' ? null : fieldValue(f, v)];
              }),
            );
      const r = await call(c, operation, operation === 'create' ? { data } : { id: String(input.id), data }, key);
      return { ...stored(c, r), deleted: false };
    },
  };
}
