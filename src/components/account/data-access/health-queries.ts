// Cek koneksi database untuk halaman status layanan pemilik: `healthSql.ping(db)`.
import type { Executor } from '../../../libraries/db.js';
export function ping(c: Executor) {
  return c.query('SELECT 1');
}
