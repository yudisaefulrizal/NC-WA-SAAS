import {db} from './db.js';
import type {RowDataPacket} from 'mysql2/promise';
// Dedicated connection holds the single-worker lock for this database.
export async function acquireEngineLock(namespace='engine'){
 const connection=await db.getConnection();
 const [rows]=await connection.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(),':',?),0) AS acquired",[namespace]);
 if(rows[0].acquired!==1){connection.release();throw new Error('Engine sudah berjalan untuk database ini');}
 return {connection,release:async()=>{await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':',?))",[namespace]);connection.release();}};
}
