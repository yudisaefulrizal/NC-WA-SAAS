// Tes penyimpanan media masuk: batas per file dan per akun, masa simpan, dan pemisahan per sesi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MediaStore } from '../../../src/components/whatsapp/data-access/media-store.js';
test('Incoming media enforces per-file and per-account caps, retention and session namespaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ncwa-media-'));
  const store = new MediaStore(root, 'https://gateway.invalid', 10, 1, 10);
  const message = {
    messageId: 'same',
    from: '628123',
    sender: '628123',
    isGroup: false,
    groupId: null,
    type: 'image' as const,
    text: '',
    timestamp: 1,
    mimetype: 'text/html\r\nx: evil',
    download: async () => Readable.from(['123456']),
  };
  try {
    const first = await store.save('one', message);
    assert.equal(first!.mimetype, 'application/octet-stream');
    await assert.rejects(store.save('two', message));
    const id = new URL(first!.url).pathname.split('/').at(-1)!,
      file = await store.get(id);
    const old = new Date(Date.now() - 2 * 86400000);
    await utimes(file.path, old, old);
    await assert.rejects(store.get(id), { code: 'media_not_found' });
    await store.prune();
    await assert.rejects(stat(file.path), { code: 'ENOENT' });
    const second = await store.save('two', message);
    assert.notEqual(first!.url, second!.url);
    await assert.rejects(store.get('../.env'), { code: 'media_not_found' });
  } finally {
    await store.flush();
    await rm(root, { recursive: true, force: true });
  }
});
