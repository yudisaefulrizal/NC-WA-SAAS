// Pemeriksaan browser CS Lembaga Pendidikan: Profil Lembaga di Knowledge, Program, Jadwal, Dokumen (unggah, ganti,
// deskripsi), dan Kontak pada sebuah sesi, kartu Data Profil dan dialog buat, kanvas pendidikan di AI Studio, dan
// tab yang sama di lebar ponsel tanpa geser ke samping.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { ai } from '../../src/components/ai/domain/service.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { setProfileEnabled } from '../../src/components/ai/domain/profiles/registry.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-edu-browser-'));
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
const [before] = await db.query<any[]>("SELECT enabled FROM ai_profile_types WHERE id='pendidikan'");
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
let browser;
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
  await setProfileEnabled(owner, 'pendidikan', true);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const open = async (token: string, path: string, width = 1280, height = 900) => {
    const context = await browser!.newContext({
      viewport: { width, height },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.0.1.' + address++ },
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
    assert.equal(
      (
        await context.request.post(origin + '/sessions', { headers: { Origin: origin }, data: { id: 'psb-darulilmi' } })
      ).status(),
      200,
    );
    await context.close();
  }
  const profile = await ai.createDataProfile(client, { profile_type: 'pendidikan', name: "Ma'had Darul Ilmi" });
  await ai.attachProfile(client, 'psb-darulilmi', { data_profile_id: profile.id, enabled: true });
  const stored = async () => ai.dataProfile(client, profile.id);
  await mkdir(screenshots, { recursive: true });

  const { page, errors, context } = await open(clientToken, '/dashboard/ai');
  const strip = page.locator('#ai-profile-strip');
  await strip.getByText("Ma'had Darul Ilmi").waitFor();
  assert.match(await strip.innerText(), /memakai profil CS Lembaga Pendidikan/);
  const tabs = await page.locator('[data-ai-tab]:visible').allTextContents();
  for (const tab of ['Knowledge', 'Percakapan', 'Riwayat pemakaian', 'Uji Coba'])
    assert.ok(tabs.includes(tab), tab + ' tampil');
  for (const tab of ['Pesanan Masuk', 'Program', 'Jadwal', 'Dokumen', 'Kontak'])
    assert.ok(!tabs.includes(tab), tab + ' bukan menu atas');
  // Knowledge: bagian-bagian milik lembaga, dibuka di Profil Lembaga dengan istilah pesantren.
  assert.deepEqual(await page.locator('[data-knowledge-tab]:visible').allTextContents(), [
    'Perilaku AI',
    'Profil Lembaga',
    'Program',
    'Jadwal',
    'Dokumen',
    'Kontak',
    'FAQ',
    'Fallback Tim',
  ]);
  for (const name of ['edu_kind', 'edu_peserta'])
    assert.equal(await page.locator(`[form=ai-form][name=${name}]`).count(), 0);
  await page.locator('[form=ai-form][name=edu_lembaga]').fill('Pesantren di Lembang, berdiri 1998.');
  await until(
    page,
    async id =>
      (await (await fetch('/ai/data-profiles/' + id)).json()).edu.lembaga === 'Pesantren di Lembang, berdiri 1998.',
    profile.id,
    5000,
  );
  await page.locator('#ai-session-detail').screenshot({ path: join(screenshots, 'edu-knowledge.png') });
  // Program: tambah, ganti nama, dan beri deskripsi; setiap suntingan tersimpan sendiri.
  await page.locator('[data-knowledge-tab=program]').click();
  await page.locator('#edu-program-add').click();
  await page.locator('#edu-program-name').waitFor();
  assert.equal(await page.locator('#edu-program-name').inputValue(), 'Program baru');
  await page.locator('#edu-program-name').fill('Tahfidz Mukim Putra');
  await page
    .locator('#edu-program-description')
    .fill('Program tahfidz berasrama, lama studi 3 tahun.\nBiaya bulanan Rp 1.250.000.');
  await page.locator('#edu-programs').getByText('Tahfidz Mukim Putra').waitFor();
  await until(
    page,
    async id => {
      const p = await (await fetch('/ai/data-profiles/' + id + '/programs')).json();
      return p.length === 1 && p[0].description.includes('Rp 1.250.000');
    },
    profile.id,
    5000,
  );
  await page.locator('#edu-program-add').click();
  await page.locator('#edu-programs').getByText('Program baru').waitFor();
  await page.locator('#edu-program-delete').click();
  await page.waitForFunction(
    () => document.querySelectorAll('#edu-programs .edu-program-item').length === 1,
    undefined,
    { timeout: 5000 },
  );
  assert.equal(
    await page
      .locator('#edu-programs .edu-program-item')
      .innerText()
      .then(t => t.startsWith('Tahfidz Mukim Putra')),
    true,
  );
  await page.locator('#ai-session-detail').screenshot({ path: join(screenshots, 'edu-program.png') });
  // Jadwal: satu teks panjang.
  await page.locator('[data-knowledge-tab=jadwal]').click();
  await page
    .locator('#edu-jadwal')
    .fill('Gelombang 1: 1 November – 31 Desember 2026\nTes masuk setiap Sabtu pukul 08.00');
  await until(
    page,
    async id => (await (await fetch('/ai/data-profiles/' + id)).json()).edu.jadwal.startsWith('Gelombang 1'),
    profile.id,
    5000,
  );
  assert.match(await page.locator('#edu-jadwal-count').innerText(), /\/ 8\.000 karakter/);
  // Dokumen: unggah dengan deskripsi, ganti file, sunting deskripsi.
  await page.locator('[data-knowledge-tab=dokumen]').click();
  await page.locator('#edu-document-description').fill('Brosur umum PSB 2027, kirim bila ditanya brosur.');
  await page
    .locator('#edu-document-file')
    .setInputFiles({ name: 'brosur-psb.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  await page.locator('#edu-document-upload').click();
  const row = page.locator('.edu-document', { hasText: 'brosur-psb.pdf' });
  await row.waitFor();
  assert.equal(await row.locator('.edu-file-badge').innerText(), 'PDF');
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0f9d6b' } })
    .png()
    .toBuffer();
  await row
    .locator('.edu-replace input')
    .setInputFiles({ name: 'denah-lokasi.png', mimeType: 'image/png', buffer: png });
  await page.locator('.edu-document', { hasText: 'denah-lokasi.png' }).waitFor();
  await page.locator('.edu-document textarea').fill('Denah dan rute ke pesantren.');
  await until(
    page,
    async id => {
      const d = await (await fetch('/ai/data-profiles/' + id + '/documents')).json();
      return (
        d.length === 1 && d[0].filename === 'denah-lokasi.png' && d[0].description === 'Denah dan rute ke pesantren.'
      );
    },
    profile.id,
    5000,
  );
  assert.equal(await page.locator('#edu-document-count').innerText(), '1 dari 20 dokumen');
  await page.locator('#ai-session-detail').screenshot({ path: join(screenshots, 'edu-dokumen.png') });
  // Kontak: baris baru dibuat setelah Bagian dan Kontak terisi, lalu diperbarui di tempat.
  await page.locator('[data-knowledge-tab=kontak]').click();
  await page.locator('#edu-contact-add').click();
  const contact = page.locator('.edu-contact').last();
  await contact.locator('input').nth(0).fill('Pendaftaran');
  await contact.locator('input').nth(1).fill('0856-2200-1100');
  await contact.locator('textarea').fill('Kendala pendaftaran: formulir online, berkas, jadwal tes.');
  await until(
    page,
    async id => {
      const c = await (await fetch('/ai/data-profiles/' + id + '/contacts')).json();
      return c.length === 1 && c[0].deskripsi.startsWith('Kendala');
    },
    profile.id,
    6000,
  );
  await contact.locator('input').nth(1).fill('0856-2200-1199');
  await until(
    page,
    async id => {
      const c = await (await fetch('/ai/data-profiles/' + id + '/contacts')).json();
      return c.length === 1 && c[0].kontak === '0856-2200-1199';
    },
    profile.id,
    6000,
  );
  await page.locator('#ai-session-detail').screenshot({ path: join(screenshots, 'edu-kontak.png') });
  const saved = await stored();
  assert.equal(saved.edu?.lembaga, 'Pesantren di Lembang, berdiri 1998.');
  // Data Profil: kartu menghitung program, dokumen, dan kontak; mengelolanya menampilkan tab pendidikan.
  await page.locator('[data-ai-view="profiles"]').click();
  const card = page.locator('.ai-profile-card', { hasText: "Ma'had Darul Ilmi" });
  await card.waitFor();
  assert.match(await card.innerText(), /1 program[\s\S]*1 dokumen[\s\S]*1 kontak/);
  await card.getByRole('button', { name: 'Kelola isi' }).click();
  await page.locator('#ai-manage-name', { hasText: "Ma'had Darul Ilmi" }).waitFor();
  assert.deepEqual(await page.locator('[data-ai-tab]:visible').allTextContents(), ['Knowledge', 'Uji Coba']);
  assert.equal(await page.locator('[data-knowledge-tab=dokumen]').isVisible(), true);
  await page.locator('#ai-manage-back').click();
  await page.locator('#ai-profile-new').click();
  await page.locator('#ai-profile-create-type').selectOption('pendidikan');
  await page.locator('#ai-profile-create-form [name=name]').fill('Kursus Bahasa');
  await page.locator('#ai-profile-create-form').getByRole('button', { name: 'Buat data profil' }).click();
  await page.locator('#ai-manage-name', { hasText: 'Kursus Bahasa' }).waitFor();
  await page.locator('[data-knowledge-tab=lembaga][aria-pressed=true]').waitFor();
  assert.deepEqual(errors, []);
  await context.close();

  // Ponsel: tab satu baris, pemilih program menggantikan daftar, tidak ada geser ke samping di tab pendidikan mana pun.
  {
    const { page, errors, context } = await open(clientToken, '/dashboard/ai', 390, 844);
    await page.locator('#ai-profile-strip').getByText("Ma'had Darul Ilmi").waitFor();
    const noScroll = async () =>
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await noScroll();
    // Di ponsel bagian Knowledge dipilih dari dropdown.
    assert.equal(await page.locator('#ai-knowledge-select').isVisible(), true);
    for (const tab of ['program', 'jadwal', 'dokumen', 'kontak']) {
      await page.locator('#ai-knowledge-select').selectOption(tab);
      await page.locator('#ai-knowledge-tab-' + tab).waitFor();
      await noScroll();
      await page.screenshot({ path: join(screenshots, `edu-mobile-${tab}.png`), fullPage: true });
    }
    await page.locator('#ai-knowledge-select').selectOption('program');
    assert.equal(await page.locator('#edu-program-select').isVisible(), true);
    assert.equal(await page.locator('#edu-programs').isVisible(), false);
    assert.equal(await page.locator('#edu-program-add').isVisible(), true);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Pemilik: AI Studio menggambar pipeline pendidikan dan data simulasinya sendiri.
  {
    const { page, errors, context } = await open(ownerToken, '/dashboard/admin/ai-studio?profile=pendidikan');
    await page.locator('#canvas-profile', { hasText: 'CS Lembaga Pendidikan' }).waitFor();
    for (const node of ['profil_lembaga', 'program', 'jadwal', 'kontak', 'get_kontak', 'kirim_dokumen'])
      assert.equal(await page.locator(`#nodes [data-node="${node}"]`).count(), 1, node);
    assert.equal(await page.locator('#nodes [data-node="layanan"]').count(), 0);
    // Data simulasi berada di <details> yang tertutup, jadi flag hidden tiap blok yang diganti profilnya.
    const flags = () =>
      page.evaluate(() => [
        document.getElementById('edu-sandbox')!.hidden,
        document.getElementById('cs-sandbox')!.hidden,
      ]);
    assert.deepEqual(await flags(), [false, true]);
    await page.locator('#nodes [data-node="kontak"]').click();
    assert.deepEqual(await page.locator('#node-tools label').allTextContents(), ['get_kontak']);
    await page.screenshot({ path: join(screenshots, 'edu-studio.png') });
    await page.locator('#profile-select').selectOption('cs');
    await page.locator('#canvas-profile', { hasText: 'CS Usaha' }).waitFor();
    assert.equal(await page.locator('#nodes [data-node="layanan"]').count(), 1);
    assert.deepEqual(await flags(), [true, false]);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'CS Lembaga Pendidikan UI: Knowledge, Program, Jadwal, Dokumen, Kontak, Data Profil, create dialog, phone layout and AI Studio checks passed',
  );
} finally {
  await setProfileEnabled(owner, 'pendidikan', Boolean(before[0]?.enabled)).catch(() => {});
  await browser?.close();
  await gateway.stop();
  await new Promise<void>(r => server.close(() => r()));
  for (const id of [client, owner]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}
