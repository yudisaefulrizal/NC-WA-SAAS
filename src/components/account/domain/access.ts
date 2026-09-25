import {db} from '../../../libraries/db.js';
import {selectAccountsIdById,selectAccountsSuspendedById,selectApiKeysIdByKeyHash,selectLoginSessionsIdByTokenHash} from '../data-access/access-queries.js';
// How the gateway identifies an account: by API key or login session, and whether it may still act.
export const accountStatus=(id:string)=>selectAccountsSuspendedById(db,[id]);
export const accountByApiKeyHash=(hash:string)=>selectApiKeysIdByKeyHash(db,[hash]);
export const accountByLoginToken=(hash:string)=>selectLoginSessionsIdByTokenHash(db,[hash]);
export const activeAccount=(id:string)=>selectAccountsIdById(db,[id]);
