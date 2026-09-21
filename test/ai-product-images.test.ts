import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import sharp from 'sharp';
import {db} from '../src/db.js';
import {ProductImageStore} from '../src/ai-product-images.js';

const root = await mkdtemp(join(tmpdir(), 'ncwa-product-images-'));
const store = new ProductImageStore(root);
const accounts: string[] = [];
async function account() {
  const id = randomUUID();
  accounts.push(id);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [id, id + '@test.invalid', 'unused']);
  return id;
}
after(async () => {
  for (const id of accounts) { await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]); await db.execute('DELETE FROM accounts WHERE id=?', [id]); }
  await db.end();
  await rm(root, {recursive: true, force: true});
});

test('Uploaded photo is downscaled to the width limit, re-encoded to JPEG, and stored per account', async () => {
  const accountId = await account();
  const wide = await sharp({create: {width: 3000, height: 1500, channels: 3, background: {r: 200, g: 100, b: 50}}}).png().toBuffer();
  const saved = await store.save(accountId, 'shop', 'wide.png', Readable.from(wide));
  assert.equal(saved.mimetype, 'image/jpeg');
  const file = await store.get(accountId, saved.id);
  const meta = await sharp(await sharp(file.path).toBuffer()).metadata();
  assert.equal(meta.width, 1920);
  assert.equal(meta.format, 'jpeg');
  const [rows] = await db.execute<any[]>('SELECT account_id,session_id FROM ai_product_images WHERE id=?', [saved.id]);
  assert.equal(rows[0].account_id, accountId);
  assert.equal(rows[0].session_id, 'shop');
});

test('A narrower photo is kept at its original width instead of being enlarged', async () => {
  const accountId = await account();
  const small = await sharp({create: {width: 400, height: 300, channels: 3, background: {r: 10, g: 10, b: 10}}}).png().toBuffer();
  const saved = await store.save(accountId, 'shop', 'small.png', Readable.from(small));
  const file = await store.get(accountId, saved.id);
  const meta = await sharp(file.path).metadata();
  assert.equal(meta.width, 400);
});

test('Non-image uploads are rejected and accounts cannot read each other\'s photos', async () => {
  const a = await account(), b = await account();
  await assert.rejects(store.save(a, 'shop', 'doc.txt', Readable.from(Buffer.from('not an image'))), {code: 'unsupported_file_type'});
  const png = await sharp({create: {width: 10, height: 10, channels: 3, background: {r: 1, g: 2, b: 3}}}).png().toBuffer();
  const saved = await store.save(a, 'shop', 'photo.png', Readable.from(png));
  await assert.rejects(store.get(b, saved.id), {code: 'image_not_found'});
  await store.remove(a, saved.id);
  await assert.rejects(store.get(a, saved.id), {code: 'image_not_found'});
  const [rows] = await db.execute<any[]>('SELECT id FROM ai_product_images WHERE id=?', [saved.id]);
  assert.equal(rows.length, 0);
});
