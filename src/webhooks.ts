import {randomUUID} from 'node:crypto';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {ApiError} from './engine/sessions.js';
import {object,requiredString} from './engine/messages.js';
import {validatePublicUrl,postPublicJson} from './engine/download.js';
export type EventPayload={event:string;sessionId:string;[key:string]:unknown};
export class TenantWebhooks {
 private timer?:ReturnType<typeof setInterval>;
 private running?:Promise<void>;
 private stopped=false;
 private abort=new AbortController();
 constructor(private send=postPublicJson,private accountScope?:string){}
 async list(account:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT id,url,session_id AS sessionId FROM webhook_subscriptions WHERE account_id=?',[account]);return rows;}
 async add(account:string,body:unknown,owns:(id:string)=>unknown){
  const input=object(body);const url=(await validatePublicUrl(requiredString(input.url,'url',4096))).url.href;
  const session=input.sessionId==null?null:requiredString(input.sessionId,'sessionId',64);if(session)owns(session);
  const c=await db.getConnection();
  try{await c.beginTransaction();await c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',[account]);
   const [rows]=await c.execute<RowDataPacket[]>('SELECT id,url,session_id AS sessionId FROM webhook_subscriptions WHERE account_id=?',[account]);
   const old=rows.find(r=>r.url===url&&r.sessionId===session);if(old){await c.commit();return old;}
   if(rows.length>=20)throw new ApiError(409,'too_many_webhooks','Maksimal 20 webhook per akun');
   const id='wh_'+randomUUID();await c.execute('INSERT INTO webhook_subscriptions(id,account_id,url,session_id) VALUES (?,?,?,?)',[id,account,url,session]);await c.commit();return {id,url,sessionId:session};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 async remove(account:string,id:string){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT id FROM webhook_subscriptions WHERE account_id=? AND id=?',[account,id]);
  if(!rows.length)throw new ApiError(404,'webhook_not_found','Webhook tidak ditemukan');
  await db.execute('DELETE FROM webhook_subscriptions WHERE account_id=? AND id=?',[account,id]);return {deleted:true};
 }
 async enqueue(account:string,payload:EventPayload){
  if(this.stopped)return;
  const c=await db.getConnection();
  try{await c.beginTransaction();await c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',[account]);
   const [count]=await c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM webhook_deliveries WHERE account_id=?',[account]);
   const [targets]=await c.execute<RowDataPacket[]>('SELECT id FROM webhook_subscriptions WHERE account_id=? AND (session_id IS NULL OR session_id=?)',[account,payload.sessionId]);
   if(count[0].total+targets.length>256)throw new ApiError(503,'webhook_queue_full','Antrean webhook akun penuh');
   for(const target of targets)await c.execute('INSERT INTO webhook_deliveries(id,account_id,subscription_id,payload) VALUES (?,?,?,?)',[randomUUID(),account,target.id,JSON.stringify(payload)]);
   await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 start(){if(this.timer||this.stopped)return;this.timer=setInterval(()=>{void this.tick().catch(()=>console.error('Pemrosesan webhook gagal.'));},1000).unref();}
 tick(){if(this.running)return this.running;this.running=this.work().finally(()=>{this.running=undefined;});return this.running;}
 private async work(){
  if(this.stopped)return;
  await db.execute('DELETE FROM webhook_deliveries WHERE created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)'+(this.accountScope?' AND account_id=?':''),this.accountScope?[this.accountScope]:[]);
  // One delivery per tenant in each pass prevents a failed tenant from occupying every slot.
  const [rows]=await db.query<RowDataPacket[]>(`SELECT d.id,d.account_id,d.payload,d.attempts,s.url FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.next_at<=UTC_TIMESTAMP() ${this.accountScope?'AND d.account_id=?':''} AND d.id=(SELECT d2.id FROM webhook_deliveries d2 WHERE d2.account_id=d.account_id AND d2.next_at<=UTC_TIMESTAMP() ORDER BY d2.created_at,d2.id LIMIT 1) ORDER BY d.next_at LIMIT 4`,this.accountScope?[this.accountScope]:[]);
  await Promise.all(rows.map(async row=>{
   if(this.stopped)return;
   try{await this.send(row.url,typeof row.payload==='string'?JSON.parse(row.payload):row.payload,this.abort.signal);await db.execute('DELETE FROM webhook_deliveries WHERE id=?',[row.id]);}
   catch{if(this.stopped)return;const attempts=row.attempts+1;
    if(attempts>=4)await db.execute('DELETE FROM webhook_deliveries WHERE id=?',[row.id]);
    else await db.execute('UPDATE webhook_deliveries SET attempts=?,next_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND) WHERE id=?',[attempts,2**attempts,row.id]);
   }
  }));
 }
 async stop(){this.stopped=true;clearInterval(this.timer);this.abort.abort();await this.running;}
}
