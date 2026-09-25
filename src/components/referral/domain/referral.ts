// Program referral: kode per akun, penukaran kode, kelolosan lewat nomor WhatsApp yang baru dipasang, bonus
// kredit, komisi pembelian, profil bank, pencairan, dan pengaturan pemilik.
import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { object } from '../../../libraries/validation.js';
import { ensureBasic } from '../../billing/index.js';
import * as aiWalletsSql from '../data-access/ai-wallets-queries.js';
import * as auditEventsSql from '../data-access/audit-events-queries.js';
import * as referralAgentsSql from '../data-access/referral-agents-queries.js';
import * as referralCodesSql from '../data-access/referral-codes-queries.js';
import * as referralEarningsSql from '../data-access/referral-earnings-queries.js';
import * as referralPayoutsSql from '../data-access/referral-payouts-queries.js';
import * as referralProfilesSql from '../data-access/referral-profiles-queries.js';
import * as referralQualifiedNumbersSql from '../data-access/referral-qualified-numbers-queries.js';
import * as referralSettingsSql from '../data-access/referral-settings-queries.js';
import * as referralsSql from '../data-access/referrals-queries.js';
import * as walletsSql from '../data-access/wallets-queries.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I supaya tidak tertukar saat diucapkan atau diketik
function generateCode() {
  let out = '';
  for (const byte of randomBytes(8)) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}
function fail(message: string) {
  return new ApiError(400, 'invalid_request', message);
}
function text(value: unknown, max: number, name: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(name + ' wajib diisi');
  return value.trim();
}
async function transaction<T>(fn: (c: PoolConnection) => Promise<T>) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

export interface ReferralSettings {
  enabled: boolean;
  commission_percent: number;
  referrer_signup_wa_credits: number;
  referrer_signup_ai_credits: number;
  referee_signup_wa_credits: number;
  referee_signup_ai_credits: number;
  min_payout_amount: number;
}

export class ReferralService {
  async settings(): Promise<ReferralSettings> {
    const [rows] = await referralSettingsSql.find(db);
    const row = rows[0];
    return {
      enabled: Boolean(row?.enabled),
      commission_percent: Number(row?.commission_percent ?? 0),
      referrer_signup_wa_credits: Number(row?.referrer_signup_wa_credits ?? 0),
      referrer_signup_ai_credits: Number(row?.referrer_signup_ai_credits ?? 0),
      referee_signup_wa_credits: Number(row?.referee_signup_wa_credits ?? 0),
      referee_signup_ai_credits: Number(row?.referee_signup_ai_credits ?? 0),
      min_payout_amount: Number(row?.min_payout_amount ?? 0),
    };
  }
  async configure(actor: string, body: unknown) {
    const input = object(body);
    if (typeof input.enabled !== 'boolean') throw fail('Status aktif wajib valid');
    const fields = [
      'commission_percent',
      'referrer_signup_wa_credits',
      'referrer_signup_ai_credits',
      'referee_signup_wa_credits',
      'referee_signup_ai_credits',
      'min_payout_amount',
    ] as const;
    const values: Record<string, number> = {};
    for (const field of fields) {
      const value = input[field];
      if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100000000)
        throw fail('Nilai ' + field + ' tidak valid');
      values[field] = Number(value);
    }
    if (values.commission_percent > 100) throw fail('Persentase komisi maksimal 100');
    await transaction(async c => {
      await referralSettingsSql.update(c, [
        input.enabled,
        values.commission_percent,
        values.referrer_signup_wa_credits,
        values.referrer_signup_ai_credits,
        values.referee_signup_wa_credits,
        values.referee_signup_ai_credits,
        values.min_payout_amount,
      ] as any[]);
      await auditEventsSql.insertSettingsUpdated(c, [actor]);
    });
    return this.settings();
  }

  // Setiap akun punya kode tetap yang dibuat saat pertama kali dipakai. Bisa menerima koneksi yang sudah ada
  // supaya pemanggil yang sedang di dalam transaksi tidak membuka koneksi kedua.
  async code(accountId: string, external?: PoolConnection) {
    const reader = external ?? db;
    const [existing] = await referralCodesSql.findByAccount(reader, [accountId]);
    if (existing[0]) return existing[0].code as string;
    const run = async (c: PoolConnection) => {
      const [rows] = await referralCodesSql.lockByAccount(c, [accountId]);
      if (rows[0]) return rows[0].code as string;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();
        try {
          await referralCodesSql.insert(c, [accountId, code]);
          return code;
        } catch (e) {
          if ((e as { code?: string }).code !== 'ER_DUP_ENTRY') throw e;
        }
      }
      throw new ApiError(503, 'referral_code_unavailable', 'Gagal membuat kode referral, coba lagi');
    };
    return external ? run(external) : transaction(run);
  }

  // Kode ditukar setelah login dari halaman referral, tidak pernah saat registrasi.
  async redeem(accountId: string, body: unknown) {
    const input = object(body),
      code = text(input.code, 16, 'Kode referral').toUpperCase();
    const settings = await this.settings();
    if (!settings.enabled) throw new ApiError(409, 'referral_disabled', 'Program referral sedang tidak aktif');
    return transaction(async c => {
      const [existing] = await referralsSql.lockByReferred(c, [accountId]);
      if (existing[0]) throw new ApiError(409, 'referral_already_used', 'Anda sudah menggunakan kode referral');
      const [owner] = await referralCodesSql.lockOwnerByCode(c, [code]);
      if (!owner[0]) throw new ApiError(404, 'referral_code_not_found', 'Kode referral tidak ditemukan');
      if (owner[0].account_id === accountId)
        throw new ApiError(409, 'referral_self', 'Tidak dapat menggunakan kode referral milik sendiri');
      const id = randomUUID();
      await referralsSql.insert(c, [id, owner[0].account_id, accountId, code]);
      await auditEventsSql.insertRedeemed(c, [accountId]);
      // Akun mungkin sudah punya nomor WhatsApp yang memenuhi syarat sebelum menukar kode.
      await this.tryQualifyExisting(c, accountId);
      return this.overview(accountId, c);
    });
  }

  // Dipanggil setelah penukaran kode (nomor yang sudah ada) dan setiap kali pairing berhasil (nomor baru).
  // Aman dipanggil berulang: satu nomor hanya bisa meloloskan satu referral, di seluruh sistem, selamanya.
  async qualify(referredAccountId: string, phoneNumber: string) {
    if (!phoneNumber) return;
    await transaction(c => this.qualifyWithConnection(c, referredAccountId, phoneNumber));
  }
  private async qualifyWithConnection(c: PoolConnection, referredAccountId: string, phoneNumber: string) {
    const [rows] = await referralsSql.lockPending(c, [referredAccountId]);
    const referral = rows[0];
    if (!referral) return;
    const settings = await this.settings();
    if (!settings.enabled) return;
    let inserted: number;
    try {
      const [result] = await referralQualifiedNumbersSql.insertIgnore(c, [phoneNumber, referral.id]);
      inserted = result.affectedRows;
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return;
      throw e;
    }
    if (!inserted) return; // nomor ini sudah pernah meloloskan referral (yang ini atau yang lain)
    await referralsSql.markQualified(c, [referral.id]);
    if (settings.referrer_signup_wa_credits || settings.referee_signup_wa_credits) {
      await ensureBasic(c, referral.referrer_id);
      await ensureBasic(c, referredAccountId);
      if (settings.referrer_signup_wa_credits)
        await walletsSql.addBalance(c, [settings.referrer_signup_wa_credits, referral.referrer_id]);
      if (settings.referee_signup_wa_credits)
        await walletsSql.addBalance(c, [settings.referee_signup_wa_credits, referredAccountId]);
    }
    if (settings.referrer_signup_ai_credits) {
      await aiWalletsSql.addBalance(c, [referral.referrer_id, settings.referrer_signup_ai_credits]);
    }
    if (settings.referee_signup_ai_credits) {
      await aiWalletsSql.addBalance(c, [referredAccountId, settings.referee_signup_ai_credits]);
    }
    await auditEventsSql.insertQualified(c, [referredAccountId]);
  }
  // Akun yang menukar kode setelah memasang WhatsApp tetap bisa lolos, asalkan nomornya belum pernah
  // dipakai meloloskan referral mana pun di sistem.
  private async tryQualifyExisting(c: PoolConnection, referredAccountId: string) {
    const numbers = await this.currentNumbers(referredAccountId);
    for (const number of numbers) await this.qualifyWithConnection(c, referredAccountId, number);
  }
  // Membaca nomor WhatsApp akun dari sesi yang sedang berjalan. Diisi oleh gateway, karena nomor telepon
  // tidak tercatat di database.
  currentNumbersProvider: (accountId: string) => Promise<string[]> = async () => [];
  private async currentNumbers(accountId: string) {
    try {
      return await this.currentNumbersProvider(accountId);
    } catch {
      return [];
    }
  }

  // Dipanggil dari pembayaran saat order lunas. Aman diulang karena order_id bersifat UNIQUE.
  async recordPurchaseCommission(c: PoolConnection, accountId: string, orderId: string, amount: number) {
    const [rows] = await referralsSql.lockQualified(c, [accountId]);
    const referral = rows[0];
    if (!referral) return;
    const settings = await this.settings();
    if (!settings.enabled) return;
    const [agents] = await referralAgentsSql.findCommission(c, [referral.referrer_id]);
    const percent = Number(agents[0]?.commission_percent ?? settings.commission_percent);
    if (!percent) return;
    const commission = Math.floor((amount * percent) / 100);
    if (!commission) return;
    try {
      await referralEarningsSql.insert(c, [randomUUID(), referral.referrer_id, referral.id, orderId, commission]);
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return;
      throw e;
    }
  }

  // --- Dashboard akun ---
  async overview(accountId: string, c: PoolConnection | typeof db = db) {
    const code = await this.code(accountId, c === db ? undefined : (c as PoolConnection));
    const [[counts], [earnings], [payouts], [myReferral]] = await Promise.all([
      referralsSql.countByReferrer(c, [accountId]),
      referralEarningsSql.sumByReferrer(c, [accountId]),
      referralPayoutsSql.sumActiveByReferrer(c, [accountId]),
      referralsSql.findByReferred(c, [accountId]),
    ]);
    const totalEarnings = Number(earnings[0].total),
      reserved = Number(payouts[0].total);
    return {
      code,
      totalReferrals: Number(counts[0].total),
      qualifiedReferrals: Number(counts[0].qualified ?? 0),
      totalEarnings,
      availableBalance: Math.max(0, totalEarnings - reserved),
      usedReferral: myReferral[0]
        ? {
            code: myReferral[0].code,
            status: myReferral[0].status,
            qualifiedAt: myReferral[0].qualified_at,
            referrerEmail: maskEmail(myReferral[0].referrer_email),
          }
        : null,
    };
  }
  async myReferrals(accountId: string) {
    const [rows] = await referralsSql.listByReferrer(db, [accountId]);
    return rows.map(r => ({
      id: r.id,
      email: maskEmail(String(r.email)),
      status: r.status,
      createdAt: r.created_at,
      qualifiedAt: r.qualified_at,
      earnings: Number(r.earnings),
    }));
  }
  async myEarnings(accountId: string) {
    const [rows] = await referralEarningsSql.listByReferrer(db, [accountId]);
    return rows.map(r => ({
      id: r.id,
      amount: Number(r.amount),
      createdAt: r.created_at,
      email: maskEmail(String(r.email)),
    }));
  }
  async profile(accountId: string) {
    const [rows] = await referralProfilesSql.findByAccount(db, [accountId]);
    return rows[0] ?? null;
  }
  async saveProfile(accountId: string, body: unknown) {
    const input = object(body);
    const bankName = text(input.bank_name, 100, 'Nama bank'),
      accountName = text(input.bank_account_name, 150, 'Nama pemilik rekening'),
      accountNumber = text(input.bank_account_number, 50, 'Nomor rekening');
    if (!/^[0-9-]{4,50}$/.test(accountNumber)) throw fail('Nomor rekening tidak valid');
    await referralProfilesSql.upsert(db, [accountId, bankName, accountName, accountNumber]);
    return this.profile(accountId);
  }
  async myPayouts(accountId: string) {
    const [rows] = await referralPayoutsSql.listByReferrer(db, [accountId]);
    return rows;
  }
  async requestPayout(accountId: string, body: unknown) {
    const input = object(body),
      amount = Number(input.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000) throw fail('Jumlah pencairan tidak valid');
    const settings = await this.settings();
    if (amount < settings.min_payout_amount)
      throw new ApiError(409, 'payout_below_minimum', 'Nominal di bawah batas minimum pencairan');
    return transaction(async c => {
      const [profiles] = await referralProfilesSql.lockByAccount(c, [accountId]);
      const profile = profiles[0];
      if (!profile) throw new ApiError(409, 'referral_profile_incomplete', 'Lengkapi profil rekening terlebih dahulu');
      const [[earnings], [reserved]] = await Promise.all([
        referralEarningsSql.sumByReferrer(c, [accountId]),
        referralPayoutsSql.lockActiveSum(c, [accountId]),
      ]);
      const available = Number(earnings[0].total) - Number(reserved[0].total);
      if (amount > available) throw new ApiError(409, 'insufficient_balance', 'Saldo referral tidak mencukupi');
      const id = randomUUID();
      await referralPayoutsSql.insert(c, [
        id,
        accountId,
        amount,
        profile.bank_name,
        profile.bank_account_name,
        profile.bank_account_number,
      ]);
      await auditEventsSql.insertPayoutRequested(c, [accountId]);
      return { id, amount, status: 'requested' };
    });
  }

  // --- Pemilik ---
  async adminList() {
    const [rows] = await referralsSql.listAllForOwner(db);
    return rows.map(r => ({ ...r, earnings: Number(r.earnings) }));
  }
  async adminPayouts(status?: string) {
    const valid = ['requested', 'paid', 'rejected'];
    const [rows] = await referralPayoutsSql.listByStatus(
      db,
      status && valid.includes(status) ? [status] : [],
      status,
      valid,
    );
    return rows;
  }
  async decidePayout(actor: string, id: string, body: unknown) {
    const input = object(body),
      decision = input.status;
    if (decision !== 'paid' && decision !== 'rejected') throw fail('Keputusan tidak valid');
    const note = input.note === undefined ? null : text(input.note, 500, 'Catatan');
    await transaction(async c => {
      const [rows] = await referralPayoutsSql.lockStatus(c, [id]);
      if (!rows[0]) throw new ApiError(404, 'payout_not_found', 'Pengajuan pencairan tidak ditemukan');
      if (rows[0].status !== 'requested')
        throw new ApiError(409, 'payout_already_processed', 'Pengajuan sudah diproses');
      await referralPayoutsSql.updateStatus(c, [decision, note, actor, id]);
      await auditEventsSql.insert(c, [actor, 'referral_payout_' + decision + ':' + id]);
    });
    return { ok: true };
  }
  async setAgent(actor: string, accountId: string, body: unknown) {
    const input = object(body);
    if (input.remove === true) {
      await referralAgentsSql.deleteByAccount(db, [accountId]);
      await auditEventsSql.insert(db, [actor, 'referral_agent_removed:' + accountId]);
      return { ok: true };
    }
    const percent = Number(input.commission_percent);
    if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) throw fail('Persentase komisi tidak valid');
    const note = input.note === undefined || input.note === '' ? null : text(input.note, 300, 'Catatan');
    await referralAgentsSql.upsert(db, [accountId, percent, note, actor]);
    await auditEventsSql.insert(db, [actor, 'referral_agent_set:' + accountId]);
    return { ok: true };
  }
  async agents() {
    const [rows] = await referralAgentsSql.listAll(db);
    return rows;
  }
}
function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return visible + '*'.repeat(Math.max(1, user.length - visible.length)) + '@' + domain;
}
export const referral = new ReferralService();
