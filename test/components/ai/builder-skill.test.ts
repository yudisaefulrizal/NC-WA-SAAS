// Tes skill AI: ZIP terbaca, frontmatter sesuai format skill, referensi mencakup semua node/operator/tipe/tier/
// variabel dari validator, contoh S-P-O yang valid dan membawa ringkasan ke pesan berikutnya, serta unduhan hanya untuk
// pemilik.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inflateRawSync, crc32 } from 'node:zlib';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { createApp } from '../../../src/http/app.js';
import { createZip } from '../../../src/libraries/zip.js';
import { modelTiers } from '../../../src/components/ai/domain/pipeline/models.js';
import {
  assertRunnable,
  computeArity,
  conditionOperators,
  fieldTypes,
  nodeTypes,
  parseDefinition,
  toolOperations,
} from '../../../src/components/ai/domain/builder/definition.js';
import { filterOperators } from '../../../src/components/ai/domain/builder/record-query.js';
import {
  contextVariablePaths,
  profileSkillZip,
  skillName,
  spoExample,
  spoExampleFile,
} from '../../../src/components/ai/domain/builder/skill.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { defaults, type AIMessage } from '../../../src/components/ai/domain/provider.js';

// Pembaca ZIP minimal lewat central directory, cukup untuk memeriksa hasil createZip.
function unzip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const crc = zip.readUInt32LE(at + 16),
      size = zip.readUInt32LE(at + 20),
      nameLength = zip.readUInt16LE(at + 28),
      local = zip.readUInt32LE(at + 42),
      name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(start, start + size));
    assert.equal(crc32(data), crc, 'CRC ' + name);
    files.set(name, data.toString('utf8'));
    at += 46 + nameLength;
  }
  return files;
}

test('createZip round-trips UTF-8 names and content', () => {
  const files = unzip(createZip([{ name: 'folder/catatan é.md', data: 'Halo — dunia' }]));
  assert.deepEqual([...files], [['folder/catatan é.md', 'Halo — dunia']]);
});

test('Skill package has valid frontmatter, a complete reference, and a runnable S-P-O example', () => {
  const files = unzip(profileSkillZip());
  const skill = files.get(skillName + '/SKILL.md')!;
  const frontmatter = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  assert.ok(frontmatter, 'frontmatter SKILL.md');
  assert.match(frontmatter[1], /^[a-z0-9-]{1,64}$/);
  assert.ok(frontmatter[2].length <= 1024);
  const reference = files.get(skillName + '/reference/format.md')!;
  assert.doesNotMatch(reference + skill, /undefined|\[object Object\]/);
  for (const value of [
    ...nodeTypes,
    ...fieldTypes,
    ...conditionOperators,
    ...filterOperators,
    ...toolOperations,
    ...modelTiers,
    ...Object.keys(computeArity),
  ])
    assert.ok(reference.includes('`' + value + '`'), 'referensi memuat ' + value);
  for (const path of contextVariablePaths) assert.ok(reference.includes('{{' + path + '}}'), path);
  assert.deepEqual([...files.keys()].sort(), [
    skillName + '/SKILL.md',
    skillName + '/' + spoExampleFile,
    skillName + '/reference/format.md',
  ]);
  assert.ok(skill.includes('](' + spoExampleFile + ')'), 'SKILL.md menaut contoh S-P-O');
  assertRunnable(parseDefinition(JSON.parse(files.get(skillName + '/' + spoExampleFile)!)));
});

// Contoh skill dijalankan dua giliran untuk setiap cabang: ringkasan S-P-O dari giliran pertama sampai ke Router di
// giliran kedua, dan setiap cabang jawaban melewati Context sebelum Output.
test('The S-P-O example carries the summary from one message to the router of the next', async () => {
  const d = spoExample();
  const scope = {
    account: randomUUID(),
    profile: 'simulation',
    session: 'test',
    customer: '628001',
    requestId: randomUUID(),
    fallbackEnabled: true,
  };
  for (const branch of ['informasi', 'layanan', 'sapaan']) {
    const calls: string[] = [];
    let routerInput = '';
    const config = { ...defaults };
    const turn = (message: string, previous: string | null, history: AIMessage[] = []) =>
      runGraph(
        d,
        async (c, messages) => {
          calls.push(c.call_role!);
          if (c.call_role === 'router') {
            routerInput = messages.map(m => m.content).join('\n');
            return JSON.stringify({ branch, fallback_terkait: [] });
          }
          return c.call_role === 'ringkas_konteks' ? 'pelanggan-memilih-paket_basic' : '{"answer":"Siap"}';
        },
        config,
        [...history, { role: 'user', content: message }],
        { ...scope, requestId: randomUUID() },
        previous,
        async () => {
          throw Error('tool tidak dipanggil di tes ini');
        },
        100,
      );
    const first = await turn('Paket basic berapa?', null);
    assert.equal(first.answer, 'Siap');
    assert.deepEqual(calls, ['router', branch, 'ringkas_konteks']);
    assert.equal(config.graph_context, 'pelanggan-memilih-paket_basic');
    await turn('1 aja', config.graph_context, [
      { role: 'user', content: 'Paket basic berapa?' },
      { role: 'assistant', content: 'Siap' },
    ]);
    assert.match(routerInput, /pelanggan-memilih-paket_basic/);
  }
});

const owner = randomUUID(),
  client = randomUUID(),
  ownerToken = randomUUID(),
  clientToken = randomUUID();
before(async () => {
  for (const [id, role, token] of [
    [owner, 'owner', ownerToken],
    [client, 'user', clientToken],
  ]) {
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
      role,
    ]);
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
      digest(token),
      id,
    ]);
  }
});
after(async () => {
  for (const id of [owner, client]) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await db.end();
});

test('Only the owner can download the skill ZIP', async () => {
  const app = createApp();
  const path = '/api/admin/ai/builder/skill';
  const denied = await request(app)
    .get(path)
    .set('Cookie', 'ncwa_session=' + clientToken);
  assert.equal(denied.status, 403);
  const res = await request(app)
    .get(path)
    .set('Cookie', 'ncwa_session=' + ownerToken)
    .buffer(true)
    .parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.match(res.headers['content-disposition'], new RegExp('attachment; filename="' + skillName + '\\.zip"'));
  assert.ok(unzip(res.body as Buffer).has(skillName + '/SKILL.md'));
});
