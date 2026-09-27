// Profil graf dan record dinamis; semua query data klien dibatasi akun serta data profil.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
import type { RecordQuery, RecordFilter } from '../domain/builder/record-query.js';
export function list(c: Executor) {
  return c.query<RowDataPacket[]>(
    'SELECT id,draft,active,revision,published_revision FROM ai_graph_profiles ORDER BY created_at',
  );
}
export function find(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_graph_profiles WHERE id=?', p);
}
export function lock(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_graph_profiles WHERE id=? FOR UPDATE', p);
}
export function insert(c: Executor, p: SqlValue[]) {
  return c.execute('INSERT INTO ai_graph_profiles(id,draft) VALUES (?,?)', p);
}
export function update(c: Executor, p: SqlValue[]) {
  return c.execute('UPDATE ai_graph_profiles SET draft=?,revision=revision+1 WHERE id=?', p);
}
export function publish(c: Executor, p: SqlValue[]) {
  return c.execute('UPDATE ai_graph_profiles SET active=draft,published_revision=revision WHERE id=?', p);
}
export function ownedProfile(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT profile_type FROM ai_data_profiles WHERE account_id=? AND id=?', p);
}
const recordColumns = 'id,data,revision,customer,created_at,updated_at';
// Nama field koleksi sudah divalidasi sebagai [a-z][a-z0-9_]*, tetapi tetap dikirim sebagai parameter path JSON.
const path = (field: string) => '$."' + field + '"';
const like = (value: string) => '%' + value.replace(/[\\%_]/g, c => '\\' + c) + '%';
const valuesText = "LOWER(CAST(COALESCE(JSON_EXTRACT(data,'$.*'),JSON_ARRAY()) AS CHAR)) LIKE ?";
function filterSql(f: RecordFilter & { type: string }, params: SqlValue[]): string {
  if (f.operator === 'empty' || f.operator === 'exists') {
    params.push(path(f.field));
    return 'JSON_EXTRACT(data,?) IS ' + (f.operator === 'empty' ? 'NULL' : 'NOT NULL');
  }
  if (f.type === 'multichoice' && (f.operator === 'equals' || f.operator === 'not_equals')) {
    params.push(path(f.field), f.value);
    return (f.operator === 'equals' ? '' : 'NOT ') + 'JSON_CONTAINS(JSON_EXTRACT(data,?),JSON_QUOTE(?))';
  }
  if (f.type === 'multichoice' && f.operator !== 'contains' && f.operator !== 'not_contains') return 'FALSE';
  if (f.type === 'boolean') {
    if (f.operator !== 'equals' && f.operator !== 'not_equals') return 'FALSE';
    params.push(path(f.field), ['true', 'ya', '1'].includes(f.value.trim().toLowerCase()) ? 'true' : 'false');
    return 'JSON_EXTRACT(data,?) ' + (f.operator === 'equals' ? '=' : '<>') + ' CAST(? AS JSON)';
  }
  const ops = { equals: '=', not_equals: '<>', greater: '>', greater_equal: '>=', less: '<', less_equal: '<=' };
  if (f.type === 'number' && f.operator in ops) {
    if (f.value.trim() === '' || !Number.isFinite(Number(f.value))) return 'FALSE';
    params.push(path(f.field), Number(f.value));
    return 'CAST(JSON_EXTRACT(data,?) AS DECIMAL(38,10)) ' + ops[f.operator as keyof typeof ops] + ' ?';
  }
  params.push(path(f.field));
  const value = 'LOWER(JSON_UNQUOTE(JSON_EXTRACT(data,?)))';
  if (f.operator === 'contains' || f.operator === 'not_contains') {
    params.push(like(f.value.toLowerCase()));
    return value + (f.operator === 'contains' ? ' LIKE ?' : ' NOT LIKE ?');
  }
  params.push(f.value.toLowerCase());
  return value + ' ' + ops[f.operator as keyof typeof ops] + ' ?';
}
function recordWhere(scope: SqlValue[], q: RecordQuery, params: SqlValue[]) {
  const parts = ['account_id=?', 'data_profile_id=?', 'collection_id=?'];
  params.push(...scope);
  if (q.customer !== undefined) {
    parts.push('customer=?');
    params.push(q.customer);
  }
  for (const g of q.groups)
    if (g.filters.length)
      parts.push('(' + g.filters.map(f => filterSql(f, params)).join(g.match === 'all' ? ' AND ' : ' OR ') + ')');
  if (q.keywords.length) {
    parts.push('(' + q.keywords.map(() => valuesText).join(' OR ') + ')');
    params.push(...q.keywords.map(like));
  }
  return parts.join(' AND ');
}
// scope: [account, data profile, koleksi]. Mengambil limit+1 baris supaya pemanggil tahu masih ada halaman lain.
export function searchRecords(c: Executor, scope: SqlValue[], q: RecordQuery) {
  if (!Number.isSafeInteger(q.limit) || q.limit < 1 || !Number.isSafeInteger(q.offset) || q.offset < 0)
    throw Error('invalid_record_query');
  const params: SqlValue[] = [];
  const score = q.keywords.length ? '(' + q.keywords.map(() => '(' + valuesText + ')').join('+') + ')' : '0';
  params.push(...q.keywords.map(like));
  const where = recordWhere(scope, q, params);
  const dir = q.sort.direction === 'desc' ? 'DESC' : 'ASC';
  let order = 'score DESC,';
  if (q.sort.type === 'created_at') order += 'created_at ' + dir + ',';
  else {
    params.push(path(q.sort.field), path(q.sort.field));
    order +=
      '(JSON_EXTRACT(data,?) IS NULL),' +
      (q.sort.type === 'number'
        ? 'CAST(JSON_EXTRACT(data,?) AS DECIMAL(38,10)) '
        : 'LOWER(JSON_UNQUOTE(JSON_EXTRACT(data,?))) ') +
      dir +
      ',';
  }
  return c.execute<RowDataPacket[]>(
    `SELECT ${recordColumns},${score} AS score FROM ai_data_records WHERE ${where} ORDER BY ${order} id LIMIT ${q.limit + 1} OFFSET ${q.offset}`,
    params,
  );
}
export function countRecords(c: Executor, scope: SqlValue[], q: RecordQuery, sumField: string) {
  const params: SqlValue[] = [path(sumField || 'id')];
  const where = recordWhere(scope, q, params);
  return c.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n,SUM(CAST(JSON_EXTRACT(data,?) AS DECIMAL(38,10))) AS total FROM ai_data_records WHERE ${where}`,
    params,
  );
}
export function record(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,data,revision,customer,created_at,updated_at FROM ai_data_records WHERE account_id=? AND data_profile_id=? AND collection_id=? AND id=? FOR UPDATE',
    p,
  );
}
export function findRecord(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,data,revision,customer,created_at,updated_at FROM ai_data_records WHERE account_id=? AND data_profile_id=? AND collection_id=? AND id=?',
    p,
  );
}
export function insertRecord(c: Executor, p: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_data_records(id,account_id,data_profile_id,collection_id,data,customer) VALUES (?,?,?,?,?,?)',
    p,
  );
}
export function updateRecord(c: Executor, p: SqlValue[]) {
  return c.execute(
    'UPDATE ai_data_records SET data=?,revision=revision+1 WHERE account_id=? AND data_profile_id=? AND collection_id=? AND id=?',
    p,
  );
}
export function deleteRecord(c: Executor, p: SqlValue[]) {
  return c.execute(
    'DELETE FROM ai_data_records WHERE account_id=? AND data_profile_id=? AND collection_id=? AND id=?',
    p,
  );
}
export function allRecords(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,collection_id,data,customer FROM ai_data_records WHERE account_id=? AND data_profile_id=?',
    p,
  );
}
export function mutation(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT result FROM ai_graph_mutations WHERE account_id=? AND data_profile_id=? AND request_key=?',
    p,
  );
}
export function insertMutation(c: Executor, p: SqlValue[]) {
  return c.execute('INSERT INTO ai_graph_mutations(account_id,data_profile_id,request_key,result) VALUES (?,?,?,?)', p);
}

export function shareOwnedGraph(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT g.active FROM ai_graph_profiles g JOIN ai_data_profiles p ON p.profile_type=g.id WHERE p.account_id=? AND p.id=? FOR SHARE',
    p,
  );
}
export function recordsByType(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT r.* FROM ai_data_records r JOIN ai_data_profiles p ON p.id=r.data_profile_id WHERE p.profile_type=? AND r.id>? ORDER BY r.id LIMIT 500',
    p,
  );
}
export function insertVersion(c: Executor, p: SqlValue[]) {
  return c.execute('INSERT IGNORE INTO ai_graph_versions(profile_id,revision,definition) VALUES (?,?,?)', p);
}
export function listVersions(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT revision,created_at FROM ai_graph_versions WHERE profile_id=? ORDER BY revision DESC LIMIT 100',
    p,
  );
}
export function findVersion(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT definition FROM ai_graph_versions WHERE profile_id=? AND revision=?', p);
}

export function listPublishedIds(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT id FROM ai_graph_profiles WHERE active IS NOT NULL');
}
export function countProfileUse(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ai_data_profiles WHERE profile_type=?', p);
}
export function deleteGraph(c: Executor, p: SqlValue[]) {
  return c.execute('DELETE FROM ai_graph_profiles WHERE id=?', p);
}
export function deleteProfileType(c: Executor, p: SqlValue[]) {
  return c.execute('DELETE FROM ai_profile_types WHERE id=?', p);
}
export function shareAvailable(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT g.id FROM ai_graph_profiles g JOIN ai_profile_types t ON t.id=g.id WHERE g.id=? AND g.active IS NOT NULL AND t.enabled=TRUE FOR SHARE',
    p,
  );
}
export function countByCollection(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT collection_id,COUNT(*) AS n FROM ai_data_records WHERE account_id=? AND data_profile_id=? GROUP BY collection_id',
    p,
  );
}
