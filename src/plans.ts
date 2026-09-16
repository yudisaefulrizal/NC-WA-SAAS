import {db} from './db.js';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
export function basicPeriod(now=new Date()):string {
 const wib=new Date(now.getTime()+7*3600000);
 return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth()+1).padStart(2,'0')}`;
}
// Caller owns transaction; lock account first to serialize initialization/reset.
export async function ensureBasic(connection:PoolConnection,accountId:string,now=new Date()) {
 const [accounts]=await connection.execute<RowDataPacket[]>('SELECT id FROM accounts WHERE id=? FOR UPDATE',[accountId]);
 if(!accounts[0])throw new Error('account_not_found');
 const [wallets]=await connection.execute<RowDataPacket[]>('SELECT * FROM wallets WHERE account_id=? FOR UPDATE',[accountId]);
 const period=basicPeriod(now); const old=wallets[0];
 if(!old||(old.plan_id==='basic'&&old.period<period)||(old.plan_id!=='basic'&&new Date(old.expires_at)<=now)){
  const [plans]=await connection.query<RowDataPacket[]>("SELECT credits,session_limit FROM plans WHERE id='basic'");
  const plan=plans[0];if(!plan)throw new Error('basic_plan_missing');
  await connection.execute("INSERT IGNORE INTO credit_events (account_id,period,reason,amount) VALUES (?,?,'basic_grant',?)",[accountId,period,plan.credits]);
  const [grants]=await connection.execute<RowDataPacket[]>("SELECT COALESCE(SUM(amount),0) AS credits FROM credit_events WHERE account_id=? AND period=? AND reason IN ('basic_grant','basic_transfer')",[accountId,period]);
  const [spent]=await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS used FROM credit_reservations WHERE account_id=? AND period=? AND status<>'failed'",[accountId,period]);
  const balance=Math.max(0,Number(grants[0].credits)-spent[0].used);
  await connection.execute("INSERT INTO wallets (account_id,period,balance,quota,session_limit,plan_id,expires_at) VALUES (?,?,?,?,?,'basic',NULL) ON DUPLICATE KEY UPDATE period=VALUES(period),balance=VALUES(balance),quota=VALUES(quota),session_limit=VALUES(session_limit),plan_id='basic',expires_at=NULL",[accountId,period,balance,plan.credits,plan.session_limit]);
 }
 const [result]=await connection.execute<RowDataPacket[]>('SELECT period,balance,quota,session_limit,plan_id,expires_at FROM wallets WHERE account_id=?',[accountId]);
 return result[0];
}
export async function basicWallet(accountId:string,now=new Date()){
 const connection=await db.getConnection();
 try{await connection.beginTransaction();const wallet=await ensureBasic(connection,accountId,now);await connection.commit();return wallet;}catch(e){await connection.rollback();throw e;}finally{connection.release();}
}
export function planInput(body:unknown){
 if(!body||typeof body!=='object')return null;
 const {name,price,credits,session_limit,active}=body as Record<string,unknown>;
 if(typeof name!=='string'||!name.trim()||name.length>100||typeof active!=='boolean')return null;
 if(![price,credits,session_limit].every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=100000000))return null;
 if((session_limit as number)<1||(session_limit as number)>1000)return null;
 return {name:name.trim(),price:price as number,credits:credits as number,session_limit:session_limit as number,active};
}

// Calendar month in WIB, clamped to the final day of the destination month.
export function nextMonth(now:Date){
 const local=new Date(now.getTime()+7*3600000),day=local.getUTCDate();
 local.setUTCDate(1);local.setUTCMonth(local.getUTCMonth()+1);
 const last=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+1,0)).getUTCDate();
 local.setUTCDate(Math.min(day,last));return new Date(local.getTime()-7*3600000);
}
export async function activatePackage(connection:PoolConnection,accountId:string,id:string,plan:{id:string;credits:number;session_limit:number},now=new Date()){
 const wallet=await ensureBasic(connection,accountId,now);
 const [old]=await connection.execute<RowDataPacket[]>('SELECT id FROM package_activations WHERE id=?',[id]);
 if(old.length)return;
 const expires=nextMonth(now),epoch='paid:'+id;
 if(wallet.plan_id==='basic'){
  const [reserved]=await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM credit_reservations WHERE account_id=? AND period=? AND status IN ('reserved','unknown')",[accountId,wallet.period]);
  await connection.execute("INSERT INTO credit_events(account_id,period,reason,amount) VALUES (?,?,'basic_transfer',?) ON DUPLICATE KEY UPDATE amount=amount+VALUES(amount)",[accountId,wallet.period,-(wallet.balance+reserved[0].total)]);
 }
 // Pending reservations travel with unexpired credit across a purchase, but never across expiry/reset.
 await connection.execute("UPDATE credit_reservations SET period=? WHERE account_id=? AND period=? AND status IN ('reserved','unknown')",[epoch,accountId,wallet.period]);
 await connection.execute('INSERT INTO package_activations VALUES (?,?,?,?,?,?,?)',[id,accountId,plan.id,plan.credits,plan.session_limit,now,expires]);
 await connection.execute('UPDATE wallets SET period=?,balance=balance+?,quota=?,session_limit=?,plan_id=?,expires_at=? WHERE account_id=?',[epoch,plan.credits,plan.credits,plan.session_limit,plan.id,expires,accountId]);
}
