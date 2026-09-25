import {roleConfig,schemaEnabled} from '../../pipeline/models.js';
import {validatedAI} from '../../pipeline/retry.js';
import type {AIConfig,AIMessage,AITransport} from '../../provider.js';
import {ApiError} from '../../../../../libraries/errors.js';
import {orderPrompt,orderCandidateLimit,orderResponseFormat,orderSchemaInstruction,parseOrderText,extractOrderJson,validateOrderOutput} from './order-schema.js';
import {ToolContext,AITools} from '../../pipeline/runner.js';
// The specialist writes the order as one "2 x Produk; catatan: ..." line. A code parser handles that
// format; only an uncertain line reaches the Pesanan node, and both paths share the catalog validation.
// Problems come back as 400s so the specialist can clarify with the customer.
export async function structuredOrder(transport:AITransport,config:AIConfig,request:string,results:ReadonlyMap<string,string>,tools:AITools,context:Readonly<ToolContext>):Promise<string>{
 const names=new Set<string>();
 const collect=(value:unknown)=>{const products=(value as {products?:unknown}|null)?.products;if(Array.isArray(products))for(const product of products)if(typeof product?.name==='string'&&names.size<orderCandidateLimit)names.add(product.name);};
 for(const [key,value] of results)if(JSON.parse(key)[0]==='get_products'){try{collect(JSON.parse(value));}catch{}}
 collect(await tools.execute('get_products','',context));
 if(!names.size)throw new ApiError(400,'order_unavailable','Belum ada produk aktif yang dapat dipesan.');
 const list=[...names],parsed=parseOrderText(request,list);
 if(parsed){config.onTrace?.({node:'pesanan',state:'done',input:{metode:'parser',permintaan:request},output:parsed});return JSON.stringify(parsed);}
 const node=roleConfig(config,'pesanan'),schema=schemaEnabled(config,'pesanan');
 const messages:AIMessage[]=[{role:'system',content:(config.workflow?.nodes.pesanan.prompt??orderPrompt)+'\n'+orderSchemaInstruction(list)},{role:'user',content:JSON.stringify({permintaan:request,produk:list})}];
 const run=(format:boolean)=>validatedAI(transport,format?{...node,response_format:orderResponseFormat(list)}:node,messages,300,raw=>validateOrderOutput(extractOrderJson(raw),list),'Kembalikan hanya satu objek JSON dengan lengkap, items berisi product_name persis dari daftar produk dan quantity bilangan bulat, serta notes.');
 let order;
 try{
  // A model without JSON Schema support rejects response_format outright; prompt mode still works there.
  try{order=await run(schema);}catch(error){if(!schema||!(error instanceof Error)||error.message!=='ai_provider_http_400')throw error;config.onTrace?.({node:'pesanan',state:'retry',error:'structured_output_unsupported'});order=await run(false);}
 }catch(error){if(error instanceof Error&&error.message==='ai_invalid_order')throw new ApiError(400,'order_invalid','Rincian pesanan tidak dapat diproses. Pastikan nama produk dan jumlah kepada pelanggan.');throw error;}
 config.onTrace?.({node:'pesanan',state:'done',input:{metode:'ai',permintaan:request},output:order});
 if(!order)throw new ApiError(400,'order_unclear','Produk atau jumlah pesanan belum jelas. Tanyakan kepada pelanggan sebelum membuat pesanan.');
 return JSON.stringify(order);
}
