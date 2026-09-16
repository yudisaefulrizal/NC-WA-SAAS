import {randomUUID} from 'node:crypto';
import {digest} from './security.js';
import {reserveCredit,settleCredit,validateReservation} from './credits.js';
import {ApiError,type SessionManager} from './engine/sessions.js';
import {object,recipient,requiredString,type MediaType,type Outbound} from './engine/messages.js';
import {downloadPublicMedia} from './engine/download.js';
import {db} from './db.js';
import type {RowDataPacket} from 'mysql2/promise';

export async function sendBilled(accountId:string,manager:SessionManager,id:string,kind:'text'|'media',body:unknown,key?:string,download=downloadPublicMedia){
 const input=object(body),jid=recipient(input.to);
 let content:Outbound;
 if(kind==='text')content={text:requiredString(input.text,'text')};
 else {
  const type=requiredString(input.type,'type');
  if(!['image','document','audio','video'].includes(type))throw new ApiError(400,'invalid_request','Jenis media tidak valid');
  content={type:type as MediaType,url:requiredString(input.url,'url',4096),
   caption:input.caption===undefined?undefined:requiredString(input.caption,'caption'),
   filename:input.filename===undefined?undefined:requiredString(input.filename,'filename',255)};
 }
 const requestId=key??randomUUID();
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))throw new ApiError(400,'invalid_request','Idempotency-Key harus 1–128 huruf, angka, garis bawah atau tanda hubung');
 manager.detail(id);
 let reservation;
 try{reservation=await reserveCredit(accountId,requestId,digest(JSON.stringify({id,jid,content})));}
 catch(error){
  const code=(error as Error).message;
  if(['insufficient_credits','idempotency_conflict'].includes(code))throw new ApiError(409,code,code==='insufficient_credits'?'Kredit habis.':'ID permintaan sudah digunakan untuk payload lain.');
  throw error;
 }
 if(!reservation.created){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT message_id,recipient FROM outbound_results WHERE account_id=? AND request_id=?',[accountId,requestId]);
  if(rows[0])return {messageId:rows[0].message_id,to:rows[0].recipient,requestId};
  throw new ApiError(409,'request_'+reservation.status,'Permintaan sudah tercatat; tidak dikirim ulang. Periksa riwayat pemakaian.');
 }
 let file:Awaited<ReturnType<typeof downloadPublicMedia>>|undefined;
 let accepted=false;
 try{
  manager.connected(id);
  if('url' in content){file=await download(content.url);content={...content,url:file.path,mimetype:file.mimetype};}
  const result=await manager.send(id,jid,content,async()=>{try{await validateReservation(accountId,requestId);}catch(error){if((error as Error).message==='reservation_expired')throw new ApiError(409,'reservation_expired','Periode kredit berakhir sebelum pesan dikirim');throw error;}});accepted=true;
  // Store the receipt before finalizing credit. A crash never causes an automatic resend.
  await db.execute('INSERT INTO outbound_results(account_id,request_id,message_id,recipient) VALUES (?,?,?,?)',[accountId,requestId,result.messageId,result.to]);
  await settleCredit(accountId,requestId,'sent');
  return {...result,requestId};
 }catch(error){
  const uncertain=accepted||(error instanceof ApiError&&error.code==='send_unknown');
  await settleCredit(accountId,requestId,uncertain?'unknown':'failed');
  if(error instanceof ApiError)throw error;
  throw new ApiError(502,uncertain?'send_unknown':'send_failed',uncertain?'Hasil pengiriman belum pasti; jangan kirim ulang.':'Pengiriman gagal sebelum diterima transport.');
 }finally{await file?.cleanup();}
}
