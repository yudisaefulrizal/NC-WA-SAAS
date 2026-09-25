import {db} from '../../../libraries/db.js';
import {ApiError} from '../../../libraries/errors.js';
import {object} from '../../../libraries/validation.js';
import {creditAIWallet,insertIgnoreWallets,selectWalletsBalanceByAccountId} from '../data-access/shared-queries.js';
import {countUsageByAccountId,insertAdjustments,insertAuditEvent,selectAdjustmentsAmountReasonByAccountIdRequestId,selectRecentUsage,selectUsagePage} from '../data-access/wallet-queries.js';
import {fail,integer,text} from './input.js';
import {transaction,lockAccount} from './shared.js';
import type {AIService} from './service.js';
// AI credit wallet of an account: balance, usage history and owner adjustments.
export async function walletSummary(svc:AIService,account:string){const [rows]=await selectWalletsBalanceByAccountId(db,[account]);const config=await svc.config();return {balance:rows[0]?.balance??0,input_rate:config.input_rate,output_rate:config.output_rate,credit_price:config.credit_price,unit:10000};}
export async function recentUsage(svc:AIService,account:string){const [rows]=await selectRecentUsage(db,[account]);return rows;}
export async function usagePage(svc:AIService,account:string,value:unknown){
  if(typeof value!=='string'||!/^\d{1,9}$/.test(value)||Number(value)<1)throw fail('Halaman tidak valid');
  const size=20;
  const [counts]=await countUsageByAccountId(db,[account]);
  const total=Number(counts[0].total),pages=Math.max(1,Math.ceil(total/size)),page=Math.min(Number(value),pages);
  const [items]=await selectUsagePage(db,[account],size,page);
  return {items,page,pages,total,page_size:size};
 }
export async function adjust(svc:AIService,actor:string,account:string,body:unknown){const input=object(body),amount=integer(input.amount,-100000000,100000000,'Jumlah'),reason=text(input.reason,200,'Alasan'),id=text(input.requestId,64,'ID');if(!amount||!reason||! /^[A-Za-z0-9_-]{1,64}$/.test(id))throw fail('Jumlah, alasan, dan ID wajib valid');await transaction(async c=>{await lockAccount(c,account);const [old]=await selectAdjustmentsAmountReasonByAccountIdRequestId(c,[account,id]);if(old[0]){if(old[0].amount!==amount||old[0].reason!==reason)throw new ApiError(409,'idempotency_conflict','ID sudah digunakan');return;}await insertIgnoreWallets(c,[account]);const [rows]=await selectWalletsBalanceByAccountId(c,[account]);if(rows[0].balance+amount<0||rows[0].balance+amount>1000000000)throw fail('Saldo di luar batas');await creditAIWallet(c,[amount,account]);await insertAdjustments(c,[account,id,actor,amount,reason]);await insertAuditEvent(c,[actor,'ai_credit_adjusted:'+account]);});return svc.wallet(account);}
