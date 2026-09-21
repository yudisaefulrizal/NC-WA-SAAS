import {routerResponseFormat} from './ai-router-schema.js';
import {modelTiers,tierConfig,type ModelRole,type AgentWorkflow,type AITraceEvent} from './ai-models.js';
import {activeWorkflow} from './ai-workflow.js';
import {transientAIError} from './ai-retry.js';
import {publicSources,sourceInput,saveSource} from './ai-data.js';
import {runAgents,updateRouterContext,defaultTools,type AITools} from './ai-agents.js';
import {randomInt,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {request} from 'node:https';
import type {PoolConnection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {db} from './db.js';
import {encrypt,decrypt} from './payments.js';
import {digest} from './security.js';
import {ApiError,type SessionManager} from './engine/sessions.js';
import {validatePublicUrl} from './engine/download.js';
import {object} from './engine/messages.js';
import type {IncomingMessage} from './engine/incoming.js';
import {basicWallet} from './plans.js';
import {sendBilled} from './outbound.js';
export type AIMessage={role:'system'|'user'|'assistant';content:string};
export interface AIConfig {signal?:AbortSignal;workflow?:AgentWorkflow;onTrace?:(event:AITraceEvent)=>void;model_cheap?:string;model_medium?:string;model_smart?:string;call_role?:ModelRole;endpoint:string;model:string;secret:string;input_rate:number;output_rate:number;memory_limit:number;credit_price:number}
export const defaults:AIConfig={endpoint:'https://ai.sumopod.com/v1/chat/completions',model:'deepseek-v4-flash',secret:'',input_rate:1,output_rate:2,memory_limit:60,credit_price:0};
export const countWords=(text:string)=>text.match(/\S+/gu)?.length??0;
// Product and price are handled by the dedicated products table (ai-data.ts), not free-text here.
// Bidang is folded into Deskripsi rather than kept as its own field.
export const profileFields=['nama','deskripsi','alamat','kontak','jam_operasional','cara_pemesanan','pembayaran','kebijakan','faq','lainnya'] as const;
export type ProfileField=typeof profileFields[number];
const profileLabels:Record<ProfileField,string>={nama:'Nama perusahaan/lembaga',deskripsi:'Deskripsi',alamat:'Alamat',kontak:'Kontak',jam_operasional:'Jam operasional',cara_pemesanan:'Cara pemesanan',pembayaran:'Metode pembayaran',kebijakan:'Kebijakan',faq:'FAQ',lainnya:'Lainnya'};
// Only filled-in fields are sent to the agent; empty ones add no noise to the prompt.
export function composeKnowledge(profile:Partial<Record<ProfileField,string>>){
 return profileFields.map(field=>{const value=profile[field]?.trim();return value?profileLabels[field]+': '+value:null;}).filter(Boolean).join('\n\n');
}
export const aiFallback='Maaf, saya sedang mengalami kendala memproses pesan Anda. Silakan coba lagi beberapa saat. Jika terkait pesanan, mohon periksa status pesanan terlebih dahulu sebelum mengulang pemesanan.';
export const creditCost=(input:number,output:number,inputRate:number,outputRate:number)=>input*inputRate+output*outputRate;
const fail=(message:string)=>new ApiError(400,'invalid_request',message);
function integer(value:unknown,min:number,max:number,name:string){if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw fail(name+' di luar batas');return Number(value);}
function text(value:unknown,max:number,name:string){if(typeof value!=='string'||value.length>max)throw fail(name+' tidak valid atau terlalu panjang');return value.trim();}
export function chatEndpoint(value:string){let url:URL;try{url=new URL(value);}catch{throw fail('Endpoint tidak valid');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw fail('Endpoint wajib HTTPS tanpa kredensial, query, atau fragmen');url.pathname=url.pathname.replace(/\/$/,'');if(url.pathname===''||url.pathname==='/')url.pathname='/v1/chat/completions';else if(url.pathname==='/v1')url.pathname+='/chat/completions';else if(!url.pathname.endsWith('/chat/completions'))throw fail('Gunakan endpoint Chat Completions');return url.href;}
export type AITransport=(config:AIConfig,messages:AIMessage[],maxWords:number)=>Promise<string>;
// Validate and pin DNS. Never follow redirects carrying the provider credential.
export function aiRequestPayload(config:AIConfig,messages:AIMessage[]){
 return {model:config.model,messages:[...messages],stream:false,max_tokens:2048,...(config.call_role==='router'&&config.workflow?.nodes.router.structured_output===true?{response_format:routerResponseFormat()}:{})};
}
export const callAI:AITransport=async(config,messages,maxWords)=>{
 const {url,addresses}=await validatePublicUrl(config.endpoint);
 const payload=JSON.stringify(aiRequestPayload(config,messages));
 return new Promise<string>((resolve,reject)=>{
  const req=request(url,{method:'POST',agent:false,signal:config.signal?AbortSignal.any([config.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+decrypt(config.secret),'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)},lookup:(_hostname,options,callback)=>{if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);}},res=>{
   const chunks:Buffer[]=[];let size=0;
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>262144){res.destroy(new Error('ai_response_limit'));return;}chunks.push(chunk);});
   res.on('error',error=>reject(new Error(error.message==='ai_response_limit'?'ai_response_limit':'ai_provider_failed')));
   res.on('end',()=>{
    if(res.statusCode!==200){reject(new Error('ai_provider_http_'+res.statusCode));return;}
    try{const data=JSON.parse(Buffer.concat(chunks).toString());const content=data.choices?.[0]?.message?.content;
     if(typeof content!=='string'||!content.trim()){reject(new Error('ai_provider_empty_content'));return;}
     resolve(content.trim());
    }catch{reject(new Error('ai_provider_invalid_json'));}
   });
  });req.on('error',()=>reject(new Error('ai_provider_failed')));req.end(payload);
 });
};
async function transaction<T>(fn:(c:PoolConnection)=>Promise<T>){const c=await db.getConnection();try{await c.beginTransaction();const result=await fn(c);await c.commit();return result;}catch(e){await c.rollback();throw e;}finally{c.release();}}
async function lockAccount(c:PoolConnection,account:string,settling=false){const [rows]=await c.execute<RowDataPacket[]>('SELECT id,suspended FROM accounts WHERE id=? FOR UPDATE',[account]);if(!rows[0]||(!settling&&rows[0].suspended))throw new ApiError(403,'account_unavailable','Akun tidak tersedia');}
function parseMemory(value:unknown):AIMessage[]{return (typeof value==='string'?JSON.parse(value):value) as AIMessage[];}
export class AIService {
 private queues=new Map<string,Promise<void>>();
 private queued=0;
 constructor(private transport:AITransport=callAI,private wait:(milliseconds:number)=>Promise<void>=async milliseconds=>{await delay(milliseconds);},private tools:AITools=defaultTools){}
 async config():Promise<AIConfig>{const [rows]=await db.query<RowDataPacket[]>('SELECT * FROM ai_settings WHERE id=1');const config:AIConfig=rows[0]?{...defaults,...rows[0]}:{...defaults};for(const tier of modelTiers)config[`model_${tier}`]=config[`model_${tier}`]||config.model;config.workflow=await activeWorkflow();return config;}
 async configuration(){const {secret,workflow,onTrace,...config}=await this.config();return {...config,configured:Boolean(secret),apiKey:secret?'********':null};}
 async configure(actor:string,body:unknown){const input=object(body),previous=await this.config();
  const config:AIConfig={endpoint:chatEndpoint(text(input.endpoint,512,'Endpoint')),model:text(input.model_medium??input.model,100,'Model sedang'),secret:previous.secret,input_rate:integer(input.input_rate,0,1000,'Tarif input'),output_rate:integer(input.output_rate,1,1000,'Tarif output'),memory_limit:integer(input.memory_limit,1,100,'Batas memori'),credit_price:integer(input.credit_price,0,1000000,'Harga per 10.000 kredit')};
  for(const tier of modelTiers){const key=('model_'+tier) as 'model_cheap'|'model_medium'|'model_smart';config[key]=text(input[key]??(tier==='medium'?config.model:previous[key])??config.model,100,'Model '+tier);if(!config[key])throw fail('Model '+tier+' wajib diisi');}
  if(!config.model)throw fail('Model wajib diisi');await validatePublicUrl(config.endpoint);
  if(input.apiKey!==undefined&&input.apiKey!==''){const key=text(input.apiKey,512,'API key');if(!key||/[\r\n]/.test(key))throw fail('API key tidak valid');config.secret=encrypt(key);}
  if(!config.secret)throw fail('API key wajib diisi');
  await transaction(async c=>{await c.execute('INSERT INTO ai_settings(id,endpoint,model,secret,input_rate,output_rate,memory_limit,credit_price,model_cheap,model_medium,model_smart) VALUES (1,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE endpoint=VALUES(endpoint),model=VALUES(model),secret=VALUES(secret),input_rate=VALUES(input_rate),output_rate=VALUES(output_rate),memory_limit=VALUES(memory_limit),credit_price=VALUES(credit_price),model_cheap=VALUES(model_cheap),model_medium=VALUES(model_medium),model_smart=VALUES(model_smart)',[config.endpoint,config.model,config.secret,config.input_rate,config.output_rate,config.memory_limit,config.credit_price,config.model_cheap??config.model,config.model_medium??config.model,config.model_smart??config.model]);
   // JSON slicing trims every tenant immediately without exposing conversation content.
   const [rows]=await c.query<RowDataPacket[]>('SELECT account_id,session_id,customer,messages FROM ai_conversations FOR UPDATE');
   for(const row of rows)await c.execute('UPDATE ai_conversations SET messages=? WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify(parseMemory(row.messages).slice(-config.memory_limit)),row.account_id,row.session_id,row.customer]);
   await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'ai_settings_updated')",[actor]);});return this.configuration();
 }
 async test(tier:unknown='medium'){
  if(tier!=='cheap'&&tier!=='medium'&&tier!=='smart')throw fail('Tier model tidak valid');
  const config=tierConfig(await this.config(),tier);if(!config.secret)throw fail('AI belum dikonfigurasi');
  try{await this.transport(config,[{role:'user',content:'Balas hanya OK.'}],10);return {ok:true,tier,model:config.model,message:'Koneksi model '+tier+' ('+config.model+') berhasil diuji.'};}
  catch{throw new ApiError(502,'ai_provider_failed','Koneksi model '+tier+' belum berhasil; periksa endpoint, key, dan model.');}
 }
 async modelUsage(){const [rows]=await db.query('SELECT account_id,session_id,request_id,status,agent,model_calls,created_at FROM ai_usage ORDER BY created_at DESC LIMIT 100');return rows;}
 async agentFailures(value:unknown){
  if(typeof value!=='string'||!/^\d{1,9}$/.test(value)||Number(value)<1)throw fail('Halaman tidak valid');
  const size=20;
  const [counts]=await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_agent_failures');
  const total=Number(counts[0].total),pages=Math.max(1,Math.ceil(total/size)),page=Math.min(Number(value),pages);
  const [items]=await db.query('SELECT id,account_id,session_id,request_id,agent,error,message,model,created_at FROM ai_agent_failures ORDER BY created_at DESC,id DESC LIMIT '+size+' OFFSET '+((page-1)*size));
  return {items,page,pages,total,page_size:size};
 }
 async agentFailureDetail(id:unknown){
  if(typeof id!=='string'||!/^\d{1,20}$/.test(id))throw fail('ID kegagalan tidak valid');
  const [rows]=await db.execute<RowDataPacket[]>('SELECT prompt,raw_output,router_context FROM ai_agent_failures WHERE id=?',[id]);
  if(!rows[0])throw new ApiError(404,'not_found','Detail kegagalan tidak ditemukan');
  return {prompt:rows[0].prompt,raw_output:rows[0].raw_output,router_context:rows[0].router_context};
 }
 async trial(account:string,body:unknown){
  const input=object(body),question=text(input.question,2000,'Pertanyaan'),session=text(input.session,64,'Sesi');
  if(!question)throw fail('Pertanyaan wajib diisi');if(!session)throw fail('Pilih nomor layanan yang akan diuji');
  const config=await this.config();if(!config.secret)throw fail('AI belum dikonfigurasi');
  const assistant=await this.assistant(account,session);
  const id=digest(JSON.stringify(['trial',account,session,randomUUID()]));
  const messages:AIMessage[]=[{role:'user',content:question}];
  const inputWords=countWords(question);
  const prepared=await transaction(async c=>{
   await lockAccount(c,account);
   await c.execute('INSERT IGNORE INTO ai_wallets VALUES (?,0)',[account]);
   const [wallet]=await c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=? FOR UPDATE',[account]);
   const maxWords=Math.min(300,Math.floor((wallet[0].balance-inputWords*config.input_rate)/config.output_rate));
   if(maxWords<1)throw new ApiError(402,'insufficient_credit','Kredit AI tidak cukup untuk uji coba');
   const reserved=creditCost(inputWords,maxWords,config.input_rate,config.output_rate);
   await c.execute('UPDATE ai_wallets SET balance=balance-? WHERE account_id=?',[reserved,account]);
   await c.execute("INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model) VALUES (?,?,?,'trial','generating',?,?,?,?,?)",[account,id,session,inputWords,config.input_rate,config.output_rate,reserved,config.model]);
   return {reserved,maxWords};
  });
  let answer:string,agent:string|null=null,generationFailed=false;
  try{
   const result=await runAgents(this.transport,config,messages,prepared.maxWords,{account,session,customer:'628000000000',requestId:id,knowledge:assistant.knowledge,behavior:assistant.behavior,fallbackEnabled:false},this.tools,null);
   answer=result.answer;agent=result.agent;
  }catch{generationFailed=true;answer=aiFallback;}
  const outputWords=generationFailed?0:countWords(answer),charged=generationFailed?0:creditCost(inputWords,outputWords,config.input_rate,config.output_rate);
  const wallet=await transaction(async c=>{await lockAccount(c,account,true);await c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?',[prepared.reserved-charged,account]);await c.execute("UPDATE ai_usage SET status=?,output_words=?,charged=?,agent=?,reserved=0 WHERE account_id=? AND request_id=?",[generationFailed?'failed':'generated',outputWords,charged,agent,account,id]);const [rows]=await c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[account]);return rows[0].balance as number;});
  if(generationFailed)throw new ApiError(502,'ai_provider_failed','AI belum berhasil menjawab; periksa konfigurasi AI.');
  return {answer,agent,balance:wallet};
 }

 async wallet(account:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[account]);const config=await this.config();return {balance:rows[0]?.balance??0,input_rate:config.input_rate,output_rate:config.output_rate,credit_price:config.credit_price,unit:10000};}
 async usage(account:string){const [rows]=await db.execute('SELECT request_id,session_id,customer,status,input_words,output_words,input_rate,output_rate,charged,reserved,agent,created_at FROM ai_usage WHERE account_id=? ORDER BY created_at DESC LIMIT 100',[account]);return rows;}
 async usagePage(account:string,value:unknown){
  if(typeof value!=='string'||!/^\d{1,9}$/.test(value)||Number(value)<1)throw fail('Halaman tidak valid');
  const size=20;
  const [counts]=await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_usage WHERE account_id=?',[account]);
  const total=Number(counts[0].total),pages=Math.max(1,Math.ceil(total/size)),page=Math.min(Number(value),pages);
  const [items]=await db.execute('SELECT request_id,session_id,customer,status,input_words,output_words,input_rate,output_rate,charged,reserved,agent,created_at FROM ai_usage WHERE account_id=? ORDER BY created_at DESC,request_id DESC LIMIT '+size+' OFFSET '+((page-1)*size),[account]);
  return {items,page,pages,total,page_size:size};
 }
 async assistant(account:string,session:string){
  const profileColumns=profileFields.map(field=>'profil_'+field).join(',');
  const [rows]=await db.execute<RowDataPacket[]>(`SELECT enabled,behavior,fallback_number,fallback_notify,revision,${profileColumns} FROM ai_assistants WHERE account_id=? AND session_id=?`,[account,session]);
  const row=rows[0];
  const profile=Object.fromEntries(profileFields.map(field=>[field,String(row?.['profil_'+field]??'')])) as Record<ProfileField,string>;
  return {enabled:Boolean(row?.enabled),profile,knowledge:composeKnowledge(profile),behavior:String(row?.behavior??''),fallback_number:String(row?.fallback_number??''),fallback_notify:Boolean(row?.fallback_notify),revision:Number(row?.revision??0),...await publicSources(account,session)};
 }
 async saveAssistant(account:string,session:string,body:unknown){
  const input=object(body);if(typeof input.enabled!=='boolean')throw fail('Status asisten wajib valid');
  const inputProfile=object(input.profile);
  const profile=Object.fromEntries(profileFields.map(field=>[field,text(inputProfile[field]??'',2000,profileLabels[field])])) as Record<ProfileField,string>;
  const behavior=text(input.behavior,2000,'Perilaku AI'),fallbackNumber=input.fallback_number===undefined?'':text(input.fallback_number,20,'Nomor fallback'),fallbackNotify=input.fallback_notify===true;
  if(fallbackNumber&&!/^[1-9][0-9]{5,14}$/.test(fallbackNumber))throw fail('Nomor fallback harus nomor internasional tanpa +');
  const products=input.products_source===undefined?undefined:await sourceInput(input.products_source),orders=input.orders_source===undefined?undefined:await sourceInput(input.orders_source);
  const profileColumns=profileFields.map(field=>'profil_'+field),profileValues=profileFields.map(field=>profile[field]);
  await transaction(async c=>{await lockAccount(c,account);
   await c.execute(`INSERT INTO ai_assistants(account_id,session_id,enabled,behavior,fallback_number,fallback_notify,${profileColumns.join(',')}) VALUES (?,?,?,?,?,?,${profileColumns.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),behavior=VALUES(behavior),fallback_number=VALUES(fallback_number),fallback_notify=VALUES(fallback_notify),revision=revision+1,${profileColumns.map(c=>c+'=VALUES('+c+')').join(',')}`,[account,session,Boolean(input.enabled),behavior,fallbackNumber,Boolean(fallbackNumber)&&fallbackNotify,...profileValues] as any[]);
   if(products)await saveSource(c,account,session,'products',products);if(orders)await saveSource(c,account,session,'orders',orders);
  });return this.assistant(account,session);
 }
 async registerSystemMessage(account:string,session:string,messageId:string){
  await db.execute("INSERT INTO ai_message_origins(account_id,session_id,message_id,origin) VALUES (?,?,?,'system')",[account,session,messageId]);
 }
 private async handleFallbackReply(account:string,manager:SessionManager,session:string,message:IncomingMessage){
  const [settings]=await db.execute<RowDataPacket[]>('SELECT fallback_number FROM ai_assistants WHERE account_id=? AND session_id=? AND fallback_number=? AND fallback_notify=TRUE',[account,session,message.from]);
  if(!settings[0]?.fallback_number)return false;
  const ticketId=message.text.match(/\b(FB-[A-Z0-9]{8,48})\b/i)?.[1]?.toUpperCase();
  const ticket=await transaction(async c=>{
   const [rows]=await c.execute<RowDataPacket[]>(`SELECT * FROM ai_fallbacks WHERE account_id=? AND session_id=? AND status='waiting' AND (notification_message_id=? OR id=?) FOR UPDATE`,[account,session,message.quotedMessageId??'',ticketId??'']);
   const row=rows[0];if(!row)return;
   await c.execute("UPDATE ai_fallbacks SET status='answered',staff_answer=?,answered_at=UTC_TIMESTAMP() WHERE id=?",[message.text.trim().slice(0,8000),row.id]);
   return row;
  });
  if(!ticket)return true;
  const answer='Berikut konfirmasi dari tim: '+message.text.trim();
  let sent=false;
  try{await sendBilled(account,manager,session,'text',{to:ticket.customer,text:answer},'fallback_resume_'+digest(message.messageId).slice(0,64));sent=true;}catch{}
  await transaction(async c=>{
   await c.execute('UPDATE ai_fallbacks SET status=?,resolved_at=IF(?,UTC_TIMESTAMP(),NULL) WHERE id=?',[sent?'resolved':'failed',sent,ticket.id]);
   if(!sent)return;
   const [limits]=await c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');
   const [rows]=await c.execute<RowDataPacket[]>('SELECT messages FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,ticket.customer]);
   if(rows[0])await c.execute('UPDATE ai_conversations SET messages=?,revision=revision+1 WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify([...parseMemory(rows[0].messages),{role:'assistant',content:answer}].slice(-(limits[0]?.memory_limit??defaults.memory_limit))),account,session,ticket.customer]);
  });
  return true;
 }
 async answerFallback(account:string,manager:SessionManager,session:string,id:string,body:unknown){
  if(!/^FB-[A-Z0-9]{8,48}$/.test(id))throw fail('ID fallback tidak valid');
  const answer=text(object(body).answer,8000,'Jawaban fallback');if(!answer)throw fail('Jawaban fallback wajib diisi');
  const ticket=await transaction(async c=>{
   const [rows]=await c.execute<RowDataPacket[]>("SELECT * FROM ai_fallbacks WHERE id=? AND account_id=? AND session_id=? AND status='waiting' FOR UPDATE",[id,account,session]);
   if(!rows[0])throw new ApiError(404,'fallback_not_found','Tiket fallback tidak tersedia.');
   await c.execute("UPDATE ai_fallbacks SET status='answered',staff_answer=?,answered_at=UTC_TIMESTAMP() WHERE id=?",[answer,rows[0].id]);return rows[0];
  });
  const customerAnswer='Berikut konfirmasi dari tim: '+answer;let sent=false;
  try{await sendBilled(account,manager,session,'text',{to:ticket.customer,text:customerAnswer},'fallback_web_'+digest(id+'\0'+answer).slice(0,64));sent=true;}catch{}
  await transaction(async c=>{await c.execute('UPDATE ai_fallbacks SET status=?,resolved_at=IF(?,UTC_TIMESTAMP(),NULL) WHERE id=?',[sent?'resolved':'failed',sent,id]);if(sent){const [limits]=await c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');const [rows]=await c.execute<RowDataPacket[]>('SELECT messages FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,ticket.customer]);if(rows[0])await c.execute('UPDATE ai_conversations SET messages=?,revision=revision+1 WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify([...parseMemory(rows[0].messages),{role:'assistant',content:customerAnswer}].slice(-(limits[0]?.memory_limit??defaults.memory_limit))),account,session,ticket.customer]);}});
  return {ok:sent,status:sent?'resolved':'failed'};
 }
 async manualOutgoing(account:string,session:string,message:IncomingMessage){
  if(message.isGroup||! /^[1-9][0-9]{5,14}$/.test(message.from))return;
  await transaction(async c=>{
   await lockAccount(c,account);
   const [known]=await c.execute<RowDataPacket[]>('SELECT origin FROM ai_message_origins WHERE account_id=? AND session_id=? AND message_id=?',[account,session,message.messageId]);
   if(known[0])return;
   await c.execute("INSERT INTO ai_message_origins(account_id,session_id,message_id,origin) VALUES (?,?,?,'manual')",[account,session,message.messageId]);
   const [assistant]=await c.execute<RowDataPacket[]>('SELECT enabled FROM ai_assistants WHERE account_id=? AND session_id=?',[account,session]);
   if(!assistant[0]?.enabled)return;
   const [settings]=await c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');
   const limit=settings[0]?.memory_limit??defaults.memory_limit;
   await c.execute("INSERT IGNORE INTO ai_conversations(account_id,session_id,customer,paused,messages) VALUES (?,?,?,FALSE,'[]')",[account,session,message.from]);
   const [rows]=await c.execute<RowDataPacket[]>('SELECT messages FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,message.from]);
   const content=(message.type==='text'?message.text:`[Pesan ${message.type} manual] ${message.text}`).trim().slice(0,4000);
   const memory=[...parseMemory(rows[0].messages),...(content?[{role:'assistant' as const,content}]:[])].slice(-limit);
   await c.execute('UPDATE ai_conversations SET paused=IF(full_auto,FALSE,TRUE),revision=revision+1,router_context=NULL,messages=? WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify(memory),account,session,message.from]);
  });
 }
 async removeSession(account:string,session:string){await transaction(async c=>{await lockAccount(c,account,true);for(const table of ['ai_data_sources','ai_products','ai_orders','ai_fallbacks'])await c.execute('DELETE FROM '+table+' WHERE account_id=? AND session_id=?',[account,session]);await c.execute('DELETE FROM ai_assistants WHERE account_id=? AND session_id=?',[account,session]);await c.execute('DELETE FROM ai_conversations WHERE account_id=? AND session_id=?',[account,session]);});}
 async conversations(account:string,session:string){const [rows]=await db.execute('SELECT customer,paused,full_auto,JSON_LENGTH(messages) AS message_count,router_context FROM ai_conversations WHERE account_id=? AND session_id=? ORDER BY customer LIMIT 200',[account,session]);return rows;}
 async fallbacks(account:string,session:string,value:unknown){
  if(typeof value!=='string'||!/^\d{1,9}$/.test(value)||Number(value)<1)throw fail('Halaman tidak valid');
  const size=20;
  const [counts]=await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_fallbacks WHERE account_id=? AND session_id=?',[account,session]);
  const total=Number(counts[0].total),pages=Math.max(1,Math.ceil(total/size)),page=Math.min(Number(value),pages);
  const [items]=await db.execute('SELECT id,customer,status,agent,reason,question,staff_answer,created_at,answered_at,resolved_at FROM ai_fallbacks WHERE account_id=? AND session_id=? ORDER BY created_at DESC,id DESC LIMIT '+size+' OFFSET '+((page-1)*size),[account,session]);
  return {items,page,pages,total,page_size:size};
 }
 async removeFallback(account:string,session:string,id:string){
  if(!/^FB-[A-Z0-9]{8,48}$/.test(id))throw fail('ID fallback tidak valid');
  const [result]=await db.execute<ResultSetHeader>('DELETE FROM ai_fallbacks WHERE id=? AND account_id=? AND session_id=?',[id,account,session]);
  if(!result.affectedRows)throw new ApiError(404,'fallback_not_found','Tiket fallback tidak tersedia.');
  return {ok:true};
 }
 async applyFallbackKnowledge(account:string,session:string,id:string,body:unknown){
  if(!/^FB-[A-Z0-9]{8,48}$/.test(id))throw fail('ID fallback tidak valid');
  const content=text(object(body).content,2000,'Knowledge dari fallback');if(!content)throw fail('Knowledge dari fallback wajib diisi');
  return transaction(async c=>{await lockAccount(c,account);const [tickets]=await c.execute<RowDataPacket[]>("SELECT status FROM ai_fallbacks WHERE id=? AND account_id=? AND session_id=? FOR UPDATE",[id,account,session]);if(!tickets[0]||tickets[0].status!=='resolved')throw new ApiError(409,'fallback_not_ready','Tiket harus sudah selesai sebelum diterapkan.');
   const [assistants]=await c.execute<RowDataPacket[]>('SELECT profil_lainnya FROM ai_assistants WHERE account_id=? AND session_id=? FOR UPDATE',[account,session]);const previous=String(assistants[0]?.profil_lainnya??''),lainnya=(previous?previous+'\n\n':'')+content;if(lainnya.length>2000)throw fail('Bagian Lainnya melebihi batas 2.000 karakter; kosongkan sebagian sebelum menambah lagi.');
   await c.execute("INSERT INTO ai_assistants(account_id,session_id,enabled,behavior,profil_lainnya) VALUES (?,?,FALSE,'',?) ON DUPLICATE KEY UPDATE profil_lainnya=VALUES(profil_lainnya),revision=revision+1",[account,session,lainnya]);const knowledge=composeKnowledge({lainnya});return {ok:true,knowledge};
  });
 }
 async conversation(account:string,session:string,customer:string,body:unknown){
  if(!/^[0-9]{5,20}$/.test(customer))throw fail('Nomor pelanggan tidak valid');
  const input=object(body);if(typeof input.paused!=='boolean'||(input.clear!==undefined&&typeof input.clear!=='boolean')||(input.full_auto!==undefined&&typeof input.full_auto!=='boolean')||(input.paused&&input.full_auto===true))throw fail('Status percakapan tidak valid');
  await transaction(async c=>{await lockAccount(c,account);await c.execute("INSERT INTO ai_conversations(account_id,session_id,customer,paused,full_auto,messages) VALUES (?,?,?,?,?,'[]') ON DUPLICATE KEY UPDATE paused=VALUES(paused),full_auto=IF(?,VALUES(full_auto),full_auto),router_context=IF(?,NULL,router_context),messages=IF(?,JSON_ARRAY(),messages),revision=revision+1",[account,session,customer,Boolean(input.paused),input.full_auto===true,Boolean(input.paused)||input.full_auto!==undefined,input.clear===true,input.clear===true]);});return {ok:true};
 }
 async adjust(actor:string,account:string,body:unknown){const input=object(body),amount=integer(input.amount,-100000000,100000000,'Jumlah'),reason=text(input.reason,200,'Alasan'),id=text(input.requestId,64,'ID');if(!amount||!reason||! /^[A-Za-z0-9_-]{1,64}$/.test(id))throw fail('Jumlah, alasan, dan ID wajib valid');await transaction(async c=>{await lockAccount(c,account);const [old]=await c.execute<RowDataPacket[]>('SELECT amount,reason FROM ai_adjustments WHERE account_id=? AND request_id=?',[account,id]);if(old[0]){if(old[0].amount!==amount||old[0].reason!==reason)throw new ApiError(409,'idempotency_conflict','ID sudah digunakan');return;}await c.execute('INSERT IGNORE INTO ai_wallets VALUES (?,0)',[account]);const [rows]=await c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[account]);if(rows[0].balance+amount<0||rows[0].balance+amount>1000000000)throw fail('Saldo di luar batas');await c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?',[amount,account]);await c.execute('INSERT INTO ai_adjustments(account_id,request_id,actor_id,amount,reason) VALUES (?,?,?,?,?)',[account,id,actor,amount,reason]);await c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',[actor,'ai_credit_adjusted:'+account]);});return this.wallet(account);}
 incoming(account:string,manager:SessionManager,session:string,message:IncomingMessage){
  if(message.isGroup||message.type!=='text'||!message.text.trim()||!/^\d{5,20}$/.test(message.from))return Promise.resolve();
  const key=JSON.stringify([account,session,message.from]);if(this.queued>=128)return Promise.resolve();this.queued++;
  const task=(this.queues.get(key)??Promise.resolve()).then(async()=>{if(!await this.handleFallbackReply(account,manager,session,message))await this.process(account,manager,session,message);}).catch(()=>{console.error('Pemrosesan AI gagal; periksa riwayat penggunaan.');}).finally(()=>{this.queued--;if(this.queues.get(key)===task)this.queues.delete(key);});this.queues.set(key,task);return task;
 }
 async stop(){await Promise.all(this.queues.values());}
 async recover(account?:string){
  // Under the engine lock, interrupted calls are not retried. Unknown provider outcomes cost zero to the customer.
  await transaction(async c=>{const [rows]=await c.execute<RowDataPacket[]>("SELECT account_id,request_id,reserved FROM ai_usage WHERE status='generating'"+(account?' AND account_id=?':'')+' FOR UPDATE',account?[account]:[]);for(const row of rows){await c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?',[row.reserved,row.account_id]);await c.execute("UPDATE ai_usage SET status='interrupted',reserved=0 WHERE account_id=? AND request_id=?",[row.account_id,row.request_id]);}
   await c.execute("UPDATE ai_usage u LEFT JOIN credit_reservations r ON r.account_id=u.account_id AND r.request_id=CONCAT('ai_',u.request_id) SET u.status=CONCAT(IF(u.status='fallback_generated','fallback_',''),IF(r.status='sent','sent','send_unknown')) WHERE u.status IN ('generated','fallback_generated')"+(account?' AND u.account_id=?':''),account?[account]:[]);});
 }
 private async process(account:string,manager:SessionManager,session:string,message:IncomingMessage){
  const config=await this.config();if(!config.secret)return;
  const assistant=await this.assistant(account,session);if(!assistant.enabled)return;
  manager.connected(session);if((await basicWallet(account)).balance<1)return;
  const id=digest(JSON.stringify([session,message.from,message.messageId]));
  const prepared=await transaction(async c=>{await lockAccount(c,account);
   const [existing]=await c.execute<RowDataPacket[]>('SELECT request_id FROM ai_usage WHERE account_id=? AND request_id=?',[account,id]);if(existing[0])return;
   const profileColumns=profileFields.map(field=>'profil_'+field).join(',');
   const [current]=await c.execute<RowDataPacket[]>(`SELECT enabled,behavior,fallback_number,fallback_notify,revision,${profileColumns} FROM ai_assistants WHERE account_id=? AND session_id=?`,[account,session]);if(!current[0]?.enabled)return;
   const knowledge=composeKnowledge(Object.fromEntries(profileFields.map(field=>[field,String(current[0]['profil_'+field]??'')])) as Record<ProfileField,string>);
   const [limits]=await c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');
   await c.execute("INSERT IGNORE INTO ai_conversations(account_id,session_id,customer,paused,messages) VALUES (?,?,?,FALSE,'[]')",[account,session,message.from]);
   const [conversations]=await c.execute<RowDataPacket[]>('SELECT paused,messages,revision,router_context FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,message.from]);if(conversations[0].paused)return;
   if(message.text.length>4000)return;
   const memory=[...parseMemory(conversations[0].messages),{role:'user' as const,content:message.text}].slice(-(limits[0]?.memory_limit??config.memory_limit));
   await c.execute('INSERT IGNORE INTO ai_wallets VALUES (?,0)',[account]);const [wallet]=await c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[account]);
   const [pending]=await c.execute<RowDataPacket[]>('SELECT id,question FROM ai_fallbacks WHERE account_id=? AND session_id=? AND customer=? AND status=\'waiting\' ORDER BY created_at DESC LIMIT 5',[account,session,message.from]);
   const fallbackNumber=String(current[0].fallback_number??'');
   const system:AIMessage[]=[{role:'system',content:'Jawab sebagai asisten bisnis berdasarkan pengetahuan yang diberikan. Jangan mengarang fakta. Jika informasi belum tersedia, minta klarifikasi atau gunakan fallback tim bila tersedia. Balas maksimal 300 kata.'},...([current[0].behavior] as string[]).filter(Boolean).map(content=>({role:'system' as const,content}))];
   const messages=[...system,...memory],inputWords=messages.reduce((sum,m)=>sum+countWords(m.content),0);
   // The system instruction is counted too; replacing its numeric limit does not change its word count.
   const maxWords=Math.min(300,Math.floor((wallet[0].balance-inputWords*config.input_rate)/config.output_rate));
   if(inputWords>12000||maxWords<1)return;
   system[0].content=system[0].content.replace('300 kata',maxWords+' kata');
   const reserved=creditCost(inputWords,maxWords,config.input_rate,config.output_rate);
   await c.execute('UPDATE ai_wallets SET balance=balance-? WHERE account_id=?',[reserved,account]);
   await c.execute("INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model) VALUES (?,?,?,?,'generating',?,?,?,?,?)",[account,id,session,message.from,inputWords,config.input_rate,config.output_rate,reserved,config.model]);
   await c.execute('UPDATE ai_conversations SET messages=? WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify(memory),account,session,message.from]);return {messages,inputWords,reserved,maxWords,routerContext:conversations[0].router_context as string|null,revision:conversations[0].revision,assistantRevision:current[0].revision,knowledge,behavior:current[0].behavior as string,pendingFallbacks:pending.map(row=>({id:String(row.id),question:String(row.question)})),fallbackNumber,fallbackNotify:Boolean(current[0].fallback_notify)};
  });if(!prepared)return;
  const jid=message.from+'@s.whatsapp.net';
  // Read/presence are best effort and never add a message or a credit charge.
  await manager.read(session,jid,message.messageId).catch(()=>{});
  const guard=async()=>{const enabled=await this.assistant(account,session);const [rows]=await db.execute<RowDataPacket[]>('SELECT paused,revision FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',[account,session,message.from]);
   if(!enabled.enabled||enabled.revision!==prepared.assistantRevision||rows[0]?.paused||rows[0]?.revision!==prepared.revision)throw new ApiError(409,'ai_cancelled','Asisten atau konteks percakapan telah berubah');};
  const modelCalls:{role:ModelRole|undefined;model:string;status:string;attempt:number}[]=[];
  const deadline=Date.now()+120000;
  const retryPause=async(attempt:number)=>{await this.wait(500*2**attempt+randomInt(0,251));await guard();};
  let lastMessages:AIMessage[]|undefined,lastModel:string|undefined;
  const trackedTransport:AITransport=async(selected,messages,maxWords)=>{
   lastMessages=messages;lastModel=selected.model;
   for(let attempt=0;attempt<3;attempt++){
    await guard();if(modelCalls.length>=20||Date.now()>=deadline)throw Error('ai_retry_limit');
    const entry={role:selected.call_role,model:selected.model,status:'failed',attempt:attempt+1};modelCalls.push(entry);
    try{const result=await this.transport(selected,messages,maxWords);entry.status='responded';return result;}
    catch(error){if(attempt===2||!transientAIError(error))throw error;await retryPause(attempt);}
   }
   throw Error('ai_retry_limit');
  };
  let answer:string,agent:string|null=null,generationFailed=false,fallback:{reason:string;question:string}|undefined;
  let lastNode:string|undefined,lastTraceError:string|undefined,lastRawOutput:string|undefined;
  config.onTrace=event=>{if(event.node==='router'&&event.state==='routed')lastNode=String((event.output as {sub_agent?:unknown})?.sub_agent??lastNode);if(event.error){lastNode=event.node;lastTraceError=event.error;if(typeof event.output==='string')lastRawOutput=event.output;}};
  try{const result=await runAgents(trackedTransport,config,prepared.messages,prepared.maxWords,{account,session,customer:message.from,requestId:id,knowledge:prepared.knowledge,behavior:prepared.behavior,fallbackEnabled:true,pendingFallbacks:prepared.pendingFallbacks},{execute:async(name,query,context)=>{
   await guard();
   try{return await this.tools.execute(name,query,context);}catch(error){
    if(name==='create_order'||!transientAIError(error)||Date.now()>=deadline)throw error;
    await retryPause(0);return this.tools.execute(name,query,context);
   }
  }},prepared.routerContext);fallback=result.fallback;answer=fallback?'Baik, saya konfirmasi dulu dan akan melanjutkan jawaban segera.':result.answer;agent=result.agent;}
  catch(error){generationFailed=true;answer=aiFallback;
   const errorCode=error instanceof Error?error.message:'unknown_error';
   await db.execute('INSERT INTO ai_agent_failures(account_id,session_id,request_id,agent,error,message,model,prompt,raw_output,router_context) VALUES (?,?,?,?,?,?,?,?,?,?)',[account,session,id,lastNode??null,(lastTraceError??errorCode).slice(0,100),message.text.slice(0,4000),lastModel??null,lastMessages?JSON.stringify(lastMessages):null,lastRawOutput?.slice(0,65000)??null,prepared.routerContext]).catch(()=>{});
  }
  // Context is internal and never billed. A failed summary clears stale context on a successful send.
  let routerContext:string|null=null;
  if(!generationFailed)try{routerContext=await updateRouterContext(trackedTransport,config,message.text,answer);}catch{console.error('Pembaruan konteks router AI gagal.');}
  const outputWords=generationFailed?0:countWords(answer),charged=generationFailed?0:creditCost(prepared.inputWords,outputWords,config.input_rate,config.output_rate);
  const fallbackId=fallback?'FB-'+randomUUID().replaceAll('-','').slice(0,20).toUpperCase():undefined;
  await transaction(async c=>{await lockAccount(c,account,true);await c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?',[prepared.reserved-charged,account]);await c.execute("UPDATE ai_usage SET status=?,output_words=?,charged=?,agent=?,model_calls=?,model=?,reserved=0 WHERE account_id=? AND request_id=?",[generationFailed?'fallback_generated':'generated',outputWords,charged,agent,JSON.stringify(modelCalls),modelCalls.find(call=>call.role===agent)?.model??config.model,account,id]);
   if(fallbackId&&fallback)await c.execute('INSERT IGNORE INTO ai_fallbacks(id,account_id,session_id,customer,fallback_number,agent,reason,question,router_context,messages,source_message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[fallbackId,account,session,message.from,prepared.fallbackNumber,agent??'lainnya',fallback.reason,fallback.question,prepared.routerContext,JSON.stringify(prepared.messages),message.messageId]);});
  let status='sent',typingStarted=false;
  try{
   await guard();typingStarted=true;
   await manager.typing(session,jid,'composing').catch(()=>{});
   await this.wait(randomInt(1000,3001));
   await guard();const confirmation=await sendBilled(account,manager,session,'text',{to:message.from,text:answer},'ai_'+id,undefined,guard);if(fallbackId)await db.execute('UPDATE ai_fallbacks SET confirmation_message_id=? WHERE id=?',[confirmation.messageId,fallbackId]);
  }catch(error){status=error instanceof ApiError&&error.code==='ai_cancelled'?'cancelled':error instanceof ApiError&&error.code==='send_unknown'?'send_unknown':'send_failed';}
  finally{if(typingStarted)await manager.typing(session,jid,'paused').catch(()=>{});}
  if(status==='sent'&&fallbackId&&fallback&&prepared.fallbackNotify&&prepared.fallbackNumber)try{const notification=await sendBilled(account,manager,session,'text',{to:prepared.fallbackNumber,text:'Konfirmasi diperlukan ['+fallbackId+']\\nPelanggan: '+message.from+'\\nPertanyaan: '+fallback.question+'\\nKonteks: '+(prepared.routerContext??'-')+'\\nBalas pesan ini atau awali balasan dengan '+fallbackId+'.'},'fallback_team_'+id);await db.execute('UPDATE ai_fallbacks SET notification_message_id=? WHERE id=?',[notification.messageId,fallbackId]);}catch{await db.execute("UPDATE ai_fallbacks SET status='failed' WHERE id=?",[fallbackId]);}
  await transaction(async c=>{await lockAccount(c,account,true);await c.execute('UPDATE ai_usage SET status=? WHERE account_id=? AND request_id=?',[generationFailed&&status!=='cancelled'?'fallback_'+status:status,account,id]);if(status==='sent'){
   const [limits]=await c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');const [rows]=await c.execute<RowDataPacket[]>('SELECT messages,revision FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,message.from]);
   if(!rows[0]||rows[0].revision!==prepared.revision)return;
   const memory=[...parseMemory(rows[0].messages),{role:'assistant' as const,content:answer}].slice(-(limits[0]?.memory_limit??defaults.memory_limit));
   await c.execute('UPDATE ai_conversations SET messages=?,router_context=? WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify(memory),routerContext,account,session,message.from]);}});
 }
}
export const ai=new AIService();
