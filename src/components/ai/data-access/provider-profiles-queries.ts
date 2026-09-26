// Query tabel ai_provider_profiles untuk komponen ai. Dipanggil lewat namespace, misalnya
// `providerProfilesSql.listAll(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listAll(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT * FROM ai_provider_profiles ORDER BY created_at');
}
export function findSecret(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT secret FROM ai_provider_profiles WHERE id=?', params);
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_provider_profiles(id,name,provider,endpoint,secret,model_cheap,model_medium,model_smart,model_structured,model_decision,active) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),provider=VALUES(provider),endpoint=VALUES(endpoint),secret=VALUES(secret),model_cheap=VALUES(model_cheap),model_medium=VALUES(model_medium),model_smart=VALUES(model_smart),model_structured=VALUES(model_structured),model_decision=VALUES(model_decision),active=VALUES(active)',
    params,
  );
}
export function deleteById(c: Executor, params: SqlValue[]) {
  return c.execute<any>('DELETE FROM ai_provider_profiles WHERE id=?', params);
}
export function findActiveModel(c: Executor, params: SqlValue[], tier: string) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,model_' + tier + ' AS model FROM ai_provider_profiles WHERE id=? AND active=TRUE',
    params,
  );
}
export function findActiveConnection(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT provider,endpoint,secret FROM ai_provider_profiles WHERE id=? AND active=TRUE',
    params,
  );
}
