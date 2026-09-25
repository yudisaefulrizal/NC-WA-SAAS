// Daftar profil. Profil adalah pipeline bawaan NC-WA: node, tool, bentuk data yang dibacanya ("data profil"), dan
// menu sesi yang ditampilkan dashboard ditetapkan di kode. Pemilik hanya menyetel tiap node di AI Studio dan
// menyalakan atau mematikan profil untuk semua klien sekaligus.
import { db } from '../../../../libraries/db.js';
import { ApiError } from '../../../../libraries/errors.js';
import { record } from '../../../../libraries/validation.js';
import { defaultWorkflow, workflowInput, csStudioMeta, studioMeta } from '../pipeline/workflow.js';
import { type Pipeline } from '../pipeline/runner.js';
import { csPipeline } from './cs/pipeline.js';
import { eduPipeline } from './pendidikan/pipeline.js';
import { testerPipeline } from './tester/pipeline.js';
import * as auditEventsSql from '../../data-access/audit-events-queries.js';
import * as dataProfilesSql from '../../data-access/data-profiles-queries.js';
import * as profileTypesSql from '../../data-access/profile-types-queries.js';
import * as workflowSql from '../../data-access/workflow-queries.js';
export interface ProfileDefinition {
  id: string;
  name: string;
  description: string;
  nodeSummary: string;
  // Pipeline saat berjalan: specialist, prompt, tool, dan tier bawaan (lihat pipeline/runner.ts).
  pipeline: Pipeline;
  // Tab sesi yang tampil saat sesi menjalankan profil ini; Percakapan (riwayat chat) selalu tersedia.
  tabs: readonly string[];
  defaultWorkflow(): unknown;
  workflowInput(value: unknown): unknown;
  studioMeta(): Record<string, unknown>;
}
export const profileDefinitions: Readonly<Record<string, ProfileDefinition>> = {
  cs: {
    id: 'cs',
    name: 'CS Usaha',
    description: 'Membalas pelanggan dari knowledge usaha, katalog produk, pesanan masuk, dan fallback tim.',
    nodeSummary: 'Router, 5 specialist, Pesanan, Context',
    pipeline: csPipeline,
    tabs: ['knowledge', 'orders', 'usage', 'trial'],
    defaultWorkflow: () => defaultWorkflow(csPipeline),
    workflowInput: value => workflowInput(value, csPipeline),
    studioMeta: csStudioMeta,
  },
  pendidikan: {
    id: 'pendidikan',
    name: 'CS Lembaga Pendidikan',
    description:
      'Menjawab calon siswa, wali, dan siswa aktif dari profil lembaga, program, jadwal, dokumen, dan kontak. Tidak menyimpan data pribadi.',
    nodeSummary: 'Router, 7 specialist, Context',
    pipeline: eduPipeline,
    tabs: ['knowledge', 'usage', 'trial'],
    defaultWorkflow: () => defaultWorkflow(eduPipeline),
    workflowInput: value => workflowInput(value, eduPipeline),
    studioMeta: () => studioMeta(eduPipeline),
  },
  tester: {
    id: 'tester',
    name: 'Tester AI',
    description:
      'Berperan sebagai pelanggan untuk menguji nomor CS mana pun. Mulai dengan mengetik pesan dari HP nomor tester; hentikan dengan Jeda.',
    nodeSummary: 'Pelanggan',
    pipeline: testerPipeline,
    tabs: ['knowledge', 'usage'],
    defaultWorkflow: () => defaultWorkflow(testerPipeline),
    workflowInput: value => workflowInput(value, testerPipeline),
    studioMeta: () => ({ allowedTools: testerPipeline.permissions }),
  },
};
// Profil baru datang dalam keadaan mati, supaya pemilik menyetelnya di AI Studio sebelum klien bisa memilihnya.
export const enabledByDefault = (id: string) => id === 'cs';
export function profileDefinition(id: unknown): ProfileDefinition {
  if (typeof id !== 'string' || !Object.hasOwn(profileDefinitions, id))
    throw new ApiError(404, 'profile_not_found', 'Profil AI tidak ditemukan');
  return profileDefinitions[id];
}
const nodeCount = (definition: ProfileDefinition) =>
  Object.keys(record(record(definition.defaultWorkflow()).nodes)).length;
const summary = (definition: ProfileDefinition) => ({
  id: definition.id,
  name: definition.name,
  description: definition.description,
  tabs: definition.tabs,
  nodes: nodeCount(definition),
  node_summary: definition.nodeSummary,
});

export async function enabledProfiles() {
  const [rows] = await profileTypesSql.listEnabled(db);
  const enabled = new Set(rows.map(row => String(row.id)));
  return new Set(Object.keys(profileDefinitions).filter(id => enabled.has(id)));
}
// Yang dilihat klien: profil yang dinyalakan pemilik (satu-satunya yang boleh dipilih), ditambah profil yang sudah
// dipakai data profilnya, supaya dashboard tetap bisa menampilkan sesi itu saat pemilik mematikan profilnya.
export async function clientProfiles(account: string) {
  const enabled = await enabledProfiles();
  const [used] = await dataProfilesSql.listTypesByAccount(db, [account]);
  const own = new Set(used.map(row => String(row.profile_type)));
  return Object.values(profileDefinitions)
    .filter(d => enabled.has(d.id) || own.has(d.id))
    .map(d => ({ ...summary(d), enabled: enabled.has(d.id) }));
}
export async function adminProfiles() {
  const enabled = await enabledProfiles();
  const [workflows] = await workflowSql.listStates(db);
  const [usage] = await dataProfilesSql.countPerType(db);
  return Object.values(profileDefinitions).map(definition => {
    const workflow = workflows.find(w => w.profile_type === definition.id),
      use = usage.find(u => u.profile_type === definition.id);
    return {
      ...summary(definition),
      enabled: enabled.has(definition.id),
      active_version: Number(workflow?.active_version ?? 0),
      revision: Number(workflow?.revision ?? 0),
      published_revision: Number(workflow?.published_revision ?? 0),
      sessions: Number(use?.sessions ?? 0),
      data_profiles: Number(use?.data_profiles ?? 0),
    };
  });
}
export async function setProfileEnabled(actor: string, id: unknown, value: unknown) {
  const definition = profileDefinition(id);
  if (typeof value !== 'boolean') throw new ApiError(400, 'invalid_request', 'Status profil wajib valid');
  await profileTypesSql.upsert(db, [definition.id, value]);
  await auditEventsSql.insert(db, [actor, (value ? 'ai_profile_enabled:' : 'ai_profile_disabled:') + definition.id]);
  return adminProfiles();
}

// Setiap profil punya alur draft dan alur terbit sendiri, disunting dan diterbitkan terpisah di AI Studio.
const parse = (definition: ProfileDefinition, value: unknown) =>
  definition.workflowInput(typeof value === 'string' ? JSON.parse(value) : value);
export async function workflowState(profile: unknown = 'cs') {
  const definition = profileDefinition(profile);
  const [rows] = await workflowSql.find(db, [definition.id]);
  const row = rows[0];
  return {
    profile: definition.id,
    profile_name: definition.name,
    enabled: (await enabledProfiles()).has(definition.id),
    draft: row ? parse(definition, row.draft) : definition.defaultWorkflow(),
    active: row?.active ? parse(definition, row.active) : definition.defaultWorkflow(),
    revision: Number(row?.revision ?? 0),
    active_version: Number(row?.active_version ?? 0),
    published_revision: Number(row?.published_revision ?? 0),
    ...definition.studioMeta(),
  };
}
export async function activeWorkflow(profile: string = 'cs') {
  const definition = profileDefinition(profile);
  const [rows] = await workflowSql.findActive(db, [definition.id]);
  return rows[0]?.active ? parse(definition, rows[0].active) : definition.defaultWorkflow();
}
export async function changeWorkflow(actor: string, profile: unknown, value: unknown, publish = false) {
  const definition = profileDefinition(profile);
  const body = record(value);
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
    throw new ApiError(400, 'invalid_revision', 'Revision wajib valid.');
  const draft = publish ? undefined : definition.workflowInput(body.draft),
    c = await db.getConnection();
  try {
    await c.beginTransaction();
    // Reset topologi sekali jalan di data-access/schema.ts dicatat sudah diterapkan, supaya migrate berikutnya tidak
    // pernah mereset baris ini.
    await workflowSql.ensure(c, [definition.id, JSON.stringify(definition.defaultWorkflow())]);
    const [rows] = await workflowSql.lockRevision(c, [definition.id]);
    if (Number(rows[0].revision) !== body.revision)
      throw new ApiError(409, 'workflow_conflict', 'Draft berubah di tempat lain. Muat ulang sebelum menyimpan.');
    if (publish) await workflowSql.publish(c, [definition.id]);
    else await workflowSql.saveDraft(c, [JSON.stringify(draft), definition.id]);
    await auditEventsSql.insert(c, [
      actor,
      (publish ? 'ai_workflow_published:' : 'ai_workflow_draft_saved:') + definition.id,
    ]);
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
  return workflowState(definition.id);
}
