// Paket dan wallet kredit WhatsApp: kuota paket dasar gratis yang direset tiap tanggal 1 WIB, validasi
// katalog paket, dan aktivasi paket berbayar.
import { db } from '../../../libraries/db.js';
import type { PoolConnection } from 'mysql2/promise';
import * as accountsSql from '../data-access/accounts-queries.js';
import * as aiWalletsSql from '../data-access/ai-wallets-queries.js';
import * as creditEventsSql from '../data-access/credit-events-queries.js';
import * as creditReservationsSql from '../data-access/credit-reservations-queries.js';
import * as packageActivationsSql from '../data-access/package-activations-queries.js';
import * as plansSql from '../data-access/plans-queries.js';
import * as walletsSql from '../data-access/wallets-queries.js';

export function basicPeriod(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 3600000);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}`;
}
// Pemanggil yang memegang transaksi; akun dikunci dulu supaya inisialisasi dan reset berjalan berurutan.
export async function ensureBasic(connection: PoolConnection, accountId: string, now = new Date()) {
  const [accounts] = await accountsSql.lock(connection, [accountId]);
  if (!accounts[0]) throw new Error('account_not_found');
  const [wallets] = await walletsSql.lock(connection, [accountId]);
  const period = basicPeriod(now);
  const old = wallets[0];
  if (
    !old ||
    (old.plan_id === 'basic' && old.period < period) ||
    (old.plan_id !== 'basic' && new Date(old.expires_at) <= now)
  ) {
    const [plans] = await plansSql.findBasicQuota(connection);
    const plan = plans[0];
    if (!plan) throw new Error('basic_plan_missing');
    await creditEventsSql.insertBasicGrant(connection, [accountId, period, plan.credits]);
    const [grants] = await creditEventsSql.sumBasicCredits(connection, [accountId, period]);
    const [spent] = await creditReservationsSql.countUsed(connection, [accountId, period]);
    const balance = Math.max(0, Number(grants[0].credits) - spent[0].used);
    await walletsSql.resetToBasic(connection, [accountId, period, balance, plan.credits, plan.session_limit]);
  }
  const [result] = await walletsSql.find(connection, [accountId]);
  // `balance` adalah total yang bisa dipakai; kredit paket ada di `plan_balance`, kredit hasil beli di `purchased`.
  const row = result[0];
  const wallet = Object.assign(row, { plan_balance: row.balance, balance: row.balance + row.purchased });
  // Kredit AI paket dasar: sebulan sekali bersama reset kredit WhatsApp; akun lama mendapatkannya saat pertama kali
  // lewat sini. Mengubah jumlahnya di tengah bulan berlaku mulai bulan berikutnya.
  if (wallet.plan_id === 'basic') {
    const [granted] = await aiWalletsSql.findPlanPeriod(connection, [accountId]);
    if (granted[0]?.plan_period !== wallet.period) {
      const [plans] = await plansSql.findBasicQuota(connection);
      const credits = Number(plans[0]?.ai_credits ?? 0);
      await aiWalletsSql.grantPlan(connection, [
        accountId,
        credits,
        credits,
        basicPeriodEnd(wallet.period),
        wallet.period,
      ]);
    }
  }
  return wallet;
}
// Awal bulan berikutnya, 00.00 WIB, dalam UTC: kredit AI paket dasar hangus di sana.
export function basicPeriodEnd(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1) - 7 * 3600000);
}
export async function basicWallet(accountId: string, now = new Date()) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const wallet = await ensureBasic(connection, accountId, now);
    await connection.commit();
    return wallet;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}
export function planInput(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const { name, price, credits, session_limit, active, max_share_assets, max_share_storage_bytes } = body as Record<
    string,
    unknown
  >;
  // Klien lama tanpa kolom ini menganggapnya 0.
  const ai_credits = (body as Record<string, unknown>).ai_credits ?? 0;
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof active !== 'boolean') return null;
  if (
    ![price, credits, ai_credits, session_limit].every(
      v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 100000000,
    )
  )
    return null;
  if ((session_limit as number) < 1 || (session_limit as number) > 1000) return null;
  if (
    typeof max_share_assets !== 'number' ||
    !Number.isSafeInteger(max_share_assets) ||
    max_share_assets < 0 ||
    max_share_assets > 100000
  )
    return null;
  if (
    typeof max_share_storage_bytes !== 'number' ||
    !Number.isSafeInteger(max_share_storage_bytes) ||
    max_share_storage_bytes < 0 ||
    max_share_storage_bytes > 10 * 1024 * 1024 * 1024
  )
    return null;
  return {
    name: name.trim(),
    price: price as number,
    credits: credits as number,
    aiCredits: ai_credits as number,
    session_limit: session_limit as number,
    active,
    maxShareAssets: max_share_assets,
    maxShareStorageBytes: max_share_storage_bytes,
  };
}

// Satu bulan kalender dalam WIB, dibatasi ke hari terakhir bulan tujuan.
export function nextMonth(now: Date) {
  const local = new Date(now.getTime() + 7 * 3600000),
    day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + 1);
  const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return new Date(local.getTime() - 7 * 3600000);
}
export async function activatePackage(
  connection: PoolConnection,
  accountId: string,
  id: string,
  plan: { id: string; credits: number; ai_credits?: number; session_limit: number },
  now = new Date(),
) {
  const wallet = await ensureBasic(connection, accountId, now);
  const [old] = await packageActivationsSql.find(connection, [id]);
  if (old.length) return;
  const expires = nextMonth(now),
    epoch = 'paid:' + id;
  if (wallet.plan_id === 'basic') {
    const [reserved] = await creditReservationsSql.countOpen(connection, [accountId, wallet.period]);
    await creditEventsSql.upsertBasicTransfer(connection, [
      accountId,
      wallet.period,
      -(wallet.plan_balance + reserved[0].total),
    ]);
  }
  // Reservasi yang masih tertunda ikut pindah bersama kredit yang belum kedaluwarsa saat membeli paket,
  // tapi tidak pernah melewati kedaluwarsa atau reset.
  await creditReservationsSql.moveOpenToPeriod(connection, [epoch, accountId, wallet.period]);
  await packageActivationsSql.insert(connection, [
    id,
    accountId,
    plan.id,
    plan.credits,
    plan.session_limit,
    now,
    expires,
  ]);
  // Kredit AI paket menggantikan sisa kredit AI paket sebelumnya dan berlaku selama paket ini aktif.
  await aiWalletsSql.grantPlan(connection, [accountId, plan.ai_credits ?? 0, plan.ai_credits ?? 0, expires, epoch]);
  await walletsSql.renew(connection, [
    epoch,
    plan.credits,
    plan.credits,
    plan.session_limit,
    plan.id,
    expires,
    accountId,
  ]);
}
