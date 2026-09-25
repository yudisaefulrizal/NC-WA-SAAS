// Pool MySQL bersama dan tipe untuk menjalankan SQL.
import mysql from 'mysql2/promise';

export const db = mysql.createPool({
  socketPath: process.env.DB_SOCKET,
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 8,
  timezone: '+00:00',
});
// Kunci baris akun sudah mengantrekan tiap tenant; READ COMMITTED mencegah gap lock yang
// membuat wallet baru milik akun lain saling menunggu (deadlock).
db.on('connection', connection => {
  connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
  connection.query("SET time_zone='+00:00'");
});
// Apa pun yang bisa menjalankan SQL: pool, atau koneksi yang sedang memegang transaksi.
export type Executor = Pick<mysql.PoolConnection, 'execute' | 'query'>;
// Nilai yang diikat ke placeholder "?".
export type SqlValue = string | number | bigint | boolean | Date | null | Buffer | Uint8Array;
