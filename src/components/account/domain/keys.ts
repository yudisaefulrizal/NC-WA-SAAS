import {randomBytes,randomUUID} from 'node:crypto';
import {db} from '../../../libraries/db.js';
import {digest} from '../../../libraries/security.js';
import {ApiError} from '../../../libraries/errors.js';
import {deleteApiKeysByAccountIdId,insertApiKeys,insertAuditEvents,lockAccountsIdById,selectApiKeysIdKeyHashByAccountId,selectLoginSessionsAccountIdByTokenHashAccountId} from '../data-access/keys-queries.js';

export async function createKey(account:string,tokenHash:string,replace?:string){
 const c=await db.getConnection();try{await c.beginTransaction();await lockAccountsIdById(c,[account]);
 const [sessions]=await selectLoginSessionsAccountIdByTokenHashAccountId(c,[tokenHash,account]);if(!sessions.length)throw new ApiError(401,'unauthorized','Sesi login telah berakhir');
 const [keys]=await selectApiKeysIdKeyHashByAccountId(c,[account]);const old=keys.find(k=>k.id===replace);
 if(replace&&!old)throw new ApiError(404,'key_not_found','Key tidak ditemukan');if(!replace&&keys.length>=10)throw new ApiError(409,'key_limit','Maksimal 10 API key aktif per akun');
 const key='ncwa_'+randomBytes(32).toString('hex'),id=randomUUID();
 if(old)await deleteApiKeysByAccountIdId(c,[account,old.id]);
 await insertApiKeys(c,[id,account,digest(key)]);
 await insertAuditEvents(c,[account,old?'api_key_rotated':'api_key_created']);await c.commit();return {id,key,revokedHash:old?.key_hash as string|undefined};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
