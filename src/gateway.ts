import {createAutoShare} from './auto-share.js';
import {aiData,orderInput,record,customerNumber} from './ai-data.js';
import {ai as defaultAI} from './ai.js';
import express from 'express';
import {TenantWebhooks} from './webhooks.js';
import {MediaStore} from './engine/media.js';
import {AssetStore} from './engine/assets.js';
import {EventStream} from './engine/events.js';
import {sendBilled} from './outbound.js';
import {object,readRecipient,requiredString} from './engine/messages.js';
import {resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {digest} from './security.js';
import {basicWallet,ensureBasic} from './plans.js';
import {SessionManager,ApiError,type Connector} from './engine/sessions.js';
import {SessionStore} from './engine/store.js';
import {baileysConnector} from './engine/baileys.js';
import {referral as defaultReferral} from './referral.js';

export function createGateway(connector?:(accountId:string,store:SessionStore)=>Connector,root=resolve('auth'),ai=defaultAI,referral=defaultReferral) {
 const hooks=new TenantWebhooks();
 referral.currentNumbersProvider=async(accountId:string)=>{
  const pending=managers.get(accountId);if(!pending)return [];
  const m=await pending;
  return m.list().filter(s=>s.status==='connected'&&s.phone).map(s=>s.phone as string);
 };
 const media=new Map<string,MediaStore>();
 const streams=new Map<string,EventStream>();
 const pending=new Map<string,number>();
 const managers=new Map<string,Promise<SessionManager>>();
 async function manager(id:string){
  if(!managers.has(id))managers.set(id,(async()=>{
   const store=new SessionStore(resolve(root,id));
   const result=new SessionManager(connector?connector(id,store):baileysConnector(store,(session,messageId)=>ai.registerSystemMessage(id,session,messageId)),store);
   const files=new MediaStore(resolve(root,'_media',id),process.env.APP_ORIGIN??'http://127.0.0.1:8067');
   const events=new EventStream();media.set(id,files);streams.set(id,events);
   result.onEvent=async event=>{
    events.push(event);await hooks.enqueue(id,event);
    if(event.event==='session.status'&&event.status==='connected'&&typeof event.phone==='string'&&event.phone)await referral.qualify(id,event.phone).catch(()=>{});
   };
   result.onBeforeSend=async()=>{const [accounts]=await db.execute<RowDataPacket[]>('SELECT suspended FROM accounts WHERE id=?',[id]);if(!accounts[0]||accounts[0].suspended){await result.applyLimit(0);throw new ApiError(403,'account_suspended','Akun dinonaktifkan');}await result.applyLimit((await basicWallet(id)).session_limit);};
   result.onOutgoing=async(session,message)=>{await ai.manualOutgoing(id,session.id,message);};
   result.onIncoming=async(session,message)=>{
    await result.onBeforeSend!();if(result.detail(session.id).serviceActive===false)return;
    const {download,...data}=message;
    const stored=await files.save(session.id,message);
    const event={event:'message',sessionId:session.id,...data,media:stored};
    events.push(event);await hooks.enqueue(id,event);
    await ai.incoming(id,result,session.id,message);
   };
   try {await files.prune();await result.restore((await basicWallet(id)).session_limit);return result;}
   catch(error){await result.stop();throw error;}
  })().catch(e=>{managers.delete(id);throw e;}));
  return managers.get(id)!;
 }
 const router=express.Router();
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 router.use(async(req,res,next)=>{
  const key=req.get('X-API-Key');
  let rows:RowDataPacket[];
  if(key){[rows]=await db.execute<RowDataPacket[]>('SELECT k.account_id AS id FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE',[digest(key)]);}
  else {
   const token=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('ncwa_session='))?.slice(13)??'';
   if(!['GET','HEAD'].includes(req.method)&&req.get('origin')!==(process.env.APP_ORIGIN??'http://127.0.0.1:8067')){res.status(403).json({error:'invalid_origin'});return;}
   [rows]=await db.execute<RowDataPacket[]>('SELECT s.account_id AS id FROM login_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.suspended=FALSE',[digest(token)]);
  }
  if(!rows[0]){res.status(401).json({error:'unauthorized'});return;}
  res.locals.accountId=rows[0].id;res.locals.manager=await manager(rows[0].id);await (res.locals.manager as SessionManager).onBeforeSend!();next();
 });
 const shareAssets=new AssetStore(resolve(root,'_share-assets'),db);
 const autoShare=createAutoShare(manager,shareAssets);
 router.use('/auto-share',autoShare.router);
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
   const [rows]=await db.execute<RowDataPacket[]>(key?'SELECT k.account_id FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE':'SELECT s.account_id FROM login_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.suspended=FALSE',[hash]);
   return rows[0]?.account_id===account;
  });
 });
 router.get('/stats',(_req,res)=>res.json((res.locals.manager as SessionManager).stats()));
 router.get('/sessions',(_req,res)=>res.json((res.locals.manager as SessionManager).list()));
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
 router.get('/sessions/:id/ai',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.assistant(res.locals.accountId,req.params.id));});
 router.put('/sessions/:id/ai',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.saveAssistant(res.locals.accountId,req.params.id,req.body));});
 router.get('/sessions/:id/ai/products',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await aiData.products(res.locals.accountId,req.params.id));});
 router.put('/sessions/:id/ai/products/:product',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await aiData.saveProduct(res.locals.accountId,req.params.id,{...record(req.body),id:req.params.product}));});
 router.get('/sessions/:id/ai/orders',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await aiData.orders(res.locals.accountId,req.params.id));});
 router.post('/sessions/:id/ai/orders',async(req,res)=>{res.locals.manager.detail(req.params.id);const input=record(req.body),key=req.get('Idempotency-Key');if(!key||!/^[A-Za-z0-9_-]{1,100}$/.test(key))throw new ApiError(400,'invalid_request','Idempotency-Key wajib diisi');res.json(await aiData.createOrder({account:res.locals.accountId,session:req.params.id,customer:customerNumber(input.customer),requestId:'manual_'+key,knowledge:''},orderInput({items:input.items,notes:input.notes})));});
 router.put('/sessions/:id/ai/orders/:order',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await aiData.updateOrder(res.locals.accountId,req.params.id,req.params.order,req.body));});
 router.get('/sessions/:id/ai/conversations',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.conversations(res.locals.accountId,req.params.id));});
 router.get('/sessions/:id/ai/fallbacks',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.fallbacks(res.locals.accountId,req.params.id,req.query.page??'1'));});
 router.post('/sessions/:id/ai/fallbacks/:fallback/answer',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.answerFallback(res.locals.accountId,res.locals.manager,req.params.id,req.params.fallback,req.body));});
 router.post('/sessions/:id/ai/fallbacks/:fallback/knowledge',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.applyFallbackKnowledge(res.locals.accountId,req.params.id,req.params.fallback,req.body));});
 router.delete('/sessions/:id/ai/fallbacks/:fallback',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.removeFallback(res.locals.accountId,req.params.id,req.params.fallback));});
 router.put('/sessions/:id/ai/conversations/:customer',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.conversation(res.locals.accountId,req.params.id,req.params.customer,req.body));});
 router.get('/sessions/:id',(req,res)=>res.json((res.locals.manager as SessionManager).detail(req.params.id)));
 router.get('/sessions/:id/qr',(req,res)=>res.json((res.locals.manager as SessionManager).qr(req.params.id)));
 router.post('/sessions/:id/logout',async(req,res)=>res.json(await (res.locals.manager as SessionManager).logout(req.params.id)));
 router.post('/sessions/:id/reconnect',async(req,res)=>res.json(await (res.locals.manager as SessionManager).reconnect(req.params.id)));
 router.delete('/sessions/:id',async(req,res)=>{const result=await (res.locals.manager as SessionManager).remove(req.params.id);await ai.removeSession(res.locals.accountId,req.params.id);res.json(result);});
 router.put('/sessions/:id/filter',async(req,res)=>res.json(await (res.locals.manager as SessionManager).setFilter(req.params.id,req.body?.filter)));
 let maintenance:ReturnType<typeof setInterval>|undefined;
 let refreshing:Promise<void>|undefined;
 async function refresh(){for(const [id,pending] of managers){const m=await pending;const [rows]=await db.execute<RowDataPacket[]>('SELECT suspended FROM accounts WHERE id=?',[id]);await m.applyLimit(!rows[0]||rows[0].suspended?0:(await basicWallet(id)).session_limit);await media.get(id)?.prune();}}
 async function restore(){
  maintenance??=setInterval(()=>{refreshing??=refresh().catch(()=>console.error('Penyegaran hak session gagal.')).finally(()=>{refreshing=undefined;});},30000).unref();

  // Only persisted directories belonging to existing accounts may open sockets.
  const entries=await readdir(root,{withFileTypes:true}).catch(error=>{
   if(error.code==='ENOENT')return [];throw error;
  });
  for(const entry of entries){
   if(!entry.isDirectory()||! /^[a-f0-9-]{36}$/i.test(entry.name))continue;
   const [rows]=await db.execute<RowDataPacket[]>('SELECT id FROM accounts WHERE id=? AND suspended=FALSE',[entry.name]);
   if(rows[0])await manager(rows[0].id);
  }
 }
 return {router,restore,autoShare,shareAssets,start:()=>{hooks.start();autoShare.start();},refresh,health:()=>({loadedAccounts:managers.size,pendingSends:[...pending.values()].reduce((a,b)=>a+b,0)}),revoke:(account:string,tag?:string)=>{const stream=streams.get(account);if(tag)stream?.revoke(tag);else stream?.stop();},stop:async()=>{clearInterval(maintenance);await refreshing;await autoShare.stop();await hooks.stop();await ai.stop();for(const stream of streams.values())stream.stop();for(const pending of managers.values())await (await pending).stop();for(const files of media.values())await files.flush();managers.clear();}};
}
export const gateway=createGateway();
