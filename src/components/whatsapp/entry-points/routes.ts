import express from 'express';
import {db} from '../../../libraries/db.js';
import {digest} from '../../../libraries/security.js';
import {ApiError} from '../../../libraries/errors.js';
import {object,requiredString} from '../../../libraries/validation.js';
import {sendBilled} from '../../billing/index.js';
import {ensureBasic} from '../../billing/index.js';
import {readRecipient} from '../domain/messages.js';
import {SessionManager} from '../domain/sessions.js';
import type {TenantWebhooks} from '../domain/tenant-webhooks.js';
import type {MediaStore} from '../data-access/media-store.js';
import type {EventStream} from './event-stream.js';
import {selectApiKeysAccountIdByKeyHash} from '../data-access/session-queries.js';
// What the session routes need from the AI component, passed in by the composition root (src/http/gateway.ts).
export interface SessionAIHooks {sessionProfiles(account:string):Promise<Record<string,{enabled:boolean;profile:unknown}>>;removeSession(account:string,session:string):Promise<void>}
export interface WhatsappRouteContext {pending:Map<string,number>;hooks:TenantWebhooks;media:Map<string,MediaStore>;streams:Map<string,EventStream>;ai:SessionAIHooks}
// Sending, typing/read, webhooks, received media, the event stream and the sessions themselves.
// Registered on the authenticated gateway router: res.locals carries accountId and the account's SessionManager.
export function sessionRoutes(router:express.Router,{pending,hooks,media,streams,ai}:WhatsappRouteContext){
 router.post('/sessions/:id/messages/:kind',async(req,res)=>{
  if(req.params.kind!=='text'&&req.params.kind!=='media')throw new ApiError(404,'not_found','Operasi tidak tersedia');
  const account=res.locals.accountId as string;
  if((pending.get(account)??0)>=32)throw new ApiError(503,'queue_full','Maksimal 32 permintaan kirim aktif per akun');
  pending.set(account,(pending.get(account)??0)+1);
  try{res.json(await sendBilled(account,res.locals.manager,req.params.id,req.params.kind,req.body,req.get('Idempotency-Key')));}
  finally{pending.set(account,(pending.get(account)??1)-1);}
 });
 router.post('/sessions/:id/typing',async(req,res)=>{const body=object(req.body);res.json(await (res.locals.manager as SessionManager).typing(req.params.id,readRecipient(body.to),body.state));});
 router.post('/sessions/:id/read',async(req,res)=>{const body=object(req.body);res.json(await (res.locals.manager as SessionManager).read(req.params.id,readRecipient(body.from??body.to),requiredString(body.messageId,'messageId',255),body.sender===undefined?undefined:readRecipient(body.sender)));});
 router.get('/webhooks',async(_req,res)=>res.json(await hooks.list(res.locals.accountId)));
 router.post('/webhooks',async(req,res)=>res.json(await hooks.add(res.locals.accountId,req.body,id=>(res.locals.manager as SessionManager).detail(id))));
 router.delete('/webhooks/:id',async(req,res)=>res.json(await hooks.remove(res.locals.accountId,req.params.id)));
 router.get('/media/:id',async(req,res)=>{const file=await media.get(res.locals.accountId)!.get(req.params.id);res.set('Content-Type',file.mimetype).set('Content-Disposition','attachment').set('Cache-Control','private, no-store').sendFile(file.path);});
 router.get('/events',(req,res)=>{
  const key=req.get('X-API-Key'),token=key??req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('ncwa_session='))?.slice(13)??'';
  const hash=digest(token),account=res.locals.accountId;
  streams.get(account)!.handler(req,res,hash,async()=>{
   const [rows]=await selectApiKeysAccountIdByKeyHash(db,[hash],key);
   return rows[0]?.account_id===account;
  });
 });
 router.get('/stats',(_req,res)=>res.json((res.locals.manager as SessionManager).stats()));
 router.get('/sessions',async(_req,res)=>{const list=(res.locals.manager as SessionManager).list(),assistants=await ai.sessionProfiles(res.locals.accountId);res.json(list.map(s=>({...s,aiEnabled:assistants[s.id]?.enabled??false,aiProfile:assistants[s.id]?.profile??null})));});
 router.post('/sessions',async(req,res)=>{
  SessionManager.validateId(req.body?.id);
  const connection=await db.getConnection();
  try{
   await connection.beginTransaction();const wallet=await ensureBasic(connection,res.locals.accountId);
   const m=res.locals.manager as SessionManager;
   if(m.list().some(s=>s.id===req.body.id))throw new ApiError(409,'session_exists','ID session sudah dipakai');
   if(m.list().filter(s=>s.serviceActive!==false).length>=wallet.session_limit)throw new ApiError(409,'session_limit','Batas nomor paket telah tercapai');
   const result=await m.create(req.body.id);await connection.commit();res.json(result);
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
 });
}
// Per-session detail and lifecycle; registered after the AI routes so the order stays as it was.
export function sessionDetailRoutes(router:express.Router,{ai}:Pick<WhatsappRouteContext,'ai'>){
 router.get('/sessions/:id',(req,res)=>res.json((res.locals.manager as SessionManager).detail(req.params.id)));
 router.get('/sessions/:id/qr',(req,res)=>res.json((res.locals.manager as SessionManager).qr(req.params.id)));
 router.post('/sessions/:id/logout',async(req,res)=>res.json(await (res.locals.manager as SessionManager).logout(req.params.id)));
 router.post('/sessions/:id/reconnect',async(req,res)=>res.json(await (res.locals.manager as SessionManager).reconnect(req.params.id)));
 router.delete('/sessions/:id',async(req,res)=>{const result=await (res.locals.manager as SessionManager).remove(req.params.id);await ai.removeSession(res.locals.accountId,req.params.id);res.json(result);});
 router.put('/sessions/:id/filter',async(req,res)=>res.json(await (res.locals.manager as SessionManager).setFilter(req.params.id,req.body?.filter)));
}
