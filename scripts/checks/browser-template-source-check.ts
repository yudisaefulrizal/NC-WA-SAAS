// Pemeriksaan browser dialog template Auto Share: pilihan sumber harus mengubah bentuk form, baris header kustom
// harus bisa ditambah, dan variabel dari uji panggilan harus bisa disisipkan ke pesan. Masih gagal karena menunggu
// tombol variabel yang tersembunyi di wizard template tiga tahap.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { createGateway } from '../../src/http/gateway.js';

if (process.env.AUTO_SHARE_ISOLATED !== '1')
  throw Error('Jalankan melalui scripts/test/test-all.ts agar antrean terisolasi.');
const temporary = await mkdtemp(join(tmpdir(), 'ncwa-template-source-'));
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(
  () => async (_id, update) => {
    update({ status: 'connected' });
    return {
      close() {},
      async logout() {},
      async typing() {},
      async send() {
        return randomUUID();
      },
    };
  },
  temporary,
);
const server = createApp(gateway).listen(port, '127.0.0.1');
const account = randomUUID(),
  token = randomUUID();
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
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 780 },
  ]) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    // validatePublicUrl memang menolak endpoint loopback, jadi transport sungguhan diuji di tes backend dan panggilan
    // dialog dijawab di sini.
    let sentHeaders: { name: string; value: string }[] = [];
    let previewCalls = 0,
      lastPreviewBody: Record<string, unknown> = {};
    await page.route('**/auto-share/templates/test-source', async route => {
      const parsed = JSON.parse(route.request().postData() ?? '{}');
      sentHeaders = parsed.source_headers ?? [];
      if (parsed.message !== undefined) {
        previewCalls++;
        lastPreviewBody = parsed;
      }
      // Ditahan sebentar supaya klik kedua selama request bisa teramati.
      await new Promise(r => setTimeout(r, 400));
      const sent = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          variables: { jumlah: '247', sisa_kuota: '53', poster: 'https://example.com/poster.png' },
          media: null,
          preview: sent.message ? { message: 'Peserta 247 orang.', tidied: Boolean(sent.tidy), note: null } : null,
          raw: '{\n "jumlah": 247\n}',
        }),
      });
    });
    await page.goto(origin + '/dashboard/auto-share');
    await page.locator('[data-share-tab="templates"]').click();
    await page.locator('#share-add-template').click();
    await page.locator('#share-template-dialog[open]').waitFor();

    // Langkah 1: tanpa sumber, form tetap persis seperti sebelum fitur ini ada.
    assert.equal(
      await page.locator('#share-source-fields').isHidden(),
      true,
      'blok sumber tampil padahal sumber data kosong',
    );
    assert.equal(await page.locator('#share-variable-bar').isHidden(), true, 'baris variabel tampil tanpa sumber data');

    // Langkah 2: memilih sumber endpoint memunculkan bidang tambahan.
    await page.locator('[name="source_mode"][value="endpoint"]').check();
    assert.equal(
      await page.locator('#share-source-fields').isHidden(),
      false,
      'blok sumber tidak muncul setelah dipilih',
    );
    assert.equal(
      await page.locator('#share-media-source option[value="endpoint"]').evaluate(o => (o as HTMLOptionElement).hidden),
      false,
      'opsi media endpoint tidak muncul setelah sumber dipilih',
    );
    await page.locator('#share-template-next').click();
    assert.equal(
      await page.locator('[data-template-step="1"]').isHidden(),
      false,
      'API dapat melewati langkah dasar tanpa tes koneksi',
    );
    assert.match(
      await page.locator('#share-source-result').innerText(),
      /Uji koneksi/,
      'peringatan tes koneksi tidak terlihat',
    );

    // Langkah 3: header kustom bisa ditambah dan dihapus.
    await page.locator('#share-header-add').click();
    await page.locator('#share-header-rows .header-row').first().waitFor();
    assert.equal(await page.locator('#share-header-rows .header-row').count(), 1, 'baris header tidak bertambah');
    await page.locator('#share-header-rows .header-row [data-header-name]').fill('X-API-Key');
    await page.locator('#share-header-rows .header-row [data-header-value]').fill('rahasia');

    // Langkah 4: uji endpoint menampilkan daftar variabel dan respons mentahnya.
    await page.locator('[name="source_endpoint"]').fill('https://data.example.com/statistik');
    await page.locator('#share-template-form [name="name"]').fill('Template Sumber');
    await page.locator('#share-source-test').click();
    await page.locator('#share-source-vars button').first().waitFor();
    assert.equal(await page.locator('#share-source-vars button').count(), 3, 'variabel tidak lengkap');
    assert.match(await page.locator('#share-source-result').innerText(), /3 variabel tersedia/);
    assert.equal(
      await page.locator('#share-variable-bar').isHidden(),
      false,
      'baris variabel tidak muncul setelah tes',
    );
    assert.deepEqual(sentHeaders, [{ name: 'X-API-Key', value: 'rahasia' }], 'header custom tidak dikirim ke server');
    assert.match(
      await page.locator('#share-source-result').innerText(),
      /Lihat respons endpoint/,
      'respons mentah tidak ditawarkan',
    );

    // Langkah pertama yang berhasil membuka langkah isi; pengaturan API tidak pernah memenuhi editor.
    await page.locator('#share-template-next').click();
    assert.equal(await page.locator('[data-template-step="1"]').isHidden(), true, 'langkah dasar belum tersembunyi');
    assert.equal(await page.locator('[data-template-step="2"]').isHidden(), false, 'langkah konten belum terbuka');
    await page.locator('#share-media-type').selectOption('image');
    assert.equal(
      await page.locator('#share-asset-field').isHidden(),
      false,
      'pilihan asset hilang untuk template gambar',
    );

    // Langkah 5: media dari endpoint dipilih lewat nama variabel, bukan blok media khusus.
    await page.locator('#share-media-source').selectOption('endpoint');
    assert.equal(
      await page.locator('#share-media-variable-field').isHidden(),
      false,
      'pemilih variabel media tidak muncul',
    );
    assert.equal(
      await page.locator('#share-asset-field').isHidden(),
      true,
      'pilihan galeri masih tampil untuk media endpoint',
    );
    assert.deepEqual(
      await page.locator('#share-media-variable option').allTextContents(),
      ['jumlah', 'sisa_kuota', 'poster'],
      'daftar variabel media tidak terisi dari hasil tes',
    );
    await page.locator('#share-media-variable').selectOption('poster');
    await page.locator('#share-media-source').selectOption('asset');
    assert.equal(
      await page.locator('#share-media-variable-field').isHidden(),
      true,
      'pemilih variabel media tidak tersembunyi kembali',
    );

    // Tombol pratinjau milik blok sumber dan ikut hilang bersamanya.
    assert.equal(
      await page.locator('#share-preview-row').isHidden(),
      false,
      'tombol pratinjau tidak tampil untuk template bersumber data',
    );

    // Langkah 6: mengeklik variabel menyisipkannya ke pesan di posisi kursor.
    await page.locator('[name="message"]').fill('Pendaftar ');
    await page.locator('#share-source-vars button').first().click();
    assert.match(
      await page.locator('[name="message"]').inputValue(),
      /\{\{jumlah\}\}/,
      'variabel tidak tersisip ke pesan',
    );

    // Pratinjau menjalankan jalur sebenarnya dan melaporkan apakah teksnya dirapikan.
    await page.locator('#share-tidy').check();
    await page.locator('[name="tidy_note"]').fill('Pakai poin bernomor');
    await page.locator('#share-template-next').click();
    assert.equal(
      await page.locator('[data-template-step="3"]').isHidden(),
      false,
      'langkah tinjau tidak terbuka untuk pratinjau',
    );
    previewCalls = 0;
    // Klik berulang selama request tidak boleh mengantrekan panggilan model tambahan, yang masing-masing memakan kredit
    // untuk pratinjau yang sama.
    await page.locator('#share-preview-run').click();
    assert.equal(
      await page.locator('#share-preview-run').isDisabled(),
      true,
      'tombol pratinjau tidak terkunci saat proses',
    );
    await page
      .locator('#share-preview-run')
      .click({ force: true, timeout: 1000 })
      .catch(() => {});
    await page
      .locator('#share-preview-run')
      .click({ force: true, timeout: 1000 })
      .catch(() => {});
    await page.locator('#share-preview-text').waitFor();
    await page.waitForFunction(() => !(document.getElementById('share-preview-run') as HTMLButtonElement).disabled);
    assert.equal(previewCalls, 1, 'tombol pratinjau memanggil server lebih dari sekali: ' + previewCalls);
    assert.equal(lastPreviewBody.tidy_note, 'Pakai poin bernomor', 'catatan perapihan tidak ikut dikirim ke pratinjau');
    assert.equal(lastPreviewBody.tidy, true, 'pilihan rapikan tidak ikut dikirim ke pratinjau');
    assert.match(
      await page.locator('#share-preview-text').innerText(),
      /Peserta 247 orang/,
      'pratinjau tidak menampilkan pesan',
    );
    assert.match(
      await page.locator('#share-preview-text').innerText(),
      /sudah dirapikan AI/,
      'pratinjau tidak menyebut hasil perapihan',
    );

    // Langkah 7: kembali ke tanpa sumber menutup semuanya lagi.
    await page.locator('#share-template-back').click();
    await page.locator('#share-template-back').click();
    await page.locator('[name="source_mode"][value="none"]').check();
    assert.equal(await page.locator('#share-source-fields').isHidden(), true, 'blok sumber tidak tersembunyi kembali');
    assert.equal(
      await page.locator('#share-variable-bar').isHidden(),
      true,
      'baris variabel tidak tersembunyi kembali',
    );
    assert.equal(
      await page.locator('#share-media-source').inputValue(),
      'asset',
      'sumber media tidak kembali ke galeri',
    );
    assert.equal(await page.locator('#share-preview-row').isHidden(), true, 'tombol pratinjau tidak ikut tersembunyi');
    assert.equal(await page.locator('#share-tidy-field').isHidden(), true, 'pilihan rapikan tidak ikut tersembunyi');

    // Langkah 8: simpan berjalan utuh, dan notifikasi harus terlihat di atas dialog yang terbuka. Dialog dari showModal()
    // berada di top layer, jadi z-index biasa akan membuat notifikasi tertutup. Galeri di fixture ini kosong, jadi template
    // media memang tidak bisa disimpan di sini. Langkah 7 mematikan sumber, jadi sumber dinyalakan lagi untuk menyimpan
    // template yang memakainya.
    await page.locator('[name="source_mode"][value="endpoint"]').check();
    await page.locator('[name="source_endpoint"]').fill('https://data.example.com/statistik');
    await page.locator('#share-source-test').click();
    await page.locator('#share-source-vars button').first().waitFor();
    await page.locator('#share-template-next').click();
    await page.locator('#share-media-type').selectOption('text');
    await page.locator('#share-tidy').check();
    // Catatan hanya muncul setelah perapian dinyalakan.
    assert.equal(
      await page.locator('#share-tidy-note-field').isHidden(),
      false,
      'kolom catatan perapihan tidak muncul setelah dicentang',
    );
    // Template yang tersimpan harus membawa setiap bidang sumber yang tampil di form. Pratinjau membaca checkbox langsung,
    // jadi bidang yang hilang dari payload ini tetap tampil benar di pratinjau sementara semua kiriman terjadwal diam-diam
    // mengabaikannya.
    let savedBody: Record<string, unknown> = {};
    await page.route('**/auto-share/templates', async route => {
      if (route.request().method() === 'POST') savedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fallback();
    });
    await page.locator('#share-template-form [name="message"]').fill('Halo tanpa variabel');
    await page.locator('#share-template-next').click();
    assert.equal(await page.locator('[data-template-step="3"]').isHidden(), false, 'langkah tinjau belum terbuka');
    await page.locator('#share-template-save').click();
    await page.locator('#message:popover-open').waitFor();
    assert.match(await page.locator('#message').innerText(), /Template tersimpan/, 'simpan template gagal');
    assert.equal(savedBody.tidy, true, 'pilihan rapikan tidak ikut tersimpan');
    assert.equal(savedBody.tidy_note, 'Pakai poin bernomor', 'catatan perapihan tidak ikut tersimpan');
    assert.equal(savedBody.source_mode, 'endpoint', 'sumber data tidak ikut tersimpan');
    assert.equal(savedBody.source_endpoint, 'https://data.example.com/statistik', 'endpoint tidak ikut tersimpan');

    const covered = await page.locator('#message').evaluate(el => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !(hit === el || el.contains(hit));
    });
    assert.equal(covered, false, 'notifikasi tertutup elemen lain meski dialog sudah ditutup');

    // Simpan baru separuh perjalanan: membuka lagi harus menampilkan apa yang tersimpan, kalau tidak suntingan berikutnya
    // diam-diam menyimpan checkbox sebagai tidak dicentang.
    await page.locator('#share-template-list').getByRole('button', { name: 'Ubah', exact: true }).first().click();
    await page.locator('#share-template-dialog[open]').waitFor();
    assert.equal(
      await page.locator('#share-tidy').isChecked(),
      true,
      'pilihan rapikan tidak dipulihkan saat template dibuka ulang',
    );
    assert.equal(
      await page.locator('[name="tidy_note"]').inputValue(),
      'Pakai poin bernomor',
      'catatan perapihan tidak dipulihkan',
    );
    assert.equal(
      await page.locator('[name="source_mode"]:checked').inputValue(),
      'endpoint',
      'sumber data tidak dipulihkan',
    );
    assert.equal(
      await page.locator('[name="source_endpoint"]').inputValue(),
      'https://data.example.com/statistik',
      'endpoint tidak dipulihkan',
    );
    await page.locator('#share-template-dialog [data-close="share-template-dialog"]').click();

    // Tidak ada langkah di atas yang boleh bergantung pada error halaman yang diabaikan.
    assert.deepEqual(errors, [], 'error JavaScript di halaman: ' + errors.join(' | '));
    await context.close();
  }
  console.log('Pemeriksaan browser form sumber data template lulus (desktop dan ponsel).');
} finally {
  await browser?.close();
  await new Promise<void>(r => {
    server.close(() => r());
  });
  await db.execute('DELETE FROM accounts WHERE id=?', [account]).catch(() => {});
  await db.end().catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
