import {randomUUID} from 'node:crypto';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {ApiError} from './engine/sessions.js';
import type {IncomingMessage} from './engine/incoming.js';

// Full WhatsApp history of private chats, shown in the dashboard's chat view. Separate from the AI memory
// (ai_conversations.messages), which is trimmed to the memory limit and wiped by "Hapus konteks".
export type ChatOrigin='customer'|'ai'|'manual'|'api'|'system';
export type ChatStatus='sent'|'delivered'|'read';
export const chatTable=`CREATE TABLE IF NOT EXISTS ai_chat_messages (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(20) NOT NULL,message_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,direction ENUM('in','out','note') NOT NULL,origin ENUM('customer','ai','manual','api','system') NOT NULL,type VARCHAR(20) NOT NULL DEFAULT 'text',text TEXT NOT NULL,status ENUM('sent','delivered','read') NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(account_id,session_id,message_id),KEY chat_by_customer(account_id,session_id,customer,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`;

type Executor=Pick<PoolConnection,'execute'>;
let notify:(account:string,session:string,customer:string)=>void=()=>{};
// The gateway forwards changes to the dashboard's realtime stream.
export function onChatChange(listener:typeof notify){notify=listener;}

const customerPattern=/^[0-9]{5,20}$/;
const mediaLabels:Record<string,string>={image:'Gambar',video:'Video',audio:'Audio',document:'Dokumen'};
export function customerOf(address:string){const digits=address.split('@')[0].split(':')[0];return !address.endsWith('@g.us')&&customerPattern.test(digits)?digits:null;}
function describe(type:string,text:string){const body=text.trim();return type==='text'?body:body||'['+(mediaLabels[type]??'Pesan '+type)+']';}

export async function recordIncoming(account:string,session:string,message:IncomingMessage){
 if(message.isGroup||!customerPattern.test(message.from))return;
 await db.execute("INSERT IGNORE INTO ai_chat_messages(account_id,session_id,customer,message_id,direction,origin,type,text) VALUES (?,?,?,?,'in','customer',?,?)",[account,session,message.from,message.messageId,message.type,describe(message.type,message.text).slice(0,8000)]);
 notify(account,session,message.from);
}
// Every send is first seen generically ("api"); a caller that knows better (AI, dashboard reply) upserts
// its own origin, and a later generic record never downgrades it. Whichever arrives first, the result is the same.
export async function recordOutgoing(account:string,session:string,input:{customer:string;messageId:string;origin:ChatOrigin;type?:string;text:string},executor:Executor=db){
 if(!customerPattern.test(input.customer))return;
 const type=input.type??'text';
 await executor.execute("INSERT INTO ai_chat_messages(account_id,session_id,customer,message_id,direction,origin,type,text,status) VALUES (?,?,?,?,'out',?,?,?,'sent') ON DUPLICATE KEY UPDATE origin=IF(VALUES(origin)='api',origin,VALUES(origin))",[account,session,input.customer,input.messageId,input.origin,type,describe(type,input.text).slice(0,8000)]);
 notify(account,session,input.customer);
}
// Notes written in the same millisecond (e.g. "resumed" and "full auto on" in one change) keep their order:
// history sorts by created_at then message_id, so note ids are time-ordered with a sequence and a random tail.
let noteSequence=0;
export async function recordNote(account:string,session:string,customer:string,text:string,executor:Executor=db){
 const id='note-'+String(Date.now()).padStart(15,'0')+'-'+String(noteSequence=(noteSequence+1)%1e6).padStart(6,'0')+'-'+randomUUID().slice(0,8);
 await executor.execute("INSERT INTO ai_chat_messages(account_id,session_id,customer,message_id,direction,origin,text) VALUES (?,?,?,?,'note','system',?)",[account,session,customer,id,text]);
 notify(account,session,customer);
}
// Receipts only move forward: sent → delivered → read.
export async function updateStatus(account:string,session:string,messageId:string,status:ChatStatus){
 const [rows]=await db.execute<RowDataPacket[]>("SELECT customer FROM ai_chat_messages WHERE account_id=? AND session_id=? AND message_id=? AND direction='out' AND (status IS NULL OR FIELD(status,'sent','delivered','read')<FIELD(?,'sent','delivered','read'))",[account,session,messageId,status]);
 if(!rows[0])return;
 await db.execute("UPDATE ai_chat_messages SET status=? WHERE account_id=? AND session_id=? AND message_id=? AND (status IS NULL OR FIELD(status,'sent','delivered','read')<FIELD(?,'sent','delivered','read'))",[status,account,session,messageId,status]);
 notify(account,session,rows[0].customer);
}

// Conversation list: every customer with history or an AI conversation, most recent activity first.
export async function listChats(account:string,session:string){
 const [latest]=await db.execute<RowDataPacket[]>("SELECT customer,text,direction,origin,type,created_at FROM (SELECT customer,text,direction,origin,type,created_at,ROW_NUMBER() OVER (PARTITION BY customer ORDER BY created_at DESC,message_id DESC) AS n FROM ai_chat_messages WHERE account_id=? AND session_id=? AND direction<>'note') t WHERE n=1",[account,session]);
 const [conversations]=await db.execute<RowDataPacket[]>('SELECT customer,paused,full_auto,JSON_LENGTH(messages) AS message_count,router_context FROM ai_conversations WHERE account_id=? AND session_id=?',[account,session]);
 const byCustomer=new Map<string,Record<string,unknown>>();
 for(const row of conversations)byCustomer.set(row.customer,{customer:row.customer,paused:Boolean(row.paused),full_auto:Boolean(row.full_auto),message_count:Number(row.message_count??0),router_context:row.router_context??null,last:null});
 for(const row of latest){const entry:Record<string,unknown>=byCustomer.get(row.customer)??{customer:row.customer,paused:false,full_auto:false,message_count:0,router_context:null};entry.last={text:row.text,direction:row.direction,origin:row.origin,type:row.type,at:row.created_at};byCustomer.set(row.customer,entry);}
 const time=(entry:Record<string,unknown>)=>{const last=entry.last as {at:Date}|null;return last?new Date(last.at).getTime():0;};
 return [...byCustomer.values()].sort((a,b)=>time(b)-time(a)||String(a.customer).localeCompare(String(b.customer))).slice(0,300);
}

// Newest page first from the database, returned oldest→newest. `before` is the cursor of the oldest message shown.
export async function chatMessages(account:string,session:string,customer:string,before?:unknown){
 if(!customerPattern.test(customer))throw new ApiError(400,'invalid_request','Nomor pelanggan tidak valid');
 let cursor:[Date,string]|undefined;
 if(before!==undefined){const match=typeof before==='string'?/^(\d{1,15})_(.{1,128})$/.exec(before):null;if(!match)throw new ApiError(400,'invalid_request','Cursor tidak valid');cursor=[new Date(Number(match[1])),match[2]];}
 const [rows]=await db.execute<RowDataPacket[]>('SELECT message_id,direction,origin,type,text,status,created_at FROM ai_chat_messages WHERE account_id=? AND session_id=? AND customer=?'+(cursor?' AND (created_at<? OR (created_at=? AND message_id<?))':'')+' ORDER BY created_at DESC,message_id DESC LIMIT 101',[account,session,customer,...(cursor?[cursor[0],cursor[0],cursor[1]]:[])]);
 const more=rows.length>100,page=rows.slice(0,100).reverse();
 const oldest=page[0];
 return {messages:page.map(row=>({id:row.message_id,direction:row.direction,origin:row.origin,type:row.type,text:row.text,status:row.status,at:row.created_at})),before:more&&oldest?new Date(oldest.created_at).getTime()+'_'+oldest.message_id:null};
}
