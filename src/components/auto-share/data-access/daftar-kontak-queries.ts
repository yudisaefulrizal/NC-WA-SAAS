// Query tabel daftar_kontak untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `daftarKontakSql.listAll(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listAll(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM daftar_kontak WHERE account_id=?', params);
}
export function listSorted(c: Executor, params: SqlValue[]) {
  return c.execute(
    'SELECT id,nomor,nama,kelompkontak FROM daftar_kontak WHERE account_id=? ORDER BY kelompkontak,nama,nomor',
    params,
  );
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM daftar_kontak WHERE account_id=? AND id=?', params);
}
export function update(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE daftar_kontak SET nomor=?,nama=?,kelompkontak=? WHERE account_id=? AND id=?', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO daftar_kontak(id,account_id,nomor,nama,kelompkontak) VALUES (?,?,?,?,?)', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM daftar_kontak WHERE account_id=? AND id=?', params);
}
export function listGroups(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id,kelompkontak FROM daftar_kontak WHERE account_id=?', params);
}
export function insertIgnore(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    'INSERT IGNORE INTO daftar_kontak(id,account_id,nomor,nama,kelompkontak) VALUES (?,?,?,?,?)',
    params,
  );
}
