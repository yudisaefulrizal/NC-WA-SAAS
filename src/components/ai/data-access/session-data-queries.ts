// Menghapus baris milik satu sesi dari tabel AI mana pun, saat sesi WhatsApp dihapus. Nama tabel selalu
// berasal dari daftar tetap di kode pemanggil, bukan dari input pengguna.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function deleteFromTable(c: Executor, params: SqlValue[], table: string) {
  return c.execute('DELETE FROM ' + table + ' WHERE account_id=? AND session_id=?', params);
}
