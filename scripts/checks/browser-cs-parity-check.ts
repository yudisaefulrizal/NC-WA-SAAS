// Pemeriksaan browser draft pembanding CS: lima agent, resource memori, tool bisnis lengkap, dan publikasi.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { screenshots } from './screenshots.js';
import { createGraph } from '../../src/components/ai/domain/builder/store.js';
import { setProfileEnabled } from '../../src/components/ai/domain/profiles/registry.js';
import { AIService } from '../../src/components/ai/domain/service.js';
import { csTemplate as csParityProfile } from '../../src/components/ai/domain/builder/cs-template.js';
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
let dataProfile = '';
const ai = new AIService();
const ids: string[] = [];
try {
  await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')", [
    owner,
    owner + '@test.invalid',
    'unused',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(ownerToken),
    owner,
  ]);
  await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'user')", [
    client,
    client + '@test.invalid',
    'unused',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(clientToken),
    client,
  ]);
  const g = await createGraph(owner, csParityProfile());
  ids.push(g.id);
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
    await page.goto(origin + '/dashboard/admin/ai-builder?profile=' + g.id);
    await page.locator('#profile-title').filter({ hasText: 'CS Usaha lengkap' }).waitFor();
    for (const id of ['pembuka', 'profil_perusahaan', 'layanan', 'penutup', 'lainnya'])
      assert.equal(await page.locator('[data-node="' + id + '"]').count(), 1);
    if (width === 390) await page.locator('#node-picker select').selectOption('layanan');
    else await page.locator('[data-node="layanan"] .node-heading').click();
    assert.equal(await page.locator('#inspector').getByLabel('Aktifkan port Fallback ke petugas').isChecked(), true);
    assert.equal(await page.locator('#inspector .issue').count(), 0);
    assert.equal(
      await page.locator('#inspector').getByLabel('Shared Memory', { exact: true }).inputValue(),
      'shared_memory',
    );
    await page.screenshot({ path: join(screenshots, 'cs-parity-' + width + '.png'), fullPage: true });
    await page.getByRole('button', { name: 'Ringkasan', exact: true }).click();
    const response = page.waitForResponse(r => r.url().endsWith('/publish') && r.request().method() === 'POST');
    await page.locator('#publish').click();
    assert.equal((await response).status(), 200);
    const stored = await (await context.request.get(origin + '/api/admin/ai/builder/' + g.id)).json();
    assert.ok(stored.active);
    assert.equal(stored.issues.length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await setProfileEnabled(owner, g.id, true);
    if (!dataProfile)
      dataProfile = (await ai.createDataProfile(client, { profile_type: g.id, name: 'CS dinamis uji' })).id;
    await context.clearCookies();
    await context.addCookies([{ name: 'ncwa_session', value: clientToken, url: origin }]);
    await page.goto(origin + '/dashboard/ai');
    await page.locator('[data-ai-view="profiles"]').click();
    await page
      .locator('.ai-profile-card', { hasText: 'CS dinamis uji' })
      .getByRole('button', { name: 'Kelola isi' })
      .click();
    await page.locator('#ai-manage-name', { hasText: 'CS dinamis uji' }).waitFor();
    if (width === 390) await page.locator('#ai-knowledge-select').selectOption('products');
    else await page.locator('[data-knowledge-tab="products"]').click();
    await page.locator('#ai-product-add').click();
    const form = page.locator('#ai-product-form');
    await form.locator('[name=name]').fill('Produk uji ' + width);
    await form.locator('[name=price]').fill('150000');
    await form.locator('[name=stock]').fill('10');
    await form.getByRole('button', { name: 'Simpan produk' }).click();
    await page
      .locator('#ai-products')
      .getByText('Produk uji ' + width, { exact: true })
      .waitFor();
    assert.equal((await ai.dataProfiles(client)).find(p => p.id === dataProfile)!.products, width === 1280 ? 1 : 2);
    await page.screenshot({ path: join(screenshots, 'cs-business-data-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'CS parity browser: five agents and memory connections visible; all business tools available; publication succeeds at 1280/390px.',
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
