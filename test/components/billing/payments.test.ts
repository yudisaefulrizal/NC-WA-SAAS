// Tes pembayaran QRIS: checkout, notifikasi Midtrans, pembuatan yang tidak pasti, ganti konfigurasi, pembatalan,
// dan order kedaluwarsa.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import { Payments, type Transport } from '../../../src/components/billing/domain/payments.js';
import { encrypt } from '../../../src/libraries/crypto.js';
import { basicWallet } from '../../../src/components/billing/domain/plans.js';
process.env.PAYMENT_ENCRYPTION_KEY = '11'.repeat(32);
const accounts: string[] = [],
  configs: string[] = [],
  plans: string[] = [];
async function fixture() {
  const account = randomUUID(),
    config = randomUUID(),
    plan = 'test-' + randomUUID().slice(0, 20);
  accounts.push(account);
  configs.push(config);
  plans.push(plan);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    account,
    account + '@test.invalid',
    'unused',
  ]);
  await basicWallet(account);
  await db.execute("INSERT INTO payment_config(id,environment,secret) VALUES (?,'sandbox',?)", [
    config,
    encrypt('fixture-key'),
  ]);
  await db.execute('INSERT INTO plans VALUES (?,?,10000,500,3,TRUE,20,104857600)', [plan, 'Fixture plan']);
  return { account, config, plan };
}
after(async () => {
  for (const id of accounts) {
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
  }
  for (const id of configs) await db.execute('DELETE FROM payment_config WHERE id=?', [id]);
  for (const id of plans) await db.execute('DELETE FROM plans WHERE id=?', [id]);
  await db.end();
});
test('Checkout snapshots catalog; parallel create and verified callback activate once using pinned credentials', async () => {
  const f = await fixture();
  let charges = 0;
  let order = '';
  let invalid = false;
  const calls: string[] = [];
  const call: Transport = async (env, key, path, body) => {
    calls.push(key);
    assert.equal(env, 'sandbox');
    assert.equal(key, 'fixture-key');
    if (body) {
      charges++;
      order = (body as any).transaction_details.order_id;
    }
    return {
      order_id: order,
      transaction_id: 'tx-' + order,
      payment_type: 'qris',
      currency: 'IDR',
      gross_amount: invalid ? '999.00' : '10000.00',
      transaction_status: body ? 'pending' : 'settlement',
      status_code: body ? '201' : '200',
      fraud_status: 'accept',
      actions: [
        { name: 'generate-qr-code', method: 'GET', url: 'https://api.sandbox.midtrans.com/v2/qris/fixture/qr-code' },
      ],
    };
  };
  const service = new Payments(call, f.config),
    initial = (await basicWallet(f.account)).balance;
  const results = await Promise.all(Array.from({ length: 5 }, () => service.create(f.account, f.plan)));
  assert.equal(charges, 1);
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal((await basicWallet(f.account)).balance, initial);
  await db.execute('UPDATE plans SET credits=1,price=20000,active=FALSE WHERE id=?', [f.plan]);
  const stored = await service.order(f.account, order);
  assert.equal(stored.total, 10000);
  assert.equal(stored.fee, 0);
  assert.equal(stored.status, 'pending');
  await assert.rejects(service.order(randomUUID(), order), { code: 'order_not_found' });
  await assert.rejects(
    service.notification({
      order_id: order,
      status_code: '200',
      gross_amount: '10000.00',
      signature_key: '0'.repeat(128),
    }),
    { code: 'invalid_signature' },
  );
  invalid = true;
  await assert.rejects(service.reconcile(order), { code: 'payment_mismatch' });
  assert.equal((await basicWallet(f.account)).balance, initial);
  invalid = false;
  const signature = createHash('sha512')
    .update(order + '20010000.00fixture-key')
    .digest('hex');
  await Promise.all([
    service.reconcile(order),
    service.reconcile(order),
    service.notification({ order_id: order, status_code: '200', gross_amount: '10000.00', signature_key: signature }),
  ]);
  assert.equal((await basicWallet(f.account)).balance, initial + 500);
  assert.equal((await basicWallet(f.account)).session_limit, 3);
  assert.equal((await service.order(f.account, order)).status, 'settlement');
  await assert.rejects(service.create(f.account, f.plan), { code: 'plan_unavailable' });
  const [config] = await db.execute<any[]>('SELECT secret FROM payment_config WHERE id=?', [f.config]);
  assert.ok(!config[0].secret.includes('fixture-key'));
});
test('Ambiguous create never charges again on resume; later GET Status recovers payment', async () => {
  const f = await fixture();
  let charges = 0;
  let order = '';
  const service = new Payments(async (_env, _key, _path, body) => {
    if (body) {
      charges++;
      order = (body as any).transaction_details.order_id;
      throw new Error('timeout');
    }
    return {
      order_id: order,
      transaction_id: 'tx-' + order,
      payment_type: 'qris',
      currency: 'IDR',
      gross_amount: '10000.00',
      transaction_status: 'settlement',
      status_code: '200',
    };
  }, f.config);
  const first = await service.create(f.account, f.plan);
  assert.equal(first.status, 'unknown');
  assert.equal((await service.create(f.account, f.plan)).id, first.id);
  assert.equal(charges, 1);
  await service.reconcile(first.id);
  assert.equal((await service.order(f.account, first.id)).status, 'settlement');
  assert.equal(charges, 1);
});

test('HTTP checkout ignores browser price/account and blocks another account from the order', async () => {
  const { createApp } = await import('../../../src/http/app.js'),
    { digest } = await import('../../../src/libraries/security.js');
  const { default: request } = await import('supertest');
  const f = await fixture();
  let id = '';
  const service = new Payments(async (_env, _key, _path, body) => {
    id = (body as any).transaction_details.order_id;
    return {
      order_id: id,
      transaction_id: 'tx-' + id,
      payment_type: 'qris',
      currency: 'IDR',
      gross_amount: '10000.00',
      transaction_status: 'pending',
      status_code: '201',
    };
  }, f.config);
  const app = createApp(undefined, service),
    token = randomUUID();
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(token),
    f.account,
  ]);
  const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
  const response = await request(app)
    .post('/api/payments')
    .set('Origin', origin)
    .set('Cookie', 'ncwa_session=' + token)
    .send({ planId: f.plan, price: 1, credits: 999999, accountId: randomUUID() })
    .expect(200);
  assert.equal(response.body.total, 10000);
  const b = await fixture(),
    other = randomUUID();
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(other),
    b.account,
  ]);
  await request(app)
    .get('/api/payments/' + id)
    .set('Cookie', 'ncwa_session=' + other)
    .expect(404);
  await request(app)
    .post('/api/payments/' + id + '/check')
    .set('Origin', origin)
    .set('Cookie', 'ncwa_session=' + other)
    .expect(404);
});

test('An order uses its original environment and key after switching the current configuration', async () => {
  const old = await fixture(),
    next = await fixture();
  await db.execute("UPDATE payment_config SET environment='production',secret=? WHERE id=?", [
    encrypt('new-key'),
    next.config,
  ]);
  let id = '';
  const first = new Payments(async (_env, _key, _path, body) => {
    id = (body as any).transaction_details.order_id;
    return {
      order_id: id,
      transaction_id: 'tx-' + id,
      payment_type: 'qris',
      currency: 'IDR',
      gross_amount: '10000.00',
      transaction_status: 'pending',
      status_code: '201',
    };
  }, old.config);
  await first.create(old.account, old.plan);
  const afterRotation = new Payments(async (env, key) => {
    assert.equal(env, 'sandbox');
    assert.equal(key, 'fixture-key');
    return {
      order_id: id,
      transaction_id: 'tx-' + id,
      payment_type: 'qris',
      currency: 'IDR',
      gross_amount: '10000.00',
      transaction_status: 'settlement',
      status_code: '200',
    };
  }, next.config);
  await afterRotation.reconcile(id);
  assert.equal((await afterRotation.order(old.account, id)).status, 'settlement');
});

test('Cancellation verifies remote status, preserves concurrent settlement and rejects other accounts', async () => {
  for (const outcome of ['cancel', 'settlement', 'pending']) {
    const f = await fixture();
    let id = '',
      status = 'pending',
      cancelCalls = 0;
    const service = new Payments(async (_env, _key, path, body) => {
      if (path.endsWith('/charge')) id = (body as any).transaction_details.order_id;
      if (path.endsWith('/cancel')) {
        cancelCalls++;
        status = outcome;
        throw new Error('response lost');
      }
      return {
        order_id: id,
        transaction_id: 'tx-' + id,
        payment_type: 'qris',
        currency: 'IDR',
        gross_amount: '10000.00',
        transaction_status: status,
        status_code: status === 'settlement' ? '200' : '201',
      };
    }, f.config);
    const initial = (await basicWallet(f.account)).balance;
    await service.create(f.account, f.plan);
    await assert.rejects(service.cancel(randomUUID(), id), { code: 'order_not_found' });
    assert.equal(cancelCalls, 0);
    if (outcome === 'pending') await assert.rejects(service.cancel(f.account, id), { code: 'cancel_unconfirmed' });
    else assert.equal((await service.cancel(f.account, id)).status, outcome);
    assert.equal(cancelCalls, 1);
    assert.equal((await basicWallet(f.account)).balance, initial + (outcome === 'settlement' ? 500 : 0));
    if (outcome === 'cancel') {
      const previousId = id;
      status = 'pending';
      const next = await service.create(f.account, f.plan);
      assert.notEqual(next.id, previousId);
    }
  }
});

test('Expired checkout is reconciled before replacement; late settlement is shown instead of charging again', async () => {
  for (const terminal of ['expire', 'settlement']) {
    const f = await fixture();
    let id = '',
      charges = 0;
    const service = new Payments(async (_env, _key, _path, body) => {
      if (body) {
        id = (body as any).transaction_details.order_id;
        charges++;
      }
      return {
        order_id: id,
        transaction_id: 'tx-' + id,
        payment_type: 'qris',
        currency: 'IDR',
        gross_amount: '10000.00',
        transaction_status: body ? 'pending' : terminal,
        status_code: body ? '201' : '200',
      };
    }, f.config);
    const first = await service.create(f.account, f.plan);
    await db.execute('UPDATE payment_orders SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?', [
      first.id,
    ]);
    const next = await service.create(f.account, f.plan);
    assert.equal(charges, terminal === 'settlement' ? 1 : 2);
    if (terminal === 'settlement') {
      assert.equal(next.id, first.id);
      assert.equal(next.status, 'settlement');
    } else assert.notEqual(next.id, first.id);
  }
});

test('QR selection falls back from unsupported v2 action host and repairs missing QR after verified status', async () => {
  const f = await fixture();
  let id = '';
  const service = new Payments(async (_env, _key, _path, body) => {
    if (body) id = (body as any).transaction_details.order_id;
    return {
      order_id: id,
      transaction_id: 'tx-' + id,
      payment_type: 'qris',
      currency: 'IDR',
      gross_amount: '10000.00',
      transaction_status: 'pending',
      status_code: '201',
      ...(body
        ? {
            actions: [
              {
                name: 'generate-qr-code-v2',
                method: 'GET',
                url: 'https://merchants-app.sbx.midtrans.com/v4/qris/gopay/example/qr-code',
              },
              {
                name: 'generate-qr-code',
                method: 'GET',
                url: 'https://api.sandbox.midtrans.com/v2/qris/tx-' + id + '/qr-code',
              },
            ],
          }
        : {}),
    };
  }, f.config);
  const order = await service.create(f.account, f.plan);
  assert.equal(order.qr_url, 'https://api.sandbox.midtrans.com/v2/qris/tx-' + id + '/qr-code');
  await db.execute('UPDATE payment_orders SET qr_url=NULL WHERE id=?', [id]);
  await service.reconcile(id);
  assert.equal((await service.order(f.account, id)).qr_url, order.qr_url);
});

test('AI QRIS snapshots selected units, credits and price; repeated settlement only updates AI balance', async () => {
  const f = await fixture();
  let price = 5000;
  class AIPayments extends Payments {
    protected override async aiPrice() {
      return price;
    }
  }
  let id = '';
  const service = new AIPayments(async (_env, _key, _path, body) => {
    if (body) id = (body as any).transaction_details.order_id;
    return {
      order_id: id,
      transaction_id: 'tx-' + id,
      payment_type: 'qris',
      currency: 'IDR',
      gross_amount: '15000.00',
      transaction_status: body ? 'pending' : 'settlement',
      status_code: body ? '201' : '200',
    };
  }, f.config);
  const initial = await basicWallet(f.account);
  const order = await service.create(f.account, 'ai-10000', 'ai', 3);
  assert.equal(order.kind, 'ai');
  assert.equal(order.total, 15000);
  assert.equal(order.credits, 30000);
  assert.equal(order.plan_id, 'ai-10000x3');
  price = 9900;
  await Promise.all([service.reconcile(order.id), service.reconcile(order.id)]);
  const [wallet] = await db.execute<any[]>('SELECT balance FROM ai_wallets WHERE account_id=?', [f.account]);
  assert.equal(wallet[0].balance, 30000);
  assert.deepEqual(await basicWallet(f.account), initial);
  assert.equal((await service.order(f.account, order.id)).total, 15000);
  price = 0;
  await assert.rejects(service.create(f.account, 'ai-10000', 'ai'), { code: 'ai_purchase_unavailable' });
  price = 5000;
  await assert.rejects(service.create(f.account, 'ai-10000', 'ai', 0), { code: 'invalid_request' });
  await assert.rejects(service.create(f.account, 'ai-10000', 'ai', 101), { code: 'invalid_request' });
});
