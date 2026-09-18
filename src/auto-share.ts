import {randomUUID,randomInt} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import express from 'express';
import type {RowDataPacket,PoolConnection} from 'mysql2/promise';
import {db} from './db.js';
import {ApiError,type SessionManager} from './engine/sessions.js';
import {object,recipient,requiredString} from './engine/messages.js';
import {downloadPublicMedia} from './engine/download.js';
import {sendBilled} from './outbound.js';

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
 let url:string|null=null;
 if(type!=='text'){
  url=requiredString(b.media_url,'URL media',4096);
  let parsed:URL;try{parsed=new URL(url);}catch{throw invalid('URL media tidak valid');}
  if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw invalid('Gunakan URL media HTTP/HTTPS publik tanpa kredensial');
 }
 const filename=b.filename?requiredString(b.filename,'Nama file',255):null;
 return {name,message,type,url,filename};
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
function expose(r:RowDataPacket){return {...r,contacts:jsonArray(r.contacts),groups:jsonArray(r.groups_json),enabled:!!r.enabled,template_ids:jsonArray(r.template_ids)};}
async function lockJob(c:PoolConnection,account:string,id:string){
 const [rows]=await c.execute<RowDataPacket[]>('SELECT * FROM auto_share_jobs WHERE account_id=? AND id=? FOR UPDATE',[account,id]);
 if(!rows[0])throw new ApiError(404,'not_found','Pengiriman tidak ditemukan');return rows[0];
}
async function enqueue(c:PoolConnection,t:RowDataPacket,source:string,selected?:string){
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
 const v=content[0],id=randomUUID();
 await c.execute('INSERT INTO auto_share_runs(id,account_id,job_id,job_name,template_id,template_name,session_id,message,source,media_type,media_url,filename) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[id,t.account_id,t.id,t.name,v.id,v.name,t.session_id,v.message,source,v.media_type,v.media_url,v.filename]);
 if(source==='schedule')await c.execute('UPDATE auto_share_jobs SET rotation_index=? WHERE id=?',[(t.rotation_index+1)%templates.length,t.id]);
 for(let i=0;i<targets.length;i++)await c.execute('INSERT INTO auto_share_deliveries(id,run_id,nomor,position) VALUES (?,?,?,?)',[randomUUID(),id,targets[i],i]);
 return {id,total:targets.length};
}
export function createAutoShare(getManager:(account:string)=>Promise<SessionManager>,delay=sleep,download=downloadPublicMedia){
 const router=express.Router();
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
 router.get('/templates',async(_req,res)=>{const [rows]=await db.execute('SELECT id,name,message,media_type,media_url,filename FROM auto_share_templates WHERE account_id=? ORDER BY created_at DESC',[res.locals.accountId]);res.json(rows);});
 async function saveTemplate(account:string,id:string,body:unknown,update:boolean){
  const v=templateInput(body),c=await db.getConnection();
  try{await c.beginTransaction();await accountLock(c,account);
   if(update){const [rows]=await c.execute<RowDataPacket[]>('SELECT id FROM auto_share_templates WHERE account_id=? AND id=?',[account,id]);if(!rows.length)throw new ApiError(404,'not_found','Template tidak ditemukan');
    await c.execute('UPDATE auto_share_templates SET name=?,message=?,media_type=?,media_url=?,filename=? WHERE account_id=? AND id=?',[v.name,v.message,v.type,v.url,v.filename,account,id]);
   }else await c.execute("INSERT INTO auto_share_templates(id,account_id,name,message,media_type,media_url,filename,session_id,contacts,groups_json,content_migrated) VALUES (?,?,?,?,?,?,?,'',JSON_ARRAY(),JSON_ARRAY(),TRUE)",[id,account,v.name,v.message,v.type,v.url,v.filename]);
   await c.commit();return {id};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
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
  const c=await db.getConnection();try{await c.beginTransaction();await accountLock(c,res.locals.accountId);const t=await lockJob(c,res.locals.accountId,req.params.id);(await getManager(t.account_id)).connected(t.session_id);const result=await enqueue(c,t,'manual',requiredString(object(req.body).template_id,'Template',36));await c.commit();res.status(202).json(result);}catch(e){await c.rollback();throw e;}finally{c.release();}
 });
 router.get('/runs',async(_req,res)=>{const [rows]=await db.execute(`SELECT r.*,COUNT(d.id) AS total,SUM(d.status='sent') AS sent,SUM(d.status='failed') AS failed,SUM(d.status='unknown') AS unknown_count FROM auto_share_runs r LEFT JOIN auto_share_deliveries d ON d.run_id=r.id WHERE r.account_id=? GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100`,[res.locals.accountId]);res.json(rows);});
 router.get('/runs/:id',async(req,res)=>{const [rows]=await db.execute('SELECT d.* FROM auto_share_deliveries d JOIN auto_share_runs r ON r.id=d.run_id WHERE r.account_id=? AND r.id=? ORDER BY d.position',[res.locals.accountId,req.params.id]);res.json(rows);});
 async function schedule(){
  const [due]=await db.query<RowDataPacket[]>('SELECT t.id,t.account_id FROM auto_share_jobs t JOIN accounts a ON a.id=t.account_id WHERE t.enabled=TRUE AND t.next_at<=UTC_TIMESTAMP(3) AND a.suspended=FALSE ORDER BY t.next_at LIMIT 100');
  for(const row of due){const c=await db.getConnection();try{
   await c.beginTransaction();await accountLock(c,row.account_id);const t=await lockJob(c,row.account_id,row.id);const now=new Date();
   if(!t.enabled||!t.next_at||new Date(t.next_at)>now){await c.commit();continue;}
   try{await enqueue(c,t,'schedule');}catch(e){
    if(!(e instanceof ApiError)||!['already_running','invalid_request'].includes(e.code))throw e;
    if(e.code==='invalid_request'){
     const id=randomUUID();await c.execute("INSERT INTO auto_share_runs(id,account_id,job_id,job_name,template_id,template_name,session_id,message,source,status,finished_at) VALUES (?,?,?,?,?,?,?,?,'schedule','failed',UTC_TIMESTAMP(3))",[id,t.account_id,t.id,t.name,jsonArray(t.template_ids)[t.rotation_index%jsonArray(t.template_ids).length],'Tidak dikirim',t.session_id,'']);
     await c.execute("INSERT INTO auto_share_deliveries(id,run_id,nomor,position,status,error) VALUES (?,?,?,0,'failed',?)",[randomUUID(),id,'—',e.message]);
    }
   }
   const next=nextSchedule(new Date(t.next_at),t.interval_minutes,now);
   await c.execute('UPDATE auto_share_jobs SET next_at=?,enabled=? WHERE id=?',[next,!!next,t.id]);await c.commit();
  }catch(e){await c.rollback();if(!(e instanceof ApiError&&e.status===404))throw e;}finally{c.release();}}
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
    const body=media?{to,type:run.media_type,url:run.media_url,...(run.message?{caption:run.message}:{}),...(run.filename?{filename:run.filename}:{})}:{to,text:run.message};
    const result=await sendBilled(run.account_id,manager,run.session_id,media?'media':'text',body,'share_'+target.id,download,async()=>{await manager!.typing(run.session_id,target.nomor,'composing');await delay(1000);});
    accepted=true;
    await db.execute("UPDATE auto_share_deliveries SET status='sent',message_id=? WHERE id=?",[result.messageId,target.id]);
   }catch(e){
    const unknown=accepted||(e instanceof ApiError&&['send_unknown','request_unknown','request_reserved','request_sent'].includes(e.code));
    await db.execute('UPDATE auto_share_deliveries SET status=?,error=? WHERE id=?',[unknown?'unknown':'failed',(e instanceof ApiError?e.message:'Pengiriman gagal; periksa sesi pengirim.').slice(0,500),target.id]);
   }finally{await manager?.typing(run.session_id,target.nomor,'paused').catch(()=>{});}
  }
  const [remaining]=await db.execute<RowDataPacket[]>("SELECT id FROM auto_share_deliveries WHERE run_id=? AND status IN ('pending','sending') LIMIT 1",[run.id]);
  if(remaining.length)await db.execute("UPDATE auto_share_runs SET status='queued' WHERE id=?",[run.id]);
  else await db.execute("UPDATE auto_share_runs SET status=IF(EXISTS(SELECT 1 FROM auto_share_deliveries WHERE run_id=? AND status<>'sent'),'completed_with_errors','completed'),finished_at=UTC_TIMESTAMP(3) WHERE id=?",[run.id,run.id]);
 }
 async function tick(){await schedule();const [runs]=await db.query<RowDataPacket[]>("SELECT * FROM auto_share_runs WHERE status='queued' ORDER BY created_at LIMIT 1");if(runs[0]&&!stopped)await deliver(runs[0]);}
 async function recover(){
  // A transport call interrupted by a crash must never be retried automatically.
  await db.query("UPDATE auto_share_deliveries d JOIN auto_share_runs r ON r.id=d.run_id LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=CONCAT('share_',d.id) SET d.status=IF(o.message_id IS NULL,'unknown','sent'),d.message_id=o.message_id,d.error=IF(o.message_id IS NULL,'Proses terhenti; hasil belum pasti dan tidak dikirim ulang.',NULL) WHERE d.status='sending'");
  await db.query("UPDATE auto_share_runs SET status='queued' WHERE status='running'");
 }
 return {router,recover,tick,start(){stopped=false;const work=()=>{if(!stopped&&!pending)pending=tick().catch(async()=>{console.error('Proses Auto Share gagal; periksa database.');await recover().catch(()=>{});}).finally(()=>{pending=undefined;});};timer??=setInterval(work,1000).unref();work();},async stop(){stopped=true;clearInterval(timer);timer=undefined;await pending;}};
}
