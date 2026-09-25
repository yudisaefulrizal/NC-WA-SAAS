import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIncoming } from '../../../src/components/whatsapp/domain/incoming.js';
import { SessionManager, type Update } from '../../../src/components/whatsapp/domain/sessions.js';

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

test('Manual candidates include fresh private or group chat content, using alternate phone for LID',async()=>{
 const {parseManualCandidate}=await import('../../../src/components/whatsapp/domain/incoming.js');
 const message={key:{id:'manual',fromMe:true,remoteJid:'123@lid',remoteJidAlt:'628123456789@s.whatsapp.net'},message:{conversation:'Admin menjawab'},messageTimestamp:101};
 assert.equal(parseManualCandidate(message,100)?.from,'628123456789');
 assert.equal(parseManualCandidate({...message,messageTimestamp:99},100),undefined);
 assert.equal(parseManualCandidate({...message,key:{...message.key,fromMe:false}},100),undefined);
 const group=parseManualCandidate({...message,key:{...message.key,remoteJid:'123@g.us',remoteJidAlt:undefined}},100);assert.equal(group?.isGroup,true);assert.equal(group?.groupId,'123@g.us');
 assert.equal(parseManualCandidate({...message,message:{protocolMessage:{}}},100),undefined);
});
test('Outgoing event reaches takeover even when incoming filter is group-only',async()=>{
 let update!: (event:Update)=>void;const manager=new SessionManager(async(_id,cb)=>{update=cb;return {close(){},async logout(){}};});const seen:string[]=[];
 manager.onOutgoing=async(_session,message)=>{seen.push(message.messageId);};
 try{await manager.create('manual');await manager.setFilter('manual','group');update({outgoing:{messageId:'manual',from:'628123456789',sender:'628123456789',isGroup:false,groupId:null,type:'text',text:'Hello',timestamp:1}});assert.deepEqual(seen,['manual']);}finally{await manager.stop();}
});
