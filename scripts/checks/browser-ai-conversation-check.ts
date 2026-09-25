// Pemeriksaan browser tampilan Percakapan gaya WhatsApp di /dashboard/ai: daftar, nama, filter, gelembung riwayat dengan
// label asal dan status, kendali AI beserta catatannya, balasan manual berbayar, pembaruan realtime, dan tata letak ponsel.
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
import { recordOutgoing, updateStatus } from '../../src/components/ai/domain/chat.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import type { Update } from '../../src/components/whatsapp/domain/sessions.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-conversation-browser-'));
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
const { createApp } = await import('../../src/http/app.js');
// WhatsApp tiruan yang, seperti konektor asli, mendaftarkan setiap kiriman sebagai pesan sistem lebih dulu.
let push: ((event: Update) => void) | undefined,
  sequence = 0;
const gateway = createGateway(
  account => async (session, update) => {
    push = update;
    update({ status: 'connected' });
    return {
      close() {},
      async logout() {},
      async typing() {},
      async read() {},
      async send() {
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
  customer = '628123456789',
  other = '628777000111';
const incoming = (messageId: string, text: string, from = customer) => ({
  messageId,
  text,
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
  await db.execute('INSERT INTO daftar_kontak(id,account_id,nomor,nama,kelompkontak) VALUES (?,?,?,?,?)', [
    randomUUID(),
    account,
    customer + '@s.whatsapp.net',
    'Rina Amalia',
    'Pelanggan',
  ]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
  assert.equal(
    (await context.request.post(origin + '/sessions', { headers: { Origin: origin }, data: { id: 'shop' } })).status(),
    200,
  );
  await ai.saveAssistant(account, 'shop', { enabled: true, profile: {}, behavior: '' });
  // Riwayat: pesan pelanggan, jawaban AI yang sudah dibaca, balasan pemilik dari HP, dan sebuah catatan.
  push!({ incoming: incoming('IN1', 'Halo kak, mau pesan kopi susu 2') });
  await new Promise(r => setTimeout(r, 200));
  await recordOutgoing(account, 'shop', {
    customer,
    messageId: 'AI1',
    origin: 'ai',
    text: 'Siap kak, 2 Kopi Susu sudah dicatat.',
  });
  await updateStatus(account, 'shop', 'AI1', 'read');
  push!({ outgoing: incoming('PHONE1', 'Kopinya kami buat kurang manis ya') });
  push!({ incoming: incoming('IN9', 'Harga paket keluarga berapa?', other) });
  await new Promise(r => setTimeout(r, 300));
  await db.execute(
    "UPDATE ai_conversations SET router_context='pelanggan-menunggu-konfirmasi-pesanan' WHERE account_id=? AND customer=?",
    [account, customer],
  );

  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => void d.accept());
  await page.goto(origin + '/dashboard/ai');
  await page.locator('[data-ai-tab="conversations"]').click();
  const list = page.locator('#chat-list');
  await list.locator('.chat-item').nth(1).waitFor();
  assert.equal(await list.locator('.chat-item').count(), 2);
  // Aktivitas terbaru di atas; kontak tersimpan tampil dengan namanya, lainnya dengan nomor yang diformat.
  assert.deepEqual(await list.locator('.chat-item strong').allTextContents(), ['+62 877-7000-111', 'Rina Amalia']);
  assert.equal(await page.locator('[data-chat-filter="paused"]').textContent(), 'Dijeda 1');
  await page.locator('[data-chat-filter="paused"]').click();
  assert.deepEqual(await list.locator('.chat-item strong').allTextContents(), ['Rina Amalia']);
  await page.locator('[data-chat-filter="all"]').click();
  await page.locator('#chat-search').fill('rina');
  assert.equal(await list.locator('.chat-item').count(), 1);
  await page.locator('#chat-search').fill('');

  // Nomor yang belum tersimpan menawarkan untuk disimpan.
  await list.getByText('+62 877-7000-111', { exact: true }).click();
  await page.locator('#chat-save-contact').waitFor();
  await list.getByText('Rina Amalia', { exact: true }).click();
  const messages = page.locator('#chat-messages');
  await messages.locator('.chat-bubble').nth(2).waitFor();
  assert.equal(await page.locator('#chat-name').textContent(), 'Rina Amalia');
  assert.equal(await page.locator('#chat-status').textContent(), 'Dijeda');
  assert.equal(await page.locator('#chat-pause').textContent(), 'Lanjutkan AI');
  assert.equal(await page.locator('#chat-context-value').textContent(), 'pelanggan-menunggu-konfirmasi-pesanan');
  assert.equal(await page.locator('#chat-save-contact').isHidden(), true);
  assert.deepEqual(await messages.locator('.chat-tag').allTextContents(), ['AI', 'Manual']);
  assert.equal(await messages.locator('.chat-bubble.out.ai .chat-tick').getAttribute('aria-label'), 'Dibaca');
  await messages.getByText('AI dijeda karena ada balasan manual', { exact: false }).waitFor();
  // Kolom ketik tetap setinggi satu baris sampai teksnya butuh lebih.
  assert.ok((await page.locator('#chat-text').boundingBox())!.height <= 50);
  await mkdir(screenshots, { recursive: true });
  await page.locator('#chat-shell').screenshot({ path: join(screenshots, 'chat-desktop.png') });

  // Kendali AI memperbarui server dan meninggalkan catatan di riwayat.
  await page.locator('#chat-pause').click();
  await page.locator('#chat-status', { hasText: 'AI aktif' }).waitFor();
  await messages.getByText('AI dilanjutkan oleh admin', { exact: false }).waitFor();
  await page.locator('#chat-full-auto').check();
  await page.locator('#chat-status', { hasText: 'Full auto' }).waitFor();
  assert.equal(((await ai.conversations(account, 'shop')) as any[]).find(r => r.customer === customer).full_auto, 1);
  await page.locator('#chat-clear').click();
  await messages.getByText('Konteks AI dihapus', { exact: false }).waitFor();
  assert.equal(
    ((await ai.conversations(account, 'shop')) as any[]).find(r => r.customer === customer).message_count,
    0,
  );
  assert.ok(await messages.getByText('Halo kak, mau pesan kopi susu 2', { exact: true }).isVisible());

  // Balasan manual dari dashboard: Enter mengirim, satu kredit, berlabel Manual, full auto tetap menyalakan AI.
  const before = (await basicWallet(account)).balance;
  await page.locator('#chat-text').fill('Pesanan sedang kami siapkan');
  await page.locator('#chat-text').press('Enter');
  await messages.locator('.chat-bubble.out.manual', { hasText: 'Pesanan sedang kami siapkan' }).waitFor();
  assert.equal(await page.locator('#chat-text').inputValue(), '');
  assert.equal((await basicWallet(account)).balance, before - 1);
  assert.equal(((await ai.conversations(account, 'shop')) as any[]).find(r => r.customer === customer).paused, 0);

  // Realtime: pesan pelanggan baru muncul tanpa memuat ulang.
  push!({ incoming: incoming('IN2', 'Terima kasih kak') });
  await messages.getByText('Terima kasih kak', { exact: true }).waitFor({ timeout: 5000 });

  // Tata letak ponsel: daftar dulu, chat terbuka layar penuh, tombol kembali ke daftar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#chat-back').click();
  await list.waitFor();
  assert.equal(await page.locator('.chat-pane').isHidden(), true);
  await list.getByText('Rina Amalia', { exact: true }).click();
  await page.locator('#chat-view').waitFor();
  assert.equal(await page.locator('.chat-list-pane').isHidden(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: join(screenshots, 'chat-mobile.png') });
  assert.deepEqual(errors, []);
  console.log(
    'Chat view: list, filters, history, receipts, AI controls, manual reply, realtime and phone layout checks passed',
  );
} finally {
  await browser?.close();
  await gateway.stop();
  await new Promise<void>(r => server.close(() => r()));
  await db.execute('DELETE FROM audit_events WHERE account_id=?', [account]);
  await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}
