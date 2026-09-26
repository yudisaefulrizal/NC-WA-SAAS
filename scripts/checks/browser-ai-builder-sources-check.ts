// Pemeriksaan browser sumber data koleksi pada 1280/390 px: klien mengganti koleksi ke API sendiri, menyimpan URL dan
// token, membuka ulang, menguji API (tiruan di proses yang sama), lalu kembali ke tabel aplikasi.
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
import { useCollectionTransport } from '../../src/components/ai/domain/builder/collection-sources.js';
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
const calls: any[] = [];
useCollectionTransport(async (_source, payload) => {
  calls.push(payload);
  return { records: [{ id: 'SO-1', data: { produk: 'Kopi dari API', jumlah: 2 } }] };
});
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
  const d = blankDefinition('Toko kopi');
  d.collections = [
    {
      id: 'pesanan',
      name: 'Pesanan',
      owner: 'shared',
      fields: [
        { id: 'produk', label: 'produk', type: 'text', required: true, options: [], collection: '' },
        { id: 'jumlah', label: 'jumlah', type: 'number', required: false, options: [], collection: '' },
      ],
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
      extraHTTPHeaders: { 'X-Forwarded-For': '10.4.0.' + (width === 1280 ? 1 : 2) },
    });
    await context.addCookies([{ name: 'ncwa_session', value: clientToken, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const data = await ai.createDataProfile(client, { profile_type: g.id, name: 'Kopi ' + width });
    await page.goto(origin + '/dashboard/ai-data?profile=' + data.id);
    await page.locator('#data-title').filter({ hasText: 'Toko kopi' }).waitFor();
    assert.equal(await page.getByRole('radio', { name: 'Tabel aplikasi' }).getAttribute('aria-checked'), 'true');
    await page.getByRole('radio', { name: 'API sendiri' }).click();
    await page.locator('#source-endpoint').fill('https://8.8.8.8/orders');
    await page.locator('#source-token').fill('rahasia-klien');
    await page.locator('#source-save').click();
    await page.locator('#source-test').waitFor();
    await page.reload();
    await page.locator('#source-test').waitFor();
    assert.equal(await page.getByRole('radio', { name: 'API sendiri' }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#source-endpoint').inputValue(), 'https://8.8.8.8/orders');
    await page.locator('#source-token-status').filter({ hasText: 'Token tersimpan.' }).waitFor();
    assert.equal(await page.locator('#new-record').isHidden(), true);
    await page.locator('#source-test').click();
    await page.locator('#records').getByText('Kopi dari API', { exact: true }).waitFor();
    assert.equal(calls.at(-1).action, 'search');
    assert.equal(calls.at(-1).context.data_profile_id, data.id);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(screenshots, 'ai-builder-api-source-' + width + '.png'), fullPage: true });
    await page.getByRole('radio', { name: 'Tabel aplikasi' }).click();
    await page.locator('#source-save').click();
    await page.locator('#new-record').waitFor();
    assert.equal(
      (await store.writeRecord(client, data.id, 'pesanan', 'create', { data: { produk: 'Lokal' } })).data.produk,
      'Lokal',
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Sumber data koleksi: ganti ke API, simpan-buka ulang, uji API, dan kembali ke tabel lulus pada 1280 dan 390px.',
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
