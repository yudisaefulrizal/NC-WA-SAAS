import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {activatePackage} from './plans.js';
import {ApiError} from './engine/sessions.js';
import {object,requiredString} from './engine/messages.js';
const base=(environment:string)=>environment==='production'?'https://api.midtrans.com':'https://api.sandbox.midtrans.com';
function encryptionKey(){const key=process.env.PAYMENT_ENCRYPTION_KEY;if(!key||! /^[a-f0-9]{64}$/i.test(key))throw new ApiError(503,'payment_not_configured','Kunci enkripsi pembayaran belum dikonfigurasi');return Buffer.from(key,'hex');}
export function encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),encrypted].map(v=>v.toString('hex')).join(':');}
function decrypt(value:string){const [iv,tag,body]=value.split(':').map(v=>Buffer.from(v,'hex'));const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(body),cipher.final()]).toString('utf8');}
export type Transport=(environment:string,key:string,path:string,body?:unknown)=>Promise<Record<string,any>>;
const transport:Transport=async(environment,key,path,body)=>{
 const response=await fetch(base(environment)+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64'),'Content-Type':'application/json',Accept:'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json() as Record<string,any>;
 if(!response.ok&&![400,401,402,404,410].includes(response.status))throw new ApiError(502,'payment_provider_error','Midtrans belum dapat dihubungi atau konfigurasi ditolak');return data;
};
export class Payments {
 constructor(private call:Transport=transport,private configId?:string){}
 async configuration(){const [rows]=await db.query<RowDataPacket[]>('SELECT c.id,c.environment,c.created_at FROM payment_config c JOIN payment_settings s ON s.config_id=c.id WHERE s.id=1');return {configured:Boolean(rows[0]),...(rows[0]??{}),serverKey:rows[0]?'********':null,notificationUrl:(process.env.APP_ORIGIN??'http://127.0.0.1:8067')+'/payments/midtrans/notification'};}
 async configure(actor:string,body:unknown){
  const input=object(body);if(!['sandbox','production'].includes(String(input.environment)))throw new ApiError(400,'invalid_request','Lingkungan tidak valid');
  const key=requiredString(input.serverKey,'serverKey',512);if(!/^[A-Za-z0-9_-]+$/.test(key))throw new ApiError(400,'invalid_request','Format Server Key tidak valid');
  const secret=encrypt(key),id=randomUUID(),c=await db.getConnection();
  try{await c.beginTransaction();await c.execute('INSERT INTO payment_config(id,environment,secret) VALUES (?,?,?)',[id,String(input.environment),secret]);await c.execute('INSERT INTO payment_settings VALUES (1,?) ON DUPLICATE KEY UPDATE config_id=VALUES(config_id)',[id]);await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'payment_config_rotated')",[actor]);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}
  return this.configuration();
 }
 private async credential(id=this.configId){
  const [rows]=await db.execute<RowDataPacket[]>(id?'SELECT * FROM payment_config WHERE id=?':'SELECT c.* FROM payment_config c JOIN payment_settings s ON c.id=s.config_id WHERE s.id=1',id?[id]:[]);
  if(!rows[0])throw new ApiError(503,'payment_not_configured','Pembayaran belum tersedia');return {id:rows[0].id as string,environment:rows[0].environment as string,key:decrypt(rows[0].secret)};
 }
 async test(){const c=await this.credential();const data=await this.call(c.environment,c.key,'/v2/ncwa-check-'+randomUUID()+'/status');if(String(data.status_code)!=='404')throw new ApiError(502,'payment_provider_error','Kredensial belum terverifikasi');return {ok:true,message:'Autentikasi status berhasil; aktivasi QRIS tetap perlu diuji di merchant.'};}
 async list(account:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT id,plan_id,plan_name,price,fee,total,status,environment,created_at,activated_at,expires_at,qr_url FROM payment_orders WHERE account_id=? ORDER BY created_at DESC LIMIT 100',[account]);return rows;}
 async order(account:string,id:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT id,plan_id,plan_name,price,fee,total,status,environment,created_at,activated_at,expires_at,qr_url FROM payment_orders WHERE account_id=? AND id=?',[account,id]);if(!rows[0])throw new ApiError(404,'order_not_found','Pembayaran tidak ditemukan');return rows[0];}
 async create(account:string,planId:unknown){
  const selected=requiredString(planId,'planId',36);
  const [stale]=await db.execute<RowDataPacket[]>("SELECT id FROM payment_orders WHERE account_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP() LIMIT 1",[account]);
  if(stale[0]){await this.reconcile(stale[0].id);const previous=await this.order(account,stale[0].id);if(previous.status==='settlement')return previous;}
  const config=await this.credential();const c=await db.getConnection();let id:string;
  try{await c.beginTransaction();await c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',[account]);
   const [pending]=await c.execute<RowDataPacket[]>("SELECT id,plan_id FROM payment_orders WHERE account_id=? AND status IN ('creating','pending','unknown') LIMIT 1",[account]);
   if(pending[0]){if(pending[0].plan_id!==planId)throw new ApiError(409,'payment_pending','Selesaikan pembayaran sebelumnya terlebih dahulu');await c.commit();return this.order(account,pending[0].id);}
   const [plans]=await c.execute<RowDataPacket[]>('SELECT * FROM plans WHERE id=? AND active=TRUE AND price>0 FOR SHARE',[selected]);const plan=plans[0];if(!plan)throw new ApiError(400,'plan_unavailable','Paket tidak dapat dibeli');
   id='ncwa-'+randomUUID();await c.execute('INSERT INTO payment_orders(id,account_id,plan_id,plan_name,price,fee,total,credits,session_limit,config_id,environment) VALUES (?,?,?,?,?,0,?,?,?,?,?)',[id,account,plan.id,plan.name,plan.price,plan.price,plan.credits,plan.session_limit,config.id,config.environment]);await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
  try{
   const order=await this.internal(id);const data=await this.call(config.environment,config.key,'/v2/charge',{payment_type:'qris',transaction_details:{order_id:id,gross_amount:order.total},qris:{acquirer:'gopay'},custom_expiry:{expiry_duration:15,unit:'minute'}});
   // Charge responses only persist payment data. Activation always requires GET Status.
   if(['400','401','402','410'].includes(String(data.status_code)))await db.execute("UPDATE payment_orders SET status='deny' WHERE id=? AND status='creating'",[id]);
   else await this.apply(id,data,false);
  }catch{await db.execute("UPDATE payment_orders SET status='unknown' WHERE id=? AND status='creating'",[id]);}
  return this.order(account,id);
 }
 private async internal(id:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT * FROM payment_orders WHERE id=?',[id]);if(!rows[0])throw new ApiError(404,'order_not_found','Pembayaran tidak ditemukan');return rows[0];}
 async reconcile(id:string){const order=await this.internal(id),config=await this.credential(order.config_id);const data=await this.call(config.environment,config.key,'/v2/'+encodeURIComponent(id)+'/status');
  if(String(data.status_code)==='404'){
   // Never retry charge after an ambiguous create; keep it visible for manual reconciliation.
   await db.execute("UPDATE payment_orders SET checked_at=UTC_TIMESTAMP(),status=IF(created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY),'not_found',status) WHERE id=? AND status IN ('creating','unknown')",[id]);return;
  }
  await this.apply(id,data,true);
 }
 async cancel(account:string,id:string){
  await this.order(account,id);
  await this.reconcile(id);
  let order=await this.order(account,id);
  if(!['creating','pending','unknown'].includes(order.status))return order;
  if(order.status!=='pending')throw new ApiError(409,'payment_processing','Status pembayaran masih diperiksa. Coba lagi beberapa saat lagi.');
  const stored=await this.internal(id),config=await this.credential(stored.config_id);
  // A timeout or a simultaneous payment is resolved through GET Status.
  try{await this.call(config.environment,config.key,'/v2/'+encodeURIComponent(id)+'/cancel',{});}catch{}
  await this.reconcile(id);order=await this.order(account,id);
  if(['creating','pending','unknown'].includes(order.status))throw new ApiError(409,'cancel_unconfirmed','Pembatalan belum terkonfirmasi. Periksa status kembali sebelum membayar.');
  return order;
 }
 async notification(body:unknown){const data=object(body),id=requiredString(data.order_id,'order_id',64),order=await this.internal(id),config=await this.credential(order.config_id);
  if(typeof data.status_code!=='string'||typeof data.gross_amount!=='string'||typeof data.signature_key!=='string'||! /^[a-f0-9]{128}$/i.test(data.signature_key))throw new ApiError(403,'invalid_signature','Notifikasi tidak valid');
  const expected=createHash('sha512').update(id+data.status_code+data.gross_amount+config.key).digest();if(!timingSafeEqual(expected,Buffer.from(data.signature_key,'hex')))throw new ApiError(403,'invalid_signature','Notifikasi tidak valid');
  await this.reconcile(id);return {ok:true};
 }
 private async apply(id:string,data:Record<string,any>,verified:boolean){
  const found=await this.internal(id),c=await db.getConnection();
  try{await c.beginTransaction();await c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',[found.account_id]);const [rows]=await c.execute<RowDataPacket[]>('SELECT * FROM payment_orders WHERE id=? FOR UPDATE',[id]);const order=rows[0];
   if(data.order_id!==id||data.currency!=='IDR'||data.payment_type!=='qris'||!/^\d+(\.00)?$/.test(String(data.gross_amount))||Number(data.gross_amount)!==order.total||typeof data.transaction_id!=='string'||!data.transaction_id||data.transaction_id.length>100||(order.transaction_id&&order.transaction_id!==data.transaction_id))throw new ApiError(409,'payment_mismatch','Identitas atau nominal pembayaran tidak cocok');
   if(order.activated_at){await c.commit();return;}
   let status=order.status;
   if(verified&&data.transaction_status==='settlement'&&String(data.status_code)==='200'&&(data.fraud_status===undefined||data.fraud_status==='accept')){
    await activatePackage(c,order.account_id,id,{id:order.plan_id,credits:order.credits,session_limit:order.session_limit});status='settlement';
    await c.execute('UPDATE payment_orders SET activated_at=UTC_TIMESTAMP() WHERE id=?',[id]);
   }else if(['pending','expire','deny','cancel'].includes(data.transaction_status))status=data.transaction_status;
   let expires=order.expires_at;
   const expiryText=data.expiry_time??data.transaction_time;
   if(typeof expiryText==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(expiryText)){const parsed=new Date(expiryText.replace(' ','T')+'+07:00');if(Number.isFinite(parsed.getTime()))expires=new Date(parsed.getTime()+(data.expiry_time?0:15*60000));}
   let qr=order.qr_url;
   const actions=Array.isArray(data.actions)?data.actions:[];
   for(const name of ['generate-qr-code-v2','generate-qr-code']){
    let accepted=false;
    for(const action of actions.filter((a:any)=>a?.name===name)){
     if(action.method!=='GET'||typeof action.url!=='string')continue;
     try{const url=new URL(action.url);if(url.origin===base(order.environment)&&/^\/v[24]\/qris\/[A-Za-z0-9_-]+\/qr-code$/.test(url.pathname)&&!url.search&&!url.hash&&!url.username&&!url.password){qr=url.href;accepted=true;break;}}catch{}
    }
    if(accepted)break;
   }
   // GET Status omits actions. Recover the documented v2 QR endpoint for
   // verified pending transactions whose original QR URL was not stored.
   if(!qr&&verified&&status==='pending'&&/^[A-Za-z0-9_-]+$/.test(data.transaction_id))qr=base(order.environment)+'/v2/qris/'+data.transaction_id+'/qr-code';
   await c.execute('UPDATE payment_orders SET status=?,transaction_id=?,qr_url=?,expires_at=?,checked_at=UTC_TIMESTAMP() WHERE id=?',[status,data.transaction_id,qr,expires,id]);await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 async qr(account:string,id:string){const order=await this.internal(id);if(order.account_id!==account||!order.qr_url||order.status!=='pending')throw new ApiError(404,'qr_not_found','QR pembayaran tidak tersedia');const config=await this.credential(order.config_id);
  const url=new URL(order.qr_url);if(url.origin!==base(config.environment))throw new ApiError(409,'payment_mismatch','URL QR tidak valid');
  const response=await fetch(url,{headers:{Authorization:'Basic '+Buffer.from(config.key+':').toString('base64')},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw new ApiError(502,'payment_provider_error','QR tidak dapat dimuat');
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>1024*1024)throw new ApiError(502,'payment_provider_error','QR terlalu besar');return bytes;
 }
 async sweep(){const [rows]=await db.query<RowDataPacket[]>("SELECT id FROM payment_orders WHERE status IN ('creating','pending','unknown') AND (checked_at IS NULL OR checked_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)) ORDER BY COALESCE(checked_at,created_at) LIMIT 10");for(const row of rows){try{await this.reconcile(row.id);}catch{await db.execute('UPDATE payment_orders SET checked_at=UTC_TIMESTAMP() WHERE id=?',[row.id]);}}}
}
export const payments=new Payments();
