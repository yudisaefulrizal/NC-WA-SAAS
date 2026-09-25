import {randomUUID} from 'node:crypto';
import {db} from '../../../libraries/db.js';
import {ApiError} from '../../../libraries/errors.js';
import {object,requiredString} from '../../../libraries/validation.js';
import {validatePublicUrl,postPublicJson} from '../../../libraries/download.js';
import {countWebhookDeliveriesByAccountId,deleteWebhookDeliveriesByAccountId,deleteWebhookDeliveriesById,deleteWebhookSubscriptionsByAccountIdId,insertWebhookDeliveries,insertWebhookSubscriptions,lockAccountsIdById,selectWebhookDeliveries,selectWebhookSubscriptionsByAccountId,selectWebhookSubscriptionsIdByAccountIdId,selectWebhookSubscriptionsIdByAccountIdSessionId,updateWebhookDeliveriesAttemptsById} from '../data-access/tenant-webhooks-queries.js';

export type EventPayload={event:string;sessionId:string;[key:string]:unknown};
export class TenantWebhooks {
 private timer?:ReturnType<typeof setInterval>;
 private running?:Promise<void>;
 private stopped=false;
 private abort=new AbortController();
 constructor(private send=postPublicJson,private accountScope?:string){}
 async list(account:string){const [rows]=await selectWebhookSubscriptionsByAccountId(db,[account]);return rows;}
 async add(account:string,body:unknown,owns:(id:string)=>unknown){
  const input=object(body);const url=(await validatePublicUrl(requiredString(input.url,'url',4096))).url.href;
  const session=input.sessionId==null?null:requiredString(input.sessionId,'sessionId',64);if(session)owns(session);
  const c=await db.getConnection();
  try{await c.beginTransaction();await lockAccountsIdById(c,[account]);
   const [rows]=await selectWebhookSubscriptionsByAccountId(c,[account]);
   const old=rows.find(r=>r.url===url&&r.sessionId===session);if(old){await c.commit();return old;}
   if(rows.length>=20)throw new ApiError(409,'too_many_webhooks','Maksimal 20 webhook per akun');
   const id='wh_'+randomUUID();await insertWebhookSubscriptions(c,[id,account,url,session]);await c.commit();return {id,url,sessionId:session};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 async remove(account:string,id:string){
  const [rows]=await selectWebhookSubscriptionsIdByAccountIdId(db,[account,id]);
  if(!rows.length)throw new ApiError(404,'webhook_not_found','Webhook tidak ditemukan');
  await deleteWebhookSubscriptionsByAccountIdId(db,[account,id]);return {deleted:true};
 }
 async enqueue(account:string,payload:EventPayload){
  if(this.stopped)return;
  const c=await db.getConnection();
  try{await c.beginTransaction();await lockAccountsIdById(c,[account]);
   const [count]=await countWebhookDeliveriesByAccountId(c,[account]);
   const [targets]=await selectWebhookSubscriptionsIdByAccountIdSessionId(c,[account,payload.sessionId]);
   if(count[0].total+targets.length>256)throw new ApiError(503,'webhook_queue_full','Antrean webhook akun penuh');
   for(const target of targets)await insertWebhookDeliveries(c,[randomUUID(),account,target.id,JSON.stringify(payload)]);
   await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 start(){if(this.timer||this.stopped)return;this.timer=setInterval(()=>{void this.tick().catch(()=>console.error('Pemrosesan webhook gagal.'));},1000).unref();}
 tick(){if(this.running)return this.running;this.running=this.work().finally(()=>{this.running=undefined;});return this.running;}
 private async work(){
  if(this.stopped)return;
  await deleteWebhookDeliveriesByAccountId(db,this.accountScope?[this.accountScope]:[],this.accountScope);
  // One delivery per tenant in each pass prevents a failed tenant from occupying every slot.
  const [rows]=await selectWebhookDeliveries(db,this.accountScope?[this.accountScope]:[],this.accountScope);
  await Promise.all(rows.map(async row=>{
   if(this.stopped)return;
   try{await this.send(row.url,typeof row.payload==='string'?JSON.parse(row.payload):row.payload,this.abort.signal);await deleteWebhookDeliveriesById(db,[row.id]);}
   catch{if(this.stopped)return;const attempts=row.attempts+1;
    if(attempts>=4)await deleteWebhookDeliveriesById(db,[row.id]);
    else await updateWebhookDeliveriesAttemptsById(db,[attempts,2**attempts,row.id]);
   }
  }));
 }
 async stop(){this.stopped=true;clearInterval(this.timer);this.abort.abort();await this.running;}
}
