// Tipe field koleksi Tahap 2: jam, tanggal-jam, pilihan ganda, telepon, file; nilai bawaan; field unik; serta siklus
// file (unggah, terikat ke record, dilepas, disalin saat duplikasi, dihapus bersama data profil).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { storagePaths } from '../../../src/libraries/storage.js';
import { createApp } from '../../../src/http/app.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import {
  blankDefinition,
  parseDefinition,
  validateRecord,
  type Collection,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { uploadRecordFile } from '../../../src/components/ai/domain/builder/record-files.js';
import {
  filterGroup,
  sortSpec,
  keywords,
  queryMemory,
} from '../../../src/components/ai/domain/builder/record-query.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import { setProfileEnabled } from '../../../src/components/ai/domain/profiles/registry.js';

const owner = randomUUID(),
  client = randomUUID(),
  other = randomUUID(),
  clientToken = randomUUID(),
  otherToken = randomUUID();
const ids: string[] = [];
const service = new AIService(
  async () => '{"answer":"Selesai"}',
  async () => {},
);
const app = createApp();
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);
const f = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  type,
  required: false,
  options: [],
  collection: '',
  ...extra,
});
const daftar = {
  id: 'daftar',
  name: 'Pendaftaran',
  owner: 'shared',
  fields: [
    f('kode', 'text', { unique: true, required: true }),
    f('jam', 'time'),
    f('mulai', 'datetime'),
    f('minat', 'multichoice', { options: ['Tahfidz', 'Bahasa', 'Sains'], default: ['Tahfidz'] }),
    f('hp', 'phone', { unique: true }),
    f('status', 'choice', { options: ['baru', 'diterima'], default: 'baru' }),
    f('foto', 'file'),
  ],
} as unknown as Collection;
before(async () => {
  for (const [id, role, token] of [
    [owner, 'owner', ''],
    [client, 'user', clientToken],
    [other, 'user', otherToken],
  ]) {
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
      role,
    ]);
    if (token)
      await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
        digest(token),
        id,
      ]);
  }
});
after(async () => {
  for (const id of [owner, client, other]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
    await rm(join(storagePaths().recordFiles, id), { recursive: true, force: true });
  }
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
});
async function published(collections: Collection[]) {
  const d = blankDefinition();
  d.collections = collections;
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  return { g, profile: await service.createDataProfile(client, { profile_type: g.id, name: 'Data ' + g.id }) };
}
const exists = (account: string, id: string) =>
  access(join(storagePaths().recordFiles, account, id)).then(
    () => true,
    () => false,
  );

test('New field types validate and normalize; defaults apply only on create', () => {
  const c = parseDefinition({ ...blankDefinition(), collections: [daftar] }).collections[0];
  assert.deepEqual(
    validateRecord(c, { kode: 'A1', jam: '07:30', mulai: '2026-10-01T08:00', hp: '0812-3456 789' }, true),
    {
      kode: 'A1',
      jam: '07:30',
      mulai: '2026-10-01T08:00',
      minat: ['Tahfidz'],
      hp: '628123456789',
      status: 'baru',
    },
  );
  assert.deepEqual(validateRecord(c, { kode: 'A2' }), { kode: 'A2' });
  for (const bad of [
    { kode: 'x', jam: '24:00' },
    { kode: 'x', jam: '7.30' },
    { kode: 'x', mulai: '2026-02-30T08:00' },
    { kode: 'x', minat: ['Musik'] },
    { kode: 'x', minat: 'Tahfidz' },
    { kode: 'x', hp: '12' },
  ])
    assert.throws(() => validateRecord(c, bad), JSON.stringify(bad));
  assert.throws(
    () =>
      parseDefinition({
        ...blankDefinition(),
        collections: [{ ...daftar, fields: [f('foto', 'file', { unique: true })] }],
      }),
    /tidak bisa dibuat unik/,
  );
  assert.throws(
    () =>
      parseDefinition({
        ...blankDefinition(),
        collections: [{ ...daftar, fields: [f('status', 'choice', { options: ['a'], default: 'b' })] }],
      }),
    /Pilihan status tidak valid/,
  );
});

test('Unique fields reject duplicates across the collection in store, simulation, and publish', async () => {
  const { g, profile } = await published([daftar]);
  await store.writeRecord(client, profile.id, 'daftar', 'create', { data: { kode: 'PSB-1', hp: '081234567' } });
  await assert.rejects(store.writeRecord(client, profile.id, 'daftar', 'create', { data: { kode: 'psb-1' } }), {
    code: 'duplicate_value',
  });
  await assert.rejects(
    store.writeRecord(client, profile.id, 'daftar', 'create', { data: { kode: 'PSB-2', hp: '+6281234567' } }),
    { code: 'duplicate_value' },
  );
  const second = await store.writeRecord(client, profile.id, 'daftar', 'create', { data: { kode: 'PSB-2' } });
  // Record boleh menyimpan ulang nilai uniknya sendiri, tapi tidak memakai nilai record lain.
  await store.writeRecord(
    client,
    profile.id,
    'daftar',
    'update',
    { id: second.id, data: { kode: 'PSB-2' } },
    undefined,
    undefined,
    undefined,
    { merge: true },
  );
  await assert.rejects(
    store.writeRecord(
      client,
      profile.id,
      'daftar',
      'update',
      { id: second.id, data: { kode: 'PSB-1' } },
      undefined,
      undefined,
      undefined,
      { merge: true },
    ),
    { code: 'duplicate_value' },
  );
  const [created] = (await store.readRecords(client, profile.id, 'daftar')).records;
  assert.deepEqual(created.data.minat, ['Tahfidz']);
  assert.equal(created.data.status, 'baru');

  // Menjadikan field lain unik ditolak saat datanya sudah kembar.
  const next = structuredClone((await store.findGraph(g.id))!.active!);
  next.collections[0].fields.find(x => x.id === 'status')!.unique = true;
  const saved = await store.saveGraph(owner, g.id, {
    revision: (await store.graphState(g.id)).revision,
    definition: next,
  });
  await assert.rejects(store.saveGraph(owner, g.id, { revision: saved.revision }, true), { code: 'schema_conflict' });

  const d = blankDefinition();
  d.collections = [daftar];
  d.nodes = [
    { ...d.nodes[0] },
    {
      ...d.nodes[2],
      id: 'buat',
      type: 'data_table',
      collection: 'daftar',
      operation: 'create',
      value: '{"data":{"kode":"{{input.message}}"}}',
    },
    { ...d.nodes[2], id: 'output', label: 'output', value: 'ok' },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'buat' },
    { id: 'e2', source: 'buat', port: 'next', target: 'output' },
  ];
  const events: any[] = [];
  await assert.rejects(
    simulate(
      owner,
      { definition: d, message: 'SIM-1', records: { daftar: [{ kode: 'SIM-1' }] } },
      e => events.push(e),
      new AbortController().signal,
      async () => '',
    ),
    { code: 'duplicate_value' },
  );
  assert.ok(events.some(e => e.state === 'error' && e.node === 'buat'));
});

test('Multichoice and phone filters behave the same in MySQL and simulation', async () => {
  const c = { ...daftar, fields: daftar.fields.map(x => ({ ...x, unique: undefined })) } as Collection;
  const { profile } = await published([c]);
  for (const data of [
    { kode: 'a', minat: ['Tahfidz', 'Bahasa'], hp: '081111111' },
    { kode: 'b', minat: ['Sains'], hp: '6282222222' },
    { kode: 'c', hp: '081111111' },
    { kode: 'd', minat: ['Bahasa'] },
  ])
    await store.writeRecord(client, profile.id, 'daftar', 'create', { data });
  const all = (await store.readRecords(client, profile.id, 'daftar')).records;
  const parsed = parseDefinition({ ...blankDefinition(), collections: [c] }).collections[0];
  for (const filters of [
    [{ field: 'minat', operator: 'equals', value: 'bahasa' }],
    [{ field: 'minat', operator: 'not_equals', value: 'Bahasa' }],
    [{ field: 'minat', operator: 'contains', value: 'sai' }],
    [{ field: 'minat', operator: 'greater', value: 'a' }],
    [{ field: 'hp', operator: 'equals', value: '0811-111-11' }],
    [{ field: 'jam', operator: 'empty', value: '' }],
  ]) {
    const group = filterGroup(parsed, filters);
    const sort = sortSpec(parsed, 'kode', 'asc');
    const sqlIds = (await store.queryRecords(client, profile.id, 'daftar', { groups: [group], sort })).records.map(
      r => r.id,
    );
    const memoryIds = queryMemory(all, { keywords: keywords(''), groups: [group], sort, limit: 100, offset: 0 }).map(
      r => r.id,
    );
    assert.deepEqual(sqlIds, memoryIds, JSON.stringify(filters));
  }
  const bahasa = await store.queryRecords(client, profile.id, 'daftar', {
    groups: [filterGroup(parsed, [{ field: 'minat', operator: 'equals', value: 'bahasa' }])],
    sort: sortSpec(parsed, 'kode', 'asc'),
  });
  assert.deepEqual(
    bahasa.records.map(r => r.data.kode),
    ['a', 'd'],
  );
});

test('Files: upload, claim by one record, release on change or delete, copy on duplicate, remove with data profile', async () => {
  const c = { ...daftar, fields: [f('kode', 'text'), f('foto', 'file')] } as Collection;
  const { profile } = await published([c]);
  const { profile: second } = await published([c]);
  await assert.rejects(uploadRecordFile(client, profile.id, 'virus.exe', Buffer.from('MZ-not-allowed')), {
    code: 'unsupported_file_type',
  });
  const one = await uploadRecordFile(client, profile.id, 'foto.png', png);
  assert.equal(one.media_type, 'image');
  const record = await store.writeRecord(client, profile.id, 'daftar', 'create', { data: { kode: 'x', foto: one.id } });
  // File yang sudah dipakai record lain, milik data profil lain, atau tidak pernah diunggah ditolak.
  for (const [target, id] of [
    [profile.id, one.id],
    [second.id, one.id],
    [profile.id, randomUUID()],
  ])
    await assert.rejects(store.writeRecord(client, target, 'daftar', 'create', { data: { kode: 'y', foto: id } }), {
      code: 'invalid_file',
    });
  const listed = await store.readRecords(client, profile.id, 'daftar');
  assert.equal(listed.files[one.id].filename, 'foto.png');

  const copy = await service.createDataProfile(client, { name: 'Salinan file', copy_from: profile.id });
  const [copied] = (await store.readRecords(client, copy.id, 'daftar')).records;
  assert.notEqual(copied.data.foto, one.id);
  assert.equal(await exists(client, String(copied.data.foto)), true);

  const two = await uploadRecordFile(client, profile.id, 'baru.pdf', Buffer.from('%PDF-1.4 test'));
  await store.writeRecord(client, profile.id, 'daftar', 'update', {
    id: record.id,
    revision: 1,
    data: { kode: 'x', foto: two.id },
  });
  assert.equal(await exists(client, one.id), false);
  await store.writeRecord(client, profile.id, 'daftar', 'delete', { id: record.id, revision: 2 });
  assert.equal(await exists(client, two.id), false);

  await service.deleteDataProfile(client, copy.id);
  assert.equal(await exists(client, String(copied.data.foto)), false);
});

test('File HTTP routes use the logged-in account and serve the stored bytes', async () => {
  const { profile } = await published([{ ...daftar, fields: [f('foto', 'file')] } as Collection]);
  const upload = await request(app)
    .post('/api/ai/record-files/' + profile.id)
    .set('Origin', origin)
    .set('Cookie', 'ncwa_session=' + clientToken)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Filename', encodeURIComponent('bukti bayar.png'))
    .send(png);
  assert.equal(upload.status, 201);
  assert.equal(upload.body.filename, 'bukti bayar.png');
  const download = await request(app)
    .get('/api/ai/record-files/' + profile.id + '/' + upload.body.id)
    .set('Cookie', 'ncwa_session=' + clientToken)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  assert.equal(download.status, 200);
  assert.equal(download.headers['content-type'], 'image/png');
  assert.deepEqual(download.body, png);
  const foreign = await request(app)
    .get('/api/ai/record-files/' + profile.id + '/' + upload.body.id)
    .set('Cookie', 'ncwa_session=' + otherToken);
  assert.equal(foreign.status, 404);
});
