// Pemeriksaan browser Asisten AI editor profil pada 1280/390 px: tanya-jawab tanpa usulan, usulan yang hanya
// dipratinjau (draft di server belum berubah, suntingan ditahan), Terapkan lalu tersimpan, Urungkan kembali ke
// sebelum usulan, dan Tolak. Model AI diganti transport tiruan di proses yang sama.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { screenshots } from './screenshots.js';
import { ai } from '../../src/components/ai/domain/service.js';
import type { AITransport } from '../../src/components/ai/domain/provider.js';
import type { GraphDefinition } from '../../src/components/ai/domain/builder/definition.js';
import { catalogGraph } from '../../test/components/ai/graph-fixture.js';

const owner = randomUUID(),
  ownerToken = randomUUID();
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
process.env.TRUST_PROXY_HOPS = '1';
// Asisten tiruan: "Jelaskan" dijawab tanpa usulan; perintah lain menambah Agent Penutup setelah Sapaan.
const fake: AITransport = async (c, messages) => {
  if (c.call_role === 'builder_samples')
    return '{"samples":{"produk":[{"_id":"produk_1","nama":"Kopi Susu","biaya":18000},{"_id":"produk_2","nama":"Americano","biaya":15000}]}}';
  if (c.call_role !== 'builder_assistant') return '{"answer":"Selesai"}';
  const last = messages.at(-1)!.content;
  if (/Jelaskan/.test(last)) return '{"reply":"Router memilih Layanan atau Sapaan.","definition":null}';
  const d = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(last)![1]) as GraphDefinition;
  const sapaan = d.nodes.find(n => n.id === 'sapaan')!;
  d.nodes.push({ ...sapaan, id: 'penutup', label: 'Penutup', prompt: 'Tutup percakapan.', x: 0, y: 0 });
  const out = d.edges.find(e => e.source === 'sapaan')!;
  d.edges.push({ id: 'e_penutup', source: 'penutup', port: 'next', target: out.target });
  out.target = 'penutup';
  return '```json\n' + JSON.stringify({ reply: 'Menambah Agent Penutup setelah Sapaan.', definition: d }) + '\n```';
};
Object.defineProperty(ai, 'transport', { value: fake });
const { createApp } = await import('../../src/http/app.js');
const server = createApp().listen(port, '127.0.0.1');
let browser;
const ids: string[] = [];
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
    owner,
    owner + '@test.invalid',
    'unused',
    'owner',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(ownerToken),
    owner,
  ]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  await mkdir(screenshots, { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.4.0.' + (width === 1280 ? 1 : 2) },
    });
    await context.addCookies([{ name: 'ncwa_session', value: ownerToken, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => void d.accept());
    // Profil tanpa posisi node (seperti buatan AI): editor menyusunnya dengan Rapikan saat dibuka dan menyimpannya.
    const bare = catalogGraph();
    bare.nodes = bare.nodes.map(({ x: _x, y: _y, ...n }) => n);
    const created = await (
      await context.request.post(origin + '/api/admin/ai/builder', {
        data: bare,
        headers: { Origin: origin },
      })
    ).json();
    ids.push(created.id);
    await page.goto(origin + '/dashboard/admin/ai-builder?profile=' + created.id);
    await page.locator('[data-node="layanan"]').waitFor();
    await page.locator('#notice').filter({ hasText: 'Posisi node disusun otomatis' }).waitFor();
    const boxes = await page
      .locator('#nodes .graph-node')
      .evaluateAll(els => els.map(el => (el as HTMLElement).offsetLeft + ':' + (el as HTMLElement).offsetTop));
    assert.equal(new Set(boxes).size, boxes.length);
    await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    const placed = await (await context.request.get(origin + '/api/admin/ai/builder/' + created.id + '/export')).json();
    assert.ok(placed.nodes.every((n: { x?: number }) => typeof n.x === 'number'));
    const serverNodes = async () =>
      (await (await context.request.get(origin + '/api/admin/ai/builder/' + created.id + '/export')).json()).nodes.map(
        (n: { id: string }) => n.id,
      );
    const saved = () => page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();

    // Data contoh: Buat data contoh (semua koleksi), lalu satu baris diisi manual; tersimpan di draft dan menjadi data awal Uji.
    await page.locator('[data-tab="schema"]').click();
    const samples = page.locator('.samples-card');
    await page.locator('#samples-all').click();
    await samples.getByLabel('Nama baris 2', { exact: true }).waitFor();
    assert.equal(await samples.getByLabel('Nama baris 1', { exact: true }).inputValue(), 'Kopi Susu');
    await samples.getByRole('button', { name: '+ Baris' }).click();
    await samples.getByLabel('Nama baris 3', { exact: true }).fill('Teh Manis');
    await samples.getByLabel('Biaya baris 3', { exact: true }).fill('9000');
    await saved();
    const withSamples = await (
      await context.request.get(origin + '/api/admin/ai/builder/' + created.id + '/export')
    ).json();
    assert.deepEqual(withSamples.collections[0].samples, [
      { _id: 'produk_1', nama: 'Kopi Susu', biaya: 18000 },
      { _id: 'produk_2', nama: 'Americano', biaya: 15000 },
      { _id: 'produk_3', nama: 'Teh Manis', biaya: 9000 },
    ]);
    await samples.screenshot({ path: join(screenshots, 'ai-builder-samples-' + width + '.png') });
    await page.locator('#test-toggle').click();
    assert.equal(JSON.parse(await page.locator('#samples').inputValue()).produk.length, 3);
    await page.locator('#close-test').click();

    const ask = async (text: string) => {
      await page.locator('#assistant-message').fill(text);
      await page.locator('#assistant-message').press('Enter');
    };
    const chat = page.locator('#assistant-chat');

    await page.locator('#assistant-toggle').click();
    await page.locator('#assistant').waitFor();
    // Pertanyaan: jawaban saja, tanpa usulan.
    await ask('Jelaskan alurnya');
    await chat.getByText('Router memilih Layanan atau Sapaan.').waitFor();
    assert.equal(await chat.locator('.proposal').count(), 0);

    // Usulan: pratinjau di kanvas, draft di server belum berubah, suntingan ditahan.
    await ask('Tambahkan Penutup');
    const card = chat.locator('.proposal').last();
    await card.getByText('Penutup · Agent').waitFor();
    await card.getByText('0 masalah').waitFor();
    await page.locator('#proposal-bar').filter({ hasText: '1 node baru' }).waitFor();
    assert.equal(await page.locator('[data-node="penutup"]').getAttribute('data-ai-mark'), 'Baru');
    assert.equal((await serverNodes()).includes('penutup'), false);
    await page.locator('#viewport').focus();
    await page.keyboard.press('Control+z');
    await page.locator('#notice').filter({ hasText: 'Terapkan atau Tolak usulan' }).waitFor();
    await page.screenshot({ path: join(screenshots, 'ai-builder-assistant-' + width + '.png'), fullPage: true });

    // Terapkan: tersimpan sebagai draft biasa; Urungkan mengembalikan ke sebelum usulan.
    await page.locator('#proposal-apply').click();
    await page.locator('#proposal-bar').waitFor({ state: 'hidden' });
    await card.getByText('Diterapkan sebagai draft').waitFor();
    await saved();
    assert.equal((await serverNodes()).includes('penutup'), true);
    await card.getByRole('button', { name: 'Urungkan' }).click();
    await card.getByText('Diurungkan').waitFor();
    await page.locator('[data-node="penutup"]').waitFor({ state: 'detached' });
    await saved();
    assert.equal((await serverNodes()).includes('penutup'), false);

    // Tolak: kanvas kembali ke draft, tidak ada yang disimpan.
    await ask('Tambahkan Penutup lagi');
    const second = chat.locator('.proposal').last();
    await second.getByRole('button', { name: 'Tolak' }).click();
    await second.getByText('Ditolak').waitFor();
    await page.locator('[data-node="penutup"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#proposal-bar').isHidden(), true);
    assert.equal((await serverNodes()).includes('penutup'), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Asisten AI: profil tanpa posisi disusun otomatis, data contoh (otomatis dan manual) dipakai Uji, tanya-jawab, pratinjau usulan tanpa menyimpan, Terapkan, Urungkan, dan Tolak lulus pada 1280 dan 390px.',
  );
} finally {
  await browser?.close();
  await new Promise<void>(r => server.close(() => r()));
  await db.execute('DELETE FROM audit_events WHERE account_id=?', [owner]);
  await db.execute('DELETE FROM accounts WHERE id=?', [owner]);
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
}
