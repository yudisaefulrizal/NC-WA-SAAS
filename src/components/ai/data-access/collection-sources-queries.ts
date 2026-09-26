// Sumber API per koleksi profil dinamis; semua query dibatasi akun dan data profil.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT endpoint,secret FROM ai_collection_sources WHERE account_id=? AND data_profile_id=? AND collection_id=?',
    p,
  );
}
export function listByProfile(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT collection_id,endpoint,secret FROM ai_collection_sources WHERE account_id=? AND data_profile_id=?',
    p,
  );
}
export function upsert(c: Executor, p: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_collection_sources(account_id,data_profile_id,collection_id,endpoint,secret) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE endpoint=VALUES(endpoint),secret=VALUES(secret)',
    p,
  );
}
export function deleteOne(c: Executor, p: SqlValue[]) {
  return c.execute('DELETE FROM ai_collection_sources WHERE account_id=? AND data_profile_id=? AND collection_id=?', p);
}
export function copyToProfile(c: Executor, p: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_collection_sources(account_id,data_profile_id,collection_id,endpoint,secret) SELECT account_id,?,collection_id,endpoint,secret FROM ai_collection_sources WHERE account_id=? AND data_profile_id=?',
    p,
  );
}
