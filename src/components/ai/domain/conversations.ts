import {request} from 'node:https';
import type {PoolConnection} from 'mysql2/promise';
import {db} from '../../../libraries/db.js';
import {digest} from '../../../libraries/security.js';
import {type SessionManager} from '../../whatsapp/index.js';
import {ApiError} from '../../../libraries/errors.js';
import {object} from '../../../libraries/validation.js';
import type {IncomingMessage} from '../../whatsapp/index.js';
import {sendBilled} from '../../billing/index.js';
import {recordNote,recordOutgoing} from './chat.js';
import {countFallbacksByAccountIdSessionId,deleteAssistantsByAccountIdSessionId,deleteConversationsByAccountIdSessionId,deleteFallbacksByIdAccountIdSessionId,deleteWHEREByAccountIdSessionId,insertManualMessageOrigin,insertSystemMessageOrigin,lockConversationForReply,lockConversationsMessagesByAccountIdSessionIdCustomer,lockConversationsPausedFullAutoByAccountIdSessionIdCustomer,lockDataProfilesProfilFaqProfileTypeByIdAccountId,lockFallbacksByAccountIdSessionIdNotificationMessageId,lockFallbacksByIdAccountIdSessionId,lockFallbacksStatusByIdAccountIdSessionId,markFallbackAnswered,selectAssistantsEnabledByAccountIdSessionId,selectAssistantsFallbackNumberByAccountIdSessionIdFallbackNumber,selectChatMessagesOriginByAccountIdSessionIdMessageId,selectConversationsByAccountIdSessionId,selectConversationsPausedFullAutoByAccountIdSessionIdCustomer,selectFallbacksByAccountIdSessionId,selectMessageOriginsOriginByAccountIdSessionIdMessageId,updateConversationMemoryRevision,updateConversationsPausedByAccountIdSessionIdCustomer,updateFallbackResolution,upsertConversations} from '../data-access/conversations-queries.js';
import {insertIgnoreConversations,shareSettingsMemoryLimit,updateDataProfilesProfilFaqByIdAccountId} from '../data-access/shared-queries.js';
import {defaults} from './provider.js';
import {fail,text} from './input.js';
import {composeKnowledge} from './profiles/cs/knowledge.js';
import {faqLimit,transaction,lockAccount,parseMemory} from './shared.js';
import type {AIService} from './service.js';
import * as dataProfiles from './data-profiles.js';
// Conversation control around the AI: system/manual message origins, manual replies, pause and full auto, fallback tickets.
export async function registerSystemMessage(svc:AIService,account:string,session:string,messageId:string){
  await insertSystemMessageOrigin(db,[account,session,messageId]);
 }
export async function handleFallbackReply(svc:AIService,account:string,manager:SessionManager,session:string,message:IncomingMessage){
  const [settings]=await selectAssistantsFallbackNumberByAccountIdSessionIdFallbackNumber(db,[account,session,message.from]);
  if(!settings[0]?.fallback_number)return false;
  const ticketId=message.text.match(/\b(FB-[A-Z0-9]{8,48})\b/i)?.[1]?.toUpperCase();
  const ticket=await transaction(async c=>{
   const [rows]=await lockFallbacksByAccountIdSessionIdNotificationMessageId(c,[account,session,message.quotedMessageId??'',ticketId??'']);
   const row=rows[0];if(!row)return;
   await markFallbackAnswered(c,[message.text.trim().slice(0,8000),row.id]);
   return row;
  });
  if(!ticket)return true;
  const answer='Berikut konfirmasi dari tim: '+message.text.trim();
  let sent=false;
  try{const relayed=await sendBilled(account,manager,session,'text',{to:ticket.customer,text:answer},'fallback_resume_'+digest(message.messageId).slice(0,64));sent=true;await recordOutgoing(account,session,{customer:ticket.customer,messageId:relayed.messageId,origin:'manual',text:answer}).catch(()=>{});}catch{}
  await transaction(async c=>{
   await updateFallbackResolution(c,[sent?'resolved':'failed',sent,ticket.id]);
   if(!sent)return;
   const [limits]=await shareSettingsMemoryLimit(c);
   const [rows]=await lockConversationsMessagesByAccountIdSessionIdCustomer(c,[account,session,ticket.customer]);
   if(rows[0])await updateConversationMemoryRevision(c,[JSON.stringify([...parseMemory(rows[0].messages),{role:'assistant',content:answer}].slice(-(limits[0]?.memory_limit??defaults.memory_limit))),account,session,ticket.customer]);
  });
  return true;
 }
export async function answerFallback(svc:AIService,account:string,manager:SessionManager,session:string,id:string,body:unknown){
  if(!/^FB-[A-Z0-9]{8,48}$/.test(id))throw fail('ID fallback tidak valid');
  const answer=text(object(body).answer,8000,'Jawaban fallback');if(!answer)throw fail('Jawaban fallback wajib diisi');
  const ticket=await transaction(async c=>{
   const [rows]=await lockFallbacksByIdAccountIdSessionId(c,[id,account,session]);
   if(!rows[0])throw new ApiError(404,'fallback_not_found','Tiket fallback tidak tersedia.');
   await markFallbackAnswered(c,[answer,rows[0].id]);return rows[0];
  });
  const customerAnswer='Berikut konfirmasi dari tim: '+answer;let sent=false;
  try{await sendBilled(account,manager,session,'text',{to:ticket.customer,text:customerAnswer},'fallback_web_'+digest(id+'\0'+answer).slice(0,64)).then(async relayed=>{await recordOutgoing(account,session,{customer:ticket.customer,messageId:relayed.messageId,origin:'manual',text:customerAnswer}).catch(()=>{});});sent=true;}catch{}
  await transaction(async c=>{await updateFallbackResolution(c,[sent?'resolved':'failed',sent,id]);if(sent){const [limits]=await shareSettingsMemoryLimit(c);const [rows]=await lockConversationsMessagesByAccountIdSessionIdCustomer(c,[account,session,ticket.customer]);if(rows[0])await updateConversationMemoryRevision(c,[JSON.stringify([...parseMemory(rows[0].messages),{role:'assistant',content:customerAnswer}].slice(-(limits[0]?.memory_limit??defaults.memory_limit))),account,session,ticket.customer]);}});
  return {ok:sent,status:sent?'resolved':'failed'};
 }
export async function manualOutgoing(svc:AIService,account:string,session:string,message:IncomingMessage){
  if(message.isGroup||! /^[1-9][0-9]{5,14}$/.test(message.from))return;
  await transaction(async c=>{
   await lockAccount(c,account);
   const [known]=await selectMessageOriginsOriginByAccountIdSessionIdMessageId(c,[account,session,message.messageId]);
   if(known[0])return;
   await insertManualMessageOrigin(c,[account,session,message.messageId]);
   await applyManualReply(svc,c,account,session,message.from,(message.type==='text'?message.text:`[Pesan ${message.type} manual] ${message.text}`).trim().slice(0,4000));
  });
 }
export async function applyManualReply(svc:AIService,c:PoolConnection,account:string,session:string,customer:string,content:string){
  const [assistant]=await selectAssistantsEnabledByAccountIdSessionId(c,[account,session]);
  if(!assistant[0]?.enabled)return;
  const [settings]=await shareSettingsMemoryLimit(c);
  const limit=settings[0]?.memory_limit??defaults.memory_limit;
  await insertIgnoreConversations(c,[account,session,customer]);
  const [rows]=await lockConversationForReply(c,[account,session,customer]);
  const memory=[...parseMemory(rows[0].messages),...(content?[{role:'assistant' as const,content}]:[])].slice(-limit);
  await updateConversationsPausedByAccountIdSessionIdCustomer(c,[JSON.stringify(memory),account,session,customer]);
  if(!rows[0].paused&&!rows[0].full_auto)await recordNote(account,session,customer,'AI dijeda karena ada balasan manual',c);
 }
export async function knownOrigin(svc:AIService,account:string,session:string,messageId:string){const [rows]=await selectMessageOriginsOriginByAccountIdSessionIdMessageId(db,[account,session,messageId]);return rows[0]?.origin as string|undefined;}
export async function dashboardReply(svc:AIService,account:string,manager:SessionManager,session:string,customer:string,body:unknown,key:unknown){
  if(!/^[0-9]{5,20}$/.test(customer))throw fail('Nomor pelanggan tidak valid');
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(key))throw fail('Idempotency-Key wajib diisi');
  const input=object(body),message=text(input.text,4000,'Pesan');if(!message)throw fail('Pesan wajib diisi');
  const sent=await sendBilled(account,manager,session,'text',{to:customer,text:message},'manual_'+key);
  // A retried request returns the original send; only its first completion touches memory and history.
  const [existing]=await selectChatMessagesOriginByAccountIdSessionIdMessageId(db,[account,session,sent.messageId]);
  if(!existing[0])await transaction(async c=>{await lockAccount(c,account,true);await recordOutgoing(account,session,{customer,messageId:sent.messageId,origin:'manual',text:message},c);await applyManualReply(svc,c,account,session,customer,message);});
  return {messageId:sent.messageId};
 }
export async function removeSession(svc:AIService,account:string,session:string){await transaction(async c=>{await lockAccount(c,account,true);for(const table of ['ai_chat_messages','ai_fallbacks'])await deleteWHEREByAccountIdSessionId(c,[account,session],table);await deleteAssistantsByAccountIdSessionId(c,[account,session]);await deleteConversationsByAccountIdSessionId(c,[account,session]);});}
export async function conversations(svc:AIService,account:string,session:string){const [rows]=await selectConversationsByAccountIdSessionId(db,[account,session]);return rows;}
export async function fallbacks(svc:AIService,account:string,session:string,value:unknown){
  if(typeof value!=='string'||!/^\d{1,9}$/.test(value)||Number(value)<1)throw fail('Halaman tidak valid');
  const size=20;
  const [counts]=await countFallbacksByAccountIdSessionId(db,[account,session]);
  const total=Number(counts[0].total),pages=Math.max(1,Math.ceil(total/size)),page=Math.min(Number(value),pages);
  const [items]=await selectFallbacksByAccountIdSessionId(db,[account,session],size,page);
  return {items,page,pages,total,page_size:size};
 }
export async function removeFallback(svc:AIService,account:string,session:string,id:string){
  if(!/^FB-[A-Z0-9]{8,48}$/.test(id))throw fail('ID fallback tidak valid');
  const [result]=await deleteFallbacksByIdAccountIdSessionId(db,[id,account,session]);
  if(!result.affectedRows)throw new ApiError(404,'fallback_not_found','Tiket fallback tidak tersedia.');
  return {ok:true};
 }
export async function applyFallbackKnowledge(svc:AIService,account:string,session:string,id:string,body:unknown){
  if(!/^FB-[A-Z0-9]{8,48}$/.test(id))throw fail('ID fallback tidak valid');
  const content=text(object(body).content,2000,'Knowledge dari fallback');if(!content)throw fail('Knowledge dari fallback wajib diisi');
  return transaction(async c=>{await lockAccount(c,account);const [tickets]=await lockFallbacksStatusByIdAccountIdSessionId(c,[id,account,session]);if(!tickets[0]||tickets[0].status!=='resolved')throw new ApiError(409,'fallback_not_ready','Tiket harus sudah selesai sebelum diterapkan.');
   const profile=await dataProfiles.ensureDataProfile(svc,c,account,session);
   const [profiles]=await lockDataProfilesProfilFaqProfileTypeByIdAccountId(c,[profile,account]);const previous=String(profiles[0]?.profil_faq??''),faq=(previous?previous+'\n\n':'')+content,limit=faqLimit(String(profiles[0]?.profile_type));if(faq.length>limit)throw fail('Bagian FAQ melebihi batas '+limit.toLocaleString('id-ID')+' karakter; kosongkan sebagian sebelum menambah lagi.');
   await updateDataProfilesProfilFaqByIdAccountId(c,[faq,profile,account]);const knowledge=composeKnowledge({faq});return {ok:true,knowledge};
  });
 }
export async function updateConversation(svc:AIService,account:string,session:string,customer:string,body:unknown){
  if(!/^[0-9]{5,20}$/.test(customer))throw fail('Nomor pelanggan tidak valid');
  const input=object(body);if(typeof input.paused!=='boolean'||(input.clear!==undefined&&typeof input.clear!=='boolean')||(input.full_auto!==undefined&&typeof input.full_auto!=='boolean')||(input.paused&&input.full_auto===true))throw fail('Status percakapan tidak valid');
  await transaction(async c=>{await lockAccount(c,account);const [before]=await lockConversationsPausedFullAutoByAccountIdSessionIdCustomer(c,[account,session,customer]);await upsertConversations(c,[account,session,customer,Boolean(input.paused),input.full_auto===true,Boolean(input.paused)||input.full_auto!==undefined,input.clear===true,input.clear===true]);
   // Shown in the chat history, so the owner can see why the AI stopped or resumed answering.
   const was={paused:Boolean(before[0]?.paused),full_auto:Boolean(before[0]?.full_auto)},[after]=await selectConversationsPausedFullAutoByAccountIdSessionIdCustomer(c,[account,session,customer]);
   if(!was.paused&&after[0].paused)await recordNote(account,session,customer,'AI dijeda oleh admin',c);
   if(was.paused&&!after[0].paused)await recordNote(account,session,customer,'AI dilanjutkan oleh admin',c);
   if(was.full_auto!==Boolean(after[0].full_auto))await recordNote(account,session,customer,after[0].full_auto?'Full auto diaktifkan':'Full auto dinonaktifkan',c);
   if(input.clear===true)await recordNote(account,session,customer,'Konteks AI dihapus; riwayat chat tetap tersimpan',c);
  });return {ok:true};
 }
