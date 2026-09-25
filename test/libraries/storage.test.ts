// Tes pemindahan penyimpanan: folder auth/ lama berisi login WhatsApp dan file klien bersama-sama; start pertama versi
// baru memindahkannya ke storage/ tanpa menghilangkan, menyembunyikan, atau menggabungkan apa pun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveLegacyStorage, storagePaths } from '../../src/libraries/storage.js';

const account = 'a6f388b1-7f38-46e3-b211-c57c854a4fa8';
async function legacyInstall(base: string) {
  const legacy = join(base, 'auth');
  const files: Record<string, string> = {
    [`${account}/toko/auth/creds.json`]: '{"login":true}',
    [`${account}/toko/session.json`]: '{"id":"toko"}',
    [`_media/${account}/IN1`]: 'media',
    [`_product-images/${account}/foto`]: 'foto',
    [`_ai-documents/${account}/brosur`]: 'pdf',
    [`_share-assets/${account}/aset`]: 'aset',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(legacy, path, '..'), { recursive: true });
    await writeFile(join(legacy, path), content);
  }
  return legacy;
}
async function assertMoved(root: string, legacy: string) {
  const paths = storagePaths(root);
  assert.equal(await readFile(join(paths.whatsapp, account, 'toko', 'auth', 'creds.json'), 'utf8'), '{"login":true}');
  assert.equal(await readFile(join(paths.whatsapp, account, 'toko', 'session.json'), 'utf8'), '{"id":"toko"}');
  assert.equal(await readFile(join(paths.media, account, 'IN1'), 'utf8'), 'media');
  assert.equal(await readFile(join(paths.productImages, account, 'foto'), 'utf8'), 'foto');
  assert.equal(await readFile(join(paths.aiDocuments, account, 'brosur'), 'utf8'), 'pdf');
  assert.equal(await readFile(join(paths.shareAssets, account, 'aset'), 'utf8'), 'aset');
  assert.equal(existsSync(legacy), false, 'auth/ lama masih tersisa');
}

test('auth/ moves into storage/ once, and a second start finds nothing to move', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ncwa-storage-'));
  try {
    const legacy = await legacyInstall(base),
      root = join(base, 'storage');
    assert.equal(await moveLegacyStorage(root, legacy), 5);
    await assertMoved(root, legacy);
    assert.equal(await moveLegacyStorage(root, legacy), 0);
    // Instalasi baru tidak punya auth/ sama sekali.
    assert.equal(await moveLegacyStorage(join(base, 'fresh'), join(base, 'none')), 0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a target of empty folders is replaced, a target with files stops startup and keeps both sides', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ncwa-storage-'));
  try {
    const legacy = await legacyInstall(base),
      root = join(base, 'storage'),
      paths = storagePaths(root);
    // Start yang berjalan sebelum pemindahan meninggalkan folder kosong, termasuk yang bersarang.
    await mkdir(join(paths.media, account), { recursive: true });
    await mkdir(join(paths.whatsapp, account), { recursive: true });
    await writeFile(join(paths.whatsapp, account, 'lain'), 'x');
    await assert.rejects(moveLegacyStorage(root, legacy), /sudah berisi file/);
    // Tidak ada data akun itu yang digabung atau hilang.
    assert.equal(await readFile(join(legacy, account, 'toko', 'auth', 'creds.json'), 'utf8'), '{"login":true}');
    assert.equal(await readFile(join(paths.whatsapp, account, 'lain'), 'utf8'), 'x');
    // Setelah konflik diselesaikan manual, start berikutnya menuntaskan pemindahan, termasuk folder media yang kosong.
    await rm(join(paths.whatsapp, account), { recursive: true });
    await moveLegacyStorage(root, legacy);
    await assertMoved(root, legacy);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// ReadWritePaths di systemd me-mount auth/ dan storage/ terpisah, dan di sana rename gagal dengan EXDEV. /dev/shm dan
// folder temporary adalah filesystem terpisah di mesin ini, jadi kondisi itu bisa ditiru.
const otherFilesystem = existsSync('/dev/shm') && (await stat('/dev/shm')).dev !== (await stat(tmpdir())).dev;
test(
  'the move also works when auth/ and storage/ are on different filesystems',
  { skip: !otherFilesystem && 'tidak ada dua filesystem terpisah' },
  async () => {
    const legacyBase = await mkdtemp(join(tmpdir(), 'ncwa-storage-')),
      rootBase = await mkdtemp(join('/dev/shm', 'ncwa-storage-'));
    try {
      const legacy = await legacyInstall(legacyBase),
        root = join(rootBase, 'storage');
      assert.equal(await moveLegacyStorage(root, legacy), 5);
      await assertMoved(root, legacy);
      assert.equal(existsSync(join(storagePaths(root).whatsapp, account + '.moving')), false);
    } finally {
      await rm(legacyBase, { recursive: true, force: true });
      await rm(rootBase, { recursive: true, force: true });
    }
  },
);
