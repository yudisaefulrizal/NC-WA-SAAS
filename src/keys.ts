import {randomBytes,randomUUID} from 'node:crypto';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {digest} from './security.js';
import {ApiError} from './engine/sessions.js';
export async function createKey(account:string,tokenHash:string,replace?:string){
 const c=await db.getConnection();try{await c.beginTransaction();await c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',[account]);
 const [sessions]=await c.execute<RowDataPacket[]>('SELECT account_id FROM login_sessions WHERE token_hash=? AND account_id=? AND expires_at>UTC_TIMESTAMP()',[tokenHash,account]);if(!sessions.length)throw new ApiError(401,'unauthorized','Sesi login telah berakhir');
 const [keys]=await c.execute<RowDataPacket[]>('SELECT id,key_hash FROM api_keys WHERE account_id=?',[account]);const old=keys.find(k=>k.id===replace);
 if(replace&&!old)throw new ApiError(404,'key_not_found','Key tidak ditemukan');if(!replace&&keys.length>=10)throw new ApiError(409,'key_limit','Maksimal 10 API key aktif per akun');
 const key='ncwa_'+randomBytes(32).toString('hex'),id=randomUUID();
 if(old)await c.execute('DELETE FROM api_keys WHERE account_id=? AND id=?',[account,old.id]);
 await c.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)',[id,account,digest(key)]);
 await c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',[account,old?'api_key_rotated':'api_key_created']);await c.commit();return {id,key,revokedHash:old?.key_hash as string|undefined};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
