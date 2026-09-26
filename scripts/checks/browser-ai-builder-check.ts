// Pengujian editor graf dan form data pada desktop/ponsel, termasuk simpan-buka ulang, impor, koneksi, dan publish.
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
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  await mkdir(screenshots, { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.1.0.' + (width === 1280 ? 1 : 2) },
    });
    await context.addCookies([{ name: 'ncwa_session', value: ownerToken, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => void d.accept());
    await page.goto(origin + '/dashboard/admin/ai-builder');
    await page.locator('#templates .card').first().getByRole('button').click();
    await page.locator('#editor').waitFor();
    await page.locator('#node-types').getByRole('button', { name: 'Shared Memory', exact: true }).waitFor();
    if (width === 390) await page.locator('#node-picker select').selectOption('shared_memory');
    else await page.locator('[data-node="shared_memory"] .node-heading').click();
    await page.locator('#inspector').getByLabel('Pesan sebelumnya (0–60)', { exact: true }).fill('8');
    const id = new URL(page.url()).searchParams.get('profile')!;
    ids.push(id);
    await page.getByRole('button', { name: 'Ringkasan', exact: true }).click();
    await page.locator('#profile-name').fill('Profil browser ' + width);
    await page.locator('#profile-name').blur();
    await page.locator('#save').click();
    await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    await page.reload();
    await page
      .locator('#profile-title')
      .filter({ hasText: 'Profil browser ' + width })
      .waitFor();
    await page.getByRole('button', { name: 'Alur', exact: true }).click();
    if (width === 1280) {
      const node = page.locator('[data-node="layanan"] .node-heading');
      const box = await node.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + 25, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 60, box.y + 45, { steps: 5 });
      await page.mouse.up();
    } else {
      await page.locator('#node-picker select').selectOption('layanan');
    }
    await page.locator('#inspector').getByLabel('Nama node', { exact: true }).fill('Layanan pelanggan');
    await page.locator('#inspector').getByLabel('Nama node', { exact: true }).blur();
    await page.locator('#node-types').getByRole('button', { name: 'Kondisi', exact: true }).click();
    await page.locator('#inspector').getByRole('button', { name: 'Hapus', exact: true }).click();
    await page.locator('#fit').click();
    if (width === 1280) {
      await page.locator('[data-source="input"][data-port="next"]').click();
      await page.locator('[data-target="router"]:not([data-connection])').click();
      await page.locator('[data-source="shared_memory"][data-port="memory"]').click();
      await page.locator('[data-target="layanan"][data-connection="memory"]').click();
      await page.locator('[data-node="layanan"] .node-heading').click();
      await page.locator('#inspector').getByLabel('Shared Memory', { exact: true }).selectOption('');
      assert.equal(await page.locator('[data-memory-connection="shared_memory:layanan"]').count(), 0);
      await page.locator('[data-source="shared_memory"][data-port="memory"]').click();
      await page.locator('[data-target="layanan"][data-connection="memory"]').click();
    } else {
      await page.locator('#node-picker select').selectOption('input');
      await page.locator('#inspector').getByLabel('next', { exact: true }).selectOption('router');
      await page.locator('#node-picker select').selectOption('layanan');
      await page.locator('#inspector').getByLabel('Shared Memory', { exact: true }).selectOption('');
      assert.equal(await page.locator('[data-memory-connection="shared_memory:layanan"]').count(), 0);
      await page.locator('#inspector').getByLabel('Shared Memory', { exact: true }).selectOption('shared_memory');
    }

    await page.locator('#save').click();
    await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    await page.locator('#publish').click();
    await page.locator('#revision').filter({ hasText: 'Terbit v' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(screenshots, 'ai-builder-' + width + '.png'), fullPage: true });
    await page.getByRole('button', { name: 'Struktur data', exact: true }).click();
    assert.equal(await page.locator('#collections .field-grid').count(), 3);
    await page.screenshot({ path: join(screenshots, 'ai-builder-schema-' + width + '.png'), fullPage: true });
    const exported = await context.request.get(origin + '/api/admin/ai/builder/' + id + '/export');
    assert.equal(exported.status(), 200);
    const definition = await exported.json();
    assert.equal(definition.nodes.find((n: any) => n.type === 'memory').memory_limit, 8);
    assert.equal(definition.nodes.find((n: any) => n.id === 'layanan').memory, 'shared_memory');
    assert.equal(
      definition.edges.some((e: any) => e.source === 'shared_memory' || e.target === 'shared_memory'),
      false,
    );
    assert.equal(definition.nodes.find((n: any) => n.id === 'layanan').label, 'Layanan pelanggan');
    await page.locator('#all-profiles').click();
    await page.locator('#import-file').setInputFiles({
      name: 'profile.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(definition)),
    });
    await page.locator('#import-preview').waitFor();
    await page.locator('#confirm-import').click();
    await page.locator('#import-preview').waitFor({ state: 'hidden' });
    const imported = new URL(page.url()).searchParams.get('profile')!;
    assert.notEqual(imported, id);
    ids.push(imported);
    assert.match(await page.locator('#revision').innerText(), /Belum diterbitkan/);
    await setProfileEnabled(owner, id, true);
    const data = await ai.createDataProfile(client, { profile_type: id, name: 'Data browser ' + width });
    await context.addCookies([{ name: 'ncwa_session', value: clientToken, url: origin }]);
    await page.goto(origin + '/dashboard/ai-data?profile=' + data.id);
    await page
      .locator('#data-title')
      .filter({ hasText: 'Profil browser ' + width })
      .waitFor();
    await page.locator('#new-record').click();
    await page.locator('#record-form [name=nama]').fill('Produk Basic');
    await page.locator('#record-form [name=biaya]').fill('150000');
    await page.locator('#record-form').getByRole('button', { name: 'Simpan', exact: true }).click();
    await page.locator('#record-dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await page.locator('#records').getByText('Produk Basic', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(screenshots, 'ai-builder-records-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Editor graf: drag, mobile selection, node edit/delete, save/reopen, publish, import, and client record persistence passed at 1280 and 390px.',
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
