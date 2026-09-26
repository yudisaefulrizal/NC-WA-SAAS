// Penyimpanan profil graf dan data koleksi; publikasi memakai revisi dan operasi tulis memakai kunci idempotensi.
import { randomUUID, createHash } from 'node:crypto';
import { db } from '../../../../libraries/db.js';
import { ApiError } from '../../../../libraries/errors.js';
import { record } from '../../../../libraries/validation.js';
import { transaction, lockAccount } from '../transaction.js';
import * as sql from '../../data-access/graph-profiles-queries.js';
import * as typesSql from '../../data-access/profile-types-queries.js';
import * as auditSql from '../../data-access/audit-events-queries.js';
import {
  parseDefinition,
  assertRunnable,
  validateGraph,
  validateRecord,
  blankDefinition,
  type Collection,
  type GraphDefinition,
} from './definition.js';
import { keywords, filterGroup, type RecordQuery, type StoredRecord } from './record-query.js';
import * as filesSql from '../../data-access/record-files-queries.js';
import * as sourcesSql from '../../data-access/collection-sources-queries.js';
import {
  claimFiles,
  releaseFiles,
  copyRecordFile,
  removeRecordFiles,
  recordFile,
  type RecordFile,
} from './record-files.js';
const decode = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
// Pelanggan yang sedang chat, diisi runtime dari sesi WhatsApp. Tanpa viewer berarti pemilik akun di dashboard.
export interface RecordViewer {
  customer: string;
}
export interface RecordSearch {
  keyword?: unknown;
  groups?: RecordQuery['groups'];
  sort?: RecordQuery['sort'];
  limit?: number;
  offset?: number;
}
export interface WriteOptions {
  // Node Data: data yang dikirim digabung ke record lama dan revisi terbaru dibaca sendiri.
  merge?: boolean;
}
const customerNumber = (v: unknown) => {
  if (typeof v !== 'string' || !/^[0-9]{5,20}$/.test(v))
    throw new ApiError(400, 'invalid_customer', 'Nomor pelanggan wajib diisi, 5–20 digit.');
  return v;
};
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : undefined);
function stored(row: import('mysql2/promise').RowDataPacket): StoredRecord {
  return {
    id: String(row.id),
    data: decode(row.data),
    revision: Number(row.revision),
    ...(row.customer ? { customer: String(row.customer) } : {}),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}
// Koleksi milik pelanggan selalu dibatasi ke pelanggan yang sedang chat; dashboard boleh memfilter pelanggan.
function ownerScope(schema: Collection, viewer: RecordViewer | undefined, filter?: string) {
  if (schema.owner !== 'customer') return undefined;
  if (viewer) return customerNumber(viewer.customer);
  return filter ? customerNumber(filter) : undefined;
}
export async function listGraphs() {
  const [rows] = await sql.list(db);
  return rows.map(row => ({
    id: String(row.id),
    draft: parseDefinition(decode(row.draft)),
    active: row.active ? parseDefinition(decode(row.active)) : null,
    revision: Number(row.revision),
    published_revision: Number(row.published_revision),
  }));
}
export async function findGraph(id: string) {
  const [rows] = await sql.find(db, [id]);
  const row = rows[0];
  return row
    ? {
        id,
        draft: parseDefinition(decode(row.draft)),
        active: row.active ? parseDefinition(decode(row.active)) : null,
        revision: Number(row.revision),
        published_revision: Number(row.published_revision),
      }
    : null;
}
export async function graphState(id: string) {
  const s = await findGraph(id);
  if (!s) throw new ApiError(404, 'profile_not_found', 'Profil tidak ditemukan.');
  return { ...s, issues: validateGraph(s.draft) };
}
export async function createGraph(actor: string, value: unknown) {
  const d = parseDefinition(value),
    id = 'g_' + randomUUID().replaceAll('-', '').slice(0, 28);
  await transaction(async c => {
    await sql.insert(c, [id, JSON.stringify(d)]);
    await typesSql.upsert(c, [id, false]);
    await auditSql.insert(c, [actor, 'graph_created:' + id]);
  });
  return graphState(id);
}
export async function saveGraph(actor: string, id: string, body: unknown, publish = false) {
  const input = record(body),
    d = publish ? undefined : parseDefinition(input.definition);
  await transaction(async c => {
    const [rows] = await sql.lock(c, [id]);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'profile_not_found', 'Profil tidak ditemukan.');
    if (input.revision !== Number(row.revision))
      throw new ApiError(409, 'workflow_conflict', 'Draft berubah. Muat ulang sebelum menyimpan.');
    if (publish) {
      const next = parseDefinition(decode(row.draft));
      assertRunnable(next);
      let cursor = '';
      const seen = new Set<string>();
      for (;;) {
        const [records] = await sql.recordsByType(c, [id, cursor]);
        for (const r of records) {
          const schema = next.collections.find(s => s.id === r.collection_id);
          if (!schema)
            throw new ApiError(
              409,
              'schema_conflict',
              'Koleksi masih berisi data. Kosongkan data atau pertahankan definisinya.',
            );
          if ((schema.owner === 'customer') !== Boolean(r.customer))
            throw new ApiError(
              409,
              'schema_conflict',
              'Kepemilikan koleksi ' +
                schema.name +
                ' tidak bisa diubah selama masih berisi data. Kosongkan koleksi sebelum menerbitkan.',
            );
          try {
            validateRecord(schema, decode(r.data));
          } catch {
            throw new ApiError(
              409,
              'schema_conflict',
              'Struktur baru tidak cocok dengan data tersimpan pada koleksi ' +
                schema.name +
                '. Migrasikan data sebelum menerbitkan.',
            );
          }
          const data = decode(r.data);
          for (const f of schema.fields.filter(f => f.unique && data[f.id] !== undefined)) {
            const v = data[f.id],
              key = [r.data_profile_id, r.collection_id, f.id, typeof v === 'string' ? v.toLowerCase() : String(v)];
            if (seen.has(JSON.stringify(key)))
              throw new ApiError(
                409,
                'schema_conflict',
                'Field ' + f.label + ' tidak bisa dibuat unik karena data tersimpan memuat nilai kembar.',
              );
            seen.add(JSON.stringify(key));
          }
          for (const f of schema.fields.filter(f => f.type === 'file' && data[f.id] !== undefined)) {
            const [file] = fileIdPattern(String(data[f.id]))
              ? await filesSql.find(c, [String(r.account_id), String(r.data_profile_id), String(data[f.id])])
              : [[]];
            if (!file[0])
              throw new ApiError(
                409,
                'schema_conflict',
                'Field ' + f.label + ' tidak bisa menjadi File karena data tersimpan bukan file yang diunggah.',
              );
          }
          for (const f of schema.fields.filter(f => f.type === 'relation'))
            if (data[f.id]) {
              const [target] = await sql.record(c, [
                String(r.account_id),
                String(r.data_profile_id),
                f.collection,
                String(data[f.id]),
              ]);
              if (!target[0])
                throw new ApiError(
                  409,
                  'schema_conflict',
                  'Relasi pada struktur baru tidak cocok dengan record yang tersimpan.',
                );
            }
        }
        if (records.length < 500) break;
        cursor = String(records.at(-1)!.id);
      }
      await sql.insertVersion(c, [id, Number(row.revision), JSON.stringify(next)]);
      await sql.publish(c, [id]);
    } else await sql.update(c, [JSON.stringify(d), id]);
    await auditSql.insert(c, [actor, (publish ? 'graph_published:' : 'graph_saved:') + id]);
  });
  return graphState(id);
}
export async function recordDefinition(account: string, profile: string) {
  const [rows] = await sql.ownedProfile(db, [account, profile]);
  if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan.');
  const graph = await findGraph(String(rows[0].profile_type));
  if (!graph?.active) throw new ApiError(409, 'profile_not_published', 'Profil belum diterbitkan.');
  return graph.active;
}
async function collectionOf(account: string, profile: string, collection: string) {
  const d = await recordDefinition(account, profile);
  const schema = d.collections.find(c => c.id === collection);
  if (!schema) throw new ApiError(404, 'collection_not_found', 'Koleksi tidak ditemukan.');
  return schema;
}
function recordQuery(schema: Collection, search: RecordSearch, customer: string | undefined): RecordQuery {
  const limit = search.limit ?? 100,
    offset = search.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
    throw new ApiError(400, 'invalid_request', 'Pencarian tidak valid.');
  return {
    keywords: keywords(search.keyword ?? ''),
    groups: search.groups ?? [],
    sort: search.sort ?? {
      field: 'created_at',
      type: 'created_at',
      direction: schema.owner === 'customer' ? 'desc' : 'asc',
    },
    limit,
    offset,
    ...(customer !== undefined ? { customer } : {}),
  };
}
// Dashboard: 100 record per halaman, dengan filter pelanggan untuk koleksi milik pelanggan.
export async function readRecords(
  account: string,
  profile: string,
  collection: string,
  query = '',
  page = 0,
  customer?: string,
) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000 || query.length > 1000)
    throw new ApiError(400, 'invalid_request', 'Pencarian tidak valid.');
  const result = await queryRecords(
    account,
    profile,
    collection,
    { keyword: query, offset: page * 100 },
    undefined,
    customer,
  );
  // Nama file untuk field File/gambar supaya dashboard bisa menampilkan tautannya.
  const schema = await collectionOf(account, profile, collection);
  const ids = result.records.flatMap(r =>
    schema.fields.filter(f => f.type === 'file' && typeof r.data[f.id] === 'string').map(f => String(r.data[f.id])),
  );
  const [rows] = await filesSql.listByIds(db, account, profile, [...new Set(ids)].filter(fileIdPattern));
  const files: Record<string, RecordFile> = Object.fromEntries(rows.map(r => [String(r.id), recordFile(r)]));
  return { ...result, files };
}
const fileIdPattern = (v: string) => /^[0-9a-f-]{36}$/.test(v);
const fileValues = (schema: Collection, data: Record<string, unknown>) =>
  schema.fields.filter(f => f.type === 'file' && typeof data[f.id] === 'string').map(f => String(data[f.id]));
// Field unik dibandingkan dengan aturan "sama dengan" pencarian, di seluruh record koleksi pada data profil ini.
async function assertUnique(
  c: import('mysql2/promise').PoolConnection,
  scope: string[],
  schema: Collection,
  data: Record<string, unknown>,
  self: string,
) {
  for (const f of schema.fields.filter(f => f.unique && data[f.id] !== undefined)) {
    const group = filterGroup(schema, [{ field: f.id, operator: 'equals', value: String(data[f.id]) }]);
    const [rows] = await sql.searchRecords(c, scope, {
      keywords: [],
      groups: [group],
      sort: { field: 'created_at', type: 'created_at', direction: 'asc' },
      limit: 2,
      offset: 0,
    });
    if (rows.some(r => String(r.id) !== self))
      throw new ApiError(409, 'duplicate_value', f.label + ' "' + String(data[f.id]) + '" sudah dipakai record lain.');
  }
}
export async function queryRecords(
  account: string,
  profile: string,
  collection: string,
  search: RecordSearch,
  viewer?: RecordViewer,
  customer?: string,
) {
  const schema = await collectionOf(account, profile, collection);
  const q = recordQuery(schema, search, ownerScope(schema, viewer, customer));
  const [rows] = await sql.searchRecords(db, [account, profile, collection], q);
  return { records: rows.slice(0, q.limit).map(stored), has_more: rows.length > q.limit };
}
export async function countCollection(
  account: string,
  profile: string,
  collection: string,
  search: RecordSearch,
  sumField: string,
  viewer?: RecordViewer,
) {
  const schema = await collectionOf(account, profile, collection);
  const q = recordQuery(schema, search, ownerScope(schema, viewer));
  const [rows] = await sql.countRecords(db, [account, profile, collection], q, sumField);
  return { count: Number(rows[0].n), total: Number(rows[0].total ?? 0) };
}
export async function getRecord(
  account: string,
  profile: string,
  collection: string,
  id: string,
  viewer?: RecordViewer,
) {
  const schema = await collectionOf(account, profile, collection);
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [rows] = await sql.findRecord(db, [account, profile, collection, id]);
  const row = rows[0];
  const customer = ownerScope(schema, viewer);
  return row && (customer === undefined || row.customer === customer) ? stored(row) : null;
}
export async function writeRecord(
  account: string,
  profile: string,
  collection: string,
  operation: 'create' | 'update' | 'delete',
  value: unknown,
  requestKey?: string,
  expected?: GraphDefinition,
  viewer?: RecordViewer,
  options: WriteOptions = {},
) {
  const input = record(value);
  const id = operation === 'create' ? randomUUID() : String(input.id);
  const key = requestKey ? createHash('sha256').update(requestKey).digest('hex') : null;
  let removedFiles: string[] = [];
  // Koleksi yang diganti API dikelola di sistem klien; dashboard tidak menulis ke tabel aplikasinya.
  if (!viewer) {
    const [api] = await sourcesSql.find(db, [account, profile, collection]);
    if (api[0])
      throw new ApiError(409, 'collection_uses_api', 'Koleksi ini memakai API sendiri. Kelola datanya di sistem Anda.');
  }
  const result = await transaction(async c => {
    await lockAccount(c, account);
    const [graphs] = await sql.shareOwnedGraph(c, [account, profile]);
    if (!graphs[0]?.active) throw new ApiError(404, 'data_profile_not_found', 'Data profil aktif tidak ditemukan.');
    const d = parseDefinition(decode(graphs[0].active)),
      schema = d.collections.find(c => c.id === collection);
    if (!schema) throw new ApiError(404, 'collection_not_found', 'Koleksi tidak ditemukan.');
    if (expected && JSON.stringify(expected.collections) !== JSON.stringify(d.collections))
      throw new ApiError(409, 'schema_conflict', 'Struktur data berubah saat eksekusi. Jalankan ulang.');
    if (key) {
      const [cached] = await sql.mutation(c, [account, profile, key]);
      if (cached[0]) return decode(cached[0].result);
    }
    const scoped = ownerScope(schema, viewer);
    let data: Record<string, unknown> = {},
      customer: string | null = null,
      revision = 1;
    if (operation === 'create') {
      data = validateRecord(schema, input.data, true);
      if (schema.owner === 'customer') customer = scoped ?? customerNumber(input.customer);
    } else {
      const [existing] = await sql.record(c, [account, profile, collection, id]);
      const row = existing[0];
      if (!row || (scoped !== undefined && row.customer !== scoped))
        throw new ApiError(404, 'record_not_found', 'Record tidak ditemukan.');
      if ((input.revision !== undefined || !options.merge) && input.revision !== row.revision)
        throw new ApiError(409, 'record_conflict', 'Record berubah; muat ulang.');
      customer = row.customer ? String(row.customer) : null;
      revision = Number(row.revision) + 1;
      if (operation === 'update') {
        const next = options.merge ? { ...decode(row.data) } : {};
        for (const [field, v] of Object.entries(record(input.data)))
          if (v === null || v === '') delete next[field];
          else next[field] = v;
        data = validateRecord(schema, next);
      }
    }
    // Mengunci akun juga menserialkan pemeriksaan relasi dan penghapusan pada data profil yang sama.
    for (const f of schema.fields.filter(f => f.type === 'relation'))
      if (data[f.id]) {
        const [target] = await sql.record(c, [account, profile, f.collection, String(data[f.id])]);
        const owned = d.collections.find(x => x.id === f.collection)?.owner === 'customer';
        if (!target[0] || (owned && target[0].customer !== customer))
          throw new ApiError(400, 'invalid_relation', 'Record relasi tidak ditemukan.');
      }
    if (operation !== 'delete') await assertUnique(c, [account, profile, collection], schema, data, id);
    const files = fileValues(schema, data);
    if (operation !== 'create') removedFiles = await releaseFiles(c, account, profile, id, files);
    if (operation === 'delete') {
      const [records] = await sql.allRecords(c, [account, profile]);
      for (const r of records) {
        const s = d.collections.find(c => c.id === r.collection_id);
        const v = decode(r.data);
        if (s?.fields.some(f => f.type === 'relation' && f.collection === collection && v[f.id] === id))
          throw new ApiError(409, 'record_in_use', 'Record masih dipakai oleh relasi.');
      }
      await sql.deleteRecord(c, [account, profile, collection, id]);
    } else if (operation === 'create')
      await sql.insertRecord(c, [id, account, profile, collection, JSON.stringify(data), customer]);
    else await sql.updateRecord(c, [JSON.stringify(data), account, profile, collection, id]);
    await claimFiles(c, account, profile, id, files);
    const result = {
      id,
      data,
      revision,
      deleted: operation === 'delete',
      ...(customer ? { customer } : {}),
    };
    if (key) await sql.insertMutation(c, [account, profile, key, JSON.stringify(result)]);
    return result;
  });
  await removeRecordFiles(account, removedFiles);
  return result;
}
export { blankDefinition };

export async function versions(id: string) {
  await graphState(id);
  const [rows] = await sql.listVersions(db, [id]);
  return rows;
}
export async function version(id: string, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new ApiError(400, 'invalid_revision', 'Versi tidak valid.');
  const [rows] = await sql.findVersion(db, [id, revision]);
  if (!rows[0]) throw new ApiError(404, 'version_not_found', 'Versi tidak ditemukan.');
  return parseDefinition(decode(rows[0].definition));
}
// Record milik pelanggan hanya ikut bila klien memilihnya saat menduplikasi data profil.
export async function copyGraphRecords(
  c: import('mysql2/promise').PoolConnection,
  account: string,
  source: string,
  target: string,
  includeCustomer = false,
  copiedFiles: string[] = [],
) {
  const [graphs] = await sql.shareOwnedGraph(c, [account, source]);
  if (!graphs[0]?.active) return;
  const d = parseDefinition(decode(graphs[0].active));
  const [all] = await sql.allRecords(c, [account, source]);
  const rows = all.filter(
    r => includeCustomer || d.collections.find(s => s.id === r.collection_id)?.owner !== 'customer',
  );
  const ids = new Map(rows.map(r => [String(r.id), randomUUID()]));
  for (const r of rows) {
    const data = decode(r.data),
      schema = d.collections.find(s => s.id === r.collection_id);
    for (const f of schema?.fields ?? [])
      if (f.type === 'relation' && data[f.id]) data[f.id] = ids.get(data[f.id]) ?? data[f.id];
      else if (f.type === 'file' && typeof data[f.id] === 'string')
        data[f.id] = await copyRecordFile(c, account, source, target, ids.get(String(r.id))!, data[f.id], copiedFiles);
    await sql.insertRecord(c, [
      ids.get(String(r.id))!,
      account,
      target,
      String(r.collection_id),
      JSON.stringify(data),
      r.customer ? String(r.customer) : null,
    ]);
  }
}

export async function deleteGraph(actor: string, id: string, value: unknown) {
  const input = record(value);
  await transaction(async c => {
    const [rows] = await sql.lock(c, [id]);
    if (!rows[0]) throw new ApiError(404, 'profile_not_found', 'Profil tidak ditemukan.');
    if (input.revision !== Number(rows[0].revision))
      throw new ApiError(409, 'workflow_conflict', 'Draft berubah. Muat ulang sebelum menghapus.');
    const [used] = await sql.countProfileUse(c, [id]);
    if (Number(used[0].n))
      throw new ApiError(
        409,
        'profile_in_use',
        'Profil masih dipakai data akun. Nonaktifkan melalui dashboard atau lepaskan data profil terkait dahulu.',
      );
    await sql.deleteGraph(c, [id]);
    await sql.deleteProfileType(c, [id]);
    await auditSql.insert(c, [actor, 'graph_deleted:' + id]);
  });
  return { deleted: true };
}
export async function requireAvailableGraph(c: import('mysql2/promise').PoolConnection, id: string) {
  if (!id.startsWith('g_')) return;
  const [rows] = await sql.shareAvailable(c, [id]);
  if (!rows[0]) throw new ApiError(409, 'profile_disabled', 'Profil tidak tersedia.');
}
