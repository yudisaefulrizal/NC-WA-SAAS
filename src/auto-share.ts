import {randomUUID,randomInt} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {Readable} from 'node:stream';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import express from 'express';
import type {RowDataPacket,PoolConnection} from 'mysql2/promise';
import {db} from './db.js';
import {ApiError,type SessionManager} from './engine/sessions.js';
import {object,recipient,requiredString} from './engine/messages.js';
import {AssetStore,sniffMediaType} from './engine/assets.js';
import {sendBilled} from './outbound.js';
import {encrypt,decrypt} from './payments.js';
import {downloadPublicMedia} from './engine/download.js';
import {decodeHeaders,fetchSource,maxSourceMediaBytes,mediaVariable,parsePlaceholders,renderTemplate,sourceInput,validateHeaders,validateSourceData,validateSourceMedia,type SourceHeaders,type SourceTransport} from './auto-share-source.js';

const invalid=(message:string)=>new ApiError(400,'invalid_request',message);
export function contactInput(body:unknown){
 const input=object(body);
 const raw=typeof input.nomor==='string'?input.nomor.trim().replace(/@s\.whatsapp\.net$/,''):input.nomor;
 const nomor=recipient(raw);
 const group=input.kelompkontak??'';
 if(typeof group!=='string'||group.trim().length>100)throw invalid('Kelompok kontak maksimal 100 karakter');
 return {nomor,kelompkontak:group.trim()};
}
function strings(value:unknown){
 if(!Array.isArray(value)||value.length>500||value.some(v=>typeof v!=='string'||!v.trim()||v.length>100))throw invalid('Daftar tujuan tidak valid (maksimal 500 pilihan)');
 return [...new Set(value.map(v=>(v as string).trim()))];
}
export function templateInput(body:unknown){
 const b=object(body),name=requiredString(b.name,'Nama',100);
 const type=b.media_type??'text';
 if(typeof type!=='string'||!['text','image','video','document','audio'].includes(type))throw invalid('Jenis template tidak valid');
 const message=type==='text'?requiredString(b.message,'Pesan',10000):(b.message??'');
 if(typeof message!=='string'||message.length>10000)throw invalid('Caption maksimal 10000 karakter');
 if(type==='audio'&&message.trim())throw invalid('Audio tidak mendukung caption; gunakan template teks terpisah');
 const source=sourceInput(b);
 // Audio carries no caption, so a source would have nowhere to write its values.
 if(source.mode==='endpoint'&&type==='audio')throw invalid('Template audio tidak mendukung sumber data');
 if(source.media==='endpoint'&&type==='text')throw invalid('Sumber media endpoint memerlukan template gambar, video, atau dokumen');
 const placeholders=parsePlaceholders(message);
 // Without this a template silently sends "{{jumlah}}" as literal text.
 if(source.mode==='none'&&placeholders.length)throw invalid('Teks memakai {{'+placeholders[0]+'}}; pilih sumber data endpoint terlebih dahulu');
 const assetId=type!=='text'&&source.media==='asset'?requiredString(b.asset_id,'Asset',36):null;
 return {name,message,type,assetId,source};
}
export function jobInput(body:unknown,now=Date.now()){
 const b=object(body),name=requiredString(b.name,'Nama',100),session=requiredString(b.session_id,'Sesi',64);
 const contacts=strings(b.contacts??[]),groups=strings(b.groups??[]),templates=strings(b.template_ids??[]);
 if(!templates.length)throw invalid('Pilih minimal satu template');
 if(!contacts.length&&!groups.length)throw invalid('Pilih kontak atau kelompok tujuan');
 if(typeof b.enabled!=='boolean')throw invalid('Status jadwal tidak valid');
 const interval=b.interval_minutes??0;
 if(typeof interval!=='number'||!Number.isSafeInteger(interval)||interval<0||interval>525600)throw invalid('Interval harus 0 (sekali kirim) atau 1–525600 menit');
 if(b.next_at!==null&&b.next_at!==undefined&&typeof b.next_at!=='string')throw invalid('Waktu jadwal tidak valid');
 const next=b.next_at?new Date(b.next_at):null;
 if(next&&!Number.isFinite(next.getTime()))throw invalid('Waktu jadwal tidak valid');
 if(b.enabled&&(!next||next.getTime()<=now))throw invalid('Jadwal aktif harus memiliki waktu di masa depan');
 return {name,session,templates,contacts,groups,enabled:b.enabled,next,interval};
}
export const randomDelay=()=>randomInt(1000,3001);
export function nextSchedule(due:Date,minutes:number,now:Date){
 if(!minutes)return null;
 const step=minutes*60000;
 return new Date(due.getTime()+(Math.max(0,Math.floor((now.getTime()-due.getTime())/step))+1)*step);
}
const jsonArray=(v:unknown):string[]=>typeof v==='string'?JSON.parse(v):v as string[];
// Keeps the stored headers when the endpoint is unchanged and none were submitted; drops them as soon
// as the endpoint moves, so a secret is never sent to a host it was not issued for.
function secretFor(source:ReturnType<typeof sourceInput>,previous:Record<string,unknown>|null){
 if(source.mode==='none')return null;
 const kept=previous&&previous.source_secret&&previous.source_endpoint===source.endpoint?previous.source_secret as string:null;
 if(source.headers===undefined)return kept;
 const stored=decodeHeaders(kept?decrypt(kept):'');
 // A blank value means "keep the stored secret for this header" so it never has to be retyped.
 const merged:SourceHeaders={};
 for(const [name,value] of Object.entries(source.headers))merged[name]=value||stored[name]||'';
 const present=Object.entries(merged).filter(([,value])=>value);
 return present.length?encrypt(JSON.stringify(Object.fromEntries(present))):null;
}
function expose(r:RowDataPacket){return {...r,contacts:jsonArray(r.contacts),groups:jsonArray(r.groups_json),enabled:!!r.enabled,template_ids:jsonArray(r.template_ids)};}
async function lockJob(c:PoolConnection,account:string,id:string){
 const [rows]=await c.execute<RowDataPacket[]>('SELECT * FROM auto_share_jobs WHERE account_id=? AND id=? FOR UPDATE',[account,id]);
 if(!rows[0])throw new ApiError(404,'not_found','Pengiriman tidak ditemukan');return rows[0];
}
// Resolved content for one run: fetched outside the transaction so a slow endpoint never holds the
// account lock. runId is minted here because temporary media must be stored under it before insert.
export interface ResolvedSource {runId:string;templateId:string;data:Record<string,string>;assetId:string|null;filename:string|null}
async function enqueue(c:PoolConnection,t:RowDataPacket,source:string,selected?:string,resolved?:ResolvedSource|null){
 const [active]=await c.execute<RowDataPacket[]>("SELECT id FROM auto_share_runs WHERE account_id=? AND job_id=? AND status IN ('queued','running') LIMIT 1",[t.account_id,t.id]);
 if(active.length)throw new ApiError(409,'already_running','Template ini masih dalam antrean atau sedang dikirim');
 const [queued]=await c.execute<RowDataPacket[]>("SELECT id FROM auto_share_runs WHERE account_id=? AND status IN ('queued','running') LIMIT 32",[t.account_id]);
 if(queued.length>=32)throw new ApiError(409,'already_running','Maksimal 32 pengiriman aktif per akun');
 const [contacts]=await c.execute<RowDataPacket[]>('SELECT * FROM daftar_kontak WHERE account_id=?',[t.account_id]);
 const ids=new Set(jsonArray(t.contacts)),groups=new Set(jsonArray(t.groups_json));
 const targets=[...new Set(contacts.filter(r=>ids.has(r.id)||groups.has(r.kelompkontak)).map(r=>r.nomor as string))];
 if(!targets.length)throw invalid('Tidak ada kontak yang cocok dengan tujuan template');
 const templates=jsonArray(t.template_ids);
 const templateId=source==='manual'?selected:templates[t.rotation_index%templates.length];
 if(!templateId||!templates.includes(templateId))throw invalid('Pilih template dari pengiriman ini');
 const [content]=await c.execute<RowDataPacket[]>('SELECT * FROM auto_share_templates WHERE account_id=? AND id=? FOR SHARE',[t.account_id,templateId]);
 if(!content[0])throw invalid('Template tidak tersedia');
 const v=content[0];
 if(v.source_mode==='endpoint'&&!resolved)throw invalid('Data dari sumber belum tersedia');
 // The prefetch ran before the lock, so confirm rotation still points at the template it fetched.
 if(resolved&&resolved.templateId!==templateId)throw invalid('Template berubah saat data sumber diambil; coba lagi');
 const id=resolved?resolved.runId:randomUUID();
 const message=v.source_mode==='endpoint'?renderTemplate(v.message as string,resolved!.data):v.message;
 const assetId=v.media_source==='endpoint'?resolved!.assetId:v.asset_id;
 const filename=v.media_source==='endpoint'?resolved!.filename:v.filename;
 const sourceData=v.source_mode==='endpoint'?JSON.stringify(resolved!.data):null;
 await c.execute('INSERT INTO auto_share_runs(id,account_id,job_id,job_name,template_id,template_name,session_id,message,source,media_type,asset_id,filename,source_data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,t.account_id,t.id,t.name,v.id,v.name,t.session_id,message,source,v.media_type,assetId,filename,sourceData]);
 if(source==='schedule')await c.execute('UPDATE auto_share_jobs SET rotation_index=? WHERE id=?',[(t.rotation_index+1)%templates.length,t.id]);
 for(let i=0;i<targets.length;i++)await c.execute('INSERT INTO auto_share_deliveries(id,run_id,nomor,position) VALUES (?,?,?,?)',[randomUUID(),id,targets[i],i]);
 return {id,total:targets.length};
}
export function createAutoShare(getManager:(account:string)=>Promise<SessionManager>,assets:AssetStore,delay=sleep,source:SourceTransport=fetchSource,download=downloadPublicMedia){
 const router=express.Router();
 // Runs before any transaction: a template source may take seconds to answer, and the account row
 // is locked for the whole of enqueue. Returns null when the template needs no remote data.
 async function prefetchSource(account:string,job:RowDataPacket,templateId:string):Promise<ResolvedSource|null>{
  const [rows]=await db.execute<RowDataPacket[]>('SELECT id,message,media_type,media_source,media_variable,source_mode,source_endpoint,source_secret FROM auto_share_templates WHERE account_id=? AND id=?',[account,templateId]);
  const t=rows[0];
  if(!t||t.source_mode!=='endpoint')return null;
  const headers=decodeHeaders(t.source_secret?decrypt(t.source_secret as string):'');
  const body=await source(t.source_endpoint as string,headers);
  const data=validateSourceData(body);
  // Fail before any download when the text needs a value the source did not send.
  renderTemplate(t.message as string,data);
  const runId=randomUUID();
  if(t.media_source!=='endpoint')return {runId,templateId,data,assetId:null,filename:null};
  const media=await validateSourceMedia(data,t.media_variable as string);
  const file=await download(media.url,{maxBytes:maxSourceMediaBytes});
  try{
   const name=media.filename??'media';
   const saved=await assets.saveTemporary(account,runId,name,createReadStream(file.path),maxSourceMediaBytes);
   if(saved.mediaType!==t.media_type)throw invalid('Media dari sumber data bertipe '+saved.mediaType+', tidak sesuai template '+t.media_type);
   return {runId,templateId,data,assetId:saved.id,filename:saved.filename};
  }catch(error){await assets.removeRunAssets(runId).catch(()=>{});throw error;}
  finally{await file.cleanup();}
 }
 async function quota(account:string){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT p.max_share_assets,p.max_share_storage_bytes FROM wallets w JOIN plans p ON p.id=w.plan_id WHERE w.account_id=?',[account]);
  return rows[0]?{maxCount:Number(rows[0].max_share_assets),maxBytes:Number(rows[0].max_share_storage_bytes)}:{maxCount:0,maxBytes:0};
 }
 router.post('/assets',express.raw({type:'*/*',limit:'32mb'}),async(req,res)=>{
  const account=res.locals.accountId;
  const filename=(req.get('X-Filename')??'asset').slice(0,255);
  if(!Buffer.isBuffer(req.body)||!req.body.length)throw invalid('Isi file kosong atau tidak terbaca');
  const saved=await assets.save(account,filename,Readable.from(req.body),await quota(account));
  res.status(201).json({id:saved.id,filename:saved.filename,mimetype:saved.mimetype,media_type:saved.mediaType,size_bytes:saved.sizeBytes});
 });
 router.get('/assets',async(req,res)=>{
  const account=res.locals.accountId;
  const [rows]=await db.execute<RowDataPacket[]>('SELECT id,filename,mimetype,media_type,size_bytes,created_at,public_token FROM share_assets WHERE account_id=? AND run_id IS NULL ORDER BY created_at DESC',[account]);
  const [[usage]]=await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes),0) AS bytes FROM share_assets WHERE account_id=? AND run_id IS NULL',[account]);
  const limit=await quota(account);
  res.json({assets:rows,used_count:Number(usage.count),used_bytes:Number(usage.bytes),max_count:limit.maxCount,max_bytes:limit.maxBytes});
 });
 router.get('/assets/:id/file',async(req,res)=>{
  const file=await assets.get(res.locals.accountId,req.params.id);
  res.set('Content-Type',file.mimetype).set('Content-Disposition','inline').set('Cache-Control','private, no-store').sendFile(file.path);
 });
 router.put('/assets/:id/public',async(req,res)=>{
  const isPublic=object(req.body).public;
  if(typeof isPublic!=='boolean')throw invalid('Status publik tidak valid');
  const token=await assets.setPublic(res.locals.accountId,req.params.id,isPublic);
  res.json({public_token:token});
 });
 router.delete('/assets/:id',async(req,res)=>{
  const account=res.locals.accountId;
  const [used]=await db.execute<RowDataPacket[]>('SELECT id FROM auto_share_templates WHERE account_id=? AND asset_id=?',[account,req.params.id]);
  if(used.length)throw new ApiError(409,'asset_in_use','Asset masih digunakan oleh template. Hapus dari template terlebih dahulu.');
  const [rows]=await db.execute<RowDataPacket[]>('SELECT id FROM share_assets WHERE account_id=? AND id=?',[account,req.params.id]);
  if(!rows.length)throw new ApiError(404,'asset_not_found','Asset tidak ditemukan');
  await assets.remove(account,req.params.id);
  await db.execute('DELETE FROM share_assets WHERE account_id=? AND id=?',[account,req.params.id]);
  res.json({ok:true});
 });
 router.get('/contacts',async(_req,res)=>{const [rows]=await db.execute('SELECT id,nomor,kelompkontak FROM daftar_kontak WHERE account_id=? ORDER BY kelompkontak,nomor',[res.locals.accountId]);res.json(rows);});
 async function saveContact(account:string,id:string,body:unknown,update:boolean){
  const v=contactInput(body);
  try{
   if(update){const [rows]=await db.execute<RowDataPacket[]>('SELECT id FROM daftar_kontak WHERE account_id=? AND id=?',[account,id]);if(!rows.length)throw new ApiError(404,'not_found','Kontak tidak ditemukan');await db.execute('UPDATE daftar_kontak SET nomor=?,kelompkontak=? WHERE account_id=? AND id=?',[v.nomor,v.kelompkontak,account,id]);}
   else await db.execute('INSERT INTO daftar_kontak(id,account_id,nomor,kelompkontak) VALUES (?,?,?,?)',[id,account,v.nomor,v.kelompkontak]);
  }catch(e){if((e as {code?:string}).code==='ER_DUP_ENTRY')throw new ApiError(409,'contact_exists','Kontak sudah tersimpan');throw e;}
  return {id,...v};
 }
 router.post('/contacts',async(req,res)=>res.status(201).json(await saveContact(res.locals.accountId,randomUUID(),req.body,false)));
 router.put('/contacts/:id',async(req,res)=>res.json(await saveContact(res.locals.accountId,req.params.id,req.body,true)));
 router.delete('/contacts/:id',async(req,res)=>{await db.execute('DELETE FROM daftar_kontak WHERE account_id=? AND id=?',[res.locals.accountId,req.params.id]);res.json({ok:true});});
 async function accountLock(c:PoolConnection,account:string){await c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',[account]);}
 router.get('/templates',async(_req,res)=>{const [rows]=await db.execute<RowDataPacket[]>('SELECT id,name,message,media_type,asset_id,filename,source_mode,source_endpoint,media_source,media_variable,source_secret FROM auto_share_templates WHERE account_id=? ORDER BY created_at DESC',[res.locals.accountId]);
  // Header values never leave the server; the form only needs their names to render the rows.
  res.json(rows.map(({source_secret,...t})=>({...t,source_header_names:Object.keys(decodeHeaders(source_secret?decrypt(source_secret as string):''))})));});
 async function saveTemplate(account:string,id:string,body:unknown,update:boolean){
  const v=templateInput(body),c=await db.getConnection();
  try{await c.beginTransaction();await accountLock(c,account);
   let filename:string|null=null;
   if(v.assetId){
    const [rows]=await c.execute<RowDataPacket[]>('SELECT filename,media_type FROM share_assets WHERE account_id=? AND id=? FOR SHARE',[account,v.assetId]);
    if(!rows[0])throw invalid('Asset tidak ditemukan');
    if(rows[0].media_type!==v.type)throw invalid('Jenis asset tidak sesuai dengan jenis konten template');
    filename=rows[0].filename;
   }
   if(update){const [rows]=await c.execute<RowDataPacket[]>('SELECT source_endpoint,source_secret FROM auto_share_templates WHERE account_id=? AND id=? FOR UPDATE',[account,id]);if(!rows.length)throw new ApiError(404,'not_found','Template tidak ditemukan');
    await c.execute('UPDATE auto_share_templates SET name=?,message=?,media_type=?,asset_id=?,filename=?,source_mode=?,source_endpoint=?,source_secret=?,media_source=?,media_variable=? WHERE account_id=? AND id=?',[v.name,v.message,v.type,v.assetId,filename,v.source.mode,v.source.endpoint,secretFor(v.source,rows[0]),v.source.media,v.source.variable,account,id]);
   }else await c.execute("INSERT INTO auto_share_templates(id,account_id,name,message,media_type,asset_id,filename,source_mode,source_endpoint,source_secret,media_source,media_variable,session_id,contacts,groups_json,content_migrated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'',JSON_ARRAY(),JSON_ARRAY(),TRUE)",[id,account,v.name,v.message,v.type,v.assetId,filename,v.source.mode,v.source.endpoint,secretFor(v.source,null),v.source.media,v.source.variable]);
   await c.commit();return {id};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 // Lets the form show which variables the endpoint actually returns, so nobody has to guess names.
 router.post('/templates/test-source',async(req,res)=>{
  const b=object(req.body),account=res.locals.accountId;
  const endpoint=requiredString(b.source_endpoint,'Endpoint',512);
  const typed=validateHeaders(b.source_headers);
  let stored:SourceHeaders={};
  if(typeof b.template_id==='string'&&b.template_id){
   const [rows]=await db.execute<RowDataPacket[]>('SELECT source_endpoint,source_secret FROM auto_share_templates WHERE account_id=? AND id=?',[account,b.template_id]);
   if(rows[0]?.source_secret&&rows[0].source_endpoint===endpoint)stored=decodeHeaders(decrypt(rows[0].source_secret as string));
  }
  // A blank value falls back to the stored secret so the test works without retyping it.
  const headers:SourceHeaders={};
  for(const [name,value] of Object.entries(typed))if(value||stored[name])headers[name]=value||stored[name];
  const body=await source(endpoint,headers);
  const variables=validateSourceData(body);
  let media=null;
  if(b.media_source==='endpoint'){
   const found=await validateSourceMedia(variables,mediaVariable(b.media_variable));
   const file=await download(found.url,{maxBytes:maxSourceMediaBytes});
   try{
    const head=await readFile(file.path);
    const sniffed=sniffMediaType(head.subarray(0,64),found.filename??new URL(found.url).pathname);
    if(!sniffed)throw invalid('Jenis media dari sumber data tidak didukung');
    media={url:found.url,media_type:sniffed.mediaType,size_bytes:head.length};
   }finally{await file.cleanup();}
  }
  // The raw body is echoed back so a mis-shaped response is visible in the dialog, capped so a large
  // payload never bloats the form.
  res.json({ok:true,variables,media,raw:JSON.stringify(body,null,1).slice(0,2000)});
 });
 router.post('/templates',async(req,res)=>res.status(201).json(await saveTemplate(res.locals.accountId,randomUUID(),req.body,false)));
 router.put('/templates/:id',async(req,res)=>res.json(await saveTemplate(res.locals.accountId,req.params.id,req.body,true)));
 router.delete('/templates/:id',async(req,res)=>{const c=await db.getConnection();try{await c.beginTransaction();await accountLock(c,res.locals.accountId);
  const [jobs]=await c.execute<RowDataPacket[]>('SELECT template_ids FROM auto_share_jobs WHERE account_id=?',[res.locals.accountId]);
  if(jobs.some(j=>jsonArray(j.template_ids).includes(req.params.id)))throw new ApiError(409,'template_in_use','Template masih digunakan oleh pengiriman. Hapus dari pengiriman terlebih dahulu.');
  await c.execute('DELETE FROM auto_share_templates WHERE account_id=? AND id=?',[res.locals.accountId,req.params.id]);await c.commit();res.json({ok:true});
 }catch(e){await c.rollback();throw e;}finally{c.release();}});
 router.get('/jobs',async(_req,res)=>{const [rows]=await db.execute<RowDataPacket[]>('SELECT * FROM auto_share_jobs WHERE account_id=? ORDER BY created_at DESC',[res.locals.accountId]);res.json(rows.map(expose));});
 async function saveJob(account:string,id:string,body:unknown,update:boolean){
  const v=jobInput(body);(await getManager(account)).detail(v.session);const c=await db.getConnection();
  try{await c.beginTransaction();await accountLock(c,account);const old=update?await lockJob(c,account,id):null;
   const [contacts]=await c.execute<RowDataPacket[]>('SELECT id,kelompkontak FROM daftar_kontak WHERE account_id=?',[account]);
   const [templates]=await c.execute<RowDataPacket[]>('SELECT id FROM auto_share_templates WHERE account_id=?',[account]);
   if(v.contacts.some(id=>!contacts.some(r=>r.id===id))||v.groups.some(g=>!contacts.some(r=>r.kelompkontak===g)))throw invalid('Kontak atau kelompok tidak ditemukan');
   if(v.templates.some(id=>!templates.some(r=>r.id===id)))throw invalid('Template tidak ditemukan');
   const rotation=old&&JSON.stringify(jsonArray(old.template_ids))===JSON.stringify(v.templates)?old.rotation_index:0;
   const values=[v.name,v.session,JSON.stringify(v.contacts),JSON.stringify(v.groups),JSON.stringify(v.templates),rotation,v.enabled,v.next,v.interval];
   if(update)await c.execute('UPDATE auto_share_jobs SET name=?,session_id=?,contacts=?,groups_json=?,template_ids=?,rotation_index=?,enabled=?,next_at=?,interval_minutes=? WHERE account_id=? AND id=?',[...values,account,id]);
   else await c.execute('INSERT INTO auto_share_jobs(name,session_id,contacts,groups_json,template_ids,rotation_index,enabled,next_at,interval_minutes,account_id,id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[...values,account,id]);
   await c.commit();return {id};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 router.post('/jobs',async(req,res)=>res.status(201).json(await saveJob(res.locals.accountId,randomUUID(),req.body,false)));
 router.put('/jobs/:id',async(req,res)=>res.json(await saveJob(res.locals.accountId,req.params.id,req.body,true)));
 router.delete('/jobs/:id',async(req,res)=>{await db.execute('DELETE FROM auto_share_jobs WHERE account_id=? AND id=?',[res.locals.accountId,req.params.id]);res.json({ok:true});});
 router.post('/jobs/:id/send',async(req,res)=>{
  const account=res.locals.accountId,templateId=requiredString(object(req.body).template_id,'Template',36);
  const [jobs]=await db.execute<RowDataPacket[]>('SELECT * FROM auto_share_jobs WHERE account_id=? AND id=?',[account,req.params.id]);
  if(!jobs[0])throw new ApiError(404,'not_found','Pengiriman tidak ditemukan');
  if(!jsonArray(jobs[0].template_ids).includes(templateId))throw invalid('Pilih template dari pengiriman ini');
  const resolved=await prefetchSource(account,jobs[0],templateId);
  const c=await db.getConnection();try{await c.beginTransaction();await accountLock(c,account);const t=await lockJob(c,account,req.params.id);(await getManager(t.account_id)).connected(t.session_id);const result=await enqueue(c,t,'manual',templateId,resolved);await c.commit();res.status(202).json(result);}
  catch(e){await c.rollback();if(resolved)await assets.removeRunAssets(resolved.runId).catch(()=>{});throw e;}finally{c.release();}
 });
 router.get('/runs',async(_req,res)=>{const [rows]=await db.execute(`SELECT r.*,COUNT(d.id) AS total,SUM(d.status='sent') AS sent,SUM(d.status='failed') AS failed,SUM(d.status='unknown') AS unknown_count FROM auto_share_runs r LEFT JOIN auto_share_deliveries d ON d.run_id=r.id WHERE r.account_id=? GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100`,[res.locals.accountId]);res.json(rows);});
 router.get('/runs/:id',async(req,res)=>{const [rows]=await db.execute('SELECT d.* FROM auto_share_deliveries d JOIN auto_share_runs r ON r.id=d.run_id WHERE r.account_id=? AND r.id=? ORDER BY d.position',[res.locals.accountId,req.params.id]);res.json(rows);});
 async function schedule(){
  const [due]=await db.query<RowDataPacket[]>('SELECT t.id,t.account_id FROM auto_share_jobs t JOIN accounts a ON a.id=t.account_id WHERE t.enabled=TRUE AND t.next_at<=UTC_TIMESTAMP(3) AND a.suspended=FALSE ORDER BY t.next_at LIMIT 100');
  for(const row of due){
   // Fetching before the transaction keeps a slow or dead endpoint from holding the account lock.
   // A failure here is carried into the transaction so it is recorded like any other failed run.
   const [preview]=await db.execute<RowDataPacket[]>('SELECT * FROM auto_share_jobs WHERE account_id=? AND id=?',[row.account_id,row.id]);
   let resolved:ResolvedSource|null=null,prefetchError:unknown;
   if(preview[0]){
    const ids=jsonArray(preview[0].template_ids);
    const wanted=ids[preview[0].rotation_index%ids.length];
    if(wanted)try{resolved=await prefetchSource(row.account_id,preview[0],wanted);}catch(e){prefetchError=e;}
   }
   const c=await db.getConnection();try{
   await c.beginTransaction();await accountLock(c,row.account_id);const t=await lockJob(c,row.account_id,row.id);const now=new Date();
   if(!t.enabled||!t.next_at||new Date(t.next_at)>now){await c.commit();if(resolved)await assets.removeRunAssets(resolved.runId).catch(()=>{});continue;}
   try{if(prefetchError)throw prefetchError;await enqueue(c,t,'schedule',undefined,resolved);}catch(e){
    if(!(e instanceof ApiError)||!['already_running','invalid_request'].includes(e.code))throw e;
    if(e.code==='invalid_request'){
     const id=randomUUID();await c.execute("INSERT INTO auto_share_runs(id,account_id,job_id,job_name,template_id,template_name,session_id,message,source,status,finished_at) VALUES (?,?,?,?,?,?,?,?,'schedule','failed',UTC_TIMESTAMP(3))",[id,t.account_id,t.id,t.name,jsonArray(t.template_ids)[t.rotation_index%jsonArray(t.template_ids).length],'Tidak dikirim',t.session_id,'']);
     await c.execute("INSERT INTO auto_share_deliveries(id,run_id,nomor,position,status,error) VALUES (?,?,?,0,'failed',?)",[randomUUID(),id,'—',e.message]);
    }
    // The run never started, so media fetched for it is already dead weight.
    if(resolved)await assets.removeRunAssets(resolved.runId).catch(()=>{});
   }
   const next=nextSchedule(new Date(t.next_at),t.interval_minutes,now);
   await c.execute('UPDATE auto_share_jobs SET next_at=?,enabled=? WHERE id=?',[next,!!next,t.id]);await c.commit();
  }catch(e){await c.rollback();if(resolved)await assets.removeRunAssets(resolved.runId).catch(()=>{});if(!(e instanceof ApiError&&e.status===404))throw e;}finally{c.release();}}
 }
 let stopped=false,pending:Promise<void>|undefined,timer:ReturnType<typeof setInterval>|undefined;
 async function deliver(run:RowDataPacket){
  await db.execute("UPDATE auto_share_runs SET status='running' WHERE id=?",[run.id]);
  const [targets]=await db.execute<RowDataPacket[]>("SELECT * FROM auto_share_deliveries WHERE run_id=? AND status='pending' ORDER BY position",[run.id]);
  for(let i=0;i<targets.length;i++){
   if(stopped)break;
   if(i)await delay(randomDelay());
   if(stopped)break;
   const target=targets[i];let manager:SessionManager|undefined;let accepted=false;
   await db.execute("UPDATE auto_share_deliveries SET status='sending' WHERE id=?",[target.id]);
   try{
    manager=await getManager(run.account_id);
    const to=target.nomor.replace(/@s\.whatsapp\.net$/,'');
    const media=run.media_type&&run.media_type!=='text';
    const body=media?{to,type:run.media_type,url:run.asset_id,...(run.message?{caption:run.message}:{}),...(run.filename?{filename:run.filename}:{})}:{to,text:run.message};
    // Local assets are already on disk; wrap AssetStore.get in the download() contract so
    // sendBilled reads the file directly instead of fetching a public URL.
    const readAsset=async(assetId:string)=>{const file=await assets.get(run.account_id,assetId);return {path:file.path,mimetype:file.mimetype,cleanup:async()=>{}};};
    const result=await sendBilled(run.account_id,manager,run.session_id,media?'media':'text',body,'share_'+target.id,readAsset,async()=>{await manager!.typing(run.session_id,target.nomor,'composing');await delay(1000);});
    accepted=true;
    await db.execute("UPDATE auto_share_deliveries SET status='sent',message_id=? WHERE id=?",[result.messageId,target.id]);
   }catch(e){
    const unknown=accepted||(e instanceof ApiError&&['send_unknown','request_unknown','request_reserved','request_sent'].includes(e.code));
    await db.execute('UPDATE auto_share_deliveries SET status=?,error=? WHERE id=?',[unknown?'unknown':'failed',(e instanceof ApiError?e.message:'Pengiriman gagal; periksa sesi pengirim.').slice(0,500),target.id]);
   }finally{await manager?.typing(run.session_id,target.nomor,'paused').catch(()=>{});}
  }
  const [remaining]=await db.execute<RowDataPacket[]>("SELECT id FROM auto_share_deliveries WHERE run_id=? AND status IN ('pending','sending') LIMIT 1",[run.id]);
  if(remaining.length)await db.execute("UPDATE auto_share_runs SET status='queued' WHERE id=?",[run.id]);
  else {
   await db.execute("UPDATE auto_share_runs SET status=IF(EXISTS(SELECT 1 FROM auto_share_deliveries WHERE run_id=? AND status<>'sent'),'completed_with_errors','completed'),finished_at=UTC_TIMESTAMP(3) WHERE id=?",[run.id,run.id]);
   // Media pulled from a source is scoped to this run; once it settles the file has no further use.
   await assets.removeRunAssets(run.id).catch(()=>{});
  }
 }
 async function tick(){await schedule();const [runs]=await db.query<RowDataPacket[]>("SELECT * FROM auto_share_runs WHERE status='queued' ORDER BY created_at LIMIT 1");if(runs[0]&&!stopped)await deliver(runs[0]);}
 async function recover(){
  // A transport call interrupted by a crash must never be retried automatically.
  await db.query("UPDATE auto_share_deliveries d JOIN auto_share_runs r ON r.id=d.run_id LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=CONCAT('share_',d.id) SET d.status=IF(o.message_id IS NULL,'unknown','sent'),d.message_id=o.message_id,d.error=IF(o.message_id IS NULL,'Proses terhenti; hasil belum pasti dan tidak dikirim ulang.',NULL) WHERE d.status='sending'");
  await db.query("UPDATE auto_share_runs SET status='queued' WHERE status='running'");
  // Safety net: a crash between saveTemporary and the run settling leaves files nothing will claim.
  await assets.sweepTemporary().catch(()=>{});
 }
 return {router,recover,tick,start(){stopped=false;const work=()=>{if(!stopped&&!pending)pending=tick().catch(async()=>{console.error('Proses Auto Share gagal; periksa database.');await recover().catch(()=>{});}).finally(()=>{pending=undefined;});};timer??=setInterval(work,1000).unref();work();},async stop(){stopped=true;clearInterval(timer);timer=undefined;await pending;}};
}
