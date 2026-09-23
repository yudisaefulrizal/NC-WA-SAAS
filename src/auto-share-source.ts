// Template sources: a template may pull live values from the account owner's HTTPS endpoint and
// substitute them into its text or caption. Everything here is pure except fetchSource, so the
// substitution rules can be tested without a database or a network.
import {request} from 'node:https';
import {ApiError} from './engine/sessions.js';
import {validatePublicUrl} from './engine/download.js';

const invalid=(message:string)=>new ApiError(400,'invalid_request',message);
export const sourceModes=['none','endpoint'] as const;
export const mediaSources=['asset','endpoint'] as const;
export const maxSourceMediaBytes=8*1024*1024;
const maxKeys=50,maxValueLength=200,maxResponseBytes=32*1024,timeoutMs=10000;

// {{{{ escapes a literal {{, so a template can still show braces. Matched before placeholders.
const token=/\{\{\{\{|\}\}\}\}|\{\{\s*([a-z0-9_]{1,40})\s*\}\}/g;

export function parsePlaceholders(text:string){
 const names=new Set<string>();
 for(const match of text.matchAll(token))if(match[1])names.add(match[1]);
 return [...names];
}

// Rejects on the first missing value: a half-substituted broadcast is worse than a skipped one.
export function renderTemplate(text:string,data:Record<string,string>){
 return text.replace(token,(match,name?:string)=>{
  if(!name)return match==='{{{{'?'{{':'}}';
  if(!Object.prototype.hasOwnProperty.call(data,name))throw invalid('Data "'+name+'" tidak tersedia dari sumber');
  return data[name];
 });
}

function sourceValue(name:string,value:unknown){
 if(typeof value==='string'){if(value.length>maxValueLength)throw invalid('Nilai "'+name+'" melebihi '+maxValueLength+' karakter');return value;}
 if(typeof value==='number'){if(!Number.isFinite(value))throw invalid('Nilai "'+name+'" bukan angka yang sah');return new Intl.NumberFormat('id-ID').format(value);}
 if(typeof value==='boolean')return value?'Ya':'Tidak';
 throw invalid('Nilai "'+name+'" harus teks, angka, atau true/false');
}

export function validateSourceData(body:unknown):Record<string,string>{
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid('Respons sumber data harus objek JSON');
 const raw=(body as Record<string,unknown>).data;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid('Respons sumber data wajib memuat objek "data"');
 const entries=Object.entries(raw as Record<string,unknown>);
 if(entries.length>maxKeys)throw invalid('Sumber data maksimal '+maxKeys+' variabel');
 const data:Record<string,string>={};
 for(const [name,value] of entries){
  if(!/^[a-z0-9_]{1,40}$/.test(name))throw invalid('Nama variabel "'+name+'" hanya boleh huruf kecil, angka, dan garis bawah (maksimal 40 karakter)');
  data[name]=sourceValue(name,value);
 }
 return data;
}

export interface SourceMedia {url:string;filename:string|null}
export async function validateSourceMedia(body:unknown):Promise<SourceMedia>{
 const raw=(body as Record<string,unknown>).media;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid('Respons sumber data wajib memuat objek "media" untuk template ini');
 const media=raw as Record<string,unknown>;
 if(typeof media.url!=='string'||media.url.length>4096)throw invalid('Alamat media dari sumber data tidak valid');
 const {url}=await validatePublicUrl(media.url);
 if(url.protocol!=='https:')throw invalid('Alamat media wajib HTTPS');
 if(media.filename!==undefined&&media.filename!==null&&(typeof media.filename!=='string'||media.filename.length>255))throw invalid('Nama berkas media dari sumber data tidak valid');
 return {url:url.href,filename:typeof media.filename==='string'&&media.filename.trim()?media.filename.trim().slice(0,255):null};
}

export function endpointUrl(value:string){
 if(value.length>512)throw invalid('Endpoint terlalu panjang');
 let url:URL;
 try{url=new URL(value);}catch{throw invalid('Endpoint tidak valid');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash)throw invalid('Endpoint wajib HTTPS tanpa kredensial atau fragmen');
 return url.href;
}

// Reads the template input's source fields. Token handling mirrors ai-data saveSource: an empty
// token keeps the stored one, and changing the endpoint drops it so it never reaches a new host.
export function sourceInput(body:Record<string,unknown>){
 const mode=body.source_mode??'none';
 if(typeof mode!=='string'||!sourceModes.includes(mode as typeof sourceModes[number]))throw invalid('Sumber data tidak valid');
 const media=body.media_source??'asset';
 if(typeof media!=='string'||!mediaSources.includes(media as typeof mediaSources[number]))throw invalid('Sumber media tidak valid');
 if(mode==='none'){
  if(media==='endpoint')throw invalid('Sumber media endpoint memerlukan sumber data endpoint');
  return {mode:'none' as const,endpoint:'',token:undefined as string|undefined,clearToken:false,media:'asset' as const};
 }
 const endpoint=endpointUrl(typeof body.source_endpoint==='string'?body.source_endpoint.trim():'');
 let token:string|undefined;
 if(body.source_token!==undefined&&body.source_token!==null){
  if(typeof body.source_token!=='string'||body.source_token.length>512)throw invalid('Token sumber data tidak valid');
  if(/[\r\n]/.test(body.source_token))throw invalid('Token sumber data tidak valid');
  token=body.source_token;
 }
 if(body.source_clear_token!==undefined&&typeof body.source_clear_token!=='boolean')throw invalid('Pilihan hapus token tidak valid');
 return {mode:'endpoint' as const,endpoint,token,clearToken:body.source_clear_token===true,media:media as 'asset'|'endpoint'};
}

// HTTPS only; DNS pinned, no redirects, response capped. Every failure surfaces as ApiError so the
// scheduler's invalid_request branch records it instead of aborting the tick for every account.
export type SourceTransport=(endpoint:string,secret:string)=>Promise<unknown>;
export const fetchSource:SourceTransport=async(endpoint,secret)=>{
 const {url,addresses}=await validatePublicUrl(endpointUrl(endpoint));
 return new Promise((resolve,reject)=>{
  const req=request(url,{
   method:'GET',agent:false,signal:AbortSignal.timeout(timeoutMs),
   headers:{Accept:'application/json','User-Agent':'NC-WA/0.1','Accept-Encoding':'identity',...(secret?{Authorization:'Bearer '+secret}:{})},
   lookup:(_host,options,callback)=>{if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);},
  },response=>{
   const chunks:Buffer[]=[];let size=0;
   response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxResponseBytes){response.destroy(Error('limit'));return;}chunks.push(chunk);});
   response.on('error',error=>reject(error.message==='limit'?invalid('Respons sumber data melebihi 32 KB'):invalid('Sumber data tidak dapat dihubungi')));
   response.on('end',()=>{
    if(response.statusCode!==200){reject(invalid('Sumber data menjawab HTTP '+response.statusCode));return;}
    try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(invalid('Respons sumber data bukan JSON yang sah'));}
   });
  });
  req.on('error',()=>reject(invalid('Sumber data tidak dapat dihubungi')));
  req.end();
 });
};
