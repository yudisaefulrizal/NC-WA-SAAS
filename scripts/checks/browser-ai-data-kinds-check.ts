// Pemeriksaan browser jenis koleksi pada 1280/390 px: pemilik melihat jenis Tabel/Teks/Isian di Struktur data dan
// node Data teks/isian di popover; klien mengisi koleksi teks (tersimpan otomatis) dan isian (Simpan) di Asisten AI ›
// Knowledge, lalu isinya tetap ada setelah dibuka ulang.
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
import * as store from '../../src/components/ai/domain/builder/store.js';
import { setProfileEnabled } from '../../src/components/ai/domain/profiles/registry.js';
import { spoExample } from '../../src/components/ai/domain/builder/skill.js';
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
  // Contoh skill (SOP = teks) ditambah koleksi isian Info usaha.
  const d = spoExample();
  d.name = 'Kopi jenis data';
  d.collections.push({
    id: 'info_usaha',
    name: 'Info usaha',
    owner: 'shared',
    kind: 'form',
    fields: [
      { id: 'alamat', label: 'Alamat', type: 'text', required: false, options: [], collection: '' },
      { id: 'ongkir', label: 'Ongkir', type: 'number', required: false, options: [], collection: '' },
    ],
  });
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  await mkdir(screenshots, { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.5.0.' + (width === 1280 ? 1 : 2) },
    });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => void d.accept());

    // Pemilik: jenis koleksi dan node data baru di editor.
    await context.addCookies([{ name: 'ncwa_session', value: ownerToken, url: origin }]);
    await page.goto(origin + '/dashboard/admin/ai-builder?profile=' + g.id);
    await page.locator('[data-node="baca_sop"]').waitFor();
    await page.getByRole('button', { name: 'Struktur data', exact: true }).click();
    await page.locator('#collection-list').getByRole('button', { name: /^SOP/ }).click();
    assert.equal(await page.getByRole('radio', { name: /^Teks/ }).isChecked(), true);
    assert.equal(await page.locator('#collections .fields-table').count(), 0);
    await page
      .locator('#collection-list')
      .getByRole('button', { name: /^Info usaha/ })
      .click();
    assert.equal(await page.getByRole('radio', { name: /^Isian/ }).isChecked(), true);
    await page.locator('#collections .fields-table').waitFor();
    await page.getByRole('button', { name: 'Alur', exact: true }).click();
    await page.locator('#add-node').click();
    await page.locator('#node-types').getByRole('button', { name: 'Data isian', exact: true }).click();
    const inspector = page.locator('#inspector');
    assert.equal(await inspector.getByLabel('Koleksi', { exact: true }).inputValue(), 'info_usaha');
    await inspector.getByRole('radio', { name: 'Ubah' }).click();
    await inspector.getByRole('button', { name: 'Hapus node', exact: true }).click();

    // Klien: koleksi teks tersimpan otomatis, isian dengan Simpan.
    const data = await ai.createDataProfile(client, { profile_type: g.id, name: 'Kopi ' + width });
    await context.addCookies([{ name: 'ncwa_session', value: clientToken, url: origin }]);
    const open = async (name: RegExp) => {
      await page.goto(origin + '/dashboard/ai-data?profile=' + data.id);
      await page
        .locator('#ai-manage-name')
        .filter({ hasText: 'Kopi ' + width })
        .waitFor();
      await page.locator('#ai-knowledge-collections').getByRole('button', { name }).click();
    };
    await open(/^SOP/);
    // Koleksi teks memakai lebar penuh area isi, tidak menyusut selebar isinya.
    const fullWidth = () =>
      page.evaluate(() => {
        const host = document.querySelector('#ai-records')!.getBoundingClientRect().width;
        return host >= document.querySelector('.ai-records-head')!.getBoundingClientRect().width - 2;
      });
    assert.equal(await fullWidth(), true);
    await page.locator('#ai-single-text').fill('Pembayaran lewat QRIS.\n\nKeluhan diteruskan ke tim.');
    await page.locator('.ai-single-status').filter({ hasText: 'Tersimpan' }).waitFor();
    await open(/^SOP/);
    assert.match(await page.locator('#ai-single-text').inputValue(), /Pembayaran lewat QRIS/);
    assert.equal(await page.locator('#ai-records-new').isHidden(), true);
    await open(/^Info usaha/);
    assert.equal(await fullWidth(), true);
    await page.locator('#ai-single-form [name=alamat]').fill('Jl. Dago 12');
    await page.locator('#ai-single-form [name=ongkir]').fill('10000');
    await page.locator('#ai-single-form').getByRole('button', { name: 'Simpan' }).click();
    await page.locator('#ai-single-form').getByRole('button', { name: 'Tersimpan' }).waitFor();
    await open(/^Info usaha/);
    assert.equal(await page.locator('#ai-single-form [name=alamat]').inputValue(), 'Jl. Dago 12');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(screenshots, 'ai-data-kinds-' + width + '.png'), fullPage: true });
    const rows = await store.readRecords(client, data.id, 'info_usaha', '', 0);
    assert.deepEqual(
      rows.records.map(r => r.data),
      [{ alamat: 'Jl. Dago 12', ongkir: 10000 }],
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Jenis koleksi: Struktur data, node Data isian, serta isi Teks dan Isian klien lulus pada 1280 dan 390px.',
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
