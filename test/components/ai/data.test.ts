// Tes data CS Usaha: produk dan pesanan bawaan, sumber endpoint milik klien, idempotensi pesanan, dan migrasi
// status pesanan.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../../src/libraries/db.js';
import {
  AIData,
  source,
  sourceInput,
  endpointUrl,
  callEndpoint,
  orderInput,
  productForAI,
  type Product,
} from '../../../src/components/ai/domain/profiles/cs/store.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import type { ToolContext } from '../../../src/components/ai/domain/pipeline/runner.js';
import { decrypt } from '../../../src/libraries/crypto.js';
import { digest } from '../../../src/libraries/security.js';
const accounts: string[] = [];
const assistant = new AIService();
const product: Product = {
  name: 'Produk A',
  type: 'product',
  description: 'Produk ringan',
  price: 125000,
  stock: 10,
  active: true,
  image_id: null,
};
const input = { items: [{ product_name: 'Produk A', quantity: 2 }], notes: 'Tolong siapkan' };
// Setiap akun fixture menjalankan sesi 'shop' dengan data profil CS sendiri, tempat produk dan pesanannya disimpan.
async function fixture(): Promise<ToolContext> {
  const account = randomUUID();
  accounts.push(account);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    account,
    account + '@test.invalid',
    'unused',
  ]);
  return {
    account,
    profile: await assistant.ensureSessionProfile(account, 'shop'),
    session: 'shop',
    customer: '628123456789',
    requestId: 'request-1',
    knowledge: 'Knowledge ' + account,
    behavior: 'Ramah',
  };
}
async function configure(scope: ToolContext, products: unknown, orders: unknown) {
  return assistant.saveAssistant(scope.account, scope.session, {
    enabled: true,
    profile: { faq: scope.knowledge },
    behavior: scope.behavior,
    products_source: products,
    orders_source: orders,
  });
}
after(async () => {
  for (const id of accounts) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  await db.end();
});

test('Built-in product and order tables isolate tenant, data profile and customer; preserve price snapshots and status', async () => {
  const a = await fixture(),
    b = await fixture(),
    data = new AIData(),
    elsewhere = {
      ...a,
      profile: (await assistant.createDataProfile(a.account, { profile_type: 'cs', name: 'Lain' })).id,
    };
  await data.saveProduct(a.account, a.profile, '', product);
  await data.saveProduct(b.account, b.profile, '', { ...product, name: 'Produk B', price: 70000 });
  assert.equal((await data.catalog(a, ''))[0].name, 'Produk A');
  assert.equal((await data.catalog(b, ''))[0].name, 'Produk B');
  assert.deepEqual(await data.catalog(elsewhere, ''), []);
  const result = (await data.execute('create_order', JSON.stringify(input), a)) as any;
  assert.equal(result.order.total, 250000);
  assert.equal(result.order.customer, a.customer);
  assert.equal(result.order.status, 'Pesanan masuk');
  assert.equal((await data.order(a.account, a.profile, result.order.id))?.status, 'pesanan_masuk');
  await data.saveProduct(a.account, a.profile, product.name, { ...product, price: 200000 });
  assert.equal((await new AIData().order(a.account, a.profile, result.order.id, a.customer))?.total, 250000);
  for (const scope of [b, elsewhere, { ...a, customer: '628999999999' }])
    assert.deepEqual(await data.execute('check_order', result.order.id, scope), { order: null });
  await assert.rejects(data.updateOrder(b.account, b.profile, result.order.id, { status: 'selesai' }), {
    code: 'not_found',
  });
  await data.updateOrder(a.account, a.profile, result.order.id, { status: 'diproses', notes: 'Dikerjakan admin' });
  assert.equal(((await data.execute('check_order', result.order.id, a)) as any).order.status, 'Diproses');
});

test('Concurrent order creation is idempotent across restart and rejects conflicting payloads', async () => {
  const scope = await fixture(),
    data = new AIData();
  await data.saveProduct(scope.account, scope.profile, '', product);
  const orders = await Promise.all(Array.from({ length: 4 }, () => data.createOrder(scope, input)));
  assert.equal(new Set(orders.map(o => o.id)).size, 1);
  await data.saveProduct(scope.account, scope.profile, product.name, { ...product, price: 99, active: false });
  assert.deepEqual(await new AIData().createOrder(scope, input), orders[0]);
  assert.equal((await data.orders(scope.account, scope.profile)).length, 1);
  await assert.rejects(data.createOrder(scope, { ...input, notes: 'Changed' }), { code: 'idempotency_conflict' });
  await assert.rejects(data.createOrder({ ...scope, customer: '628999999999' }, input), {
    code: 'idempotency_conflict',
  });
  await assert.rejects(data.createOrder({ ...scope, requestId: 'new' }, input), { code: 'invalid_request' });
});

test('Product validation, insufficient stock and forged order prices or customer are rejected', async () => {
  const scope = await fixture(),
    data = new AIData();
  for (const p of [
    { ...product, price: -1 },
    { ...product, stock: 1.5 },
    { ...product, active: 'yes' },
    { ...product, name: '' },
  ])
    await assert.rejects(data.saveProduct(scope.account, scope.profile, '', p), { code: 'invalid_request' });
  await data.saveProduct(scope.account, scope.profile, '', product);
  for (const o of [
    { ...input, customer: '628999999999' },
    { items: [{ product_name: 'Produk A', quantity: 1, price: 1 }] },
    { items: [{ product_name: 'Produk A', quantity: 0 }] },
    {
      items: [
        { product_name: 'Produk A', quantity: 1 },
        { product_name: 'Produk A', quantity: 1 },
      ],
    },
  ])
    assert.throws(() => orderInput(o), { code: 'invalid_request' });
  await assert.rejects(
    data.execute('create_order', JSON.stringify({ items: [{ product_name: 'Produk A', quantity: 11 }] }), scope),
    { code: 'invalid_request' },
  );
  assert.equal((await data.orders(scope.account, scope.profile)).length, 0);
});

test('Independent endpoint sources keep encrypted tokens private and preserve built-in data', async () => {
  const scope = await fixture(),
    other = await fixture(),
    data = new AIData();
  await data.saveProduct(scope.account, scope.profile, '', product);
  const config = await configure(
    scope,
    { mode: 'endpoint', endpoint: 'https://8.8.8.8/products', token: 'private-token' },
    { mode: 'builtin' },
  );
  assert.equal(config.products_source.has_token, true);
  assert.equal(config.orders_source.mode, 'builtin');
  assert.ok(!JSON.stringify(config).includes('private-token'));
  assert.ok(!JSON.stringify(config).includes('secret'));
  const saved = await source(scope.account, scope.profile, 'products');
  assert.notEqual(saved.secret, 'private-token');
  assert.equal(decrypt(saved.secret), 'private-token');
  assert.equal((await assistant.assistant(other.account, other.session)).products_source.mode, 'builtin');
  await configure(scope, { mode: 'endpoint', endpoint: 'https://8.8.8.8/products', token: '' }, { mode: 'builtin' });
  assert.equal((await source(scope.account, scope.profile, 'products')).secret, saved.secret);
  await configure(scope, { mode: 'endpoint', endpoint: 'https://8.8.8.8/other', token: '' }, { mode: 'builtin' });
  assert.equal((await source(scope.account, scope.profile, 'products')).secret, '');
  await configure(scope, { mode: 'builtin' }, { mode: 'builtin' });
  assert.equal((await data.catalog(scope, ''))[0].name, product.name);
});

test('Custom products and built-in orders work together with the same normalized tool results', async () => {
  const scope = await fixture();
  await configure(
    scope,
    { mode: 'endpoint', endpoint: 'https://8.8.8.8/products', token: 'fixture' },
    { mode: 'builtin' },
  );
  let calls = 0;
  const data = new AIData(async (config, payload, key) => {
    calls++;
    assert.equal(config.endpoint, 'https://8.8.8.8/products');
    assert.equal(decrypt(config.secret), 'fixture');
    assert.equal(payload.action, 'get_products');
    assert.deepEqual(payload.context, {
      account_id: scope.account,
      data_profile_id: scope.profile,
      session_id: scope.session,
      customer: scope.customer,
      request_id: scope.requestId,
    });
    assert.equal(
      key,
      digest(
        JSON.stringify([scope.account, scope.session, scope.customer, scope.requestId, 'get_products', payload.query]),
      ),
    );
    return { products: [product] };
  });
  assert.deepEqual(await data.execute('get_products', '', scope), { products: [productForAI(product)] });
  const created = (await data.execute('create_order', JSON.stringify(input), scope)) as any;
  assert.equal(created.order.total, 250000);
  assert.equal((await data.orders(scope.account, scope.profile)).length, 1);
  assert.equal(calls, 2);
});

test('Built-in products and custom orders route independently, validate customer and pass priced items', async () => {
  const scope = await fixture();
  await configure(scope, { mode: 'builtin' }, { mode: 'endpoint', endpoint: 'https://8.8.8.8/orders' });
  const order = {
    id: 'EXT-1',
    customer: scope.customer,
    items: [{ product_name: product.name, quantity: 2, price: product.price }],
    total: 250000,
    status: 'pesanan_masuk',
    notes: input.notes,
  };
  const actions: string[] = [];
  const data = new AIData(async (config, payload) => {
    assert.equal(config.endpoint, 'https://8.8.8.8/orders');
    actions.push(String(payload.action));
    if (payload.action === 'create_order') assert.deepEqual(payload.query, { ...input, items: order.items });
    return { order };
  });
  await data.saveProduct(scope.account, scope.profile, '', product);
  assert.deepEqual(await data.execute('create_order', JSON.stringify(input), scope), {
    order: { ...order, status: 'Pesanan masuk' },
  });
  assert.deepEqual(await data.execute('check_order', 'EXT-1', scope), { order: { ...order, status: 'Pesanan masuk' } });
  assert.deepEqual(actions, ['create_order', 'check_order']);
  assert.deepEqual(await data.orders(scope.account, scope.profile), []);
  // Status lama "baru" tidak lagi valid, termasuk dari endpoint klien.
  for (const bad of [
    { ...order, customer: '628999999999' },
    { ...order, id: 'wrong' },
    { ...order, total: 1 },
    { ...order, status: 'baru' },
  ])
    await assert.rejects(new AIData(async () => ({ order: bad })).execute('check_order', 'EXT-1', scope));
  await assert.rejects(
    new AIData(async () => {
      throw Error('endpoint_timeout');
    }).execute('check_order', 'EXT-1', scope),
    /endpoint_timeout/,
  );
});

test('send_product_image reports availability without ever dispatching WhatsApp itself', async () => {
  const scope = await fixture(),
    data = new AIData();
  await data.saveProduct(scope.account, scope.profile, '', product);
  assert.deepEqual(await data.execute('send_product_image', product.name, scope), {
    available: false,
    reason: 'Produk tidak ditemukan atau belum memiliki foto',
  });
  const photo = randomUUID();
  await db.execute('INSERT INTO ai_product_images(id,account_id,data_profile_id,size_bytes) VALUES (?,?,?,1)', [
    photo,
    scope.account,
    scope.profile,
  ]);
  await data.saveProduct(scope.account, scope.profile, product.name, { ...product, image_id: photo });
  assert.deepEqual(await data.execute('send_product_image', product.name, scope), {
    available: true,
    product_name: product.name,
    image_id: photo,
  });
  assert.deepEqual(await data.execute('send_product_image', 'Produk tidak ada', scope), {
    available: false,
    reason: 'Produk tidak ditemukan atau belum memiliki foto',
  });
});

test('SSRF URLs, unsupported endpoint data and credentials in URLs are rejected', async () => {
  for (const url of [
    'http://8.8.8.8/api',
    'https://127.0.0.1/api',
    'https://10.0.0.1/api',
    'https://[::1]/api',
    'https://user:secret@8.8.8.8/api',
    'https://8.8.8.8/api?key=secret',
  ])
    await assert.rejects(endpointUrl(url));
  await assert.rejects(callEndpoint({ mode: 'endpoint', endpoint: 'https://127.0.0.1', secret: '' }, {}, 'test'));
  await assert.rejects(sourceInput({ mode: 'endpoint', endpoint: 'https://8.8.8.8/api', token: 'x\r\ny' }));
  const scope = await fixture();
  await configure(scope, { mode: 'endpoint', endpoint: 'https://8.8.8.8/products' }, { mode: 'builtin' });
  for (const data of [
    { products: 'wrong' },
    { products: [{ ...product, price: -1 }] },
    { products: [product, product] },
  ])
    await assert.rejects(new AIData(async () => data).catalog(scope, ''));
});

test('Authenticated product/order APIs enforce ownership, CSRF and immutable order amounts', async () => {
  const a = await fixture(),
    b = await fixture(),
    root = await mkdtemp(join(tmpdir(), 'ncwa-data-test-'));
  const { createGateway } = await import('../../../src/http/gateway.js'),
    { createApp } = await import('../../../src/http/app.js');
  const gateway = createGateway(
    () => async (_id, update) => {
      update({ status: 'connected' });
      return { close() {}, async logout() {} };
    },
    root,
  );
  const app = createApp(gateway),
    origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
  const tokens = [randomUUID(), randomUUID()];
  try {
    for (const [index, scope] of [a, b].entries()) {
      await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
        digest(tokens[index]),
        scope.account,
      ]);
      await request(app)
        .post('/sessions')
        .set('Cookie', 'ncwa_session=' + tokens[index])
        .set('Origin', origin)
        .send({ id: 'shop' })
        .expect(200);
    }
    const cookie = 'ncwa_session=' + tokens[0],
      other = 'ncwa_session=' + tokens[1],
      base = '/sessions/shop/ai';
    await request(app)
      .post(base + '/products')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ ...product, account_id: b.account })
      .expect(200);
    assert.deepEqual(
      (
        await request(app)
          .get(base + '/products')
          .set('Cookie', other)
          .expect(200)
      ).body,
      [],
    );
    await request(app)
      .put(base + '/products/' + encodeURIComponent(product.name))
      .set('Cookie', cookie)
      .send(product)
      .expect(403);
    await request(app).get('/sessions/missing/ai/products').set('Cookie', cookie).expect(404);
    const created = await request(app)
      .post(base + '/orders')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', 'manual-test')
      .send({ ...input, customer: a.customer, account_id: b.account, total: 1 })
      .expect(200);
    assert.equal(created.body.total, 250000);
    await request(app)
      .put(base + '/orders/' + created.body.id)
      .set('Cookie', other)
      .set('Origin', origin)
      .send({ status: 'selesai' })
      .expect(404);
    await request(app)
      .put(base + '/orders/' + created.body.id)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ status: 'diproses', notes: 'Siap', total: 1, customer: b.customer })
      .expect(200);
    const order = (
      await request(app)
        .get(base + '/orders')
        .set('Cookie', cookie)
        .expect(200)
    ).body[0];
    assert.equal(order.total, 250000);
    assert.equal(order.customer, a.customer);
    assert.equal(order.status, 'diproses');
    assert.deepEqual(
      (
        await request(app)
          .get(base + '/orders')
          .set('Cookie', other)
          .expect(200)
      ).body,
      [],
    );
    const sharp = (await import('sharp')).default;
    const pngFixture = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 5, g: 6, b: 7 } } })
      .png()
      .toBuffer();
    const uploaded = await request(app)
      .post(base + '/products-image')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-Filename', 'photo.png')
      .set('Content-Type', 'application/octet-stream')
      .send(pngFixture)
      .expect(200);
    assert.ok(uploaded.body.id);
    await request(app)
      .get(base + '/products-image/' + uploaded.body.id)
      .set('Cookie', cookie)
      .expect(200)
      .expect('Content-Type', 'image/jpeg');
    await request(app)
      .get(base + '/products-image/' + uploaded.body.id)
      .set('Cookie', other)
      .expect(404);
  } finally {
    await gateway.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('AI sees whether a product has a photo, never the internal image id', () => {
  const base: Product = {
    name: 'Kopi Susu',
    type: 'product',
    description: '',
    price: 18000,
    stock: 20,
    active: true,
    image_id: null,
  };
  assert.deepEqual(productForAI(base), {
    name: 'Kopi Susu',
    type: 'product',
    description: '',
    price: 18000,
    stock: 20,
    active: true,
    ada_foto: false,
  });
  const withPhoto = productForAI({ ...base, image_id: 'a'.repeat(32) });
  assert.equal(withPhoto.ada_foto, true);
  assert.equal('image_id' in withPhoto, false);
});
test('Deleting an order is scoped to its tenant and data profile', async () => {
  const a = await fixture(),
    b = await fixture(),
    data = new AIData(),
    elsewhere = (await assistant.createDataProfile(a.account, { profile_type: 'cs', name: 'Lain' })).id;
  await data.saveProduct(a.account, a.profile, '', product);
  const { order } = (await data.execute('create_order', JSON.stringify(input), a)) as any;
  for (const [account, profile] of [
    [b.account, a.profile],
    [a.account, elsewhere],
  ])
    await assert.rejects(data.deleteOrder(account, profile, order.id), { code: 'not_found' });
  assert.deepEqual(await data.deleteOrder(a.account, a.profile, order.id), { ok: true });
  assert.deepEqual(await data.orders(a.account, a.profile), []);
  assert.equal(await data.order(a.account, a.profile, order.id), null);
  await assert.rejects(data.deleteOrder(a.account, a.profile, order.id), { code: 'not_found' });
  // Stok tidak pernah dipesan oleh pesanan, jadi tidak berubah setelah pesanan dihapus.
  assert.equal((await data.catalog(a, ''))[0].stock, product.stock);
});
test('Orders can be marked paid, and migrating the old status enum renames baru to pesanan_masuk', async () => {
  const { migrateAI } = await import('../../../src/components/ai/data-access/schema.js');
  const a = await fixture(),
    data = new AIData();
  await data.saveProduct(a.account, a.profile, '', product);
  const first = ((await data.execute('create_order', JSON.stringify(input), a)) as any).order;
  const second = (
    (await data.execute('create_order', JSON.stringify({ ...input, notes: 'Kedua' }), {
      ...a,
      requestId: 'request-2',
    })) as any
  ).order;
  // Membuat ulang bentuk tabel sebelum perubahan ini: "baru" alih-alih "pesanan_masuk" dan tanpa "dibayar".
  await db.query(
    "ALTER TABLE ai_orders MODIFY status ENUM('baru','pesanan_masuk','diproses','selesai','dibatalkan') NOT NULL DEFAULT 'baru'",
  );
  // Semua baris harus muat di enum lama, termasuk pesanan sisa tes sebelumnya di database ini.
  await db.query("UPDATE ai_orders SET status='baru' WHERE status IN ('pesanan_masuk','dibayar')");
  await db.execute("UPDATE ai_orders SET status='diproses' WHERE account_id=? AND id=?", [a.account, second.id]);
  await db.query(
    "ALTER TABLE ai_orders MODIFY status ENUM('baru','diproses','selesai','dibatalkan') NOT NULL DEFAULT 'baru'",
  );
  await migrateAI();
  await migrateAI();
  const [column] = await db.execute<any[]>(
    "SELECT COLUMN_TYPE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_orders' AND COLUMN_NAME='status'",
  );
  assert.equal(column[0].COLUMN_TYPE, "enum('pesanan_masuk','dibayar','diproses','selesai','dibatalkan')");
  assert.match(String(column[0].COLUMN_DEFAULT), /pesanan_masuk/);
  assert.equal((await data.order(a.account, a.profile, first.id))?.status, 'pesanan_masuk');
  assert.equal((await data.order(a.account, a.profile, second.id))?.status, 'diproses');
  await data.updateOrder(a.account, a.profile, first.id, { status: 'dibayar', notes: 'Transfer diterima' });
  assert.equal((await data.order(a.account, a.profile, first.id))?.status, 'dibayar');
  for (const status of ['baru', 'lunas'])
    await assert.rejects(data.updateOrder(a.account, a.profile, first.id, { status }), { code: 'invalid_request' });
});
test('Terstruktur tier: every provider profile and route carries it, runtime uses it, and migration copies it from Murah', async () => {
  const { migrateAI } = await import('../../../src/components/ai/data-access/schema.js');
  const { encrypt } = await import('../../../src/libraries/crypto.js');
  const [settings] = await db.query<any[]>('SELECT id FROM ai_settings WHERE id=1'),
    createdSettings = !settings.length;
  if (createdSettings)
    await db.execute(
      "INSERT INTO ai_settings(id,endpoint,model,secret) VALUES (1,'https://openrouter.ai/api/v1/chat/completions','legacy',?)",
      [encrypt('legacy-key')],
    );
  try {
    const base = {
      name: 'OpenRouter uji',
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'key-1',
      model_cheap: 'm-cheap',
      model_medium: 'm-medium',
      model_smart: 'm-smart',
    };
    await assert.rejects(assistant.saveProviderProfile(base), { code: 'invalid_request' });
    const { id } = await assistant.saveProviderProfile({
      ...base,
      model_structured: 'm-structured',
      model_decision: 'm-decision',
    });
    assert.equal(
      (await assistant.providerProfiles()).profiles.find((p: any) => p.id === id)?.model_structured,
      'm-structured',
    );
    const routes = { cheap: { profileId: id }, medium: { profileId: id }, smart: { profileId: id } };
    await assert.rejects(assistant.setProviderRoutes(routes), { code: 'invalid_request' });
    await assert.rejects(assistant.setProviderRoutes({ ...routes, structured: { profileId: id } }), {
      code: 'invalid_request',
    });
    await assistant.setProviderRoutes({
      ...routes,
      structured: { profileId: id },
      decision: { profileId: id },
    });
    const config = await assistant.config();
    assert.equal(config.tier_profiles?.structured?.model, 'm-structured');
    assert.equal(config.tier_profiles?.decision?.model, 'm-decision');
    assert.equal(config.tier_profiles?.cheap?.model, 'm-cheap');
    // Kode baru berjalan sebelum `npm run migrate`: kolom dan rutenya belum ada. Routing harus tetap memakai profil untuk
    // setiap tier, dan Terstruktur memakai Murah alih-alih seluruh konfigurasi kembali ke cara lama.
    await db.query("DELETE FROM ai_provider_routes WHERE tier='structured'");
    await db.query('ALTER TABLE ai_provider_profiles DROP COLUMN model_structured');
    const early = await assistant.config();
    assert.deepEqual(
      [
        early.tier_profiles?.cheap?.model,
        early.tier_profiles?.medium?.model,
        early.tier_profiles?.smart?.model,
        early.tier_profiles?.structured?.model,
      ],
      ['m-cheap', 'm-medium', 'm-smart', 'm-cheap'],
    );
    assert.equal(early.tier_profiles?.structured?.id, id);
    const listed = (await assistant.providerProfiles()).profiles;
    assert.deepEqual(
      listed.map((p: any) => p.id),
      [id],
    );
    assert.equal('secret' in listed[0], false);
    await migrateAI();
    // Database dari sebelum tier ini ada: belum ada model terstruktur di profil dan belum ada rute terstruktur.
    await db.execute("UPDATE ai_provider_profiles SET model_structured='' WHERE id=?", [id]);
    await db.query("DELETE FROM ai_provider_routes WHERE tier='structured'");
    await db.query('UPDATE ai_settings SET model_structured=NULL WHERE id=1');
    await migrateAI();
    await migrateAI();
    const [route] = await db.query<any[]>("SELECT profile_id,model FROM ai_provider_routes WHERE tier='structured'");
    assert.deepEqual({ ...route[0] }, { profile_id: id, model: 'm-cheap' });
    assert.equal(
      (await assistant.providerProfiles()).profiles.find((p: any) => p.id === id)?.model_structured,
      'm-cheap',
    );
    assert.equal((await assistant.config()).tier_profiles?.structured?.model, 'm-cheap');
    // Simulasikan data sebelum tier Keputusan ada; migrasi harus menyalin model dan rute Murah.
    await db.execute("UPDATE ai_provider_profiles SET model_decision='' WHERE id=?", [id]);
    await db.query("DELETE FROM ai_provider_routes WHERE tier='decision'");
    await db.query('UPDATE ai_settings SET model_decision=NULL WHERE id=1');
    await migrateAI();
    const [decisionRoute] = await db.query<any[]>(
      "SELECT profile_id,model FROM ai_provider_routes WHERE tier='decision'",
    );
    assert.deepEqual({ ...decisionRoute[0] }, { profile_id: id, model: 'm-cheap' });
    assert.equal((await assistant.config()).tier_profiles?.decision?.model, 'm-cheap');
  } finally {
    // Routing bersifat global; tes berikutnya dibiarkan dengan konfigurasi tanpa rute yang diharapkannya.
    await db.query('DELETE FROM ai_provider_routes');
    await db.query('DELETE FROM ai_provider_profiles');
    if (createdSettings) await db.query('DELETE FROM ai_settings WHERE id=1');
    else await db.query('UPDATE ai_settings SET profile_routing_enabled=FALSE WHERE id=1');
  }
});
