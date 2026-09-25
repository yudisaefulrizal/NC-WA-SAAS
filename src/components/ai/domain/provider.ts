import {routerResponseFormat} from './pipeline/router-schema.js';
import {schemaEnabled,type ModelRole,type ModelTier,type AgentWorkflow,type AITraceEvent} from './pipeline/models.js';
import {request} from 'node:https';
import {decrypt} from '../../../libraries/crypto.js';
import {validatePublicUrl} from '../../../libraries/download.js';
import {resolve} from 'node:path';
import {fail} from './input.js';

export type AIMessage={role:'system'|'user'|'assistant';content:string};
export type AIProvider='sumopod'|'compatible'|'openrouter';
export interface AIConfig {signal?:AbortSignal;workflow?:AgentWorkflow;onTrace?:(event:AITraceEvent)=>void;model_cheap?:string;model_medium?:string;model_smart?:string;model_structured?:string;tier_profiles?:Partial<Record<ModelTier,{id:string;provider:AIProvider;endpoint:string;secret:string;model:string}>>;call_role?:ModelRole;router_agents?:readonly string[];response_format?:Record<string,unknown>;provider:AIProvider;endpoint:string;model:string;secret:string;input_rate:number;output_rate:number;memory_limit:number;context_memory_limit:number;trace_enabled:boolean;credit_price:number;tidy_prompt?:string}
export const defaults:AIConfig={provider:'compatible',endpoint:'https://ai.sumopod.com/v1/chat/completions',model:'deepseek-v4-flash',secret:'',input_rate:1,output_rate:2,memory_limit:60,context_memory_limit:6,trace_enabled:false,credit_price:0,tidy_prompt:''};
export function provider(value:unknown):AIProvider{if(value==='sumopod'||value==='compatible'||value==='openrouter')return value;throw fail('Provider AI tidak valid');}
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
