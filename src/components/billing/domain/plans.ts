import {db} from '../../../libraries/db.js';
import type {PoolConnection} from 'mysql2/promise';
import {countOpenReservations,countUsedReservations,insertIgnoreCreditEvents,insertPackageActivations,lockAccountsIdById,lockWalletsByAccountId,selectCreditEventsByAccountIdPeriod,selectPackageActivationsIdById,selectPlansCreditsSessionLimit,selectWalletsByAccountId,updateCreditReservationsPeriodByAccountIdPeriod,updateWalletsPeriodByAccountId,upsertCreditEvents,upsertWallets} from '../data-access/plans-queries.js';

export function basicPeriod(now=new Date()):string {
 const wib=new Date(now.getTime()+7*3600000);
 return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth()+1).padStart(2,'0')}`;
}
// Caller owns transaction; lock account first to serialize initialization/reset.
export async function ensureBasic(connection:PoolConnection,accountId:string,now=new Date()) {
 const [accounts]=await lockAccountsIdById(connection,[accountId]);
 if(!accounts[0])throw new Error('account_not_found');
 const [wallets]=await lockWalletsByAccountId(connection,[accountId]);
 const period=basicPeriod(now); const old=wallets[0];
 if(!old||(old.plan_id==='basic'&&old.period<period)||(old.plan_id!=='basic'&&new Date(old.expires_at)<=now)){
  const [plans]=await selectPlansCreditsSessionLimit(connection);
  const plan=plans[0];if(!plan)throw new Error('basic_plan_missing');
  await insertIgnoreCreditEvents(connection,[accountId,period,plan.credits]);
  const [grants]=await selectCreditEventsByAccountIdPeriod(connection,[accountId,period]);
  const [spent]=await countUsedReservations(connection,[accountId,period]);
  const balance=Math.max(0,Number(grants[0].credits)-spent[0].used);
  await upsertWallets(connection,[accountId,period,balance,plan.credits,plan.session_limit]);
 }
 const [result]=await selectWalletsByAccountId(connection,[accountId]);
 return result[0];
}
export async function basicWallet(accountId:string,now=new Date()){
 const connection=await db.getConnection();
 try{await connection.beginTransaction();const wallet=await ensureBasic(connection,accountId,now);await connection.commit();return wallet;}catch(e){await connection.rollback();throw e;}finally{connection.release();}
}
export function planInput(body:unknown){
 if(!body||typeof body!=='object')return null;
 const {name,price,credits,session_limit,active,max_share_assets,max_share_storage_bytes}=body as Record<string,unknown>;
 if(typeof name!=='string'||!name.trim()||name.length>100||typeof active!=='boolean')return null;
 if(![price,credits,session_limit].every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=100000000))return null;
 if((session_limit as number)<1||(session_limit as number)>1000)return null;
 if(typeof max_share_assets!=='number'||!Number.isSafeInteger(max_share_assets)||max_share_assets<0||max_share_assets>100000)return null;
 if(typeof max_share_storage_bytes!=='number'||!Number.isSafeInteger(max_share_storage_bytes)||max_share_storage_bytes<0||max_share_storage_bytes>10*1024*1024*1024)return null;
 return {name:name.trim(),price:price as number,credits:credits as number,session_limit:session_limit as number,active,maxShareAssets:max_share_assets,maxShareStorageBytes:max_share_storage_bytes};
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
 const [old]=await selectPackageActivationsIdById(connection,[id]);
 if(old.length)return;
 const expires=nextMonth(now),epoch='paid:'+id;
 if(wallet.plan_id==='basic'){
  const [reserved]=await countOpenReservations(connection,[accountId,wallet.period]);
  await upsertCreditEvents(connection,[accountId,wallet.period,-(wallet.balance+reserved[0].total)]);
 }
 // Pending reservations travel with unexpired credit across a purchase, but never across expiry/reset.
 await updateCreditReservationsPeriodByAccountIdPeriod(connection,[epoch,accountId,wallet.period]);
 await insertPackageActivations(connection,[id,accountId,plan.id,plan.credits,plan.session_limit,now,expires]);
 await updateWalletsPeriodByAccountId(connection,[epoch,plan.credits,plan.credits,plan.session_limit,plan.id,expires,accountId]);
}
