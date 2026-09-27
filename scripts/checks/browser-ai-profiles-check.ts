// Pemeriksaan browser multi-profil: kartu dan strip sesi, memasang data profil baru dari dialog, daftar Data Profil
// dan mengelolanya langsung, mencabut, dan halaman Profil AI pemilik, di lebar desktop dan ponsel.
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
import { blankDefinition } from '../../src/components/ai/domain/builder/definition.js';
import { createGraph, saveGraph } from '../../src/components/ai/domain/builder/store.js';
import { setProfileEnabled } from '../../src/components/ai/domain/profiles/registry.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-profiles-browser-'));
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
// Setiap halaman mendapat alamat klien sendiri supaya pembatas per IP tidak terpicu selama pemeriksaan.
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
process.env.TRUST_PROXY_HOPS = '1';
let address = 10;
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(
  () => async (_session, update) => {
    update({ status: 'connected' });
    return {
      close() {},
      async logout() {},
      async typing() {},
      async read() {},
      async send() {
        return randomUUID();
      },
    };
  },
  temporary,
);
const server = createApp(gateway).listen(port, '127.0.0.1');
const client = randomUUID(),
  owner = randomUUID(),
  clientToken = randomUUID(),
  ownerToken = randomUUID();
// waitForFunction menganggap Promise dari fungsi async selalu benar, jadi keadaan server diperiksa berulang di sini.
const until = async <T>(
  page: import('playwright').Page,
  check: (arg: T) => Promise<boolean>,
  arg: T,
  timeout = 6000,
) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(check, arg)) return;
    if (Date.now() > end) throw Error('Waktu tunggu habis: ' + check.toString().slice(0, 160));
    await page.waitForTimeout(150);
  }
};
let browser,
  graphId = '';
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    client,
    client + '@test.invalid',
    'unused',
  ]);
  await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')", [
    owner,
    owner + '@test.invalid',
    'unused',
  ]);
  for (const [token, id] of [
    [clientToken, client],
    [ownerToken, owner],
  ])
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
      digest(token),
      id,
    ]);
  await basicWallet(client);
  await db.execute('UPDATE wallets SET session_limit=3 WHERE account_id=?', [client]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const open = async (token: string, path: string, width = 1280, height = 900) => {
    const context = await browser!.newContext({
      viewport: { width, height },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.0.0.' + address++ },
    });
    await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => void d.accept());
    await page.goto(origin + path);
    return { page, errors, context };
  };
  {
    const { context } = await open(clientToken, '/dashboard/ai');
    for (const id of ['toko-utama', 'cabang-dago', 'promo-baru'])
      assert.equal(
        (await context.request.post(origin + '/sessions', { headers: { Origin: origin }, data: { id } })).status(),
        200,
      );
    await context.close();
  }
  // Profil yang dipilih klien: graf "Kafe" yang diterbitkan dan dinyalakan pemilik.
  const graph = await createGraph(owner, blankDefinition('Kafe'));
  graphId = graph.id;
  await saveGraph(owner, graph.id, { revision: graph.revision }, true);
  await setProfileEnabled(owner, graph.id, true);
  const kopi = await ai.createDataProfile(client, { profile_type: graph.id, name: 'Toko Kopi Senja' });
  await ai.saveDataProfileField(client, kopi.id, 'behavior', 'Ramah, panggil pelanggan Kak');
  for (const session of ['toko-utama', 'cabang-dago'])
    await ai.attachProfile(client, session, { data_profile_id: kopi.id, enabled: true });
  await mkdir(screenshots, { recursive: true });

  // Tampilan Sesi: profil terpasang tampil di kartu dan strip, dengan peringatan bahwa isinya dipakai bersama.
  const { page, errors, context } = await open(clientToken, '/dashboard/ai');
  const strip = page.locator('#ai-profile-strip');
  await strip.getByText('Toko Kopi Senja').waitFor();
  assert.match(await strip.innerText(), /memakai profil Kafe dengan data profil Toko Kopi Senja/);
  assert.match(await strip.innerText(), /dipakai juga oleh cabang-dago/);
  assert.equal(
    await page.locator('.ai-session-card.selected .ai-session-profile').innerText(),
    'KAFE\nToko Kopi Senja',
  );
  assert.equal(await page.locator('textarea[name=behavior]').inputValue(), 'Ramah, panggil pelanggan Kak');
  await page.locator('#ai-session-detail').screenshot({ path: join(screenshots, 'profiles-session.png') });
  // Sesi tanpa profil hanya menawarkan tab sesi dan cara memasang profil.
  for (let i = 0; i < 5 && !(await strip.innerText()).includes('belum memakai'); i++) {
    await page.locator('#ai-session-next').click();
    await page.waitForTimeout(600);
  }
  assert.match(await strip.innerText(), /Sesi ini belum memakai profil AI/);
  assert.deepEqual(await page.locator('[data-ai-tab]:visible').allTextContents(), [
    'Percakapan',
    'Uji Coba',
    'Integrasi',
  ]);
  // Memasang data profil baru dari dialog.
  await strip.getByRole('button', { name: 'Pasang profil' }).click();
  const dialog = page.locator('#ai-attach-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.locator('#ai-attach-title').innerText(), 'Pasang profil ke promo-baru');
  await dialog.locator('label.ai-choice', { hasText: 'Toko Kopi Senja' }).click();
  assert.match(await dialog.locator('#ai-attach-warning').innerText(), /dipakai juga oleh cabang-dago, toko-utama/);
  await dialog.locator('label.ai-choice', { hasText: 'Buat data profil baru' }).click();
  await dialog.locator('input[name=name]').fill('Promo Lebaran');
  await dialog.getByRole('button', { name: 'Pasang profil' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await strip.getByText('Promo Lebaran').waitFor();
  const promo = (await ai.dataProfiles(client)).find(p => p.name === 'Promo Lebaran')!;
  assert.deepEqual(promo.sessions, ['promo-baru']);
  assert.equal((await ai.assistant(client, 'promo-baru')).enabled, false);
  assert.ok(await page.locator('[data-ai-tab="knowledge"]').isVisible());
  // Perilaku yang diketik di sini tersimpan otomatis ke data profil yang terpasang.
  await page.locator('[data-knowledge-tab="behavior"]').click();
  await page.locator('textarea[name=behavior]').fill('Promo khusus Lebaran');
  await until(
    page,
    async id => {
      const r = await fetch('/ai/data-profiles/' + id);
      return (await r.json()).behavior === 'Promo khusus Lebaran';
    },
    promo.id,
    5000,
  );
  // Cabut: AI berhenti untuk sesi itu, data profilnya tetap ada.
  await strip.getByRole('button', { name: 'Cabut' }).click();
  await strip.getByText('Sesi ini belum memakai profil AI').waitFor();
  assert.deepEqual((await ai.dataProfiles(client)).find(p => p.id === promo.id)!.sessions, []);

  // Tampilan Data Profil: daftar, lalu kelola langsung data profil yang tidak terpasang.
  await page.locator('[data-ai-view="profiles"]').click();
  const card = page.locator('.ai-profile-card', { hasText: 'Promo Lebaran' });
  await card.waitFor();
  assert.match(await card.innerText(), /Belum dipasang ke sesi mana pun/);
  assert.match(
    await page.locator('.ai-profile-card', { hasText: 'Toko Kopi Senja' }).innerText(),
    /cabang-dago[\s\S]*toko-utama/,
  );
  await page.locator('#ai-profiles-view').screenshot({ path: join(screenshots, 'profiles-list.png') });
  await card.getByRole('button', { name: 'Kelola isi' }).click();
  await page.locator('#ai-manage-name', { hasText: 'Promo Lebaran' }).waitFor();
  assert.deepEqual(await page.locator('[data-ai-tab]:visible').allTextContents(), ['Knowledge', 'Uji Coba']);
  assert.equal(await page.locator('#ai-session-picker').isHidden(), true);
  // Isi bisnis dikelola di halaman data koleksi milik data profil ini.
  await page.locator('[data-knowledge-tab="records"]').click();
  assert.equal(await page.locator('#ai-records-link').getAttribute('href'), '/dashboard/ai-data?profile=' + promo.id);
  await page.locator('#ai-manage-back').click();
  await card.filter({ hasText: '0 record' }).waitFor();
  // Buat dari daftar.
  await page.locator('#ai-profile-new').click();
  await page.locator('#ai-profile-create-form [name=name]').fill('Laundry Bersih');
  await page.locator('#ai-profile-create-form').getByRole('button', { name: 'Buat data profil' }).click();
  await page.locator('#ai-manage-name', { hasText: 'Laundry Bersih' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();

  // Ponsel: menu satu baris, strip bertumpuk, kartu data profil, tanpa geser ke samping.
  {
    const { page, errors, context } = await open(clientToken, '/dashboard/ai', 390, 844);
    await page.locator('#ai-profile-strip').getByText('Toko Kopi Senja').waitFor();
    const links = await page
      .locator('.tabs .nav-links > a:visible')
      .evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
    assert.equal(new Set(links).size, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.locator('#ai-knowledge-select').isVisible(), true);
    await page.screenshot({ path: join(screenshots, 'profiles-mobile.png'), fullPage: true });
    await page.locator('[data-ai-view="profiles"]').click();
    await page.locator('.ai-profile-card').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Pemilik: halaman Profil AI mengatur ketersediaan dan membuka profil di Editor profil.
  {
    const { page, errors, context } = await open(ownerToken, '/dashboard/admin/profiles');
    const row = page.locator('#admin-profiles-list tr', { hasText: 'Kafe' });
    await row.waitFor();
    assert.match(await row.innerText(), /2 sesi/);
    assert.equal(
      await row.getByRole('link', { name: 'Buka di Editor profil' }).getAttribute('href'),
      '/dashboard/admin/ai-builder?profile=' + graphId,
    );
    await row.locator('label.admin-profile-toggle').click();
    await row.getByText('Nonaktif', { exact: true }).waitFor();
    const listed = (await (await context.request.get(origin + '/api/admin/ai/profiles')).json()).find(
      (p: any) => p.id === graphId,
    );
    assert.equal(listed.enabled, false);
    await page.locator('#admin-profiles-list tr', { hasText: 'Kafe' }).locator('label.admin-profile-toggle').click();
    await page.locator('#admin-profiles-list tr', { hasText: 'Kafe' }).getByText('Aktif', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { page, errors, context } = await open(ownerToken, '/dashboard/admin/profiles', 390, 844);
    await page.locator('#admin-menu-toggle').click();
    await page.locator('#adminsubmenu a', { hasText: 'Editor profil' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Multi-profile UI: session strip, attach dialog, Data Profil, manage, detach, and owner Profil AI checks passed on desktop and phone',
  );
} finally {
  await browser?.close();
  await gateway.stop();
  await new Promise<void>(r => server.close(() => r()));
  for (const id of [client, owner]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [graphId]);
  await db.execute('DELETE FROM ai_profile_types WHERE id=?', [graphId]);
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}
