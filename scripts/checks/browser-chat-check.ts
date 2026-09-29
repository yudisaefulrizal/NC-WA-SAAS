// Pemeriksaan browser halaman Chat (/dashboard/chat): kotak masuk gabungan sesi WhatsApp dan Instagram, label sesi
// dan ikon platform, filter sesi, baris "Masuk lewat", balas manual dari sesi asal, dan tata letak ponsel.
// WhatsApp dan Zernio adalah tiruan.
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
import { ai } from '../../src/components/ai/domain/service.js';
import { createGateway } from '../../src/http/gateway.js';
import { recordIncoming } from '../../src/components/ai/domain/chat.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import type { Update } from '../../src/components/whatsapp/domain/sessions.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-chat-browser-'));
async function freePort() {
  const slot = net.createServer();
  await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
  const port = (slot.address() as net.AddressInfo).port;
  await new Promise<void>(r => slot.close(() => r()));
  return port;
}
const port = await freePort(),
  zernioPort = await freePort();
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
process.env.ZERNIO_API_URL = 'http://127.0.0.1:' + zernioPort + '/api';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'd'.repeat(64);
const sentInstagram: { recipient: string; text: string }[] = [];
const zernio = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const url = new URL(req.url!, 'http://zernio.test');
  const route = req.method + ' ' + url.pathname;
  const json = (data: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (route === 'GET /api/v1/profiles') return json({ profiles: [{ _id: 'prof1', name: 'Default', isDefault: true }] });
  if (route === 'POST /api/v1/webhooks/settings') return json({ success: true, webhook: { _id: 'wh1' } });
  if (route === 'GET /api/v1/accounts')
    return json({ accounts: [{ _id: 'igacc1', platform: 'instagram', username: 'kopisenja.id', isActive: true }] });
  const send = url.pathname.match(/^\/api\/v1\/inbox\/conversations\/([^/]+)\/messages$/);
  if (req.method === 'POST' && send) {
    sentInstagram.push({ recipient: send[1], text: JSON.parse(raw).message });
    return json({ success: true, data: { messageId: 'mid.' + sentInstagram.length } });
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>(r => zernio.listen(zernioPort, '127.0.0.1', r));
const { createApp } = await import('../../src/http/app.js');
let sequence = 0;
const sentWhatsapp: string[] = [];
const whatsapp = new Map<string, (event: Update) => void>();
const gateway = createGateway(
  account => async (session, update) => {
    whatsapp.set(session, update);
    update({ status: 'connected', phone: '628123456789' });
    return {
      close() {},
      async logout() {},
      async send(jid) {
        sentWhatsapp.push(jid);
        const id = 'OUT' + ++sequence;
        await ai.registerSystemMessage(account, session, id);
        return id;
      },
    };
  },
  temporary,
);
const server = createApp(gateway).listen(port, '127.0.0.1');
const account = randomUUID(),
  token = randomUUID(),
  igCustomer = '17841400000000001';
const text = (messageId: string, body: string, from: string) => ({
  messageId,
  text: body,
  from,
  sender: from,
  isGroup: false,
  groupId: null,
  type: 'text' as const,
  timestamp: 1,
});
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
  await db.execute('UPDATE wallets SET session_limit=5 WHERE account_id=?', [account]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
  const post = (path: string, data: unknown) =>
    context.request.post(origin + path, { headers: { Origin: origin }, data });
  assert.equal((await post('/sessions', { id: 'toko-utama' })).status(), 200);
  const zernioId = (await (await post('/api/instagram/zernio', { name: 'Pusat', apiKey: 'sk_chat_check_12' })).json())
    .id;
  assert.equal(
    (await post('/api/instagram/connect', { zernioId, sessionId: 'ig-senja', instagramId: 'igacc1' })).status(),
    200,
  );
  // Riwayat: satu pelanggan WhatsApp dan satu pelanggan Instagram (dengan nama dari DM-nya).
  whatsapp.get('toko-utama')!({ incoming: text('WA1', 'Oke kak, saya transfer sekarang', '628777000111') });
  await recordIncoming(account, 'ig-senja', text('ig_1', 'Kak, kopi susu literan ready?', igCustomer));
  await db.execute('INSERT INTO instagram_contacts(account_id,session_id,customer,username,name) VALUES (?,?,?,?,?)', [
    account,
    'ig-senja',
    igCustomer,
    'nadia.rhm',
    'Nadia',
  ]);
  await new Promise(r => setTimeout(r, 300));

  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/dashboard/chat');
  const list = page.locator('#inbox-list');
  await list.locator('.inbox-item').nth(1).waitFor();
  assert.equal(await page.locator('.tabs a[aria-current="page"]').first().textContent(), 'Chat');
  const nadia = list.locator('.inbox-item', { hasText: 'Nadia' });
  assert.match(await nadia.innerText(), /ig-senja · @kopisenja\.id/);
  assert.equal(await nadia.locator('.inbox-platform.instagram').count(), 1);
  const wa = list.locator('.inbox-item', { hasText: '+62 877-7000-111' });
  assert.match(await wa.innerText(), /toko-utama · 628123456789/);
  assert.equal(await wa.locator('.inbox-platform.whatsapp').count(), 1);
  // Filter sesi menyempitkan daftar ke satu sesi.
  await page.locator('#inbox-session').selectOption('ig-senja');
  assert.equal(await list.locator('.inbox-item').count(), 1);
  await page.locator('#inbox-session').selectOption('');
  // Membuka percakapan Instagram: asal percakapan tertulis dan balasan dikirim lewat sesi itu.
  await nadia.click();
  await page.locator('#inbox-view').waitFor();
  assert.match(await page.locator('#inbox-source').innerText(), /Masuk lewat ig-senja · Instagram DM · @kopisenja\.id/);
  assert.equal(await page.locator('#inbox-text').getAttribute('placeholder'), 'Balas manual lewat ig-senja…');
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, 'chat-inbox-desktop.png') });
  await page.locator('#inbox-text').fill('Ready kak, mau berapa liter?');
  await page.locator('#inbox-composer .chat-send').click();
  await page.locator('#inbox-messages .chat-bubble.out', { hasText: 'Ready kak, mau berapa liter?' }).waitFor();
  assert.deepEqual(sentInstagram, [{ recipient: igCustomer, text: 'Ready kak, mau berapa liter?' }]);
  assert.deepEqual(sentWhatsapp, []);
  // Ponsel: daftar, lalu percakapan dengan tombol kembali.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#inbox-back').click();
  await list.waitFor();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390, 'Tidak boleh ada gulir horizontal di ponsel: ' + width);
  await page.screenshot({ path: join(screenshots, 'chat-inbox-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('Pemeriksaan browser Chat lulus. Screenshot di ' + screenshots);
} finally {
  await browser?.close();
  server.close();
  zernio.close();
  await gateway.stop();
  await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}
