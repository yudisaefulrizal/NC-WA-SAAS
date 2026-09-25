import {routerResponseFormat} from './ai-router-schema.js';
import {modelTiers,tierConfig,schemaEnabled,type ModelRole,type ModelTier,type AgentWorkflow,type AITraceEvent} from './ai-models.js';
import {activeWorkflow,profileDefinition,enabledProfiles} from './ai-profiles.js';
import {transientAIError} from './ai-retry.js';
import {publicSources,sourceInput,saveSource,builtinSource} from './ai-data.js';
import {runAgents,updateRouterContext,defaultTools,csPipeline,type AITools,type Pipeline} from './ai-agents.js';
import {eduData,eduPipeline,eduView,eduIdentity,eduKinds,eduKind,eduLimits,eduTextFields,documentMarker,sentDocuments,type EduKind} from './ai-edu.js';
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
import {recordNote,recordOutgoing} from './ai-chat.js';
import {ProductImageStore} from './ai-product-images.js';
import {resolve} from 'node:path';
export type AIMessage={role:'system'|'user'|'assistant';content:string};
export type AIProvider='sumopod'|'compatible'|'openrouter';
export interface AIConfig {signal?:AbortSignal;workflow?:AgentWorkflow;onTrace?:(event:AITraceEvent)=>void;model_cheap?:string;model_medium?:string;model_smart?:string;model_structured?:string;tier_profiles?:Partial<Record<ModelTier,{id:string;provider:AIProvider;endpoint:string;secret:string;model:string}>>;call_role?:ModelRole;router_agents?:readonly string[];response_format?:Record<string,unknown>;provider:AIProvider;endpoint:string;model:string;secret:string;input_rate:number;output_rate:number;memory_limit:number;context_memory_limit:number;trace_enabled:boolean;credit_price:number;tidy_prompt?:string}
export const defaults:AIConfig={provider:'compatible',endpoint:'https://ai.sumopod.com/v1/chat/completions',model:'deepseek-v4-flash',secret:'',input_rate:1,output_rate:2,memory_limit:60,context_memory_limit:6,trace_enabled:false,credit_price:0,tidy_prompt:''};
export const countWords=(text:string)=>text.match(/\S+/gu)?.length??0;
// Product and price are handled by the dedicated products table (ai-data.ts), not free-text here.
// Bidang is folded into Deskripsi rather than kept as its own field.
// Nama/deskripsi/alamat/kontak/jam_operasional merged into one free-text "usaha" field.
// "Lainnya" removed; anything that doesn't fit another field belongs in FAQ as free text.
export const profileFields=['usaha','cara_pemesanan','pembayaran','kebijakan','faq'] as const;
export type ProfileField=typeof profileFields[number];
const profileLabels:Record<ProfileField,string>={usaha:'Profil usaha',cara_pemesanan:'Cara pemesanan',pembayaran:'Metode pembayaran',kebijakan:'Kebijakan',faq:'FAQ'};
// Only filled-in fields are sent to the agent; empty ones add no noise to the prompt.
export function composeKnowledge(profile:Partial<Record<ProfileField,string>>){
 return profileFields.map(field=>{const value=profile[field]?.trim();return value?profileLabels[field]+': '+value:null;}).filter(Boolean).join('\n\n');
}
export const aiFallback='Maaf, saya sedang mengalami kendala memproses pesan Anda. Silakan coba lagi beberapa saat. Jika terkait pesanan, mohon periksa status pesanan terlebih dahulu sebelum mengulang pemesanan.';
export const creditCost=(input:number,output:number,inputRate:number,outputRate:number)=>input*inputRate+output*outputRate;
const fail=(message:string)=>new ApiError(400,'invalid_request',message);
// The runtime pipeline of each profile a session can run.
const pipelines:Record<string,Pipeline>={cs:csPipeline,pendidikan:eduPipeline};
const faqLimit=(type:string)=>type==='pendidikan'?eduLimits.faq:2000;
// Content columns of a new data profile: copied from another one, or empty with the chosen institution kind.
function eduColumns(from?:RowDataPacket,kind?:EduKind){const k=(from?String(from.edu_kind):kind)??'sekolah';return {edu_kind:Object.hasOwn(eduKinds,k)?k:'sekolah',edu_lembaga:String(from?.edu_lembaga??''),edu_jadwal:String(from?.edu_jadwal??'')};}
function integer(value:unknown,min:number,max:number,name:string){if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw fail(name+' di luar batas');return Number(value);}
function text(value:unknown,max:number,name:string){if(typeof value!=='string'||value.length>max)throw fail(name+' tidak valid atau terlalu panjang');return value.trim();}
function provider(value:unknown):AIProvider{if(value==='sumopod'||value==='compatible'||value==='openrouter')return value;throw fail('Provider AI tidak valid');}
export function chatEndpoint(value:string){let url:URL;try{url=new URL(value);}catch{throw fail('Endpoint tidak valid');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw fail('Endpoint wajib HTTPS tanpa kredensial, query, atau fragmen');url.pathname=url.pathname.replace(/\/$/,'');if(url.pathname===''||url.pathname==='/')url.pathname='/v1/chat/completions';else if(url.pathname==='/v1')url.pathname+='/chat/completions';else if(!url.pathname.endsWith('/chat/completions'))throw fail('Gunakan endpoint Chat Completions');return url.href;}
export type AITransport=(config:AIConfig,messages:AIMessage[],maxWords:number)=>Promise<string>;
// Validate and pin DNS. Never follow redirects carrying the provider credential.
export function aiRequestPayload(config:AIConfig,messages:AIMessage[]){
 return {model:config.model,messages:[...messages],stream:false,max_tokens:2048,...(config.response_format?{response_format:config.response_format}:config.call_role==='router'&&schemaEnabled(config,'router')?{response_format:routerResponseFormat(config.router_agents)}:{})};
}
export const callAI:AITransport=async(config,messages,maxWords)=>{
 const {url,addresses}=await validatePublicUrl(config.endpoint);
 const payload=JSON.stringify(aiRequestPayload(config,messages));
 return new Promise<string>((resolve,reject)=>{
  const openRouterHeaders=config.provider==='openrouter'?{'X-OpenRouter-Title':'NC-WA',...(process.env.APP_ORIGIN?{'HTTP-Referer':process.env.APP_ORIGIN}:{})}:{};
  const req=request(url,{method:'POST',agent:false,signal:config.signal?AbortSignal.any([config.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+decrypt(config.secret),'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),...openRouterHeaders},lookup:(_hostname,options,callback)=>{if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);}},res=>{
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
 // Assigned by createGateway() once the tenant storage root is known, so file paths always match the gateway that sends them.
 productImages=new ProductImageStore(resolve('auth','_product-images'));
 constructor(private transport:AITransport=callAI,private wait:(milliseconds:number)=>Promise<void>=async milliseconds=>{await delay(milliseconds);},private tools:AITools=defaultTools){}
 async config():Promise<AIConfig>{const [rows]=await db.query<RowDataPacket[]>('SELECT * FROM ai_settings WHERE id=1');const stored=rows[0],host=new URL(stored?.endpoint??defaults.endpoint).hostname;const detected:AIProvider=host==='openrouter.ai'?'openrouter':host==='ai.sumopod.com'?'sumopod':'compatible';const config:AIConfig={...defaults,...(stored??{}),provider:detected,trace_enabled:Boolean(stored?.trace_enabled)};for(const tier of modelTiers)config[`model_${tier}`]=config[`model_${tier}`]||config.model;if(stored?.profile_routing_enabled){try{
  // p.* keeps routing working if the code runs before `npm run migrate` adds a newer tier's column; a missing
  // Terstruktur route or model then falls back to Murah, which is exactly what the migration would set.
  const [routes]=await db.query<RowDataPacket[]>('SELECT r.tier,p.* FROM ai_provider_routes r JOIN ai_provider_profiles p ON p.id=r.profile_id WHERE p.active=TRUE');
  const profiles:NonNullable<AIConfig['tier_profiles']>=Object.fromEntries(routes.map(r=>[r.tier,{id:r.id,provider:r.provider,endpoint:r.endpoint,secret:r.secret,model:r['model_'+r.tier]||r.model_cheap}]));
  if(!profiles.structured&&profiles.cheap)profiles.structured=profiles.cheap;
  config.tier_profiles=profiles;
 }catch(error){console.error('Rute provider AI gagal dimuat; memakai konfigurasi lama.',error instanceof Error?error.message:error);}}return config;}
 async configuration(){const {secret,workflow,onTrace,tier_profiles,...config}=await this.config();return {...config,configured:Boolean(secret),apiKey:secret?'********':null};}
 async providerProfiles(){try{
  // SELECT * so the list still loads before `npm run migrate` adds a newer tier column; the secret never leaves the server.
  const [all]=await db.query<RowDataPacket[]>('SELECT * FROM ai_provider_profiles ORDER BY created_at');const rows=all.map(({secret,...profile})=>profile);const [routes]=await db.query<RowDataPacket[]>('SELECT tier,profile_id FROM ai_provider_routes');return {profiles:rows,routes};}catch{return {profiles:[],routes:[]};}}
 async saveProviderProfile(body:unknown){const input=object(body),id=typeof input.id==='string'?input.id:'';const name=text(input.name,100,'Nama profil'),kind=provider(input.provider),endpoint=chatEndpoint(text(input.endpoint,512,'Endpoint')),host=new URL(endpoint).hostname;if(kind==='openrouter'&&host!=='openrouter.ai')throw fail('Endpoint OpenRouter harus memakai openrouter.ai');if(kind==='sumopod'&&host!=='ai.sumopod.com')throw fail('Endpoint Sumopod harus memakai ai.sumopod.com');const active=input.active!==false;const [old]=id?await db.execute<RowDataPacket[]>('SELECT secret FROM ai_provider_profiles WHERE id=?',[id]):[[] as RowDataPacket[]];if(id&&!old[0])throw new ApiError(404,'not_found','Profil provider tidak ditemukan');const models=Object.fromEntries(modelTiers.map(tier=>[tier,text(input['model_'+tier],100,'Model '+tier)]));if(Object.values(models).some(model=>!model))throw fail('Model tiap tingkat wajib diisi');let secret=old[0]?.secret??'';if(input.apiKey!==undefined&&input.apiKey!==''){const key=text(input.apiKey,512,'API key');if(!key||/[\r\n]/.test(key))throw fail('API key tidak valid');secret=encrypt(key);}if(!secret)throw fail('API key wajib diisi');const profileId=id||randomUUID();await db.execute('INSERT INTO ai_provider_profiles(id,name,provider,endpoint,secret,model_cheap,model_medium,model_smart,model_structured,active) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),provider=VALUES(provider),endpoint=VALUES(endpoint),secret=VALUES(secret),model_cheap=VALUES(model_cheap),model_medium=VALUES(model_medium),model_smart=VALUES(model_smart),model_structured=VALUES(model_structured),active=VALUES(active)',[profileId,name,kind,endpoint,secret,models.cheap,models.medium,models.smart,models.structured,active]);return {id:profileId};}
 async deleteProviderProfile(id:unknown){if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw fail('ID profil tidak valid');const [routes]=await db.execute<RowDataPacket[]>('SELECT tier FROM ai_provider_routes WHERE profile_id=?',[id]);if(routes.length)throw new ApiError(409,'profile_in_use','Profil masih dipakai oleh tingkat '+routes.map(r=>r.tier).join(', ')+'. Pilih profil lain terlebih dahulu.');const [result]=await db.execute<any>('DELETE FROM ai_provider_profiles WHERE id=?',[id]);if(!result.affectedRows)throw new ApiError(404,'not_found','Profil provider tidak ditemukan');return {ok:true};}
 async setProviderRoutes(body:unknown){const input=object(body);for(const tier of modelTiers){const route=object(input[tier]);if(typeof route.profileId!=='string')throw fail('Rute '+tier+' tidak valid');const [profiles]=await db.execute<RowDataPacket[]>('SELECT id,model_'+tier+' AS model FROM ai_provider_profiles WHERE id=? AND active=TRUE',[route.profileId]);if(!profiles[0]||!profiles[0].model)throw fail('Profil '+tier+' tidak aktif atau model belum diisi');await db.execute('INSERT INTO ai_provider_routes(tier,profile_id,model) VALUES (?,?,?) ON DUPLICATE KEY UPDATE profile_id=VALUES(profile_id),model=VALUES(model)',[tier,route.profileId,profiles[0].model]);}await db.query('UPDATE ai_settings SET profile_routing_enabled=TRUE WHERE id=1');return this.providerProfiles();}
 async testProviderProfile(body:unknown){const input=object(body);const id=typeof input.id==='string'?input.id:'';const [rows]=await db.execute<RowDataPacket[]>('SELECT provider,endpoint,secret FROM ai_provider_profiles WHERE id=? AND active=TRUE',[id]);if(!rows[0])throw new ApiError(404,'not_found','Profil provider tidak ditemukan');const model=text(input.model,100,'Model');if(!model)throw fail('Model wajib diisi');await this.transport({...defaults,provider:rows[0].provider,endpoint:rows[0].endpoint,secret:rows[0].secret,model},[{role:'user',content:'Balas hanya OK.'}],10);return {ok:true};}
 async configure(actor:string,body:unknown){const input=object(body),previous=await this.config();
  if(typeof input.trace_enabled!=='boolean')throw fail('Status log lengkap wajib valid');
  const selectedProvider=provider(input.provider??previous.provider);const endpoint=chatEndpoint(text(input.endpoint,512,'Endpoint'));const host=new URL(endpoint).hostname;if(selectedProvider==='openrouter'&&host!=='openrouter.ai')throw fail('Endpoint OpenRouter harus memakai openrouter.ai');if(selectedProvider==='sumopod'&&host!=='ai.sumopod.com')throw fail('Endpoint Sumopod harus memakai ai.sumopod.com');
  const config:AIConfig={provider:selectedProvider,endpoint,model:text(input.model_medium??input.model,100,'Model sedang'),secret:previous.secret,input_rate:integer(input.input_rate,0,1000,'Tarif input'),output_rate:integer(input.output_rate,1,1000,'Tarif output'),memory_limit:integer(input.memory_limit,1,100,'Batas memori'),context_memory_limit:integer(input.context_memory_limit,0,100,'Batas memori Context Agent'),trace_enabled:input.trace_enabled,credit_price:integer(input.credit_price,0,1000000,'Harga per 10.000 kredit'),tidy_prompt:text(input.tidy_prompt??previous.tidy_prompt??'',2000,'Prompt rapikan pesan')};
  for(const tier of modelTiers){const key=`model_${tier}` as const;config[key]=text(input[key]??(tier==='medium'?config.model:previous[key])??config.model,100,'Model '+tier);if(!config[key])throw fail('Model '+tier+' wajib diisi');}
  if(!config.model)throw fail('Model wajib diisi');await validatePublicUrl(config.endpoint);
  if(input.apiKey!==undefined&&input.apiKey!==''){const key=text(input.apiKey,512,'API key');if(!key||/[\r\n]/.test(key))throw fail('API key tidak valid');config.secret=encrypt(key);}
  if(!config.secret)throw fail('API key wajib diisi');
  await transaction(async c=>{await c.execute('INSERT INTO ai_settings(id,endpoint,model,secret,input_rate,output_rate,memory_limit,context_memory_limit,trace_enabled,credit_price,model_cheap,model_medium,model_smart,model_structured,tidy_prompt) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE endpoint=VALUES(endpoint),model=VALUES(model),secret=VALUES(secret),input_rate=VALUES(input_rate),output_rate=VALUES(output_rate),memory_limit=VALUES(memory_limit),context_memory_limit=VALUES(context_memory_limit),trace_enabled=VALUES(trace_enabled),credit_price=VALUES(credit_price),model_cheap=VALUES(model_cheap),model_medium=VALUES(model_medium),model_smart=VALUES(model_smart),model_structured=VALUES(model_structured),tidy_prompt=VALUES(tidy_prompt)',[config.endpoint,config.model,config.secret,config.input_rate,config.output_rate,config.memory_limit,config.context_memory_limit,config.trace_enabled,config.credit_price,config.model_cheap??config.model,config.model_medium??config.model,config.model_smart??config.model,config.model_structured??config.model,config.tidy_prompt??'']);
   // JSON slicing trims every tenant immediately without exposing conversation content.
   const [rows]=await c.query<RowDataPacket[]>('SELECT account_id,session_id,customer,messages FROM ai_conversations FOR UPDATE');
   for(const row of rows)await c.execute('UPDATE ai_conversations SET messages=? WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify(parseMemory(row.messages).slice(-config.memory_limit)),row.account_id,row.session_id,row.customer]);
   await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'ai_settings_updated')",[actor]);});return this.configuration();
 }
 async test(tier:unknown='medium'){
  if(!modelTiers.includes(tier as ModelTier))throw fail('Tier model tidak valid');
  const config=tierConfig(await this.config(),tier as ModelTier);if(!config.secret)throw fail('AI belum dikonfigurasi');
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
 async traceRequests(value:unknown){
  if(typeof value!=='string'||!/^\d{1,9}$/.test(value)||Number(value)<1)throw fail('Halaman tidak valid');
  const size=20;
  const [counts]=await db.execute<RowDataPacket[]>('SELECT COUNT(DISTINCT request_id) AS total FROM ai_trace_log');
  const total=Number(counts[0].total),pages=Math.max(1,Math.ceil(total/size)),page=Math.min(Number(value),pages);
  const [items]=await db.query('SELECT request_id,account_id,session_id,MIN(created_at) AS started_at,COUNT(*) AS event_count FROM ai_trace_log GROUP BY request_id,account_id,session_id ORDER BY started_at DESC LIMIT '+size+' OFFSET '+((page-1)*size));
  return {items,page,pages,total,page_size:size};
 }
 async traceLog(requestId:unknown){
  if(typeof requestId!=='string'||!/^[0-9a-f]{1,64}$/i.test(requestId))throw fail('ID permintaan tidak valid');
  const [rows]=await db.execute<RowDataPacket[]>('SELECT node,state,model,attempt,duration_ms,input,output,error,created_at FROM ai_trace_log WHERE request_id=? ORDER BY id',[requestId]);
  return rows;
 }
 async trial(account:string,body:unknown){
  // Tests either a session's attached data profile or a data profile directly (Data Profil page, even unattached).
  const input=object(body),question=text(input.question,2000,'Pertanyaan'),session=input.data_profile===undefined?text(input.session,64,'Sesi'):'';
  if(!question)throw fail('Pertanyaan wajib diisi');if(input.data_profile===undefined&&!session)throw fail('Pilih nomor layanan yang akan diuji');
  const config=await this.config();if(!config.secret)throw fail('AI belum dikonfigurasi');
  const assistant=session?await this.assistant(account,session):await this.dataProfile(account,input.data_profile);
  const profile='data_profile' in assistant?assistant.data_profile:{id:assistant.id,name:assistant.name,profile_type:assistant.profile_type};
  if(!profile)throw new ApiError(409,'no_profile','Pasang profil AI ke sesi ini terlebih dahulu.');
  if(!(await enabledProfiles()).has(profile.profile_type))throw new ApiError(409,'profile_disabled','Profil AI ini sedang dinonaktifkan admin.');
  config.workflow=await activeWorkflow(profile.profile_type) as AgentWorkflow;
  const pipeline=pipelines[profile.profile_type]??csPipeline,identity='edu' in assistant&&assistant.edu?eduIdentity(profile.name,assistant.edu):undefined;
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
   await c.execute("INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model,profile_type,data_profile_id) VALUES (?,?,?,'trial','generating',?,?,?,?,?,?,?)",[account,id,session,inputWords,config.input_rate,config.output_rate,reserved,config.model,profile.profile_type,profile.id]);
   return {reserved,maxWords};
  });
  let answer:string,agent:string|null=null,generationFailed=false;const documents:string[]=[];
  try{
   // Uji Coba never sends WhatsApp; a document the AI chose is listed with the answer instead.
   const result=await runAgents(this.transport,config,messages,prepared.maxWords,{account,profile:profile.id,session,customer:'628000000000',requestId:id,knowledge:assistant.knowledge,behavior:assistant.behavior,identity,fallbackEnabled:false},{execute:async(name,query,context)=>{const value=await this.tools.execute(name,query,{...context,sentDocuments:documents});if(name==='kirim_dokumen'&&(value as {available?:boolean})?.available)documents.push((value as {nama_file:string}).nama_file);return value;}},null,pipeline);
   answer=result.answer;agent=result.agent;
  }catch{generationFailed=true;answer=aiFallback;}
  const outputWords=generationFailed?0:countWords(answer),charged=generationFailed?0:creditCost(inputWords,outputWords,config.input_rate,config.output_rate);
  const wallet=await transaction(async c=>{await lockAccount(c,account,true);await c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?',[prepared.reserved-charged,account]);await c.execute("UPDATE ai_usage SET status=?,output_words=?,charged=?,agent=?,reserved=0 WHERE account_id=? AND request_id=?",[generationFailed?'failed':'generated',outputWords,charged,agent,account,id]);const [rows]=await c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[account]);return rows[0].balance as number;});
  if(generationFailed)throw new ApiError(502,'ai_provider_failed','AI belum berhasil menjawab; periksa konfigurasi AI.');
  return {answer,agent,balance:wallet,documents};
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
 // Per session: the AI switch and which data profile (content for one profile) the session runs.
 async sessionProfiles(account:string){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT a.session_id,a.enabled,p.id,p.name,p.profile_type FROM ai_assistants a LEFT JOIN ai_data_profiles p ON p.id=a.data_profile_id WHERE a.account_id=?',[account]);
  return Object.fromEntries(rows.map(row=>[String(row.session_id),{enabled:Boolean(row.enabled)&&Boolean(row.id),profile:row.id?{id:String(row.id),name:String(row.name),profile_type:String(row.profile_type)}:null}])) as Record<string,{enabled:boolean;profile:{id:string;name:string;profile_type:string}|null}>;
 }
 async setEnabled(account:string,session:string,enabled:boolean){
  await transaction(async c=>{await lockAccount(c,account);if(enabled)await this.ensureDataProfile(c,account,session);await c.execute('INSERT INTO ai_assistants(account_id,session_id,enabled) VALUES (?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),revision=revision+1',[account,session,enabled]);});
  return {enabled};
 }
 // Integrations written before profiles existed configure a session directly. When that session has no data
 // profile, one is created for it ("CS – <sesi>", the same name the upgrade migration uses) and attached.
 private async ensureDataProfile(c:PoolConnection,account:string,session:string){
  const [rows]=await c.execute<RowDataPacket[]>('SELECT data_profile_id FROM ai_assistants WHERE account_id=? AND session_id=? FOR UPDATE',[account,session]);
  if(rows[0]?.data_profile_id)return String(rows[0].data_profile_id);
  if(!(await enabledProfiles()).has('cs'))throw new ApiError(409,'profile_disabled','Profil CS Usaha sedang dinonaktifkan admin.');
  const id=await this.insertDataProfile(c,account,'cs',await this.uniqueName(c,account,'CS – '+session));
  await c.execute('INSERT INTO ai_assistants(account_id,session_id,enabled,data_profile_id) VALUES (?,?,FALSE,?) ON DUPLICATE KEY UPDATE data_profile_id=VALUES(data_profile_id),revision=revision+1',[account,session,id]);
  return id;
 }
 private async uniqueName(c:PoolConnection,account:string,base:string){const [rows]=await c.execute<RowDataPacket[]>('SELECT name FROM ai_data_profiles WHERE account_id=? FOR UPDATE',[account]);const names=new Set(rows.map(row=>String(row.name).toLowerCase()));let name=base.slice(0,100);for(let n=2;names.has(name.toLowerCase());n++)name=base.slice(0,94)+' ('+n+')';return name;}
 private async insertDataProfile(c:PoolConnection,account:string,type:string,name:string,from?:RowDataPacket,kind?:EduKind){
  const [count]=await c.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ai_data_profiles WHERE account_id=?',[account]);
  if(Number(count[0].n)>=100)throw new ApiError(409,'data_profile_limit','Maksimal 100 data profil per akun.');
  const id=randomUUID(),columns=profileFields.map(field=>'profil_'+field),edu=eduColumns(from,kind);
  await c.execute(`INSERT INTO ai_data_profiles(id,account_id,profile_type,name,behavior,fallback_number,fallback_notify,${columns.join(',')},${Object.keys(edu).join(',')}) VALUES (?,?,?,?,?,?,?,${columns.map(()=>'?').join(',')},${Object.keys(edu).map(()=>'?').join(',')})`,[id,account,type,name,String(from?.behavior??''),String(from?.fallback_number??''),Boolean(from?.fallback_notify),...columns.map(column=>String(from?.[column]??'')),...Object.values(edu)]);
  return id;
 }
 // The data profile a session runs (null when none is attached).
 async sessionProfile(account:string,session:string){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT data_profile_id FROM ai_assistants WHERE account_id=? AND session_id=?',[account,session]);
  return rows[0]?.data_profile_id?String(rows[0].data_profile_id):null;
 }
 // For legacy session-scoped writes: the attached data profile, created and attached first when there is none.
 async ensureSessionProfile(account:string,session:string){return transaction(async c=>{await lockAccount(c,account);return this.ensureDataProfile(c,account,session);});}
 private dataProfileId(value:unknown){if(typeof value!=='string'||!/^[0-9a-f-]{36}$/.test(value))throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');return value;}
 async ownedDataProfile(account:string,value:unknown){const id=this.dataProfileId(value);const [rows]=await db.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE id=? AND account_id=?',[id,account]);if(!rows[0])throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');return id;}
 async profileType(account:string,profile:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT profile_type FROM ai_data_profiles WHERE id=? AND account_id=?',[profile,account]);if(!rows[0])throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');return String(rows[0].profile_type);}
 private profileView(row:RowDataPacket){
  const profile=Object.fromEntries(profileFields.map(field=>[field,String(row['profil_'+field]??'')])) as Record<ProfileField,string>;
  return {profile,knowledge:row.profile_type==='cs'?composeKnowledge(profile):'',behavior:String(row.behavior??''),fallback_number:String(row.fallback_number??''),fallback_notify:Boolean(row.fallback_notify),revision:Number(row.revision??0),edu:row.profile_type==='pendidikan'?eduView(row):null};
 }
 async dataProfiles(account:string){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT p.id,p.profile_type,p.name,p.updated_at,(SELECT COUNT(*) FROM ai_products x WHERE x.data_profile_id=p.id) AS products,(SELECT COUNT(*) FROM ai_orders o WHERE o.data_profile_id=p.id) AS orders,(SELECT COUNT(*) FROM ai_edu_programs e WHERE e.data_profile_id=p.id) AS programs,(SELECT COUNT(*) FROM ai_edu_documents e WHERE e.data_profile_id=p.id) AS documents,(SELECT COUNT(*) FROM ai_edu_contacts e WHERE e.data_profile_id=p.id) AS contacts FROM ai_data_profiles p WHERE p.account_id=? ORDER BY p.name',[account]);
  const [attached]=await db.execute<RowDataPacket[]>('SELECT data_profile_id,session_id FROM ai_assistants WHERE account_id=? AND data_profile_id IS NOT NULL ORDER BY session_id',[account]);
  const enabled=await enabledProfiles();
  return rows.map(row=>({id:String(row.id),profile_type:String(row.profile_type),profile_name:profileDefinition(row.profile_type).name,profile_enabled:enabled.has(row.profile_type),name:String(row.name),products:Number(row.products),orders:Number(row.orders),programs:Number(row.programs),documents:Number(row.documents),contacts:Number(row.contacts),updated_at:row.updated_at,sessions:attached.filter(a=>a.data_profile_id===row.id).map(a=>String(a.session_id))}));
 }
 async dataProfile(account:string,value:unknown){
  const id=this.dataProfileId(value);
  const [rows]=await db.execute<RowDataPacket[]>('SELECT * FROM ai_data_profiles WHERE id=? AND account_id=?',[id,account]);const row=rows[0];
  if(!row)throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');
  const [attached]=await db.execute<RowDataPacket[]>('SELECT session_id FROM ai_assistants WHERE account_id=? AND data_profile_id=? ORDER BY session_id',[account,id]);
  return {id,profile_type:String(row.profile_type),profile_name:profileDefinition(row.profile_type).name,profile_enabled:(await enabledProfiles()).has(row.profile_type),name:String(row.name),sessions:attached.map(a=>String(a.session_id)),...this.profileView(row),...await publicSources(account,id)};
 }
 async createDataProfile(account:string,body:unknown){
  const input=object(body),name=text(input.name,100,'Nama data profil');if(!name)throw fail('Nama data profil wajib diisi');
  const copyFrom=input.copy_from===undefined?undefined:this.dataProfileId(input.copy_from);
  const kind=input.edu_kind===undefined?undefined:eduKind(input.edu_kind);
  const images=new Map<string,string>(),documents:string[]=[];
  let id:string;
  try{
   id=await transaction(async c=>{await lockAccount(c,account);
    let from:RowDataPacket|undefined,type:string;
    if(copyFrom){const [rows]=await c.execute<RowDataPacket[]>('SELECT * FROM ai_data_profiles WHERE id=? AND account_id=? FOR SHARE',[copyFrom,account]);from=rows[0];if(!from)throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');type=String(from.profile_type);}
    else type=profileDefinition(input.profile_type).id;
    if(!(await enabledProfiles()).has(type))throw new ApiError(409,'profile_disabled','Profil AI ini sedang dinonaktifkan admin.');
    const [taken]=await c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE account_id=? AND name=? FOR UPDATE',[account,name]);if(taken[0])throw new ApiError(409,'name_taken','Nama data profil sudah dipakai.');
    const created=await this.insertDataProfile(c,account,type,name,from,kind);
    if(copyFrom){
     // A duplicate owns its own copy of every photo, so deleting either data profile never breaks the other.
     const [photos]=await c.execute<RowDataPacket[]>('SELECT id FROM ai_product_images WHERE account_id=? AND data_profile_id=?',[account,copyFrom]);
     for(const photo of photos){const copy=await this.productImages.copy(account,String(photo.id));images.set(String(photo.id),copy.id);await c.execute('INSERT INTO ai_product_images(id,account_id,data_profile_id,size_bytes) VALUES (?,?,?,?)',[copy.id,account,created,copy.sizeBytes]);}
     const [products]=await c.execute<RowDataPacket[]>('SELECT * FROM ai_products WHERE account_id=? AND data_profile_id=?',[account,copyFrom]);
     for(const p of products)await c.execute('INSERT INTO ai_products(account_id,data_profile_id,name,type,description,price,stock,active,image_id) VALUES (?,?,?,?,?,?,?,?,?)',[account,created,p.name,p.type,p.description,p.price,p.stock,p.active,p.image_id?images.get(String(p.image_id))??null:null]);
     await c.execute('INSERT INTO ai_data_sources(account_id,data_profile_id,kind,mode,endpoint,secret) SELECT account_id,?,kind,mode,endpoint,secret FROM ai_data_sources WHERE account_id=? AND data_profile_id=?',[created,account,copyFrom]);
     await eduData.store.copy(c,account,copyFrom,created,documents);
    }
    return created;
   });
  }catch(error){for(const copy of images.values())await this.productImages.removeFile(account,copy).catch(()=>{});await eduData.store.removeFiles(account,documents);throw error;}
  return this.dataProfile(account,id);
 }
 async renameDataProfile(account:string,value:unknown,body:unknown){
  const id=this.dataProfileId(value),name=text(object(body).name,100,'Nama data profil');if(!name)throw fail('Nama data profil wajib diisi');
  await transaction(async c=>{await lockAccount(c,account);
   const [rows]=await c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE id=? AND account_id=? FOR UPDATE',[id,account]);if(!rows[0])throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');
   const [taken]=await c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE account_id=? AND name=? AND id<>?',[account,name,id]);if(taken[0])throw new ApiError(409,'name_taken','Nama data profil sudah dipakai.');
   await c.execute('UPDATE ai_data_profiles SET name=? WHERE id=?',[name,id]);
  });return this.dataProfile(account,id);
 }
 // Only an unattached data profile can be deleted; its products, sources, orders and photos go with it.
 async deleteDataProfile(account:string,value:unknown){
  const id=this.dataProfileId(value);
  const photos=await transaction(async c=>{await lockAccount(c,account);
   const [rows]=await c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE id=? AND account_id=? FOR UPDATE',[id,account]);if(!rows[0])throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');
   const [attached]=await c.execute<RowDataPacket[]>('SELECT session_id FROM ai_assistants WHERE account_id=? AND data_profile_id=? FOR UPDATE',[account,id]);
   if(attached.length)throw new ApiError(409,'data_profile_in_use','Data profil masih dipasang di sesi '+attached.map(a=>a.session_id).join(', ')+'. Cabut dari sesi terlebih dahulu.');
   const [images]=await c.execute<RowDataPacket[]>('SELECT id FROM ai_product_images WHERE account_id=? AND data_profile_id=?',[account,id]);
   const documents=await eduData.store.files(c,account,id);
   await c.execute('DELETE FROM ai_data_profiles WHERE id=? AND account_id=?',[id,account]);
   return {images:images.map(image=>String(image.id)),documents};
  });
  for(const photo of photos.images)await this.productImages.removeFile(account,photo).catch(()=>{});
  await eduData.store.removeFiles(account,photos.documents);
  return {ok:true};
 }
 // Attaches a data profile to a session, switches it, or detaches it (null). Memory built for another business
 // no longer applies, so a change empties the session's AI memory and S-P-O context; the chat history stays.
 async attachProfile(account:string,session:string,body:unknown){
  const input=object(body);if(input.data_profile_id!==null&&typeof input.data_profile_id!=='string')throw fail('Data profil wajib dipilih');
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw fail('Status asisten wajib valid');
  const target=input.data_profile_id===null?null:this.dataProfileId(input.data_profile_id);
  await transaction(async c=>{await lockAccount(c,account);
   let profile:RowDataPacket|undefined;
   if(target){const [rows]=await c.execute<RowDataPacket[]>('SELECT id,name,profile_type FROM ai_data_profiles WHERE id=? AND account_id=? FOR SHARE',[target,account]);profile=rows[0];if(!profile)throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');if(!(await enabledProfiles()).has(String(profile.profile_type)))throw new ApiError(409,'profile_disabled','Profil AI ini sedang dinonaktifkan admin.');}
   const [current]=await c.execute<RowDataPacket[]>('SELECT data_profile_id,enabled FROM ai_assistants WHERE account_id=? AND session_id=? FOR UPDATE',[account,session]);
   const previous=current[0]?.data_profile_id?String(current[0].data_profile_id):null;
   const enabled=target?(input.enabled===undefined?Boolean(current[0]?.enabled):input.enabled===true):false;
   await c.execute('INSERT INTO ai_assistants(account_id,session_id,enabled,data_profile_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),data_profile_id=VALUES(data_profile_id),revision=revision+1',[account,session,enabled,target]);
   if(previous===target)return;
   const [customers]=await c.execute<RowDataPacket[]>('SELECT customer FROM ai_conversations WHERE account_id=? AND session_id=? FOR UPDATE',[account,session]);
   await c.execute('UPDATE ai_conversations SET messages=JSON_ARRAY(),router_context=NULL,revision=revision+1 WHERE account_id=? AND session_id=?',[account,session]);
   const note=!profile?'Profil AI dicabut; AI berhenti membalas':previous?'Profil diganti ke '+profile.name+'; memori AI dikosongkan':'Profil AI dipasang: '+profile.name;
   for(const row of customers)await recordNote(account,session,String(row.customer),note,c);
  });
  return this.assistant(account,session);
 }
 // Autosave: one field at a time, read-modify-write against the stored row so an in-flight edit
 // in another tab never gets clobbered by a save that only carries a single field's value.
 async saveField(account:string,session:string,field:string,value:unknown){
  await this.saveProfileField(account,await this.ensureSessionProfile(account,session),field,value);
  return this.assistant(account,session);
 }
 async saveDataProfileField(account:string,value:unknown,field:string,input:unknown){const id=await this.ownedDataProfile(account,value);await this.saveProfileField(account,id,field,input);return this.dataProfile(account,id);}
 private async saveProfileField(account:string,profile:string,field:string,value:unknown){
  // Each profile accepts its own fields; behavior, FAQ and the fallback number are shared by every profile.
  const type=await this.profileType(account,profile);
  if(field==='faq'){await db.execute('UPDATE ai_data_profiles SET profil_faq=?,revision=revision+1 WHERE id=? AND account_id=?',[text(value,faqLimit(type),'FAQ'),profile,account]);return;}
  if(type==='pendidikan'){
   if(field==='edu_kind'){await db.execute('UPDATE ai_data_profiles SET edu_kind=?,revision=revision+1 WHERE id=? AND account_id=?',[eduKind(value),profile,account]);return;}
   if(Object.hasOwn(eduTextFields,field)){const spec=eduTextFields[field as keyof typeof eduTextFields];await db.execute(`UPDATE ai_data_profiles SET ${spec.column}=?,revision=revision+1 WHERE id=? AND account_id=?`,[text(value,spec.max,spec.label),profile,account]);return;}
  }
  if(type==='cs'&&profileFields.includes(field as ProfileField)){
   await db.execute(`UPDATE ai_data_profiles SET profil_${field}=?,revision=revision+1 WHERE id=? AND account_id=?`,[text(value,2000,profileLabels[field as ProfileField]),profile,account]);return;
  }
  if(field==='behavior'){await db.execute('UPDATE ai_data_profiles SET behavior=?,revision=revision+1 WHERE id=? AND account_id=?',[text(value,2000,'Perilaku AI'),profile,account]);return;}
  if(field==='fallback_number'||field==='fallback_notify'){
   const [rows]=await db.execute<RowDataPacket[]>('SELECT fallback_number,fallback_notify FROM ai_data_profiles WHERE id=? AND account_id=?',[profile,account]);
   const current={fallback_number:String(rows[0]?.fallback_number??''),fallback_notify:Boolean(rows[0]?.fallback_notify)};
   const fallbackNumber=field==='fallback_number'?(value===''?'':text(value,20,'Nomor fallback')):current.fallback_number;
   if(fallbackNumber&&!/^[1-9][0-9]{5,14}$/.test(fallbackNumber))throw fail('Nomor fallback harus nomor internasional tanpa +');
   const fallbackNotify=field==='fallback_notify'?value===true:current.fallback_notify;
   await db.execute('UPDATE ai_data_profiles SET fallback_number=?,fallback_notify=?,revision=revision+1 WHERE id=? AND account_id=?',[fallbackNumber,Boolean(fallbackNumber)&&fallbackNotify,profile,account]);return;
  }
  if(type==='cs'&&(field==='products_source'||field==='orders_source')){
   const kind=field==='products_source'?'products':'orders';
   const input=await sourceInput(value);
   await transaction(async c=>{await lockAccount(c,account);await saveSource(c,account,profile,kind,input);});return;
  }
  throw fail('Bidang tidak dikenal');
 }
 // A session's AI settings: its switch plus the attached data profile's content (empty when none is attached).
 async assistant(account:string,session:string){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT a.enabled,a.data_profile_id,p.* FROM ai_assistants a LEFT JOIN ai_data_profiles p ON p.id=a.data_profile_id WHERE a.account_id=? AND a.session_id=?',[account,session]);
  const row=rows[0],attached=row?.data_profile_id?String(row.data_profile_id):null;
  const view=attached?this.profileView(row):{profile:Object.fromEntries(profileFields.map(field=>[field,''])) as Record<ProfileField,string>,knowledge:'',behavior:'',fallback_number:'',fallback_notify:false,revision:0,edu:null};
  const {secret:_,...builtin}=builtinSource,sources=attached?await publicSources(account,attached):{products_source:{...builtin,has_token:false},orders_source:{...builtin,has_token:false}};
  return {enabled:Boolean(row?.enabled)&&Boolean(attached),data_profile:attached?{id:attached,name:String(row.name),profile_type:String(row.profile_type)}:null,profile_enabled:attached?(await enabledProfiles()).has(String(row.profile_type)):false,...view,...sources};
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
   const id=await this.ensureDataProfile(c,account,session);
   const [types]=await c.execute<RowDataPacket[]>('SELECT profile_type FROM ai_data_profiles WHERE id=?',[id]);if(types[0]?.profile_type!=='cs')throw new ApiError(409,'profile_mismatch','Sesi ini memakai profil lain; ubah isinya lewat halaman Asisten AI atau endpoint data profil.');
   await c.execute(`UPDATE ai_data_profiles SET behavior=?,fallback_number=?,fallback_notify=?,revision=revision+1,${profileColumns.map(column=>column+'=?').join(',')} WHERE id=? AND account_id=?`,[behavior,fallbackNumber,Boolean(fallbackNumber)&&fallbackNotify,...profileValues,id,account]);
   await c.execute('UPDATE ai_assistants SET enabled=?,revision=revision+1 WHERE account_id=? AND session_id=?',[Boolean(input.enabled),account,session]);
   if(products)await saveSource(c,account,id,'products',products);if(orders)await saveSource(c,account,id,'orders',orders);
  });return this.assistant(account,session);
 }
 async registerSystemMessage(account:string,session:string,messageId:string){
  await db.execute("INSERT INTO ai_message_origins(account_id,session_id,message_id,origin) VALUES (?,?,?,'system')",[account,session,messageId]);
 }
 private async handleFallbackReply(account:string,manager:SessionManager,session:string,message:IncomingMessage){
  const [settings]=await db.execute<RowDataPacket[]>('SELECT p.fallback_number FROM ai_assistants a JOIN ai_data_profiles p ON p.id=a.data_profile_id WHERE a.account_id=? AND a.session_id=? AND p.fallback_number=? AND p.fallback_notify=TRUE',[account,session,message.from]);
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
  try{const relayed=await sendBilled(account,manager,session,'text',{to:ticket.customer,text:answer},'fallback_resume_'+digest(message.messageId).slice(0,64));sent=true;await recordOutgoing(account,session,{customer:ticket.customer,messageId:relayed.messageId,origin:'manual',text:answer}).catch(()=>{});}catch{}
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
  try{await sendBilled(account,manager,session,'text',{to:ticket.customer,text:customerAnswer},'fallback_web_'+digest(id+'\0'+answer).slice(0,64)).then(async relayed=>{await recordOutgoing(account,session,{customer:ticket.customer,messageId:relayed.messageId,origin:'manual',text:customerAnswer}).catch(()=>{});});sent=true;}catch{}
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
   await this.applyManualReply(c,account,session,message.from,(message.type==='text'?message.text:`[Pesan ${message.type} manual] ${message.text}`).trim().slice(0,4000));
  });
 }
 // A human reply, from the phone or the dashboard, enters AI memory and pauses the AI unless full auto is on.
 private async applyManualReply(c:PoolConnection,account:string,session:string,customer:string,content:string){
  const [assistant]=await c.execute<RowDataPacket[]>('SELECT enabled FROM ai_assistants WHERE account_id=? AND session_id=?',[account,session]);
  if(!assistant[0]?.enabled)return;
  const [settings]=await c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');
  const limit=settings[0]?.memory_limit??defaults.memory_limit;
  await c.execute("INSERT IGNORE INTO ai_conversations(account_id,session_id,customer,paused,messages) VALUES (?,?,?,FALSE,'[]')",[account,session,customer]);
  const [rows]=await c.execute<RowDataPacket[]>('SELECT messages,paused,full_auto FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,customer]);
  const memory=[...parseMemory(rows[0].messages),...(content?[{role:'assistant' as const,content}]:[])].slice(-limit);
  await c.execute('UPDATE ai_conversations SET paused=IF(full_auto,FALSE,TRUE),revision=revision+1,router_context=NULL,messages=? WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify(memory),account,session,customer]);
  if(!rows[0].paused&&!rows[0].full_auto)await recordNote(account,session,customer,'AI dijeda karena ada balasan manual',c);
 }
 // What sent a message this session already knows about: 'system' for API/AI/Auto Share sends, 'manual' for phone replies.
 async knownOrigin(account:string,session:string,messageId:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT origin FROM ai_message_origins WHERE account_id=? AND session_id=? AND message_id=?',[account,session,messageId]);return rows[0]?.origin as string|undefined;}
 // Dashboard reply: billed like any API send, recorded as manual, and handled like a reply typed on the phone.
 async dashboardReply(account:string,manager:SessionManager,session:string,customer:string,body:unknown,key:unknown){
  if(!/^[0-9]{5,20}$/.test(customer))throw fail('Nomor pelanggan tidak valid');
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(key))throw fail('Idempotency-Key wajib diisi');
  const input=object(body),message=text(input.text,4000,'Pesan');if(!message)throw fail('Pesan wajib diisi');
  const sent=await sendBilled(account,manager,session,'text',{to:customer,text:message},'manual_'+key);
  // A retried request returns the original send; only its first completion touches memory and history.
  const [existing]=await db.execute<RowDataPacket[]>("SELECT origin FROM ai_chat_messages WHERE account_id=? AND session_id=? AND message_id=? AND origin='manual'",[account,session,sent.messageId]);
  if(!existing[0])await transaction(async c=>{await lockAccount(c,account,true);await recordOutgoing(account,session,{customer,messageId:sent.messageId,origin:'manual',text:message},c);await this.applyManualReply(c,account,session,customer,message);});
  return {messageId:sent.messageId};
 }
 // Products, sources and orders belong to the data profile and stay with it; only this session's own state goes.
 async removeSession(account:string,session:string){await transaction(async c=>{await lockAccount(c,account,true);for(const table of ['ai_chat_messages','ai_fallbacks'])await c.execute('DELETE FROM '+table+' WHERE account_id=? AND session_id=?',[account,session]);await c.execute('DELETE FROM ai_assistants WHERE account_id=? AND session_id=?',[account,session]);await c.execute('DELETE FROM ai_conversations WHERE account_id=? AND session_id=?',[account,session]);});}
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
   const profile=await this.ensureDataProfile(c,account,session);
   const [profiles]=await c.execute<RowDataPacket[]>('SELECT profil_faq,profile_type FROM ai_data_profiles WHERE id=? AND account_id=? FOR UPDATE',[profile,account]);const previous=String(profiles[0]?.profil_faq??''),faq=(previous?previous+'\n\n':'')+content,limit=faqLimit(String(profiles[0]?.profile_type));if(faq.length>limit)throw fail('Bagian FAQ melebihi batas '+limit.toLocaleString('id-ID')+' karakter; kosongkan sebagian sebelum menambah lagi.');
   await c.execute('UPDATE ai_data_profiles SET profil_faq=?,revision=revision+1 WHERE id=? AND account_id=?',[faq,profile,account]);const knowledge=composeKnowledge({faq});return {ok:true,knowledge};
  });
 }
 async conversation(account:string,session:string,customer:string,body:unknown){
  if(!/^[0-9]{5,20}$/.test(customer))throw fail('Nomor pelanggan tidak valid');
  const input=object(body);if(typeof input.paused!=='boolean'||(input.clear!==undefined&&typeof input.clear!=='boolean')||(input.full_auto!==undefined&&typeof input.full_auto!=='boolean')||(input.paused&&input.full_auto===true))throw fail('Status percakapan tidak valid');
  await transaction(async c=>{await lockAccount(c,account);const [before]=await c.execute<RowDataPacket[]>('SELECT paused,full_auto FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,customer]);await c.execute("INSERT INTO ai_conversations(account_id,session_id,customer,paused,full_auto,messages) VALUES (?,?,?,?,?,'[]') ON DUPLICATE KEY UPDATE paused=VALUES(paused),full_auto=IF(?,VALUES(full_auto),full_auto),router_context=IF(?,NULL,router_context),messages=IF(?,JSON_ARRAY(),messages),revision=revision+1",[account,session,customer,Boolean(input.paused),input.full_auto===true,Boolean(input.paused)||input.full_auto!==undefined,input.clear===true,input.clear===true]);
   // Shown in the chat history, so the owner can see why the AI stopped or resumed answering.
   const was={paused:Boolean(before[0]?.paused),full_auto:Boolean(before[0]?.full_auto)},[after]=await c.execute<RowDataPacket[]>('SELECT paused,full_auto FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',[account,session,customer]);
   if(!was.paused&&after[0].paused)await recordNote(account,session,customer,'AI dijeda oleh admin',c);
   if(was.paused&&!after[0].paused)await recordNote(account,session,customer,'AI dilanjutkan oleh admin',c);
   if(was.full_auto!==Boolean(after[0].full_auto))await recordNote(account,session,customer,after[0].full_auto?'Full auto diaktifkan':'Full auto dinonaktifkan',c);
   if(input.clear===true)await recordNote(account,session,customer,'Konteks AI dihapus; riwayat chat tetap tersimpan',c);
  });return {ok:true};
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
  // Runs the pipeline of the profile the session's data profile belongs to, while the owner has it switched on.
  const config=await this.config();if(!config.secret)return;
  const assistant=await this.assistant(account,session),type=assistant.data_profile?.profile_type??'',pipeline=pipelines[type];if(!assistant.enabled||!pipeline||!assistant.profile_enabled)return;
  manager.connected(session);if((await basicWallet(account)).balance<1)return;
  const id=digest(JSON.stringify([session,message.from,message.messageId]));
  const prepared=await transaction(async c=>{await lockAccount(c,account);
   const [existing]=await c.execute<RowDataPacket[]>('SELECT request_id FROM ai_usage WHERE account_id=? AND request_id=?',[account,id]);if(existing[0])return;
   const [current]=await c.execute<RowDataPacket[]>('SELECT a.enabled,p.*,p.id AS data_profile_id FROM ai_assistants a JOIN ai_data_profiles p ON p.id=a.data_profile_id AND p.account_id=a.account_id JOIN ai_profile_types t ON t.id=p.profile_type AND t.enabled=TRUE WHERE a.account_id=? AND a.session_id=? AND p.profile_type=?',[account,session,type]);if(!current[0]?.enabled)return;
   // CS knowledge is a snapshot taken here; the education tools read the data profile when they run.
   const knowledge=type==='cs'?composeKnowledge(Object.fromEntries(profileFields.map(field=>[field,String(current[0]['profil_'+field]??'')])) as Record<ProfileField,string>):'';
   const identity=type==='pendidikan'?eduIdentity(String(current[0].name),eduView(current[0])):undefined;
   const [limits]=await c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');
   await c.execute("INSERT IGNORE INTO ai_conversations(account_id,session_id,customer,paused,messages) VALUES (?,?,?,FALSE,'[]')",[account,session,message.from]);
   const [conversations]=await c.execute<RowDataPacket[]>('SELECT paused,messages,revision,router_context FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,message.from]);if(conversations[0].paused)return;
   if(message.text.length>4000)return;
   const memory=[...parseMemory(conversations[0].messages),{role:'user' as const,content:message.text}].slice(-(limits[0]?.memory_limit??config.memory_limit));
   await c.execute('INSERT IGNORE INTO ai_wallets VALUES (?,0)',[account]);const [wallet]=await c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[account]);
   const [pending]=await c.execute<RowDataPacket[]>('SELECT id,question FROM ai_fallbacks WHERE account_id=? AND session_id=? AND customer=? AND status=\'waiting\' ORDER BY created_at DESC LIMIT 5',[account,session,message.from]);
   const fallbackNumber=String(current[0].fallback_number??'');
   const system:AIMessage[]=[{role:'system',content:pipeline.system},...([current[0].behavior] as string[]).filter(Boolean).map(content=>({role:'system' as const,content}))];
   const messages=[...system,...memory],inputWords=messages.reduce((sum,m)=>sum+countWords(m.content),0);
   // The system instruction is counted too; replacing its numeric limit does not change its word count.
   const maxWords=Math.min(300,Math.floor((wallet[0].balance-inputWords*config.input_rate)/config.output_rate));
   if(inputWords>12000||maxWords<1)return;
   system[0].content=system[0].content.replace('300 kata',maxWords+' kata');
   const reserved=creditCost(inputWords,maxWords,config.input_rate,config.output_rate);
   await c.execute('UPDATE ai_wallets SET balance=balance-? WHERE account_id=?',[reserved,account]);
   await c.execute("INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model,profile_type,data_profile_id) VALUES (?,?,?,?,'generating',?,?,?,?,?,?,?)",[account,id,session,message.from,inputWords,config.input_rate,config.output_rate,reserved,config.model,type,current[0].data_profile_id]);
   await c.execute('UPDATE ai_conversations SET messages=? WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify(memory),account,session,message.from]);return {messages,inputWords,reserved,maxWords,routerContext:conversations[0].router_context as string|null,revision:conversations[0].revision,knowledge,behavior:current[0].behavior as string,identity,pendingFallbacks:pending.map(row=>({id:String(row.id),question:String(row.question)})),fallbackNumber,fallbackNotify:Boolean(current[0].fallback_notify),profileId:String(current[0].data_profile_id)};
  });if(!prepared)return;
  config.workflow=await activeWorkflow(type) as AgentWorkflow;
  const jid=message.from+'@s.whatsapp.net';
  // Customer-facing order: a short pause, blue ticks, then "typing..." for the whole generation.
  // Read/presence are best effort and never add a message or a credit charge.
  await this.wait(randomInt(200,1001));
  await manager.read(session,jid,message.messageId).catch(()=>{});
  await manager.typing(session,jid,'composing').catch(()=>{});
  // WhatsApp drops "composing" after a few seconds, so it is refreshed until the reply goes out.
  const typingRefresh=setInterval(()=>{manager.typing(session,jid,'composing').catch(()=>{});},8000);typingRefresh.unref();
  let typingStopped=false;
  const stopTyping=async()=>{if(typingStopped)return;typingStopped=true;clearInterval(typingRefresh);await manager.typing(session,jid,'paused').catch(()=>{});};
  try{
  // Assistant config (knowledge/behavior/fallback) can autosave mid-flight; a request already in
  // progress finishes with the config it started with rather than being cancelled by every edit.
  // Disabling the assistant is the one config change that still cancels in-flight work immediately.
  // Switching the session to another data profile, or the owner switching the profile off, cancels too.
  const guard=async()=>{const enabled=await this.assistant(account,session);const [rows]=await db.execute<RowDataPacket[]>('SELECT paused,revision FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',[account,session,message.from]);
   if(!enabled.enabled||enabled.data_profile?.id!==prepared.profileId||!enabled.profile_enabled||rows[0]?.paused||rows[0]?.revision!==prepared.revision)throw new ApiError(409,'ai_cancelled','Asisten atau konteks percakapan telah berubah');};
  const modelCalls:{role:ModelRole|undefined;model:string;status:string;attempt:number}[]=[];
  const deadline=Date.now()+120000;
  const retryPause=async(attempt:number)=>{await this.wait(500*2**attempt+randomInt(0,251));await guard();};
  let lastMessages:AIMessage[]|undefined,lastModel:string|undefined;
  const trace=config.trace_enabled?(event:AITraceEvent)=>{db.execute('INSERT INTO ai_trace_log(account_id,session_id,request_id,profile_type,node,state,model,attempt,duration_ms,input,output,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[account,session,id,type,event.node.slice(0,20),event.state.slice(0,20),event.model?.slice(0,100)??null,event.attempt??null,event.duration_ms??null,event.input!==undefined?JSON.stringify(event.input).slice(0,60000):null,event.output!==undefined?JSON.stringify(event.output).slice(0,60000):null,event.error?.slice(0,200)??null]).catch(()=>{});}:undefined;
  const trackedTransport:AITransport=async(selected,messages,maxWords)=>{
   lastMessages=messages;lastModel=selected.model;
   const node=selected.call_role??'model';
   for(let attempt=0;attempt<3;attempt++){
    await guard();if(modelCalls.length>=20||Date.now()>=deadline)throw Error('ai_retry_limit');
    const entry={role:selected.call_role,model:selected.model,status:'failed',attempt:attempt+1};modelCalls.push(entry);
    trace?.({node,state:'running',input:messages,model:selected.model,attempt:attempt+1});
    try{const result=await this.transport(selected,messages,maxWords);entry.status='responded';trace?.({node,state:'responded',output:result,model:selected.model,attempt:attempt+1});return result;}
    catch(error){trace?.({node,state:'error',error:error instanceof Error?error.message:'unknown_error',attempt:attempt+1});if(attempt===2||!transientAIError(error))throw error;await retryPause(attempt);}
   }
   throw Error('ai_retry_limit');
  };
  let answer:string,agent:string|null=null,generationFailed=false,fallback:{reason:string;question:string}|undefined;
  let lastNode:string|undefined,lastTraceError:string|undefined,lastRawOutput:string|undefined,pendingImageId:string|undefined;
  // Documents chosen with kirim_dokumen this turn, sent ahead of the answer; the memory markers stop a repeat.
  const alreadySent=sentDocuments(prepared.messages),pendingDocuments:{id:string;filename:string}[]=[];
  config.onTrace=event=>{trace?.(event);if(event.node==='router'&&event.state==='routed')lastNode=String((event.output as {sub_agent?:unknown})?.sub_agent??lastNode);if(event.error){lastNode=event.node;lastTraceError=event.error;if(typeof event.output==='string')lastRawOutput=event.output;}};
  try{const result=await runAgents(trackedTransport,config,prepared.messages,prepared.maxWords,{account,profile:prepared.profileId,session,customer:message.from,requestId:id,knowledge:prepared.knowledge,behavior:prepared.behavior,fallbackEnabled:true,pendingFallbacks:prepared.pendingFallbacks,identity:prepared.identity,sentDocuments:alreadySent},{execute:async(name,query,base)=>{
   await guard();
   const context={...base,sentDocuments:[...alreadySent,...pendingDocuments.map(d=>d.filename)]};
   const start=Date.now();trace?.({node:name,state:'running',input:query});
   try{let result=await this.tools.execute(name,query,context);
    if(name==='kirim_dokumen'&&(result as {available?:boolean})?.available){if(pendingDocuments.length>=3)result={available:false,reason:'Paling banyak tiga dokumen per jawaban.'};else pendingDocuments.push({id:(result as {document_id:string}).document_id,filename:(result as {nama_file:string}).nama_file});}
    trace?.({node:name,state:'done',output:result,duration_ms:Date.now()-start});
    // Resolving the image is just data; the actual WhatsApp send happens once the final answer is settled below,
    // so a later tool step or an ai_invalid_tool retry never leaves an image sent ahead of a discarded turn.
    if(name==='send_product_image'&&(result as {available?:boolean;image_id?:string})?.available)pendingImageId=(result as {image_id:string}).image_id;
    return result;}catch(error){
    if(name==='create_order'||!transientAIError(error)||Date.now()>=deadline){trace?.({node:name,state:'error',error:error instanceof Error?error.message:'unknown_error',duration_ms:Date.now()-start});throw error;}
    await retryPause(0);const result=await this.tools.execute(name,query,context);trace?.({node:name,state:'done',output:result,duration_ms:Date.now()-start});return result;
   }
  }},prepared.routerContext,pipeline);fallback=result.fallback;answer=fallback?'Baik, saya konfirmasi dulu dan akan melanjutkan jawaban segera.':result.answer;agent=result.agent;}
  catch(error){generationFailed=true;answer=aiFallback;
   const errorCode=error instanceof Error?error.message:'unknown_error';
   await db.execute('INSERT INTO ai_agent_failures(account_id,session_id,request_id,agent,error,message,model,prompt,raw_output,router_context) VALUES (?,?,?,?,?,?,?,?,?,?)',[account,session,id,lastNode??null,(lastTraceError??errorCode).slice(0,100),message.text.slice(0,4000),lastModel??null,lastMessages?JSON.stringify(lastMessages):null,lastRawOutput?.slice(0,65000)??null,prepared.routerContext]).catch(()=>{});
  }
  // Context is internal and never billed. A failed summary clears stale context on a successful send.
  let routerContext:string|null=null;
  const contextHistory=config.context_memory_limit>0?prepared.messages.filter(m=>m.role!=='system').slice(0,-1).slice(-config.context_memory_limit):[];
  if(!generationFailed)try{routerContext=await updateRouterContext(trackedTransport,config,message.text,answer,contextHistory,pipeline);}catch(error){
   console.error('Pembaruan konteks router AI gagal.');
   const errorCode=error instanceof Error?error.message:'unknown_error';
   await db.execute('INSERT INTO ai_agent_failures(account_id,session_id,request_id,agent,error,message,model,prompt,raw_output,router_context) VALUES (?,?,?,?,?,?,?,?,?,?)',[account,session,id,'context',(lastTraceError??errorCode).slice(0,100),message.text.slice(0,4000),lastModel??null,lastMessages?JSON.stringify(lastMessages):null,lastRawOutput?.slice(0,65000)??null,prepared.routerContext]).catch(()=>{});
  }
  const outputWords=generationFailed?0:countWords(answer),charged=generationFailed?0:creditCost(prepared.inputWords,outputWords,config.input_rate,config.output_rate);
  const fallbackId=fallback?'FB-'+randomUUID().replaceAll('-','').slice(0,20).toUpperCase():undefined;
  await transaction(async c=>{await lockAccount(c,account,true);await c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?',[prepared.reserved-charged,account]);await c.execute("UPDATE ai_usage SET status=?,output_words=?,charged=?,agent=?,model_calls=?,model=?,reserved=0 WHERE account_id=? AND request_id=?",[generationFailed?'fallback_generated':'generated',outputWords,charged,agent,JSON.stringify(modelCalls),modelCalls.find(call=>call.role===agent)?.model??config.model,account,id]);
   if(fallbackId&&fallback)await c.execute('INSERT IGNORE INTO ai_fallbacks(id,account_id,session_id,customer,fallback_number,agent,reason,question,router_context,messages,source_message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[fallbackId,account,session,message.from,prepared.fallbackNumber,agent??'lainnya',fallback.reason,fallback.question,prepared.routerContext,JSON.stringify(prepared.messages),message.messageId]);});
  let status='sent';const sentMarkers:string[]=[];
  try{
   // Sent ahead of the text answer so the customer sees the product before its explanation.
   // Best effort: a failed image never blocks or fails the text reply that follows.
   if(!generationFailed&&!fallback&&pendingImageId){
    await guard();
    const readImage=async(imageId:string)=>{const file=await this.productImages.get(account,imageId);return {path:file.path,mimetype:file.mimetype,cleanup:async()=>{}};};
    const image=await sendBilled(account,manager,session,'media',{to:message.from,type:'image'as const,url:pendingImageId},'ai_image_'+id,readImage,guard).catch(()=>undefined);
    if(image)await recordOutgoing(account,session,{customer:message.from,messageId:image.messageId,origin:'ai',type:'image',text:''}).catch(()=>{});
   }
   // Each document is its own billed message: an image shows as a photo, everything else as a file with its name.
   if(!generationFailed&&!fallback)for(const [index,document] of pendingDocuments.entries()){
    await guard();
    const readDocument=async()=>{const file=await eduData.store.file(account,document.id,prepared.profileId);return {path:file.path,mimetype:file.mimetype,cleanup:async()=>{}};};
    const file=await eduData.store.file(account,document.id,prepared.profileId).catch(()=>undefined);if(!file)continue;
    const sent=await sendBilled(account,manager,session,'media',{to:message.from,type:file.media_type,url:document.id,...(file.media_type==='document'?{filename:file.filename}:{})},'ai_doc_'+index+'_'+id,readDocument,guard).catch(()=>undefined);
    if(sent){sentMarkers.push(documentMarker(document.filename));await recordOutgoing(account,session,{customer:message.from,messageId:sent.messageId,origin:'ai',type:file.media_type,text:file.filename}).catch(()=>{});}
   }
   await guard();const confirmation=await sendBilled(account,manager,session,'text',{to:message.from,text:answer},'ai_'+id,undefined,guard);await recordOutgoing(account,session,{customer:message.from,messageId:confirmation.messageId,origin:'ai',text:answer}).catch(()=>{});if(fallbackId)await db.execute('UPDATE ai_fallbacks SET confirmation_message_id=? WHERE id=?',[confirmation.messageId,fallbackId]);
  }catch(error){status=error instanceof ApiError&&error.code==='ai_cancelled'?'cancelled':error instanceof ApiError&&error.code==='send_unknown'?'send_unknown':'send_failed';}
  finally{await stopTyping();}
  if(status==='sent'&&fallbackId&&fallback&&prepared.fallbackNotify&&prepared.fallbackNumber)try{const notification=await sendBilled(account,manager,session,'text',{to:prepared.fallbackNumber,text:'Konfirmasi diperlukan ['+fallbackId+']\\nPelanggan: '+message.from+'\\nPertanyaan: '+fallback.question+'\\nKonteks: '+(prepared.routerContext??'-')+'\\nBalas pesan ini atau awali balasan dengan '+fallbackId+'.'},'fallback_team_'+id);await recordOutgoing(account,session,{customer:prepared.fallbackNumber,messageId:notification.messageId,origin:'system',text:'Konfirmasi diperlukan ['+fallbackId+']'}).catch(()=>{});await db.execute('UPDATE ai_fallbacks SET notification_message_id=? WHERE id=?',[notification.messageId,fallbackId]);}catch{await db.execute("UPDATE ai_fallbacks SET status='failed' WHERE id=?",[fallbackId]);}
  await transaction(async c=>{await lockAccount(c,account,true);await c.execute('UPDATE ai_usage SET status=? WHERE account_id=? AND request_id=?',[generationFailed&&status!=='cancelled'?'fallback_'+status:status,account,id]);if(status==='sent'){
   const [limits]=await c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');const [rows]=await c.execute<RowDataPacket[]>('SELECT messages,revision FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',[account,session,message.from]);
   if(!rows[0]||rows[0].revision!==prepared.revision)return;
   const memory=[...parseMemory(rows[0].messages),...sentMarkers.map(content=>({role:'assistant' as const,content})),{role:'assistant' as const,content:answer}].slice(-(limits[0]?.memory_limit??defaults.memory_limit));
   await c.execute('UPDATE ai_conversations SET messages=?,router_context=? WHERE account_id=? AND session_id=? AND customer=?',[JSON.stringify(memory),routerContext,account,session,message.from]);}});
  }finally{await stopTyping();}
 }
}
export const ai=new AIService();
