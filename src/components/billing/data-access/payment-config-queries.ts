// Query tabel payment_config untuk komponen billing. Dipanggil lewat namespace, misalnya
// `paymentConfigSql.findActiveSummary(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findActiveSummary(c: Executor) {
  return c.query<RowDataPacket[]>(
    'SELECT c.id,c.environment,c.created_at FROM payment_config c JOIN payment_settings s ON s.config_id=c.id WHERE s.id=1',
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO payment_config(id,environment,secret) VALUES (?,?,?)', params);
}
export function findOrActive(c: Executor, params: SqlValue[], id: string | undefined) {
  return c.execute<RowDataPacket[]>(
    id
      ? 'SELECT * FROM payment_config WHERE id=?'
      : 'SELECT c.* FROM payment_config c JOIN payment_settings s ON c.id=s.config_id WHERE s.id=1',
    params,
  );
}
