// Pembayaran QRIS lewat Midtrans: pengaturan kredensial, membuat dan membatalkan order, notifikasi dari
// Midtrans, aktivasi paket atau kredit AI setelah lunas, dan pengecekan berkala order yang belum pasti.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { db } from '../../../libraries/db.js';
import { activatePackage } from './plans.js';
import { ApiError } from '../../../libraries/errors.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { decrypt, encrypt } from '../../../libraries/crypto.js';
import * as accountsSql from '../data-access/accounts-queries.js';
import * as aiSettingsSql from '../data-access/ai-settings-queries.js';
import * as aiWalletsSql from '../data-access/ai-wallets-queries.js';
import * as auditEventsSql from '../data-access/audit-events-queries.js';
import * as paymentConfigSql from '../data-access/payment-config-queries.js';
import * as paymentOrdersSql from '../data-access/payment-orders-queries.js';
import * as paymentSettingsSql from '../data-access/payment-settings-queries.js';
import * as plansSql from '../data-access/plans-queries.js';

const base = (environment: string) =>
  environment === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
// Dipanggil di dalam transaksi pelunasan order; komponen referral mencatat komisinya di sini.
export interface PurchaseCommissions {
  recordPurchaseCommission(c: PoolConnection, account: string, orderId: string, total: number): Promise<unknown>;
}
const noCommissions: PurchaseCommissions = { async recordPurchaseCommission() {} };
export type Transport = (
  environment: string,
  key: string,
  path: string,
  body?: unknown,
) => Promise<Record<string, any>>;
const transport: Transport = async (environment, key, path, body) => {
  const response = await fetch(base(environment) + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as Record<string, any>;
  if (!response.ok && ![400, 401, 402, 404, 410].includes(response.status))
    throw new ApiError(502, 'payment_provider_error', 'Midtrans belum dapat dihubungi atau konfigurasi ditolak');
  return data;
};
export class Payments {
  constructor(
    private call: Transport = transport,
    private configId?: string,
    private referral: PurchaseCommissions = noCommissions,
  ) {}
  async configuration() {
    const [rows] = await paymentConfigSql.findActiveSummary(db);
    return {
      configured: Boolean(rows[0]),
      ...(rows[0] ?? {}),
      serverKey: rows[0] ? '********' : null,
      notificationUrl: (process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067') + '/payments/midtrans/notification',
    };
  }
  async configure(actor: string, body: unknown) {
    const input = object(body);
    if (!['sandbox', 'production'].includes(String(input.environment)))
      throw new ApiError(400, 'invalid_request', 'Lingkungan tidak valid');
    const key = requiredString(input.serverKey, 'serverKey', 512);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new ApiError(400, 'invalid_request', 'Format Server Key tidak valid');
    const secret = encrypt(key),
      id = randomUUID(),
      c = await db.getConnection();
    try {
      await c.beginTransaction();
      await paymentConfigSql.insert(c, [id, String(input.environment), secret]);
      await paymentSettingsSql.setActiveConfig(c, [id]);
      await auditEventsSql.insertPaymentConfigRotated(c, [actor]);
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    return this.configuration();
  }
  private async credential(id = this.configId) {
    const [rows] = await paymentConfigSql.findOrActive(db, id ? [id] : [], id);
    if (!rows[0]) throw new ApiError(503, 'payment_not_configured', 'Pembayaran belum tersedia');
    return { id: rows[0].id as string, environment: rows[0].environment as string, key: decrypt(rows[0].secret) };
  }
  async test() {
    const c = await this.credential();
    const data = await this.call(c.environment, c.key, '/v2/ncwa-check-' + randomUUID() + '/status');
    if (String(data.status_code) !== '404')
      throw new ApiError(502, 'payment_provider_error', 'Kredensial belum terverifikasi');
    return { ok: true, message: 'Autentikasi status berhasil; aktivasi QRIS tetap perlu diuji di merchant.' };
  }
  async list(account: string) {
    const [rows] = await paymentOrdersSql.listRecentByAccount(db, [account]);
    return rows;
  }
  async order(account: string, id: string) {
    const [rows] = await paymentOrdersSql.findOwned(db, [account, id]);
    if (!rows[0]) throw new ApiError(404, 'order_not_found', 'Pembayaran tidak ditemukan');
    return rows[0];
  }
  protected async aiPrice(c: PoolConnection) {
    const [rows] = await aiSettingsSql.shareCreditPrice(c);
    return Number(rows[0]?.credit_price ?? 0);
  }
  async create(account: string, planId: unknown, kind: 'whatsapp' | 'ai' = 'whatsapp', units: unknown = 1) {
    const selected = requiredString(planId, 'planId', 36);
    const aiUnits = kind === 'ai' ? Number(units) : 1;
    if (kind === 'ai' && (!Number.isSafeInteger(aiUnits) || aiUnits < 1 || aiUnits > 100))
      throw new ApiError(400, 'invalid_request', 'Jumlah unit kredit AI harus bilangan 1–100');
    const effectivePlanId = kind === 'ai' && aiUnits > 1 ? 'ai-10000x' + aiUnits : selected;
    const [stale] = await paymentOrdersSql.findExpiredPending(db, [account]);
    if (stale[0]) {
      await this.reconcile(stale[0].id);
      const previous = await this.order(account, stale[0].id);
      if (previous.status === 'settlement' && previous.kind === kind) return previous;
    }
    const config = await this.credential();
    const c = await db.getConnection();
    let id: string;
    try {
      await c.beginTransaction();
      await accountsSql.lock(c, [account]);
      const [pending] = await paymentOrdersSql.findOpen(c, [account]);
      if (pending[0]) {
        if (pending[0].plan_id !== effectivePlanId || pending[0].kind !== kind)
          throw new ApiError(409, 'payment_pending', 'Selesaikan pembayaran sebelumnya terlebih dahulu');
        await c.commit();
        return this.order(account, pending[0].id);
      }
      const [plans] = await plansSql.sharePurchasable(c, [selected]);
      let plan: { id: string; name: string; price: number; credits: number; session_limit: number } | undefined =
        plans[0] as any;
      if (kind === 'ai') {
        const price = await this.aiPrice(c);
        if (selected !== 'ai-10000' || !price)
          throw new ApiError(409, 'ai_purchase_unavailable', 'Harga kredit AI belum ditetapkan pemilik');
        plan = {
          id: effectivePlanId,
          name: new Intl.NumberFormat('id-ID').format(10000 * aiUnits) + ' Kredit AI',
          price: price * aiUnits,
          credits: 10000 * aiUnits,
          session_limit: 0,
        };
      }
      if (!plan) throw new ApiError(400, 'plan_unavailable', 'Paket tidak dapat dibeli');
      id = 'ncwa-' + randomUUID();
      await paymentOrdersSql.insert(c, [
        id,
        account,
        plan.id,
        plan.name,
        plan.price,
        plan.price,
        plan.credits,
        plan.session_limit,
        config.id,
        config.environment,
        kind,
      ]);
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    try {
      const order = await this.internal(id);
      const data = await this.call(config.environment, config.key, '/v2/charge', {
        payment_type: 'qris',
        transaction_details: { order_id: id, gross_amount: order.total },
        qris: { acquirer: 'gopay' },
        custom_expiry: { expiry_duration: 15, unit: 'minute' },
      });
      // Respons charge hanya menyimpan data pembayaran. Aktivasi selalu menunggu konfirmasi GET Status.
      if (['400', '401', '402', '410'].includes(String(data.status_code))) await paymentOrdersSql.markDenied(db, [id]);
      else await this.apply(id, data, false);
    } catch {
      await paymentOrdersSql.markUnknown(db, [id]);
    }
    return this.order(account, id);
  }
  private async internal(id: string) {
    const [rows] = await paymentOrdersSql.find(db, [id]);
    if (!rows[0]) throw new ApiError(404, 'order_not_found', 'Pembayaran tidak ditemukan');
    return rows[0];
  }
  async reconcile(id: string) {
    const order = await this.internal(id),
      config = await this.credential(order.config_id);
    const data = await this.call(config.environment, config.key, '/v2/' + encodeURIComponent(id) + '/status');
    if (String(data.status_code) === '404') {
      // Charge tidak pernah diulang setelah pembuatan yang hasilnya tidak pasti; order tetap terlihat untuk
      // dicocokkan manual.
      await paymentOrdersSql.markStaleChecked(db, [id]);
      return;
    }
    await this.apply(id, data, true);
  }
  async cancel(account: string, id: string) {
    await this.order(account, id);
    await this.reconcile(id);
    let order = await this.order(account, id);
    if (!['creating', 'pending', 'unknown'].includes(order.status)) return order;
    if (order.status !== 'pending')
      throw new ApiError(409, 'payment_processing', 'Status pembayaran masih diperiksa. Coba lagi beberapa saat lagi.');
    const stored = await this.internal(id),
      config = await this.credential(stored.config_id);
    // Timeout atau pembayaran yang terjadi bersamaan diselesaikan lewat GET Status.
    try {
      await this.call(config.environment, config.key, '/v2/' + encodeURIComponent(id) + '/cancel', {});
    } catch {}
    await this.reconcile(id);
    order = await this.order(account, id);
    if (['creating', 'pending', 'unknown'].includes(order.status))
      throw new ApiError(
        409,
        'cancel_unconfirmed',
        'Pembatalan belum terkonfirmasi. Periksa status kembali sebelum membayar.',
      );
    return order;
  }
  async notification(body: unknown) {
    const data = object(body),
      id = requiredString(data.order_id, 'order_id', 64),
      order = await this.internal(id),
      config = await this.credential(order.config_id);
    if (
      typeof data.status_code !== 'string' ||
      typeof data.gross_amount !== 'string' ||
      typeof data.signature_key !== 'string' ||
      !/^[a-f0-9]{128}$/i.test(data.signature_key)
    )
      throw new ApiError(403, 'invalid_signature', 'Notifikasi tidak valid');
    const expected = createHash('sha512')
      .update(id + data.status_code + data.gross_amount + config.key)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(data.signature_key, 'hex')))
      throw new ApiError(403, 'invalid_signature', 'Notifikasi tidak valid');
    await this.reconcile(id);
    return { ok: true };
  }
  private async apply(id: string, data: Record<string, any>, verified: boolean) {
    const found = await this.internal(id),
      c = await db.getConnection();
    try {
      await c.beginTransaction();
      await accountsSql.lock(c, [found.account_id]);
      const [rows] = await paymentOrdersSql.lock(c, [id]);
      const order = rows[0];
      if (
        data.order_id !== id ||
        data.currency !== 'IDR' ||
        data.payment_type !== 'qris' ||
        !/^\d+(\.00)?$/.test(String(data.gross_amount)) ||
        Number(data.gross_amount) !== order.total ||
        typeof data.transaction_id !== 'string' ||
        !data.transaction_id ||
        data.transaction_id.length > 100 ||
        (order.transaction_id && order.transaction_id !== data.transaction_id)
      )
        throw new ApiError(409, 'payment_mismatch', 'Identitas atau nominal pembayaran tidak cocok');
      if (order.activated_at) {
        await c.commit();
        return;
      }
      let status = order.status;
      if (
        verified &&
        data.transaction_status === 'settlement' &&
        String(data.status_code) === '200' &&
        (data.fraud_status === undefined || data.fraud_status === 'accept')
      ) {
        if (order.kind === 'ai') {
          await aiWalletsSql.addBalance(c, [order.account_id, order.credits]);
        } else
          await activatePackage(c, order.account_id, id, {
            id: order.plan_id,
            credits: order.credits,
            session_limit: order.session_limit,
          });
        status = 'settlement';
        await paymentOrdersSql.markActivated(c, [id]);
        await this.referral.recordPurchaseCommission(c, order.account_id, id, order.total);
      } else if (['pending', 'expire', 'deny', 'cancel'].includes(data.transaction_status))
        status = data.transaction_status;
      let expires = order.expires_at;
      const expiryText = data.expiry_time ?? data.transaction_time;
      if (typeof expiryText === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(expiryText)) {
        const parsed = new Date(expiryText.replace(' ', 'T') + '+07:00');
        if (Number.isFinite(parsed.getTime()))
          expires = new Date(parsed.getTime() + (data.expiry_time ? 0 : 15 * 60000));
      }
      let qr = order.qr_url;
      const actions = Array.isArray(data.actions) ? data.actions : [];
      for (const name of ['generate-qr-code-v2', 'generate-qr-code']) {
        let accepted = false;
        for (const action of actions.filter((a: any) => a?.name === name)) {
          if (action.method !== 'GET' || typeof action.url !== 'string') continue;
          try {
            const url = new URL(action.url);
            if (
              url.origin === base(order.environment) &&
              /^\/v[24]\/qris\/[A-Za-z0-9_-]+\/qr-code$/.test(url.pathname) &&
              !url.search &&
              !url.hash &&
              !url.username &&
              !url.password
            ) {
              qr = url.href;
              accepted = true;
              break;
            }
          } catch {}
        }
        if (accepted) break;
      }
      // GET Status tidak memuat actions. Untuk transaksi pending yang sudah terverifikasi tapi URL QR
      // aslinya tidak tersimpan, pakai endpoint QR v2 yang terdokumentasi.
      if (!qr && verified && status === 'pending' && /^[A-Za-z0-9_-]+$/.test(data.transaction_id))
        qr = base(order.environment) + '/v2/qris/' + data.transaction_id + '/qr-code';
      await paymentOrdersSql.updateFromGateway(c, [status, data.transaction_id, qr, expires, id]);
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async qr(account: string, id: string) {
    const order = await this.internal(id);
    if (order.account_id !== account || !order.qr_url || order.status !== 'pending')
      throw new ApiError(404, 'qr_not_found', 'QR pembayaran tidak tersedia');
    const config = await this.credential(order.config_id);
    const url = new URL(order.qr_url);
    if (url.origin !== base(config.environment)) throw new ApiError(409, 'payment_mismatch', 'URL QR tidak valid');
    const response = await fetch(url, {
      headers: { Authorization: 'Basic ' + Buffer.from(config.key + ':').toString('base64') },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png'))
      throw new ApiError(502, 'payment_provider_error', 'QR tidak dapat dimuat');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 1024 * 1024) throw new ApiError(502, 'payment_provider_error', 'QR terlalu besar');
    return bytes;
  }
  async sweep() {
    const [rows] = await paymentOrdersSql.listDueForCheck(db);
    for (const row of rows) {
      try {
        await this.reconcile(row.id);
      } catch {
        await paymentOrdersSql.touchChecked(db, [row.id]);
      }
    }
  }
}
