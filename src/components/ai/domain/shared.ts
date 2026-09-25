import {type Pipeline} from './pipeline/runner.js';
import {csPipeline} from './profiles/cs/pipeline.js';
import {eduPipeline} from './profiles/pendidikan/pipeline.js';
import {eduLimits} from './profiles/pendidikan/profile.js';
import type {PoolConnection} from 'mysql2/promise';
import {db} from '../../../libraries/db.js';
import {ApiError} from '../../../libraries/errors.js';
import {lockAccountsIdSuspendedById} from '../data-access/shared-queries.js';
import {AIMessage} from './provider.js';
// The runtime pipeline of each profile a session can run.
export const pipelines:Record<string,Pipeline>={cs:csPipeline,pendidikan:eduPipeline};
export const faqLimit=(type:string)=>type==='pendidikan'?eduLimits.faq:2000;
export async function transaction<T>(fn:(c:PoolConnection)=>Promise<T>){const c=await db.getConnection();try{await c.beginTransaction();const result=await fn(c);await c.commit();return result;}catch(e){await c.rollback();throw e;}finally{c.release();}}
export async function lockAccount(c:PoolConnection,account:string,settling=false){const [rows]=await lockAccountsIdSuspendedById(c,[account]);if(!rows[0]||(!settling&&rows[0].suspended))throw new ApiError(403,'account_unavailable','Akun tidak tersedia');}
export function parseMemory(value:unknown):AIMessage[]{return (typeof value==='string'?JSON.parse(value):value) as AIMessage[];}
