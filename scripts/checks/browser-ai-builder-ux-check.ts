// Pemeriksaan browser alat kerja editor profil pada 1280/390 px: popover Tambah node (cari dan keyboard), nama node
// unik dengan ID dari nama (termasuk ID acak lama), penanda variabel dan menu Sisipkan variabel, simpan otomatis,
// daftar masalah, uji coba dengan jejak yang disorot di kanvas, serta unduh skill AI dan Tempel JSON. Model AI diganti
// transport tiruan di proses yang sama.
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
import { isJevModel } from '../../src/components/ai/domain/pipeline/models.js';
import { blankDefinition } from '../../src/components/ai/domain/builder/definition.js';
import { spoExample } from '../../src/components/ai/domain/builder/skill.js';
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
// Router di konfigurasi bisa memakai model JEV (Decisions API) atau model biasa; keduanya dijawab cabang "layanan".
const fake: AITransport = async c =>
  c.call_role !== 'router'
    ? '{"answer":"Selesai"}'
    : isJevModel(c.model)
      ? '{"branch":{"choice":"layanan"}}'
      : '{"branch":"layanan","fallback_terkait":[]}';
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
      extraHTTPHeaders: { 'X-Forwarded-For': '10.3.0.' + (width === 1280 ? 1 : 2) },
    });
    await context.addCookies([{ name: 'ncwa_session', value: ownerToken, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => void d.accept());
    await page.goto(origin + '/dashboard/admin/ai-builder');
    await page.locator('#paste').waitFor();
    await page.screenshot({ path: join(screenshots, 'ai-builder-library-' + width + '.png'), fullPage: true });
    // Profil uji berbentuk katalog (Router → Layanan/Sapaan, koleksi Produk) dibuat lewat API, lalu dibuka di editor.
    const created = await (
      await context.request.post(origin + '/api/admin/ai/builder', {
        data: catalogGraph(),
        headers: { Origin: origin },
      })
    ).json();
    await page.goto(origin + '/dashboard/admin/ai-builder?profile=' + created.id);
    await page.locator('[data-node="layanan"]').waitFor();
    const id = new URL(page.url()).searchParams.get('profile')!;
    ids.push(id);
    const inspector = page.locator('#inspector');
    const saved = () => page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    const exported = async () => (await context.request.get(origin + '/api/admin/ai/builder/' + id + '/export')).json();
    const select = async (node: string) => {
      if (width === 390) await page.locator('#node-picker select').selectOption(node);
      else await page.locator(`[data-node="${node}"] .node-heading`).click();
    };

    // Tambah node lewat keyboard: "/" membuka popover, pencarian menyaring, Enter menambah item teratas.
    await page.locator('#viewport').focus();
    await page.keyboard.press('/');
    await page.locator('#palette').waitFor();
    await page.locator('#node-search').fill('simpan');
    assert.equal(await page.locator('#node-types .palette-item.active').getAttribute('data-kind'), 'data_table');
    assert.equal(
      await page.locator('#node-types').getByRole('button', { name: 'Agent', exact: true }).isHidden(),
      true,
    );
    await page.locator('#node-search').press('Enter');
    await page.locator('#palette').waitFor({ state: 'hidden' });
    await inspector.getByLabel('Koleksi', { exact: true }).waitFor();
    await inspector.getByRole('button', { name: 'Hapus node', exact: true }).click();

    // Nama node unik dan ID-nya mengikuti nama: nama kembar ditandai dan menjadi masalah terbit.
    await page.locator('#add-node').click();
    await page.locator('#node-types').getByRole('button', { name: 'Agent', exact: true }).click();
    const name = inspector.getByLabel('Nama node', { exact: true });
    await name.fill('Sapaan');
    await inspector.getByText('Nama sudah dipakai node lain.').waitFor();
    await page.locator('#issues-button').filter({ hasText: 'masalah' }).waitFor();
    // Spasi di nama otomatis menjadi _.
    await name.fill('Sapaan malam');
    assert.equal(await name.inputValue(), 'Sapaan_malam');
    await inspector.locator('.inspector-head small', { hasText: 'nodes.sapaan_malam' }).waitFor();
    assert.equal(await inspector.getByText('Nama sudah dipakai node lain.').isHidden(), true);
    await inspector.getByRole('button', { name: 'Hapus node', exact: true }).click();

    // Instruksi: variabel tak dikenal ditandai, variabel dari menu disisipkan di posisi kursor.
    await select('layanan');
    const prompt = inspector.getByLabel('Instruksi', { exact: true });
    const original = await prompt.inputValue();
    await prompt.fill(original + ' {{salah.ketik}}');
    await inspector.getByText('1 variabel tidak dikenal').waitFor();
    await prompt.fill(original + ' Sapa ');
    await inspector.getByRole('button', { name: 'Sisipkan variabel' }).first().click();
    await page.locator('#variable-menu').waitFor();
    await page.locator('#variable-search').fill('customer.name');
    await page.locator('#variable-list').getByRole('button', { name: '{{customer.name}}' }).click();
    assert.equal(await prompt.inputValue(), original + ' Sapa {{customer.name}}');
    assert.equal(await inspector.locator('.var-backdrop mark:not(.unknown)').count(), 1);
    await saved();
    assert.equal(
      (await exported()).nodes.find((n: any) => n.id === 'layanan').prompt,
      original + ' Sapa {{customer.name}}',
    );

    // Memutus koneksi keluar memunculkan masalah; menu masalah membuka node terkait dan Terbitkan dinonaktifkan.
    const next = (await exported()).edges.find((e: any) => e.source === 'layanan' && e.port === 'next').target;
    await inspector.getByLabel('Lanjut', { exact: true }).selectOption('');
    await page.locator('#issues-button').filter({ hasText: 'masalah' }).waitFor();
    assert.equal(await page.locator('#publish').isDisabled(), true);
    await select('router');
    await page.locator('#issues-button').click();
    await page.locator('#issues-list .menu-item').first().click();
    await inspector.locator('.inspector-head small', { hasText: 'nodes.layanan' }).waitFor();
    await inspector.getByLabel('Lanjut', { exact: true }).selectOption(next);
    await page.locator('#issues-button').waitFor({ state: 'hidden' });
    await saved();

    // Uji coba di samping kanvas: jawaban, jejak per langkah, sorotan jalur, detail langkah, lalu sembunyikan.
    await page.locator('#test-toggle').click();
    await page.locator('#test-message').fill('Ada produk apa?');
    await page.locator('#test-message').press('Control+Enter');
    await page.locator('#chat .bubble.assistant', { hasText: 'Selesai' }).waitFor();
    await page.locator('#chat .trace summary', { hasText: 'panggilan model' }).waitFor();
    assert.ok((await page.locator('#chat .trace-step').count()) >= 3);
    assert.ok((await page.locator('#nodes .step-badge').count()) >= 3);
    await page.locator('#trace-banner').waitFor();
    await page.locator('#chat .trace-step', { hasText: 'Router' }).click();
    await page.locator('#chat .trace-detail').getByText('Hasil').waitFor();
    assert.equal(await page.locator('[data-node="router"].selected').count(), 1);
    await page.screenshot({ path: join(screenshots, 'ai-builder-test-' + width + '.png'), fullPage: true });
    await page.locator('#clear-trace').click();
    assert.equal(await page.locator('#nodes .step-badge').count(), 0);
    await page.locator('#reset-test').click();
    assert.equal(await page.locator('#chat .bubble').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

    // ID acak dari editor lama diganti ID dari nama saat dibuka, beserta rujukan variabelnya.
    const legacy = blankDefinition('Profil lama ' + width);
    legacy.nodes[1].id = 'agent_1234abcd';
    legacy.nodes[2].value = '{{nodes.agent_1234abcd.answer}}';
    legacy.edges = legacy.edges.map(e => ({
      ...e,
      source: e.source === 'agent' ? 'agent_1234abcd' : e.source,
      target: e.target === 'agent' ? 'agent_1234abcd' : e.target,
    }));
    const legacyProfile = await (
      await context.request.post(origin + '/api/admin/ai/builder', { data: legacy, headers: { Origin: origin } })
    ).json();
    ids.push(legacyProfile.id);
    await page.goto(origin + '/dashboard/admin/ai-builder?profile=' + legacyProfile.id);
    await page.locator('[data-node="asisten"]').waitFor();
    await saved();
    const tidy = await (
      await context.request.get(origin + '/api/admin/ai/builder/' + legacyProfile.id + '/export')
    ).json();
    assert.equal(tidy.nodes.find((n: any) => n.type === 'output').value, '{{nodes.asisten.answer}}');
    assert.ok(tidy.edges.some((e: any) => e.target === 'asisten'));

    // Dua memori, bentuk node, dan Rapikan sesuai jenis node pada contoh S-P-O dari skill.
    const spo = await (
      await context.request.post(origin + '/api/admin/ai/builder', { data: spoExample(), headers: { Origin: origin } })
    ).json();
    ids.push(spo.id);
    await page.goto(origin + '/dashboard/admin/ai-builder?profile=' + spo.id);
    await page.locator('[data-node="memori_konteks"]').waitFor();
    assert.equal(await page.locator('[data-context-connection="memori_konteks:maksud"]').count(), 1);
    assert.equal(
      await page.locator('path.context-write[data-context-connection="memori_konteks:ringkas_konteks"]').count(),
      1,
    );
    assert.equal(await page.locator('[data-memory-connection="memori_percakapan:maksud"]').count(), 0);
    await select('maksud');
    assert.equal(await inspector.getByLabel('Memori konteks', { exact: true }).inputValue(), 'memori_konteks');
    assert.equal(await inspector.getByLabel('Memori percakapan', { exact: true }).inputValue(), '');
    // Satu jenis node, satu ilustrasi: semua Agent memakai gambar yang sama, jenis berbeda memakai gambar berbeda.
    const art = (id: string) => page.locator(`[data-node="${id}"] .node-illustration`).innerHTML();
    assert.equal(await art('informasi'), await art('layanan'));
    assert.equal(await art('informasi'), await art('sapaan'));
    assert.notEqual(await art('informasi'), await art('maksud'));
    await page.locator('#layout').click();
    await saved();
    const boxes = await page.locator('#nodes .graph-node').evaluateAll(els =>
      els.map(el => ({
        id: (el as HTMLElement).dataset.node!,
        type: (el as HTMLElement).dataset.type!,
        x: (el as HTMLElement).offsetLeft,
        y: (el as HTMLElement).offsetTop,
        w: (el as HTMLElement).offsetWidth,
        h: (el as HTMLElement).offsetHeight,
      })),
    );
    for (const a of boxes)
      for (const b of boxes)
        if (a.id < b.id)
          assert.ok(
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
            'Rapikan tidak boleh menumpuk ' + a.id + ' dan ' + b.id,
          );
    const at = (id: string) => boxes.find(b => b.id === id)!;
    assert.equal(at('cari_produk').x, at('informasi').x);
    assert.ok(at('cari_produk').y > at('informasi').y);
    const flowBottom = Math.max(...boxes.filter(b => !b.type.includes('memory')).map(b => b.y + b.h));
    assert.ok(at('memori_konteks').y > flowBottom && at('memori_percakapan').y > flowBottom);
    assert.ok(at('tim').x === at('jawaban').x && at('tim').y > at('jawaban').y);
    await page.screenshot({ path: join(screenshots, 'ai-builder-shapes-' + width + '.png'), fullPage: true });

    // Buat dengan bantuan AI: skill terunduh sebagai ZIP, jawaban AI (teks + blok ```json) bisa ditempel langsung.
    await page.goto(origin + '/dashboard/admin/ai-builder');
    const skill = await context.request.get(origin + (await page.locator('#skill-download').getAttribute('href')));
    assert.equal(skill.headers()['content-type'], 'application/zip');
    await page.locator('#paste').click();
    await page.locator('#paste-json').fill('Ini profilnya {"format":');
    await page.locator('#confirm-paste').click();
    await page.locator('#paste-error').filter({ hasText: 'JSON tidak valid' }).waitFor();
    const answer = blankDefinition('Profil dari AI ' + width);
    await page
      .locator('#paste-json')
      .fill('Berikut JSON-nya:\n```json\n' + JSON.stringify(answer, null, 2) + '\n```\nSilakan impor.');
    await page.locator('#confirm-paste').click();
    await page
      .locator('#import-preview')
      .getByText('Profil dari AI ' + width)
      .waitFor();
    await page.locator('#confirm-import').click();
    await page
      .locator('#profile-title')
      .filter({ hasText: 'Profil dari AI ' + width })
      .waitFor();
    ids.push(new URL(page.url()).searchParams.get('profile')!);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Alat kerja editor: Tambah node dengan keyboard, nama node unik dan ID dari nama, penanda dan menu variabel, simpan otomatis, daftar masalah, uji coba dengan jejak di kanvas, serta unduh skill AI dan Tempel JSON lulus pada 1280 dan 390px.',
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
