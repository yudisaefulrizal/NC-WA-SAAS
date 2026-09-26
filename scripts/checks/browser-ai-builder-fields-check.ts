// Pemeriksaan browser Tahap 2–4 pada 1280/390 px: node Ekstrak, Set / Hitung, Terima media, dan Kirim media, tipe field baru dengan nilai bawaan dan
// unik, simpan-buka ulang, serta formulir record klien (jam, tanggal-jam, pilihan ganda, telepon, unggah file).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { storagePaths } from '../../src/libraries/storage.js';
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
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
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
  const d = blankDefinition('Pendaftaran santri');
  const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    label: id,
    type,
    required: false,
    options: [],
    collection: '',
    ...extra,
  });
  d.collections = [
    {
      id: 'daftar',
      name: 'Pendaftaran',
      owner: 'shared',
      fields: [
        field('nama', 'text', { required: true }),
        field('jam', 'time'),
        field('mulai', 'datetime'),
        field('minat', 'multichoice', { options: ['Tahfidz', 'Bahasa'], default: ['Tahfidz'] }),
        field('hp', 'phone', { unique: true }),
        field('foto', 'file'),
      ],
    } as never,
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
      extraHTTPHeaders: { 'X-Forwarded-For': '10.3.0.' + (width === 1280 ? 1 : 2) },
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

    // Struktur data: field baru bertipe Pilihan ganda dengan nilai bawaan, dan Telepon yang unik.
    await page.getByRole('button', { name: 'Struktur data', exact: true }).click();
    const produk = page.locator('#collections .collection').first();
    await produk.getByRole('button', { name: '＋ Field' }).click();
    const added = produk.locator('.field-grid').last();
    await added.getByLabel('Nama field', { exact: true }).fill('Kategori');
    await added.getByLabel('Tipe', { exact: true }).selectOption('multichoice');
    await produk.locator('.field-grid').last().getByLabel('Opsi (pisahkan koma)').fill('Reguler, Promo');
    await produk.locator('.field-grid').last().getByLabel('Nilai bawaan (pisahkan koma)').fill('Reguler');
    await produk.getByRole('button', { name: '＋ Field' }).click();
    const phone = produk.locator('.field-grid').last();
    await phone.getByLabel('Nama field', { exact: true }).fill('Kontak');
    await phone.getByLabel('Tipe', { exact: true }).selectOption('phone');
    await produk.locator('.field-grid').last().getByLabel('Unik', { exact: true }).check();

    // Alur: Ekstrak dengan field dari koleksi, lalu Set / Hitung dengan operasi Kali.
    await page.getByRole('button', { name: 'Alur', exact: true }).click();
    const inspector = page.locator('#inspector');
    await page.locator('#node-types').getByRole('button', { name: 'Ekstrak', exact: true }).click();
    await inspector.getByLabel('Tipe', { exact: true }).selectOption('choice');
    await inspector.getByLabel('Opsi (pisahkan koma)', { exact: true }).fill('Gigi, Umum');
    await inspector.getByLabel('Salin field dari koleksi', { exact: true }).selectOption('produk');
    await inspector.getByLabel('Petunjuk untuk AI', { exact: true }).first().fill('Nama layanan');
    await page.locator('#node-types').getByRole('button', { name: 'Set / Hitung', exact: true }).click();
    await inspector.getByLabel('Nama hasil', { exact: true }).fill('total');
    await inspector.getByLabel('Operasi', { exact: true }).selectOption('multiply');
    await inspector.getByLabel('Angka', { exact: true }).fill('150000');
    await inspector.getByLabel('Dikali', { exact: true }).fill('2');
    await inspector.getByRole('button', { name: '＋ Langkah' }).click();
    await inspector.getByLabel('Operasi', { exact: true }).last().selectOption('format_rupiah');
    await inspector.getByLabel('Angka', { exact: true }).last().fill('{{input.message}}');

    // Kirim media: file dari variabel, keterangan, sesudah jawaban, sebagai dokumen.
    await page.locator('#node-types').getByRole('button', { name: 'Kirim media', exact: true }).click();
    await inspector.getByLabel('File yang dikirim', { exact: true }).fill('{{input.message}}');
    await inspector.getByLabel('Keterangan (opsional)', { exact: true }).fill('Brosur terbaru');
    await inspector.getByLabel('Waktu kirim', { exact: true }).selectOption('after');
    await inspector.getByLabel('Kirim sebagai', { exact: true }).selectOption('document');
    // Terima media: hanya gambar.
    await page.locator('#node-types').getByRole('button', { name: 'Terima media', exact: true }).click();
    await inspector.getByLabel(/^Dokumen \(PDF/).uncheck();
    await page.locator('#save').click();
    await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    await page.reload();
    await page.locator('#editor').waitFor();
    const definition = await (await context.request.get(origin + '/api/admin/ai/builder/' + id + '/export')).json();
    const extract = definition.nodes.find((n: any) => n.type === 'extract');
    assert.equal(extract.tier, 'structured');
    assert.deepEqual(extract.fields[0], {
      id: 'nama',
      label: 'Nama',
      type: 'choice',
      required: true,
      hint: 'Nama layanan',
      options: ['Gigi', 'Umum'],
    });
    assert.ok(extract.fields.some((f: any) => f.id === 'biaya' && f.type === 'number'));
    const computeNode = definition.nodes.find((n: any) => n.type === 'compute');
    assert.deepEqual(computeNode.steps[0], { name: 'total', op: 'multiply', args: ['150000', '2'] });
    assert.equal(computeNode.steps[1].op, 'format_rupiah');
    assert.deepEqual(definition.nodes.find((n: any) => n.type === 'receive').accept, ['image']);
    const media = definition.nodes.find((n: any) => n.type === 'media');
    assert.deepEqual(
      [media.value, media.caption, media.send_when, media.media_as],
      ['{{input.message}}', 'Brosur terbaru', 'after', 'document'],
    );
    const produkDef = definition.collections.find((c: any) => c.id === 'produk');
    assert.deepEqual(produkDef.fields.find((f: any) => f.id === 'kategori').default, ['Reguler']);
    assert.equal(produkDef.fields.find((f: any) => f.id === 'kontak').unique, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    if (width === 390) await page.locator('#node-picker select').selectOption(computeNode.id);
    else await page.locator(`[data-node="${computeNode.id}"] .node-heading`).click();
    await inspector.getByLabel('Nama hasil', { exact: true }).first().waitFor();
    await page.screenshot({ path: join(screenshots, 'ai-builder-compute-' + width + '.png'), fullPage: true });

    // Klien: formulir record dengan tipe baru dan unggahan file.
    const data = await ai.createDataProfile(client, { profile_type: g.id, name: 'Santri ' + width });
    await context.addCookies([{ name: 'ncwa_session', value: clientToken, url: origin }]);
    await page.goto(origin + '/dashboard/ai-data?profile=' + data.id);
    await page.locator('#data-title').filter({ hasText: 'Pendaftaran santri' }).waitFor();
    await page.locator('#new-record').click();
    const form = page.locator('#record-form');
    assert.equal(await form.getByLabel('Tahfidz', { exact: true }).isChecked(), true);
    await form.locator('[name=nama]').fill('Ahmad');
    await form.locator('[name=jam]').fill('07:30');
    await form.locator('[name=mulai]').fill('2026-10-01T08:00');
    await form.getByLabel('Bahasa', { exact: true }).check();
    await form.locator('[name=hp]').fill('0812-3456-789');
    await form.locator('[name=foto]').setInputFiles({ name: 'pas foto.png', mimeType: 'image/png', buffer: png });
    await form.getByRole('button', { name: 'Simpan', exact: true }).click();
    await page.locator('#record-dialog').waitFor({ state: 'hidden' });
    await page.reload();
    const link = page.locator('#records a', { hasText: 'pas foto.png' });
    await link.waitFor();
    await page.locator('#records').getByText('Tahfidz, Bahasa', { exact: true }).waitFor();
    await page.locator('#records').getByText('628123456789', { exact: true }).waitFor();
    await page.locator('#records').getByText('2026-10-01 08:00', { exact: true }).waitFor();
    const file = await context.request.get(origin + (await link.getAttribute('href')));
    assert.equal(file.status(), 200);
    assert.deepEqual(Buffer.from(await file.body()), png);
    // Nomor unik yang sama ditolak dengan pesan yang jelas.
    await page.locator('#new-record').click();
    await form.locator('[name=nama]').fill('Budi');
    await form.locator('[name=hp]').fill('628123456789');
    await form.getByRole('button', { name: 'Simpan', exact: true }).click();
    await page.locator('#notice').filter({ hasText: 'sudah dipakai record lain' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(screenshots, 'ai-builder-field-types-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Tahap 2–4: Ekstrak, Set / Hitung, Terima media, Kirim media, tipe field baru, nilai bawaan, unik, dan unggah file lulus pada 1280 dan 390px.',
  );
} finally {
  await browser?.close();
  await new Promise<void>(r => server.close(() => r()));
  for (const id of [owner, client]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
    await rm(join(storagePaths().recordFiles, id), { recursive: true, force: true });
  }
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
}
