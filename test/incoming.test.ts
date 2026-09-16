import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIncoming } from '../src/engine/incoming.js';
import { SessionManager, type Update } from '../src/engine/sessions.js';

test('parser membedakan sender grup dan menggunakan nomor alternatif LID', () => {
  const message = parseIncoming({ key: { id: 'one', remoteJid: '123@g.us', participant: '999@lid', participantAlt: '628123@s.whatsapp.net' }, message: { conversation: 'halo' }, messageTimestamp: 123 });
  assert.equal(message?.isGroup, true);
  assert.equal(message?.groupId, '123@g.us');
  assert.equal(message?.sender, '628123');
  assert.equal(message?.timestamp, 123);
  assert.equal(parseIncoming({ key: { id: 'one', remoteJid: '628123@s.whatsapp.net', fromMe: true }, message: { conversation: 'halo' } }), undefined);
});
test('filter private mencegah pesan grup diteruskan', async () => {
  let update!: (event: Update) => void;
  const manager = new SessionManager(async (_id, cb) => { update = cb; return { close() {}, async logout() {} }; });
  const received: string[] = [];
  manager.onIncoming = async (_session, message) => { received.push(message.messageId); };
  await manager.create('a');
  await manager.setFilter('a', 'private');
  const common = { from: '628123', sender: '628123', text: 'halo', timestamp: 123, type: 'text' as const };
  update({ incoming: { ...common, messageId: 'group', isGroup: true, groupId: '123@g.us' } });
  update({ incoming: { ...common, messageId: 'private', isGroup: false, groupId: null } });
  assert.deepEqual(received, ['private']);
});
