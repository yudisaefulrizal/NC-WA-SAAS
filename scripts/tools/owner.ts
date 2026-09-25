import {db} from '../../src/libraries/db.js';
import type {RowDataPacket} from 'mysql2';
const email=process.argv[2]?.trim().toLowerCase();
if(!email)throw new Error('Usage: npm run owner -- email-akun-terdaftar');
const connection=await db.getConnection();
try {
 await connection.beginTransaction();
 const [accounts]=await connection.execute<RowDataPacket[]>('SELECT id FROM accounts WHERE email=? FOR UPDATE',[email]);
 if(!accounts[0])throw new Error('Daftarkan akun terlebih dahulu.');
 await connection.execute("UPDATE accounts SET role='owner' WHERE id=?",[accounts[0].id]);
 await connection.execute("INSERT INTO audit_events (account_id,action) VALUES (?,'owner_granted_local_cli')",[accounts[0].id]);
 await connection.commit();
 console.log('Peran pemilik diberikan melalui administrasi lokal.');
} catch(e){await connection.rollback();throw e;} finally {connection.release();await db.end();}
