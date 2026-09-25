// Tes aliran event SSE: terpisah per akun dan terputus saat kredensialnya dicabut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { EventStream } from '../../../src/components/whatsapp/entry-points/event-stream.js';
test('SSE separates tenant streams and closes revoked credentials before another event', async () => {
  const a = new EventStream(),
    b = new EventStream();
  let valid = true;
  const app = express();
  app.get('/a', (q, r) => a.handler(q, r, 'key-a', async () => valid));
  app.get('/b', (q, r) => b.handler(q, r, 'key-b'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const abort = new AbortController();
  try {
    const first = await fetch(base + '/a', { signal: abort.signal }),
      second = await fetch(base + '/b', { signal: abort.signal });
    const ra = first.body!.getReader(),
      rb = second.body!.getReader();
    await ra.read();
    await rb.read();
    a.push({ event: 'message', sessionId: 'same', text: 'tenant-a' });
    b.push({ event: 'message', sessionId: 'same', text: 'tenant-b' });
    const aFrame = new TextDecoder().decode((await ra.read()).value),
      bFrame = new TextDecoder().decode((await rb.read()).value);
    assert.ok(aFrame.includes('tenant-a'));
    assert.ok(!aFrame.includes('tenant-b'));
    assert.ok(bFrame.includes('tenant-b'));
    assert.ok(!bFrame.includes('tenant-a'));
    valid = false;
    a.push({ event: 'message', sessionId: 'same', text: 'after-revoke' });
    assert.equal((await ra.read()).done, true);
    b.revoke('key-b');
    assert.equal((await rb.read()).done, true);
  } finally {
    abort.abort();
    a.stop();
    b.stop();
    await new Promise<void>(r => server.close(() => r()));
  }
});
