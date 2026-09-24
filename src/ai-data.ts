import {randomUUID} from 'node:crypto';
import {request} from 'node:https';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {digest} from './security.js';
import {encrypt,decrypt} from './payments.js';
import {ApiError} from './engine/sessions.js';
import {validatePublicUrl} from './engine/download.js';
import type {AITools,ToolContext,ToolName} from './ai-agents.js';

const invalid=(message:string)=>new ApiError(400,'invalid_request',message);
const missing=()=>new ApiError(404,'not_found','Data tidak ditemukan');
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('Objek data wajib valid');return value as Record<string,unknown>;}
function text(value:unknown,max:number,name:string,empty=false){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw invalid(name+' tidak valid');return value.trim();}
function integer(value:unknown,max:number,name:string,min=0){if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw invalid(name+' tidak valid');return Number(value);}
function identifier(value:unknown){const id=text(value,64,'ID');if(!/^[A-Za-z0-9_-]+$/.test(id))throw invalid('ID hanya boleh huruf, angka, tanda - dan _');return id;}
export function customerNumber(value:unknown){const number=text(value,20,'Nomor pelanggan');if(!/^[1-9][0-9]{5,14}$/.test(number))throw invalid('Gunakan nomor WhatsApp internasional tanpa +');return number;}
async function transaction<T>(account:string,fn:(c:PoolConnection)=>Promise<T>){const c=await db.getConnection();try{await c.beginTransaction();const [rows]=await c.execute<RowDataPacket[]>('SELECT suspended FROM accounts WHERE id=? FOR UPDATE',[account]);if(!rows[0]||rows[0].suspended)throw new ApiError(403,'account_unavailable','Akun tidak tersedia');const result=await fn(c);await c.commit();return result;}catch(error){await c.rollback();throw error;}finally{c.release();}}
export interface Product {name:string;type:'product'|'service';description:string;price:number;stock:number;active:boolean;image_id:string|null}
function imageId(value:unknown){if(value===null||value===undefined||value==='')return null;const id=text(value,36,'Foto');if(!/^[0-9a-f-]{36}$/.test(id))throw invalid('Referensi foto tidak valid');return id;}
export function productInput(value:unknown):Product{const p=record(value);if(p.type!=='product'&&p.type!=='service')throw invalid('Jenis produk/layanan tidak valid');if(typeof p.active!=='boolean')throw invalid('Status produk tidak valid');return {name:text(p.name,150,'Nama'),type:p.type,description:text(p.description??'',500,'Deskripsi',true),price:integer(p.price,1000000000,'Harga'),stock:integer(p.stock,1000000,'Stok/kapasitas'),active:p.active,image_id:imageId(p.image_id)};}
// What the AI sees: whether a photo exists, not the internal image id (send_product_image works by name).
export function productForAI({image_id,...product}:Product){return {...product,ada_foto:Boolean(image_id)};}
function productRow(p:RowDataPacket):Product{return productInput({...p,price:Number(p.price),active:Boolean(p.active)});}
export interface OrderInput {items:{product_name:string;quantity:number}[];notes:string}
export function orderInput(value:unknown):OrderInput{const o=record(value);if(Object.keys(o).some(k=>!['items','notes'].includes(k)))throw invalid('Pesanan hanya menerima items dan notes');if(!Array.isArray(o.items)||!o.items.length||o.items.length>20)throw invalid('Isi 1–20 item pesanan');const items=o.items.map(value=>{const item=record(value);if(Object.keys(item).some(k=>!['product_name','quantity'].includes(k)))throw invalid('Item hanya menerima product_name dan quantity');return {product_name:text(item.product_name,150,'Nama produk'),quantity:integer(item.quantity,1000,'Jumlah',1)};});if(new Set(items.map(i=>i.product_name)).size!==items.length)throw invalid('Gabungkan produk yang sama dalam satu item');return {items,notes:text(o.notes??'',1000,'Catatan',true)};}
export const orderStatuses=['baru','diproses','selesai','dibatalkan'] as const;
export interface Order {id:string;customer:string;items:(OrderInput['items'][number]&{price:number})[];total:number;status:string;notes:string}
function orderRow(row:RowDataPacket):Order{return {id:row.id,customer:row.customer,items:typeof row.items==='string'?JSON.parse(row.items):row.items,total:Number(row.total),status:row.status,notes:row.notes};}
export interface DataSource {mode:'builtin'|'endpoint';endpoint:string;secret:string}
export type SourceKind='products'|'orders';
export const builtinSource:DataSource={mode:'builtin',endpoint:'',secret:''};
export async function source(account:string,session:string,kind:SourceKind,c=db):Promise<DataSource>{const [rows]=await c.execute<RowDataPacket[]>('SELECT mode,endpoint,secret FROM ai_data_sources WHERE account_id=? AND session_id=? AND kind=?',[account,session,kind]);return rows[0]?{mode:rows[0].mode,endpoint:rows[0].endpoint,secret:rows[0].secret}:{...builtinSource};}
export async function publicSources(account:string,session:string){const products=await source(account,session,'products'),orders=await source(account,session,'orders');const safe=({secret,...s}:DataSource)=>({...s,has_token:Boolean(secret)});return {products_source:safe(products),orders_source:safe(orders)};}
export async function endpointUrl(value:string){if(value.length>512)throw invalid('Endpoint terlalu panjang');let u:URL;try{u=new URL(value);}catch{throw invalid('Endpoint tidak valid');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw invalid('Endpoint wajib HTTPS tanpa kredensial, query atau fragmen');await validatePublicUrl(u.href);return u.href;}
export async function sourceInput(value:unknown){const s=record(value);if(s.mode!=='builtin'&&s.mode!=='endpoint')throw invalid('Sumber data tidak valid');const endpoint=s.mode==='endpoint'?await endpointUrl(text(s.endpoint,512,'Endpoint')):'';let token:string|undefined;if(s.token!==undefined){token=text(s.token,512,'Token',true);if(/[\r\n]/.test(token))throw invalid('Token tidak valid');}if(s.clear_token!==undefined&&typeof s.clear_token!=='boolean')throw invalid('Pilihan hapus token tidak valid');return {mode:s.mode as DataSource['mode'],endpoint,token,clear_token:s.clear_token===true};}
export async function saveSource(c:PoolConnection,account:string,session:string,kind:SourceKind,input:Awaited<ReturnType<typeof sourceInput>>){const [rows]=await c.execute<RowDataPacket[]>('SELECT endpoint,secret FROM ai_data_sources WHERE account_id=? AND session_id=? AND kind=?',[account,session,kind]);const secret=input.clear_token||input.mode==='builtin'?'':input.token?encrypt(input.token):rows[0]?.endpoint===input.endpoint?rows[0].secret:'';await c.execute('INSERT INTO ai_data_sources(account_id,session_id,kind,mode,endpoint,secret) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE mode=VALUES(mode),endpoint=VALUES(endpoint),secret=VALUES(secret)',[account,session,kind,input.mode,input.endpoint,secret]);}

// HTTPS only; DNS pinned on every request, no redirects, no credential/body in errors.
export type EndpointTransport=(source:DataSource,payload:Record<string,unknown>,idempotencyKey:string)=>Promise<unknown>;
export const callEndpoint:EndpointTransport=async(config,payload,idempotencyKey)=>{
 const {url,addresses}=await validatePublicUrl(await endpointUrl(config.endpoint));const body=JSON.stringify(payload);
 return new Promise((resolve,reject)=>{const req=request(url,{method:'POST',agent:false,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Idempotency-Key':idempotencyKey,...(config.secret?{Authorization:'Bearer '+decrypt(config.secret)}:{})},lookup:(_host,options,callback)=>{if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);}},res=>{
  const chunks:Buffer[]=[];let size=0;
  res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>32000){res.destroy(Error('endpoint_response_limit'));return;}chunks.push(chunk);});
  res.on('error',error=>reject(Error(error.message==='endpoint_response_limit'?'endpoint_response_limit':'endpoint_failed')));
  res.on('end',()=>{if(res.statusCode!==200){reject(Error('endpoint_http_'+res.statusCode));return;}try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(Error('endpoint_invalid_json'));}});
 });req.on('error',()=>reject(Error('endpoint_failed')));req.end(body);});
};

export class AIData implements AITools {
 constructor(private remote:EndpointTransport=callEndpoint){}
 async products(account:string,session:string,query='',activeOnly=false){const [rows]=await db.execute<RowDataPacket[]>('SELECT name,type,description,price,stock,active,image_id FROM ai_products WHERE account_id=? AND session_id=?'+(activeOnly?' AND active=TRUE':'')+' AND name LIKE ? ORDER BY name LIMIT '+(activeOnly?'20':'200'),[account,session,'%'+query+'%']);return rows.map(productRow);}
 async saveProduct(account:string,session:string,previousName:string,value:unknown){const p=productInput(value);return transaction(account,async c=>{
  if(previousName&&previousName!==p.name)await c.execute('DELETE FROM ai_products WHERE account_id=? AND session_id=? AND name=?',[account,session,previousName]);
  const [previous]=await c.execute<RowDataPacket[]>('SELECT image_id FROM ai_products WHERE account_id=? AND session_id=? AND name=?',[account,session,previousName||p.name]);
  await c.execute('INSERT INTO ai_products(account_id,session_id,name,type,description,price,stock,active,image_id) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE type=VALUES(type),description=VALUES(description),price=VALUES(price),stock=VALUES(stock),active=VALUES(active),image_id=VALUES(image_id)',[account,session,p.name,p.type,p.description,p.price,p.stock,p.active,p.image_id]);
  return {product:p,replacedImageId:previous[0]?.image_id&&previous[0].image_id!==p.image_id?String(previous[0].image_id):null};
 });}
 async orders(account:string,session:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT * FROM ai_orders WHERE account_id=? AND session_id=? ORDER BY created_at DESC,id DESC LIMIT 200',[account,session]);return rows.map(row=>({...orderRow(row),created_at:row.created_at}));}
 async order(account:string,session:string,id:string,customer?:string){const [rows]=await db.execute<RowDataPacket[]>('SELECT * FROM ai_orders WHERE account_id=? AND session_id=? AND id=?'+(customer?' AND customer=?':''),[account,session,id,...(customer?[customer]:[])]);return rows[0]?orderRow(rows[0]):null;}
 async updateOrder(account:string,session:string,id:string,value:unknown){const o=record(value);if(!orderStatuses.includes(o.status as any))throw invalid('Status pesanan tidak valid');const notes=text(o.notes??'',1000,'Catatan',true);return transaction(account,async c=>{const [rows]=await c.execute<RowDataPacket[]>('SELECT id FROM ai_orders WHERE account_id=? AND session_id=? AND id=? FOR UPDATE',[account,session,id]);if(!rows[0])throw missing();await c.execute('UPDATE ai_orders SET status=?,notes=? WHERE account_id=? AND session_id=? AND id=?',[String(o.status),notes,account,session,id]);return {ok:true};});}
 private async remoteCall(config:DataSource,name:ToolName,query:unknown,scope:ToolContext){return record(await this.remote(config,{action:name,query,context:{account_id:scope.account,session_id:scope.session,customer:scope.customer,request_id:scope.requestId}},digest(JSON.stringify([scope.account,scope.session,scope.customer,scope.requestId,name,name==='create_order'?'':query]))));}
 async catalog(scope:ToolContext,query:string):Promise<Product[]>{const config=await source(scope.account,scope.session,'products');if(config.mode==='builtin')return this.products(scope.account,scope.session,query,true);const result=await this.remoteCall(config,'get_products',query,scope);if(!Array.isArray(result.products)||result.products.length>20)throw Error('endpoint_invalid_products');const products=result.products.map(productInput).filter(p=>p.active);if(new Set(products.map(p=>p.name)).size!==products.length)throw Error('endpoint_duplicate_products');return products;}
 private validateRemoteOrder(value:unknown,scope:ToolContext,expectedId?:string):Order|null{if(value===null)return null;const o=record(value);if(o.customer!==scope.customer||(expectedId&&o.id!==expectedId)||!orderStatuses.includes(o.status as any))throw Error('endpoint_order_scope');const id=identifier(o.id),customer=customerNumber(o.customer),notes=text(o.notes??'',1000,'Catatan',true);if(!Array.isArray(o.items)||!o.items.length||o.items.length>20)throw Error('endpoint_invalid_order');const items=o.items.map(value=>{const i=record(value);return {product_name:text(i.product_name,150,'Nama produk'),quantity:integer(i.quantity,1000,'Jumlah',1),price:integer(i.price,1000000000,'Harga')};});const total=integer(o.total,20000000000000,'Total');if(total!==items.reduce((sum,i)=>sum+i.quantity*i.price,0))throw Error('endpoint_invalid_total');return {id,customer,items,total,status:String(o.status),notes};}
 async createOrder(scope:ToolContext,input:OrderInput):Promise<Order>{
  const hash=digest(JSON.stringify([scope.customer,input]));
  // Check persisted idempotency before reading prices, so retries preserve the original snapshot.
  const [old]=await db.execute<RowDataPacket[]>('SELECT * FROM ai_orders WHERE account_id=? AND session_id=? AND request_id=?',[scope.account,scope.session,scope.requestId]);
  if(old[0]){if(old[0].customer!==scope.customer||old[0].input_hash!==hash)throw new ApiError(409,'idempotency_conflict','ID sudah dipakai');return orderRow(old[0]);}
  const items:Order['items']=[];
  for(const item of input.items){const product=(await this.catalog(scope,item.product_name)).find(p=>p.name===item.product_name);if(!product||product.stock<item.quantity)throw invalid('Produk tidak tersedia atau stok/kapasitas tidak cukup');items.push({...item,price:product.price});}
  const total=items.reduce((sum,item)=>sum+item.price*item.quantity,0);
  return transaction(scope.account,async c=>{const [existing]=await c.execute<RowDataPacket[]>('SELECT * FROM ai_orders WHERE account_id=? AND session_id=? AND request_id=?',[scope.account,scope.session,scope.requestId]);if(existing[0]){if(existing[0].customer!==scope.customer||existing[0].input_hash!==hash)throw new ApiError(409,'idempotency_conflict','ID sudah dipakai');return orderRow(existing[0]);}
   const order:Order={id:'ORD-'+randomUUID(),customer:scope.customer,items,total,status:'baru',notes:input.notes};
   await c.execute('INSERT INTO ai_orders(account_id,session_id,id,request_id,input_hash,customer,items,total,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)',[scope.account,scope.session,order.id,scope.requestId,hash,scope.customer,JSON.stringify(items),total,order.status,order.notes]);return order;
  });
 }
 async execute(name:ToolName,query:string,scope:ToolContext):Promise<unknown>{
  if(name==='get_knowledge')return {knowledge:scope.knowledge};
  if(name==='get_products')return {products:(await this.catalog(scope,query)).map(productForAI)};
  if(name==='send_product_image'){
   // Resolving which image to send is data (used by every caller, including AI Studio's simulation);
   // actually dispatching it over WhatsApp is a side effect only ai.ts's process() performs, after this returns.
   const product=(await this.catalog(scope,query)).find(p=>p.name===query.trim());
   if(!product||!product.image_id)return {available:false,reason:'Produk tidak ditemukan atau belum memiliki foto'};
   return {available:true,product_name:product.name,image_id:product.image_id};
  }
  const config=await source(scope.account,scope.session,'orders');
  if(name==='check_order'){const id=identifier(query);return {order:config.mode==='builtin'?await this.order(scope.account,scope.session,id,scope.customer):this.validateRemoteOrder((await this.remoteCall(config,name,id,scope)).order,scope,id)};}
  let input:OrderInput;try{input=orderInput(JSON.parse(query));}catch{throw invalid('create_order memerlukan JSON items [{product_name,quantity}] dan notes');}
  if(config.mode==='builtin')return {order:await this.createOrder(scope,input)};
  const priced=[];for(const item of input.items){const product=(await this.catalog(scope,item.product_name)).find(p=>p.name===item.product_name);if(!product||product.stock<item.quantity)throw invalid('Produk tidak tersedia atau stok/kapasitas tidak cukup');priced.push({...item,price:product.price});}
  const result=await this.remoteCall(config,name,{...input,items:priced},scope);const order=this.validateRemoteOrder(result.order,scope);if(!order)throw Error('endpoint_missing_order');if(order.items.length!==input.items.length||input.items.some(i=>!order.items.some(o=>o.product_name===i.product_name&&o.quantity===i.quantity)))throw Error('endpoint_order_items');return {order};
 }
}
export const aiData=new AIData();
