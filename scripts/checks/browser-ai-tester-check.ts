// Pemeriksaan browser profil Tester AI: strip sesi, Knowledge yang hanya berisi Peran pelanggan (tersimpan otomatis),
// tab sesi tanpa Pesanan Masuk, kartu Data Profil, tampilan ponsel tanpa geser ke samping, dan kanvas AI Studio
// dengan satu node Pelanggan tanpa router.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { ai } from '../../src/components/ai/domain/service.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { setProfileEnabled } from '../../src/components/ai/domain/profiles/registry.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-tester-browser-'));
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
// Setiap halaman mendapat alamat klien sendiri supaya pembatas per IP tidak terpicu selama pemeriksaan.
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
process.env.TRUST_PROXY_HOPS = '1';
let address = 10;
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(
  () => async (_session, update) => {
    update({ status: 'connected' });
    return {
      close() {},
      async logout() {},
      async typing() {},
      async read() {},
      async send() {
        return randomUUID();
      },
    };
  },
  temporary,
);
const server = createApp(gateway).listen(port, '127.0.0.1');
const client = randomUUID(),
  owner = randomUUID(),
  clientToken = randomUUID(),
  ownerToken = randomUUID();
const [before] = await db.query<any[]>("SELECT enabled FROM ai_profile_types WHERE id='tester'");
let browser;
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    client,
    client + '@test.invalid',
    'x',
  ]);
  await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')", [
    owner,
    owner + '@test.invalid',
    'x',
  ]);
  for (const [token, id] of [
    [clientToken, client],
    [ownerToken, owner],
  ])
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
      digest(token),
      id,
    ]);
  await basicWallet(client);
  await setProfileEnabled(owner, 'tester', true);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const open = async (token: string, path: string, width = 1280, height = 900) => {
    const context = await browser!.newContext({
      viewport: { width, height },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.0.2.' + address++ },
    });
    await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => void d.accept());
    await page.goto(origin + path);
    return { page, errors, context };
  };
  {
    const { context } = await open(clientToken, '/dashboard/ai');
    const created = await context.request.post(origin + '/sessions', {
      headers: { Origin: origin },
      data: { id: 'tester-kue' },
    });
    assert.equal(created.status(), 200);
    await context.close();
  }
  const profile = await ai.createDataProfile(client, { profile_type: 'tester', name: 'Ibu pesan kue' });
  await ai.attachProfile(client, 'tester-kue', { data_profile_id: profile.id, enabled: true });
  await mkdir(screenshots, { recursive: true });

  // Sesi: strip menyebut Tester AI; Knowledge hanya Peran pelanggan; tab sesi tanpa Pesanan dan Uji Coba.
  {
    const { page, errors, context } = await open(clientToken, '/dashboard/ai');
    const strip = page.locator('#ai-profile-strip');
    await strip.getByText('Ibu pesan kue').waitFor();
    assert.match(await strip.innerText(), /memakai profil Tester AI/);
    const tabs = await page.locator('[data-ai-tab]:visible').allTextContents();
    // Uji Coba (berisi Uji Pesan) dimiliki setiap sesi; Pesanan Masuk hanya milik CS Usaha.
    for (const tab of ['Knowledge', 'Percakapan', 'Riwayat pemakaian', 'Uji Coba'])
      assert.ok(tabs.includes(tab), tab + ' tampil');
    assert.ok(!tabs.includes('Pesanan Masuk'), 'Pesanan Masuk tidak tampil');
    assert.deepEqual(await page.locator('[data-knowledge-tab]:visible').allTextContents(), ['Peran pelanggan']);
    assert.equal(await page.locator('#ai-behavior-tester-help').isVisible(), true);
    const role = 'Ibu rumah tangga yang mau pesan kue ulang tahun, suka menawar.';
    await page.locator('[form=ai-form][name=behavior]').fill(role);
    for (let i = 0; i < 40 && (await ai.dataProfile(client, profile.id)).behavior !== role; i++)
      await page.waitForTimeout(150);
    assert.equal((await ai.dataProfile(client, profile.id)).behavior, role, 'peran pelanggan tersimpan otomatis');
    assert.equal(await page.locator('#message').textContent(), '', 'tidak ada pesan error');
    await page.locator('#ai-session-detail').screenshot({ path: join(screenshots, 'tester-knowledge.png') });
    // Data Profil: kartu tester tidak menghitung produk atau pesanan.
    await page.locator('[data-ai-view="profiles"]').click();
    const card = page.locator('.ai-profile-card', { hasText: 'Ibu pesan kue' });
    await card.waitFor();
    assert.match(await card.innerText(), /Pelanggan tiruan/);
    assert.doesNotMatch(await card.innerText(), /produk|pesanan/);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Ponsel: tanpa geser ke samping, dan dropdown Knowledge hanya berisi Peran pelanggan.
  {
    const { page, errors, context } = await open(clientToken, '/dashboard/ai', 390, 844);
    await page.locator('#ai-profile-strip').getByText('Ibu pesan kue').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const options = await page
      .locator('#ai-knowledge-select option')
      .evaluateAll(list => list.filter(o => !(o as HTMLOptionElement).hidden).map(o => o.textContent));
    assert.deepEqual(options, ['Peran pelanggan']);
    await page.screenshot({ path: join(screenshots, 'tester-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Pemilik: AI Studio menggambar satu node Pelanggan tanpa router, dengan data simulasi Peran pelanggan.
  {
    const { page, errors, context } = await open(ownerToken, '/dashboard/admin/ai-studio?profile=tester');
    await page.locator('#canvas-profile', { hasText: 'Tester AI' }).waitFor();
    assert.equal(await page.locator('#nodes [data-node="pelanggan"]').count(), 1);
    for (const node of ['router', 'context', 'fallback', 'router_memory'])
      assert.equal(await page.locator(`#nodes [data-node="${node}"]`).count(), 0, node + ' tidak ada');
    assert.equal(await page.evaluate(() => document.getElementById('tester-sandbox')!.hidden), false);
    assert.equal(await page.locator('#node-title').textContent(), 'Pelanggan');
    await page.screenshot({ path: join(screenshots, 'tester-studio.png') });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Tester AI UI: strip, Knowledge Peran pelanggan, tabs, Data Profil card, phone layout and AI Studio passed',
  );
} finally {
  await setProfileEnabled(owner, 'tester', Boolean(before[0]?.enabled)).catch(() => {});
  await browser?.close();
  await gateway.stop();
  await new Promise<void>(r => server.close(() => r()));
  for (const id of [client, owner]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}
