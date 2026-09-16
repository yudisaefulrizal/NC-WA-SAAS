import {db} from './db.js';
import {basicPeriod,basicWallet} from './plans.js';
import type {RowDataPacket} from 'mysql2/promise';

export async function refreshBasicAccounts(now=new Date()) {
 let cursor='';let count=0;
 for(;;){
  const [rows]=await db.execute<RowDataPacket[]>(`SELECT a.id FROM accounts a LEFT JOIN wallets w ON w.account_id=a.id WHERE a.id>? AND (w.account_id IS NULL OR (w.plan_id='basic' AND w.period<?) OR w.expires_at<=?) ORDER BY a.id LIMIT 100`,[cursor,basicPeriod(now),now]);
  if(!rows.length)return count;
  for(const row of rows){await basicWallet(row.id,now);cursor=row.id;count++;}
 }
}
export function startBasicScheduler(){
 let pending:Promise<void>|undefined;let stopped=false;
 const tick=()=>{if(stopped||pending)return;pending=refreshBasicAccounts().then(()=>{}).catch(()=>{console.error('Reset kredit dasar gagal; akan dicoba kembali.');}).finally(()=>{pending=undefined;});};
 const timer=setInterval(tick,30000);timer.unref();tick();
 return async()=>{stopped=true;clearInterval(timer);await pending;};
}
