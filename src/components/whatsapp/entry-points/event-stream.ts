import type {Request,Response} from 'express';
import {ApiError} from '../../../libraries/errors.js';

type Payload={event:string;sessionId:string;[key:string]:unknown};
export class EventStream {
 private clients=new Map<Response,{tag:string;valid:()=>Promise<boolean>}>();
 private heartbeat?:ReturnType<typeof setInterval>;
 handler=(req:Request,res:Response,tag='',valid=async()=>true)=>{
  if(this.clients.size>=5)throw new ApiError(429,'stream_limit','Maksimal 5 koneksi realtime per akun');
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});
  res.write(': terhubung\n\n');this.clients.set(res,{tag,valid});
  this.heartbeat??=setInterval(()=>{void this.broadcast(': ping\n\n');},25000).unref();
  res.on('close',()=>{this.clients.delete(res);if(!this.clients.size){clearInterval(this.heartbeat);this.heartbeat=undefined;}});
 };
 private async broadcast(frame:string){
  await Promise.all([...this.clients].map(async([client,auth])=>{
   try{if(!await auth.valid()){client.end();return;}if(!client.writableEnded&&!client.write(frame))client.end();}
   catch{client.end();}
  }));
 }
 push(payload:Payload){void this.broadcast(`data: ${JSON.stringify(payload)}\n\n`);}
 revoke(tag:string){for(const [client,auth] of this.clients)if(auth.tag===tag)client.end();}
 stop(){clearInterval(this.heartbeat);this.heartbeat=undefined;for(const client of this.clients.keys())client.end();this.clients.clear();}
}
