// Pemeriksaan browser Instagram DM lewat Zernio di /dashboard/ai: dialog Tambah sesi dengan pilihan Instagram,
// menambah akun Zernio, alur login Instagram sampai kembali ke dashboard dengan pesan hasil, kartu sesi Instagram,
// dan tata letak ponsel. Zernio dan halaman login Instagram adalah server tiruan.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-instagram-browser-'));
async function freePort() {
  const slot = net.createServer();
  await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
  const port = (slot.address() as net.AddressInfo).port;
  await new Promise<void>(r => slot.close(() => r()));
  return port;
}
const port = await freePort(),
  zernioPort = await freePort();
const origin = 'http://127.0.0.1:' + port,
  zernioOrigin = 'http://127.0.0.1:' + zernioPort;
process.env.APP_ORIGIN = origin;
process.env.ZERNIO_API_URL = zernioOrigin + '/api';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'b'.repeat(64);
// Zernio tiruan. Halaman /oauth berperan sebagai login Instagram: langsung mengalihkan balik ke NC-WA.
let redirect = '';
const zernio = createServer(async (req, res) => {
  const url = new URL(req.url!, zernioOrigin);
  const json = (data: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  for await (const _ of req);
  if (url.pathname === '/oauth') {
    const back = new URL(redirect);
    back.searchParams.set('connected', 'instagram');
    back.searchParams.set('accountId', 'igacc1');
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }
  if (req.headers.authorization !== 'Bearer sk_browser_check_1') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Unauthorized"}');
  }
  const route = req.method + ' ' + url.pathname;
  if (route === 'GET /api/v1/profiles') return json({ profiles: [{ _id: 'prof1', name: 'NC-WA' }] });
  if (route === 'POST /api/v1/webhooks/settings') return json({ success: true, webhook: { _id: 'wh1' } });
  if (route === 'GET /api/v1/connect/instagram') {
    redirect = url.searchParams.get('redirect_url')!;
    return json({ authUrl: zernioOrigin + '/oauth' });
  }
  if (route === 'GET /api/v1/accounts')
    return json({ accounts: [{ _id: 'igacc1', platform: 'instagram', username: 'kopisenja.id', profileId: 'prof1' }] });
  res.writeHead(404);
  res.end();
});
await new Promise<void>(r => zernio.listen(zernioPort, '127.0.0.1', r));
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(
  () => async (_session, update) => {
    update({ status: 'connected', phone: '628111111111' });
    return { close() {}, async logout() {} };
  },
  temporary,
);
const server = createApp(gateway).listen(port, '127.0.0.1');
const account = randomUUID(),
  token = randomUUID();
let browser;
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    account,
    account + '@test.invalid',
    'unused',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(token),
    account,
  ]);
  await basicWallet(account);
  await db.execute('UPDATE wallets SET session_limit=3 WHERE account_id=?', [account]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // Kartu "+ Tambah sesi" hanya membuka dialog saat berada di tengah carousel; digeser dulu bila perlu.
  const openAddSession = async () => {
    await page.locator('.ai-session-card.ai-session-depth-0').waitFor();
    const add = page.locator('.ai-session-card.placeholder-add.ai-session-depth-0');
    for (let i = 0; i < 8 && !(await add.count()); i++) {
      await page.locator('#ai-session-next').click();
      await page.waitForTimeout(300);
    }
    await add.click();
    await page.locator('#addconnection').waitFor({ state: 'visible' });
  };
  await page.goto(origin + '/dashboard/ai');
  await openAddSession();
  const dialog = page.locator('#addconnection');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#session-instagram').isVisible(), false);
  await dialog.getByText('Instagram DM', { exact: true }).click();
  await page.locator('#session-zernio-empty').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#session-submit').textContent(), 'Hubungkan Instagram');
  await mkdir(screenshots, { recursive: true });
  await dialog.screenshot({ path: join(screenshots, 'instagram-add-session.png') });
  // Menambah akun Zernio dari dialog, lalu kembali memilihnya di Tambah sesi.
  await dialog.getByText('Kelola akun Zernio').click();
  const zernioDialog = page.locator('#zernio-dialog');
  await zernioDialog.waitFor({ state: 'visible' });
  await zernioDialog.locator('input[name="name"]').fill('Pusat');
  await zernioDialog.locator('input[name="apiKey"]').fill('sk_browser_check_1');
  await zernioDialog.getByRole('button', { name: 'Simpan & periksa' }).click();
  await zernioDialog.locator('#zernio-list li').filter({ hasText: 'Pusat' }).waitFor();
  assert.match(await zernioDialog.locator('#zernio-list').innerText(), /Terhubung/);
  assert.equal((await zernioDialog.locator('#zernio-list').innerText()).includes('sk_browser'), false);
  await zernioDialog.screenshot({ path: join(screenshots, 'instagram-zernio-accounts.png') });
  await zernioDialog.getByRole('button', { name: 'Tutup' }).click();
  assert.equal(
    await page.locator('#session-zernio').inputValue(),
    await page.locator('#session-zernio option').nth(1).getAttribute('value'),
  );
  await dialog.locator('input[name="id"]').fill('ig-shop');
  // Login Instagram tiruan mengalihkan balik; pesan hasil tampil di dashboard dan kartu sesi Instagram muncul.
  await Promise.all([
    page.waitForURL(origin + '/dashboard/ai'),
    dialog.getByRole('button', { name: 'Hubungkan Instagram' }).click(),
  ]);
  await page.locator('#message').filter({ hasText: '@kopisenja.id terhubung sebagai sesi ig-shop' }).waitFor();
  const card = page.locator('.ai-session-card.selected').filter({ hasText: 'ig-shop' });
  await card.waitFor();
  assert.match(await card.innerText(), /@kopisenja\.id · Instagram/);
  await page.screenshot({ path: join(screenshots, 'instagram-connected-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAddSession();
  await dialog.getByText('Instagram DM', { exact: true }).click();
  await page.locator('#session-instagram').waitFor({ state: 'visible' });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390, 'Tidak boleh ada gulir horizontal di ponsel: ' + width);
  await page.screenshot({ path: join(screenshots, 'instagram-add-session-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('Pemeriksaan browser Instagram lulus. Screenshot di ' + screenshots);
} finally {
  await browser?.close();
  server.close();
  zernio.close();
  await gateway.stop();
  await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}
