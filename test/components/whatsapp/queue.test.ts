// Tes antrean kirim: antrean satu sesi yang penuh atau macet tidak menahan sesi lain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SendQueue } from '../../../src/components/whatsapp/domain/queue.js';
test('A full or blocked session queue does not block another session and closes pending jobs', async () => {
  const blocked = new SendQueue(0),
    other = new SendQueue(0);
  let release!: () => void;
  const gate = new Promise<void>(r => {
    release = r;
  });
  const jobs = Array.from({ length: 256 }, () => blocked.run(() => gate));
  await assert.rejects(
    blocked.run(async () => {}),
    { code: 'queue_full' },
  );
  assert.equal(await other.run(async () => 'independent'), 'independent');
  blocked.close();
  release();
  const result = await Promise.allSettled(jobs);
  assert.ok(result.some(r => r.status === 'rejected'));
  other.close();
});
