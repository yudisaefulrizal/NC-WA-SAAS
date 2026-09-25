// Tes batas sesi dari paket: turun paket menutup sesi lama tanpa menghapus login, naik paket menyalakannya lagi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../../src/components/whatsapp/data-access/session-store.js';
import { SessionManager } from '../../../src/components/whatsapp/domain/sessions.js';
test('Downgrade keeps newest, closes older without deleting auth, restores inactive state and reactivates on upgrade', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ncwa-limit-'));
  const store = new SessionStore(root);
  const opened: string[] = [],
    closed: string[] = [];
  for (const [id, createdAt] of [
    ['old', 1],
    ['new', 2],
  ] as const)
    await store.save({ id, createdAt, status: 'connected', phone: null, filter: 'all' });
  const connect = async (id: string, update: any) => {
    opened.push(id);
    update({ status: 'connected' });
    return {
      close() {
        closed.push(id);
      },
      async logout() {},
      async send() {
        return 'sent';
      },
    };
  };
  const manager = new SessionManager(connect, store);
  let restored: SessionManager | undefined;
  try {
    await manager.restore(2);
    await Promise.all([manager.applyLimit(1), manager.applyLimit(1)]);
    assert.equal(manager.detail('new').serviceActive, true);
    assert.equal(manager.detail('old').serviceActive, false);
    assert.ok(closed.includes('old'));
    assert.throws(() => manager.qr('old'), { code: 'session_inactive' });
    await assert.rejects(manager.send('old', '628123@s.whatsapp.net', { text: 'fixture' }), {
      code: 'session_inactive',
    });
    assert.equal((await store.load()).length, 2);
    await manager.stop();
    const before = opened.length;
    restored = new SessionManager(connect, store);
    await restored.restore(1);
    assert.deepEqual(opened.slice(before), ['new']);
    await restored.applyLimit(2);
    assert.equal(restored.detail('old').serviceActive, true);
    assert.equal(opened.at(-1), 'old');
  } finally {
    await manager.stop();
    await restored?.stop();
    await rm(root, { recursive: true, force: true });
  }
});
