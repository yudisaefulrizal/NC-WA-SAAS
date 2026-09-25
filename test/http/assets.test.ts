// Tes versi aset: browser yang memakai skrip lama setelah deploy terlihat persis seperti fitur rusak, jadi setiap
// halaman harus memberi URL aset yang berubah setiap kali file di baliknya berubah.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { app } from '../../src/http/app.js';
import { db } from '../../src/libraries/db.js';

after(async () => {
  await db.end();
});

const hashOf = (name: string) =>
  createHash('sha256')
    .update(readFileSync('public/' + name))
    .digest('hex')
    .slice(0, 12);

// Setiap skrip dan stylesheet yang dirujuk halaman, beserta hash yang diberikan.
const assets = (page: string) =>
  [...page.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))(?:\?v=([a-f0-9]{12}))?"/g)].map(m => ({
    path: m[1]!,
    stamp: m[2],
  }));

test('pages reference assets by content hash and hashed URLs are cached immutably', async () => {
  const page = (await request(app).get('/dashboard').expect(200)).text;
  const linked = assets(page);
  assert.ok(
    linked.some(a => a.path === '/dashboard/js/core.js'),
    'halaman tidak memuat core.js',
  );
  assert.ok(
    linked.some(a => a.path === '/dashboard/css/base.css'),
    'halaman tidak memuat base.css',
  );
  // Hash harus berasal dari isi file, kalau tidak deploy tidak membatalkan cache apa pun, dan tidak boleh ada rujukan
  // tanpa versi, karena satu request itu akan terus memakai salinan lama.
  for (const a of linked) assert.equal(a.stamp, hashOf(a.path.slice(1)), 'aset tanpa versi yang benar: ' + a.path);

  const asset = await request(app).get(`${linked[0]!.path}?v=${linked[0]!.stamp}`).expect(200);
  assert.match(asset.headers['cache-control'], /immutable/, 'aset berhash tidak dicache permanen');
  assert.match(asset.headers['cache-control'], /max-age=31536000/);
  // Tanpa hash file harus selalu divalidasi ulang, supaya tautan lama tidak tersimpan selamanya.
  const plain = await request(app).get('/dashboard/js/core.js').expect(200);
  assert.doesNotMatch(plain.headers['cache-control'] ?? '', /immutable/, 'aset tanpa versi ikut dicache permanen');
});

test('the AI Studio page is versioned with its own assets', async () => {
  const page = (await request(app).get('/dashboard/admin/ai-studio').expect(200)).text;
  assert.match(page, new RegExp('/ai-studio/studio\\.js\\?v=' + hashOf('ai-studio/studio.js')));
  assert.match(page, new RegExp('/ai-studio/studio\\.css\\?v=' + hashOf('ai-studio/studio.css')));
});
