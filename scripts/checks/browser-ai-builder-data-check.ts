// Pemeriksaan browser perkakas data Tahap 1 pada 1280/390 px: kepemilikan koleksi, node Data (operasi, mode,
// filter, batas, jumlah), Kondisi berkelompok, simpan-buka ulang, halaman record milik pelanggan, dan dialog duplikat.
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
import { setProfileEnabled } from '../../src/components/ai/domain/profiles/registry.js';
import * as store from '../../src/components/ai/domain/builder/store.js';
import { blankDefinition } from '../../src/components/ai/domain/builder/definition.js';
const owner = randomUUID(),
  client = randomUUID(),
  ownerToken = randomUUID(),
  clientToken = randomUUID();
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
process.env.TRUST_PROXY_HOPS = '1';
const { createApp } = await import('../../src/http/app.js');
const server = createApp().listen(port, '127.0.0.1');
let browser;
const ids: string[] = [];
try {
  for (const [id, role, token] of [
    [owner, 'owner', ownerToken],
    [client, 'user', clientToken],
  ]) {
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
  // Profil terbit dengan koleksi umum dan milik pelanggan untuk halaman record dan dialog duplikat klien.
  const d = blankDefinition('Booking klinik');
  const text = (id: string) => ({ id, label: id, type: 'text' as const, required: false, options: [], collection: '' });
  d.collections = [
    { id: 'layanan', name: 'Layanan', owner: 'shared', fields: [{ ...text('nama'), required: true }] },
    {
      id: 'booking',
      name: 'Booking',
      owner: 'customer',
      fields: [{ ...text('tanggal'), type: 'date' }, text('keluhan')],
    },
  ];
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  await mkdir(screenshots, { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.2.0.' + (width === 1280 ? 1 : 2) },
    });
    await context.addCookies([{ name: 'ncwa_session', value: ownerToken, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => void d.accept());
    await page.goto(origin + '/dashboard/admin/ai-builder');
    await page.locator('#templates .card').first().getByRole('button').click();
    await page.locator('#editor').waitFor();
    const id = new URL(page.url()).searchParams.get('profile')!;
    ids.push(id);

    // Struktur data: koleksi baru milik pelanggan.
    await page.getByRole('button', { name: 'Struktur data', exact: true }).click();
    await page.locator('#add-collection').click();
    const added = page.locator('#collections .collection').last();
    await added.getByLabel('Nama koleksi', { exact: true }).fill('Booking');
    await added.getByLabel('Kepemilikan data', { exact: true }).selectOption('customer');
    await page
      .locator('#collections .collection')
      .last()
      .getByText(/Nomor pelanggan diisi otomatis/)
      .waitFor();

    // Alur: node Data dengan filter, batas, jumlah, dan mode Agent/alur.
    await page.getByRole('button', { name: 'Alur', exact: true }).click();
    await page.locator('#node-types').getByRole('button', { name: 'Data', exact: true }).click();
    const inspector = page.locator('#inspector');
    await inspector.getByLabel('Koleksi', { exact: true }).selectOption('produk');
    await inspector.getByRole('button', { name: '＋ Filter' }).click();
    await inspector.getByLabel('Field', { exact: true }).selectOption('nama');
    await inspector.getByLabel('Operator', { exact: true }).selectOption('contains');
    await inspector.getByLabel('Nilai', { exact: true }).fill('{{input.message}}');
    await inspector.getByLabel('Batas', { exact: true }).fill('5');
    await page.locator('.graph-node.selected', { hasText: 'Ditemukan' }).waitFor();
    await inspector.getByRole('radio', { name: 'Hitung' }).click();
    await inspector.getByLabel('Jumlahkan field (opsional)', { exact: true }).selectOption('biaya');
    await inspector.getByRole('radio', { name: 'Cari' }).click();
    await inspector.getByRole('radio', { name: 'Dipanggil Agent' }).click();
    assert.equal(await inspector.getByLabel('Dipakai Layanan', { exact: true }).isChecked(), true);
    await inspector.getByRole('radio', { name: 'Di alur' }).click();
    // ID field dibuat dari nama dan tidak ditampilkan; selama belum terbit, mengganti nama ikut mengganti rujukan filter.
    await page.getByRole('button', { name: 'Struktur data', exact: true }).click();
    assert.equal(await page.locator('#collections').getByLabel('ID field').count(), 0);
    await page
      .locator('#collections .collection')
      .first()
      .getByLabel('Nama field', { exact: true })
      .first()
      .fill('Nama Produk');
    await page.getByRole('button', { name: 'Alur', exact: true }).click();

    // Kondisi: satu syarat jam dan satu grup "salah satu".
    await page.locator('#node-types').getByRole('button', { name: 'Kondisi', exact: true }).click();
    await inspector.getByLabel('Nilai yang diperiksa', { exact: true }).fill('system.time');
    await inspector.getByLabel('Operator', { exact: true }).selectOption('time_between');
    await inspector.getByLabel('Pembanding', { exact: true }).fill('08.00-16.00');
    await inspector.getByRole('button', { name: '＋ Grup DAN/ATAU' }).click();
    await inspector.getByLabel('Pembanding', { exact: true }).last().fill('gigi');

    await page.locator('#save').click();
    await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    await page.reload();
    await page.locator('#editor').waitFor();
    const exported = await context.request.get(origin + '/api/admin/ai/builder/' + id + '/export');
    const definition = await exported.json();
    const dataNode = definition.nodes.find(
      (n: any) => n.type === 'tool' && n.collection === 'produk' && n.filters?.length,
    );
    assert.deepEqual(dataNode.filters, [{ field: 'nama_produk', operator: 'contains', value: '{{input.message}}' }]);
    assert.equal(definition.collections[0].fields[0].id, 'nama_produk');
    assert.equal(definition.collections.at(-1).id, 'booking');
    assert.equal(dataNode.limit, 5);
    assert.equal(dataNode.operation, 'search');
    assert.equal(dataNode.sum_field, 'biaya');
    assert.equal(
      definition.nodes.some((n: any) => n.tools.includes(dataNode.id)),
      false,
    );
    const condition = definition.nodes.find((n: any) => n.type === 'condition');
    assert.deepEqual(condition.rules[0], { field: 'system.time', operator: 'time_between', compare: '08.00-16.00' });
    assert.equal(condition.rules[1].match, 'any');
    assert.equal(condition.rules[1].rules[0].compare, 'gigi');
    assert.equal(definition.collections.at(-1).owner, 'customer');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    if (width === 390) await page.locator('#node-picker select').selectOption(dataNode.id);
    else await page.locator(`[data-node="${dataNode.id}"] .node-heading`).click();
    await inspector.getByRole('radio', { name: 'Cari' }).waitFor();
    assert.equal(await inspector.getByRole('radio', { name: 'Cari' }).getAttribute('aria-checked'), 'true');
    await page.screenshot({ path: join(screenshots, 'ai-builder-data-node-' + width + '.png'), fullPage: true });

    // Klien: record milik pelanggan wajib bernomor, tampil dengan kolom Pelanggan, dan bisa difilter.
    const data = await ai.createDataProfile(client, { profile_type: g.id, name: 'Klinik ' + width });
    await context.addCookies([{ name: 'ncwa_session', value: clientToken, url: origin }]);
    await page.goto(origin + '/dashboard/ai-data?profile=' + data.id);
    await page.locator('#data-title').filter({ hasText: 'Booking klinik' }).waitFor();
    await page.locator('#collection').selectOption('booking');
    await page.locator('#owner-note').waitFor();
    await page.locator('#new-record').click();
    await page.locator('#record-form [name=__customer]').fill('62811');
    await page.locator('#record-form [name=tanggal]').fill('2026-09-27');
    await page.locator('#record-form [name=keluhan]').fill('Gusi bengkak');
    await page.locator('#record-form').getByRole('button', { name: 'Simpan', exact: true }).click();
    await page.locator('#record-dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await page.locator('#collection').selectOption('booking');
    await page.locator('#records').getByText('62811', { exact: true }).waitFor();
    await page.locator('#customer-filter').fill('62899');
    await page.locator('#customer-filter').press('Enter');
    await page.locator('#records').getByText('Belum ada data yang sesuai.').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(screenshots, 'ai-builder-owned-records-' + width + '.png'), fullPage: true });

    // Dialog duplikat: pilihan salin record pelanggan muncul untuk profil ini dan tersimpan sesuai centang.
    await page.goto(origin + '/dashboard/ai');
    await page.locator('[data-ai-view="profiles"]').click();
    const card = page.locator('.ai-profile-card', { hasText: 'Klinik ' + width });
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Duplikat' }).click();
    const dialog = page.locator('#ai-profile-duplicate-dialog');
    await dialog.waitFor();
    await dialog.getByLabel(/Salin juga record milik pelanggan/).check();
    await dialog.getByRole('button', { name: 'Duplikat', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const copy = (await ai.dataProfiles(client)).find(p => p.name === 'Salinan Klinik ' + width)!;
    assert.equal((await store.readRecords(client, copy.id, 'booking')).records[0].customer, '62811');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Perkakas data: kepemilikan koleksi, node Data, Kondisi berkelompok, simpan-buka ulang, record milik pelanggan, dan duplikat lulus pada 1280 dan 390px.',
  );
} finally {
  await browser?.close();
  await new Promise<void>(r => server.close(() => r()));
  for (const id of [owner, client]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
}
