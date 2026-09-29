// Pemeriksaan browser kredit di paket dan beli kredit: form paket pemilik (kolom Kredit AI), harga kredit WhatsApp
// satuan, katalog paket klien, kartu dan dialog beli kredit WhatsApp, serta rincian saldo (kredit paket dipakai lebih
// dulu) di dashboard klien.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-aicredits-browser-'));
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), temporary);
const server = createApp(gateway).listen(port, '127.0.0.1');
const owner = randomUUID(),
  client = randomUUID(),
  planId = 'browser-' + randomUUID().slice(0, 8);
const tokens = { owner: randomUUID(), client: randomUUID() };
let browser;
try {
  for (const [id, role, token] of [
    [owner, 'owner', tokens.owner],
    [client, 'user', tokens.client],
  ] as const) {
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
      role,
    ]);
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
      digest(token),
      id,
    ]);
  }
  await basicWallet(client);
  // Klien punya kredit paket 3.000 (hangus besok) dan kredit hasil beli 500.
  await db.execute(
    'UPDATE ai_wallets SET balance=500,plan_balance=3000,plan_quota=3000,plan_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE account_id=?',
    [client],
  );
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  // Pemilik menyimpan paket dengan kredit AI lewat form.
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ownerContext.addCookies([{ name: 'ncwa_session', value: tokens.owner, url: origin }]);
  const admin = await ownerContext.newPage(),
    errors: string[] = [];
  admin.on('pageerror', e => errors.push(e.message));
  await admin.goto(origin + '/dashboard/admin/plans');
  await admin.locator('[data-open="planform-modal"]').first().click();
  const form = admin.locator('#planform');
  await form.locator('input[name="id"]').fill(planId);
  await form.locator('input[name="name"]').fill('Paket uji AI');
  await form.locator('input[name="price"]').fill('50000');
  await form.locator('input[name="credits"]').fill('1000');
  await form.locator('input[name="ai_credits"]').fill('25000');
  await form.locator('input[name="session_limit"]').fill('3');
  await form.locator('input[name="max_share_assets"]').fill('10');
  await form.locator('input[name="max_share_storage_mb"]').fill('50');
  await form.getByRole('button', { name: 'Simpan paket' }).click();
  const row = admin.locator('#plans tr', { hasText: 'Paket uji AI' });
  await row.waitFor();
  assert.match(await row.innerText(), /25000/);
  const [saved] = await db.execute<any[]>('SELECT ai_credits FROM plans WHERE id=?', [planId]);
  assert.equal(saved[0].ai_credits, 25000);
  // Pemilik menetapkan harga beli 100 kredit WhatsApp; nilainya tersimpan.
  await admin.locator('#wa-credit-price-form input[name="wa_credit_price"]').fill('4000');
  await admin.locator('#wa-credit-price-form').getByRole('button', { name: 'Simpan harga' }).click();
  await admin.locator('#message', { hasText: 'Harga kredit WhatsApp tersimpan' }).waitFor();
  const [priceRow] = await db.execute<any[]>('SELECT wa_credit_price FROM billing_settings WHERE id=1');
  assert.equal(priceRow[0].wa_credit_price, 4000);
  await db.execute('UPDATE wallets SET purchased=40 WHERE account_id=?', [client]);
  // Klien melihat rincian saldo AI dan kredit AI di katalog paket.
  const clientContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await clientContext.addCookies([{ name: 'ncwa_session', value: tokens.client, url: origin }]);
  const page = await clientContext.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/dashboard/ai');
  await page.locator('#ai-balance', { hasText: '3500 kredit' }).waitFor();
  assert.equal(await page.locator('#ai-balance-label').textContent(), 'Kredit AI · paket 3000');
  assert.match((await page.locator('#ai-balance').locator('..').getAttribute('title')) ?? '', /hasil beli 500/);
  await page.goto(origin + '/dashboard/paket');
  const card = page.locator('#catalog article', { hasText: 'Paket uji AI' });
  await card.waitFor();
  assert.match(await card.innerText(), /25\.000 kredit AI per bulan/);
  assert.match(await card.innerText(), /1\.000 kredit WhatsApp per bulan/);
  // Kartu beli kredit WhatsApp: harga tampil dan dialog menghitung total.
  const wa = page.locator('#catalog article', { hasText: 'Kredit WhatsApp' }).first();
  assert.match(await wa.innerText(), /Rp\s?4\.000 per 100 kredit/);
  await page.locator('#wa-buy').click();
  await page.locator('#wa-credit-units').fill('3');
  assert.match(await page.locator('#wa-credit-summary').innerText(), /300 kredit WhatsApp · Rp\s?12\.000/);
  await page.locator('#wa-credit-units').fill('0');
  assert.equal(await page.locator('#wa-credit-confirm').isDisabled(), true);
  await page.locator('#wa-credit-modal').getByRole('button', { name: 'Tutup' }).click();
  await page.goto(origin + '/dashboard/ai');
  await page.locator('#wa-balance').waitFor();
  await page.waitForFunction(() => document.getElementById('wa-balance')!.parentElement!.title.includes('hasil beli'));
  assert.match((await page.locator('#wa-balance').locator('..').getAttribute('title')) ?? '', /hasil beli 40/);
  assert.deepEqual(errors, []);
  console.log('Pemeriksaan browser kredit AI paket lulus.');
} finally {
  await browser?.close();
  server.close();
  await gateway.stop();
  await db.execute('DELETE FROM plans WHERE id=?', [planId]);
  await db.execute('UPDATE billing_settings SET wa_credit_price=0 WHERE id=1');
  for (const id of [owner, client]) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}
