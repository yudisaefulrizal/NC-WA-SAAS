import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createReadStream} from 'node:fs';
import type {RowDataPacket,PoolConnection} from 'mysql2/promise';
import {db} from '../../../libraries/db.js';
import {type SessionManager} from '../../whatsapp/index.js';
import {ApiError} from '../../../libraries/errors.js';
import {AssetStore} from '../data-access/asset-store.js';
import {sendBilled} from '../../billing/index.js';
import {decrypt} from '../../../libraries/crypto.js';
import {downloadPublicMedia} from '../../../libraries/download.js';
import {tidyMessage} from './tidy.js';
import {ai} from '../../ai/index.js';
import type {IncomingMessage} from '../../whatsapp/index.js';
import {decodeHeaders,fetchSource,maxSourceMediaBytes,renderTemplate,validateSourceData,validateSourceMedia,type SourceTransport} from './source.js';
import {insertAutoShareDelivery,insertAutoShareJobs,insertAutoShareRun,insertAutoShareTemplates,insertDaftarKontak,insertFailedDelivery,insertFailedScheduleRun,insertIgnoreDaftarKontak,lockAccountsIdById,lockAutoShareJobsByAccountIdId,lockAutoShareTemplatesSourceEndpointSourceSecretByAccountIdId,markDeliverySending,markDeliverySent,markRunQueued,markRunRunning,selectAllContacts,selectAutoShareDeliveriesByRunId,selectAutoShareDeliveriesIdByRunId,selectAutoShareJobsByAccountIdId,selectAutoShareJobsIdAccountId,selectAutoShareRuns,selectAutoShareRunsIdByAccountId,selectAutoShareRunsIdByAccountIdJobId,selectAutoShareSettingsAutoAddEnabledByAccountId,selectAutoShareTemplatesByAccountIdId,selectAutoShareTemplatesIdByAccountId,selectDaftarKontakIdByAccountIdId,selectDaftarKontakIdKelompkontakByAccountId,selectWalletsMaxShareAssetsMaxShareStorageBytesByAccountId,shareAutoShareTemplatesByAccountIdId,shareShareAssetsFilenameMediaTypeByAccountIdId,updateAutoShareDeliveriesStatus,updateAutoShareJobsNameByAccountIdId,updateAutoShareJobsNextAtById,updateAutoShareJobsRotationIndexById,updateAutoShareRunsStatus,updateAutoShareRunsStatusByRunId,updateAutoShareTemplatesNameByAccountIdId,updateDaftarKontakNomorByAccountIdId,updateDeliveryResult} from '../data-access/auto-share-queries.js';
import {invalid,contactInput,templateInput,jobInput,randomDelay,nextSchedule,jsonArray,secretFor} from './inputs.js';

export {contactInput,templateInput,jobInput,randomDelay,nextSchedule} from './inputs.js';
export async function accountLock(c:PoolConnection,account:string){await lockAccountsIdById(c,[account]);}
export async function lockJob(c:PoolConnection,account:string,id:string){
 const [rows]=await lockAutoShareJobsByAccountIdId(c,[account,id]);
 if(!rows[0])throw new ApiError(404,'not_found','Pengiriman tidak ditemukan');return rows[0];
}
// Resolved content for one run: fetched outside the transaction so a slow endpoint never holds the
// account lock. runId is minted here because temporary media must be stored under it before insert.
export interface ResolvedSource {runId:string;templateId:string;data:Record<string,string>;assetId:string|null;filename:string|null;message?:string;tidied?:boolean;tidyNote?:string|null}
export async function enqueue(c:PoolConnection,t:RowDataPacket,source:string,selected?:string,resolved?:ResolvedSource|null){
 const [active]=await selectAutoShareRunsIdByAccountIdJobId(c,[t.account_id,t.id]);
 if(active.length)throw new ApiError(409,'already_running','Template ini masih dalam antrean atau sedang dikirim');
 const [queued]=await selectAutoShareRunsIdByAccountId(c,[t.account_id]);
 if(queued.length>=32)throw new ApiError(409,'already_running','Maksimal 32 pengiriman aktif per akun');
 const [contacts]=await selectAllContacts(c,[t.account_id]);
 const ids=new Set(jsonArray(t.contacts)),groups=new Set(jsonArray(t.groups_json));
 const targets=[...new Set(contacts.filter(r=>ids.has(r.id)||groups.has(r.kelompkontak)).map(r=>r.nomor as string))];
 if(!targets.length)throw invalid('Tidak ada kontak yang cocok dengan tujuan template');
 const templates=jsonArray(t.template_ids);
 const templateId=source==='manual'?selected:templates[t.rotation_index%templates.length];
 if(!templateId||!templates.includes(templateId))throw invalid('Pilih template dari pengiriman ini');
 const [content]=await shareAutoShareTemplatesByAccountIdId(c,[t.account_id,templateId]);
 if(!content[0])throw invalid('Template tidak tersedia');
 const v=content[0];
 if(v.source_mode==='endpoint'&&!resolved)throw invalid('Data dari sumber belum tersedia');
 // The prefetch ran before the lock, so confirm rotation still points at the template it fetched.
 if(resolved&&resolved.templateId!==templateId)throw invalid('Template berubah saat data sumber diambil; coba lagi');
 const id=resolved?resolved.runId:randomUUID();
 // The prefetch already substituted and, when asked, tidied the text outside this transaction.
 const message=v.source_mode==='endpoint'?(resolved!.message??renderTemplate(v.message as string,resolved!.data)):v.message;
 const assetId=v.media_source==='endpoint'?resolved!.assetId:v.asset_id;
 const filename=v.media_source==='endpoint'?resolved!.filename:v.filename;
 const sourceData=v.source_mode==='endpoint'?JSON.stringify(resolved!.data):null;
 await insertAutoShareRun(c,[id,t.account_id,t.id,t.name,v.id,v.name,t.session_id,message,source,v.media_type,assetId,filename,sourceData,Boolean(resolved?.tidied),resolved?.tidyNote??null]);
 if(source==='schedule')await updateAutoShareJobsRotationIndexById(c,[(t.rotation_index+1)%templates.length,t.id]);
 for(let i=0;i<targets.length;i++)await insertAutoShareDelivery(c,[randomUUID(),id,targets[i],i]);
 return {id,total:targets.length};
}
export function createAutoShare(getManager:(account:string)=>Promise<SessionManager>,assets:AssetStore,delay=sleep,source:SourceTransport=fetchSource,download=downloadPublicMedia,aiConfig=()=>ai.config()){
 // Runs before any transaction: a template source may take seconds to answer, and the account row
 // is locked for the whole of enqueue. Returns null when the template needs no remote data.
 async function prefetchSource(account:string,job:RowDataPacket,templateId:string):Promise<ResolvedSource|null>{
  const [rows]=await selectAutoShareTemplatesByAccountIdId(db,[account,templateId]);
  const t=rows[0];
  if(!t||t.source_mode!=='endpoint')return null;
  const headers=decodeHeaders(t.source_secret?decrypt(t.source_secret as string):'');
  const body=await source(t.source_endpoint as string,headers);
  const data=validateSourceData(body);
  // Fail before any download when the text needs a value the source did not send.
  const substituted=renderTemplate(t.message as string,data);
  // Cosmetic only: a failed rewrite keeps the substituted text and the send goes ahead.
  const tidy=t.tidy?await tidyMessage(account,substituted,await aiConfig(),undefined,String(t.tidy_note??'')):{message:substituted,tidied:false,reason:null};
  const runId=randomUUID();
  const resolved={runId,templateId,data,message:tidy.message,tidied:tidy.tidied,tidyNote:tidy.reason};
  if(t.media_source!=='endpoint')return {...resolved,assetId:null,filename:null};
  const media=await validateSourceMedia(data,t.media_variable as string);
  const file=await download(media.url,{maxBytes:maxSourceMediaBytes});
  try{
   const name=media.filename??'media';
   const saved=await assets.saveTemporary(account,runId,name,createReadStream(file.path),maxSourceMediaBytes);
   if(saved.mediaType!==t.media_type)throw invalid('Media dari sumber data bertipe '+saved.mediaType+', tidak sesuai template '+t.media_type);
   return {...resolved,assetId:saved.id,filename:saved.filename};
  }catch(error){await assets.removeRunAssets(runId).catch(()=>{});throw error;}
  finally{await file.cleanup();}
 }
 async function quota(account:string){
  const [rows]=await selectWalletsMaxShareAssetsMaxShareStorageBytesByAccountId(db,[account]);
  return rows[0]?{maxCount:Number(rows[0].max_share_assets),maxBytes:Number(rows[0].max_share_storage_bytes)}:{maxCount:0,maxBytes:0};
 }
 async function saveContact(account:string,id:string,body:unknown,update:boolean){
  const v=contactInput(body);
  try{
   if(update){const [rows]=await selectDaftarKontakIdByAccountIdId(db,[account,id]);if(!rows.length)throw new ApiError(404,'not_found','Kontak tidak ditemukan');await updateDaftarKontakNomorByAccountIdId(db,[v.nomor,v.nama,v.kelompkontak,account,id]);}
   else await insertDaftarKontak(db,[id,account,v.nomor,v.nama,v.kelompkontak]);
  }catch(e){if((e as {code?:string}).code==='ER_DUP_ENTRY')throw new ApiError(409,'contact_exists','Kontak sudah tersimpan');throw e;}
  return {id,...v};
 }
 async function saveTemplate(account:string,id:string,body:unknown,update:boolean){
  const v=templateInput(body),c=await db.getConnection();
  try{await c.beginTransaction();await accountLock(c,account);
   let filename:string|null=null;
   if(v.assetId){
    const [rows]=await shareShareAssetsFilenameMediaTypeByAccountIdId(c,[account,v.assetId]);
    if(!rows[0])throw invalid('Asset tidak ditemukan');
    if(rows[0].media_type!==v.type)throw invalid('Jenis asset tidak sesuai dengan jenis konten template');
    filename=rows[0].filename;
   }
   if(update){const [rows]=await lockAutoShareTemplatesSourceEndpointSourceSecretByAccountIdId(c,[account,id]);if(!rows.length)throw new ApiError(404,'not_found','Template tidak ditemukan');
    await updateAutoShareTemplatesNameByAccountIdId(c,[v.name,v.message,v.type,v.assetId,filename,v.source.mode,v.source.endpoint,secretFor(v.source,rows[0]),v.source.media,v.source.variable,v.tidy,v.tidyNote,account,id]);
   }else await insertAutoShareTemplates(c,[id,account,v.name,v.message,v.type,v.assetId,filename,v.source.mode,v.source.endpoint,secretFor(v.source,null),v.source.media,v.source.variable,v.tidy,v.tidyNote]);
   await c.commit();return {id};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 async function saveJob(account:string,id:string,body:unknown,update:boolean){
  const v=jobInput(body);(await getManager(account)).detail(v.session);const c=await db.getConnection();
  try{await c.beginTransaction();await accountLock(c,account);const old=update?await lockJob(c,account,id):null;
   const [contacts]=await selectDaftarKontakIdKelompkontakByAccountId(c,[account]);
   const [templates]=await selectAutoShareTemplatesIdByAccountId(c,[account]);
   if(v.contacts.some(id=>!contacts.some(r=>r.id===id))||v.groups.some(g=>!contacts.some(r=>r.kelompkontak===g)))throw invalid('Kontak atau kelompok tidak ditemukan');
   if(v.templates.some(id=>!templates.some(r=>r.id===id)))throw invalid('Template tidak ditemukan');
   const rotation=old&&JSON.stringify(jsonArray(old.template_ids))===JSON.stringify(v.templates)?old.rotation_index:0;
   const values=[v.name,v.session,JSON.stringify(v.contacts),JSON.stringify(v.groups),JSON.stringify(v.templates),rotation,v.enabled,v.next,v.interval];
   if(update)await updateAutoShareJobsNameByAccountIdId(c,[...values,account,id]);
   else await insertAutoShareJobs(c,[...values,account,id]);
   await c.commit();return {id};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 async function schedule(){
  const [due]=await selectAutoShareJobsIdAccountId(db);
  for(const row of due){
   // Fetching before the transaction keeps a slow or dead endpoint from holding the account lock.
   // A failure here is carried into the transaction so it is recorded like any other failed run.
   const [preview]=await selectAutoShareJobsByAccountIdId(db,[row.account_id,row.id]);
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
     const id=randomUUID();await insertFailedScheduleRun(c,[id,t.account_id,t.id,t.name,jsonArray(t.template_ids)[t.rotation_index%jsonArray(t.template_ids).length],'Tidak dikirim',t.session_id,'']);
     await insertFailedDelivery(c,[randomUUID(),id,'—',e.message]);
    }
    // The run never started, so media fetched for it is already dead weight.
    if(resolved)await assets.removeRunAssets(resolved.runId).catch(()=>{});
   }
   const next=nextSchedule(new Date(t.next_at),t.interval_minutes,now);
   await updateAutoShareJobsNextAtById(c,[next,!!next,t.id]);await c.commit();
  }catch(e){await c.rollback();if(resolved)await assets.removeRunAssets(resolved.runId).catch(()=>{});if(!(e instanceof ApiError&&e.status===404))throw e;}finally{c.release();}}
 }
 let stopped=false,pending:Promise<void>|undefined,timer:ReturnType<typeof setInterval>|undefined;
 async function deliver(run:RowDataPacket){
  await markRunRunning(db,[run.id]);
  const [targets]=await selectAutoShareDeliveriesByRunId(db,[run.id]);
  for(let i=0;i<targets.length;i++){
   if(stopped)break;
   if(i)await delay(randomDelay());
   if(stopped)break;
   const target=targets[i];let manager:SessionManager|undefined;let accepted=false;
   await markDeliverySending(db,[target.id]);
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
    await markDeliverySent(db,[result.messageId,target.id]);
   }catch(e){
    const unknown=accepted||(e instanceof ApiError&&['send_unknown','request_unknown','request_reserved','request_sent'].includes(e.code));
    await updateDeliveryResult(db,[unknown?'unknown':'failed',(e instanceof ApiError?e.message:'Pengiriman gagal; periksa sesi pengirim.').slice(0,500),target.id]);
   }finally{await manager?.typing(run.session_id,target.nomor,'paused').catch(()=>{});}
  }
  const [remaining]=await selectAutoShareDeliveriesIdByRunId(db,[run.id]);
  if(remaining.length)await markRunQueued(db,[run.id]);
  else {
   await updateAutoShareRunsStatusByRunId(db,[run.id,run.id]);
   // Media pulled from a source is scoped to this run; once it settles the file has no further use.
   await assets.removeRunAssets(run.id).catch(()=>{});
  }
 }
 async function tick(){await schedule();const [runs]=await selectAutoShareRuns(db);if(runs[0]&&!stopped)await deliver(runs[0]);}
 async function recover(){
  // A transport call interrupted by a crash must never be retried automatically.
  await updateAutoShareDeliveriesStatus(db);
  await updateAutoShareRunsStatus(db);
  // Safety net: a crash between saveTemporary and the run settling leaves files nothing will claim.
  await assets.sweepTemporary().catch(()=>{});
 }
 function autoAddInput(message:IncomingMessage){if(message.type!=='text')return;const matched=/^tambah(?:-([^-]*)(?:-(.*))?)?$/i.exec(message.text.trim());if(!matched)return;const nama=(matched[1]??'').trim()||null,kelompkontak=(matched[2]??'').trim();return (nama===null||nama.length<=100)&&kelompkontak.length<=100?{nama,kelompkontak}:undefined;}
 async function listen(account:string,message:IncomingMessage,fromSession=false){const input=autoAddInput(message);if(!fromSession||!input)return;const [settings]=await selectAutoShareSettingsAutoAddEnabledByAccountId(db,[account]);if(!settings[0]?.auto_add_enabled)return;const nomor=message.isGroup?(message.groupId||message.from):message.from;if(!nomor)return;const [saved]=await insertIgnoreDaftarKontak(db,[randomUUID(),account,nomor,input.nama,input.kelompkontak]);return saved.affectedRows?{nomor,...input,isGroup:message.isGroup}:undefined;}
 return {assets,getManager,prefetchSource,quota,saveContact,saveTemplate,saveJob,source,download,aiConfig,recover,tick,listen,start(){stopped=false;const work=()=>{if(!stopped&&!pending)pending=tick().catch(async()=>{console.error('Proses Auto Share gagal; periksa database.');await recover().catch(()=>{});}).finally(()=>{pending=undefined;});};timer??=setInterval(work,1000).unref();work();},async stop(){stopped=true;clearInterval(timer);timer=undefined;await pending;}};
}
