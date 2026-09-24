import {createAutoShare} from './auto-share.js';
import {aiData,orderInput,record,customerNumber} from './ai-data.js';
import {ai as defaultAI} from './ai.js';
import express from 'express';
import {TenantWebhooks} from './webhooks.js';
import {MediaStore} from './engine/media.js';
import {AssetStore} from './engine/assets.js';
import {ProductImageStore} from './ai-product-images.js';
import {EventStream} from './engine/events.js';
import {sendBilled} from './outbound.js';
import {object,readRecipient,requiredString} from './engine/messages.js';
import {resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {digest} from './security.js';
import {basicWallet,ensureBasic} from './plans.js';
import {SessionManager,ApiError,type Connector} from './engine/sessions.js';
import {SessionStore} from './engine/store.js';
import {baileysConnector} from './engine/baileys.js';
import {referral as defaultReferral} from './referral.js';
import {chatMessages,customerOf,listChats,onChatChange,recordIncoming,recordOutgoing,updateStatus} from './ai-chat.js';
import {clientProfiles} from './ai-profiles.js';

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
 onChatChange((account,sessionId,customer)=>streams.get(account)?.push({event:'chat.updated',sessionId,customer}));
 // Chat history is a view; failing to record never blocks delivery, AI replies or webhooks.
 const history=(work:Promise<unknown>)=>work.catch(error=>console.error('Riwayat chat gagal dicatat.',error instanceof Error?error.message:error));
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
   result.onOutgoing=async(session,message)=>{const {download,...data}=message;events.push({event:'message',direction:'outgoing',sessionId:session.id,...data,media:null});
    // Echoes of API/AI/Auto Share sends are registered as 'system' before dispatch and recorded by onSent instead.
    if(!message.isGroup)await history((async()=>{if(await ai.knownOrigin(id,session.id,message.messageId)!=='system')await recordOutgoing(id,session.id,{customer:message.from,messageId:message.messageId,origin:'manual',type:message.type,text:message.text});})());
    await ai.manualOutgoing(id,session.id,message);const added=await autoShare.listen(id,message,true);if(added)events.push({event:'auto_share.contact_added',sessionId:session.id,...added});};
   result.onSent=async(session,message)=>{const content=message.content,text='text' in content?content.text:content.caption??`[Pesan ${content.type}]`;
    const customer=customerOf(message.to);if(customer)await history(recordOutgoing(id,session.id,{customer,messageId:message.messageId,origin:'api',type:'text' in content?'text':content.type,text:'text' in content?content.text:content.caption??''}));events.push({event:'message',direction:'outgoing',sessionId:session.id,messageId:message.messageId,from:message.to,sender:message.to,isGroup:message.to.endsWith('@g.us'),groupId:message.to.endsWith('@g.us')?message.to:null,type:'text' in content?'text':content.type,text,timestamp:Math.floor(Date.now()/1000),media:null});};
   result.onReceipt=async(session,receipt)=>{await history(updateStatus(id,session.id,receipt.messageId,receipt.status));};
   result.onIncoming=async(session,message)=>{
    await result.onBeforeSend!();if(result.detail(session.id).serviceActive===false)return;
    await history(recordIncoming(id,session.id,message));
    const {download,...data}=message;
    const stored=await files.save(session.id,message);
    const event={event:'message',sessionId:session.id,direction:'incoming',...data,media:stored};
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
 const productImages=new ProductImageStore(resolve(root,'_product-images'));
 ai.productImages=productImages;
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
 router.get('/sessions/:id/ai',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.assistant(res.locals.accountId,req.params.id));});
 router.put('/sessions/:id/ai',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.saveAssistant(res.locals.accountId,req.params.id,req.body));});
 router.patch('/sessions/:id/ai/enabled',async(req,res)=>{res.locals.manager.detail(req.params.id);if(typeof req.body?.enabled!=='boolean')throw new ApiError(400,'invalid_request','Status asisten wajib valid');res.json(await ai.setEnabled(res.locals.accountId,req.params.id,req.body.enabled));});
 router.patch('/sessions/:id/ai/field',async(req,res)=>{res.locals.manager.detail(req.params.id);if(typeof req.body?.field!=='string')throw new ApiError(400,'invalid_request','Bidang wajib diisi');res.json(await ai.saveField(res.locals.accountId,req.params.id,req.body.field,req.body.value));});
 // Products, photos and orders belong to a data profile. They are served under the data profile and, for
 // integrations written before profiles, under a session (resolving to the data profile it runs; writes on a
 // session without one create and attach "CS – <sesi>").
 type Scope={profile:string|null;session:string};
 function dataRoutes(base:string,scope:(req:express.Request,res:express.Response,write:boolean)=>Promise<Scope>){
  const required=(profile:string|null)=>{if(!profile)throw new ApiError(404,'not_found','Data tidak ditemukan');return profile;};
  router.get(base+'/products',async(req,res)=>{const {profile}=await scope(req,res,false);res.json(profile?await aiData.products(res.locals.accountId,profile):[]);});
  router.put(base+'/products/:product',async(req,res)=>{const {profile}=await scope(req,res,true);const {product,replacedImageId}=await aiData.saveProduct(res.locals.accountId,required(profile),String(req.params.product),record(req.body));if(replacedImageId)await productImages.remove(res.locals.accountId,replacedImageId).catch(()=>{});res.json(product);});
  router.post(base+'/products',async(req,res)=>{const {profile}=await scope(req,res,true);const {product}=await aiData.saveProduct(res.locals.accountId,required(profile),'',record(req.body));res.json(product);});
  router.post(base+'/products-image',express.raw({type:'*/*',limit:'12mb'}),async(req,res)=>{const {profile}=await scope(req,res,true);const filename=(req.get('X-Filename')??'photo').slice(0,255);res.json(await productImages.save(res.locals.accountId,required(profile),filename,Readable.from(req.body)));});
  router.get(base+'/products-image/:image',async(req,res)=>{await scope(req,res,false);const file=await productImages.get(res.locals.accountId,String(req.params.image));res.set('Content-Type',file.mimetype).set('Cache-Control','private, max-age=3600').sendFile(file.path);});
  router.get(base+'/orders',async(req,res)=>{const {profile}=await scope(req,res,false);res.json(profile?await aiData.orders(res.locals.accountId,profile):[]);});
  router.post(base+'/orders',async(req,res)=>{const input=record(req.body),key=req.get('Idempotency-Key');if(!key||!/^[A-Za-z0-9_-]{1,100}$/.test(key))throw new ApiError(400,'invalid_request','Idempotency-Key wajib diisi');const {profile,session}=await scope(req,res,true);res.json(await aiData.createOrder({account:res.locals.accountId,profile:required(profile),session,customer:customerNumber(input.customer),requestId:'manual_'+key,knowledge:''},orderInput({items:input.items,notes:input.notes})));});
  router.put(base+'/orders/:order',async(req,res)=>{const {profile}=await scope(req,res,false);res.json(await aiData.updateOrder(res.locals.accountId,required(profile),String(req.params.order),req.body));});
  router.delete(base+'/orders/:order',async(req,res)=>{const {profile}=await scope(req,res,false);res.json(await aiData.deleteOrder(res.locals.accountId,required(profile),String(req.params.order)));});
 }
 dataRoutes('/sessions/:id/ai',async(req,res,write)=>{const session=String(req.params.id);(res.locals.manager as SessionManager).detail(session);return {session,profile:write?await ai.ensureSessionProfile(res.locals.accountId,session):await ai.sessionProfile(res.locals.accountId,session)};});
 dataRoutes('/ai/data-profiles/:profile',async(req,res)=>({session:'',profile:await ai.ownedDataProfile(res.locals.accountId,req.params.profile)}));
 router.get('/ai/profile-types',async(_req,res)=>res.json(await clientProfiles(res.locals.accountId)));
 router.get('/ai/data-profiles',async(_req,res)=>res.json(await ai.dataProfiles(res.locals.accountId)));
 router.post('/ai/data-profiles',async(req,res)=>res.status(201).json(await ai.createDataProfile(res.locals.accountId,req.body)));
 router.get('/ai/data-profiles/:profile',async(req,res)=>res.json(await ai.dataProfile(res.locals.accountId,req.params.profile)));
 router.patch('/ai/data-profiles/:profile',async(req,res)=>res.json(await ai.renameDataProfile(res.locals.accountId,req.params.profile,req.body)));
 router.patch('/ai/data-profiles/:profile/field',async(req,res)=>{if(typeof req.body?.field!=='string')throw new ApiError(400,'invalid_request','Bidang wajib diisi');res.json(await ai.saveDataProfileField(res.locals.accountId,req.params.profile,req.body.field,req.body.value));});
 router.delete('/ai/data-profiles/:profile',async(req,res)=>res.json(await ai.deleteDataProfile(res.locals.accountId,req.params.profile)));
 router.put('/sessions/:id/ai/profile',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.attachProfile(res.locals.accountId,req.params.id,req.body));});
 router.get('/sessions/:id/ai/conversations',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.conversations(res.locals.accountId,req.params.id));});
 router.get('/sessions/:id/ai/fallbacks',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.fallbacks(res.locals.accountId,req.params.id,req.query.page??'1'));});
 router.post('/sessions/:id/ai/fallbacks/:fallback/answer',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.answerFallback(res.locals.accountId,res.locals.manager,req.params.id,req.params.fallback,req.body));});
 router.post('/sessions/:id/ai/fallbacks/:fallback/knowledge',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.applyFallbackKnowledge(res.locals.accountId,req.params.id,req.params.fallback,req.body));});
 router.delete('/sessions/:id/ai/fallbacks/:fallback',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await ai.removeFallback(res.locals.accountId,req.params.id,req.params.fallback));});
 router.get('/sessions/:id/ai/chats',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await listChats(res.locals.accountId,req.params.id));});
 router.get('/sessions/:id/ai/chats/:customer/messages',async(req,res)=>{res.locals.manager.detail(req.params.id);res.json(await chatMessages(res.locals.accountId,req.params.id,req.params.customer,req.query.before));});
 router.post('/sessions/:id/ai/chats/:customer/messages',async(req,res)=>{res.json(await ai.dashboardReply(res.locals.accountId,res.locals.manager,req.params.id,req.params.customer,req.body,req.get('Idempotency-Key')));});
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
