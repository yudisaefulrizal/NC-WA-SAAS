// Data profil (isi milik klien untuk satu profil) dan data profil mana yang dijalankan setiap sesi: membuat,
// menggandakan, mengganti nama, menghapus, memasang ke sesi, dan menyimpan bidang-bidangnya.
import { copyGraphRecords, deleteGraph, findGraph, requireAvailableGraph } from './builder/store.js';
import { profileFiles, removeRecordFiles } from './builder/record-files.js';
import { copyCollectionSources } from './builder/collection-sources.js';
import { profileDefinition, enabledProfiles, setProfileEnabled } from './profiles/registry.js';
import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { object } from '../../../libraries/validation.js';
import { recordNote } from './chat.js';
import { fail, text } from './input-validation.js';
import { transaction, lockAccount } from './transaction.js';
import type { AIService } from './service.js';
import * as assistantsSql from '../data-access/assistants-queries.js';
import * as conversationsSql from '../data-access/conversations-queries.js';
import * as dataProfilesSql from '../data-access/data-profiles-queries.js';
import * as auditEventsSql from '../data-access/audit-events-queries.js';
export async function sessionProfiles(svc: AIService, account: string) {
  const [rows] = await assistantsSql.listByAccount(db, [account]);
  return Object.fromEntries(
    rows.map(row => [
      String(row.session_id),
      {
        enabled: Boolean(row.enabled) && Boolean(row.id),
        profile: row.id ? { id: String(row.id), name: String(row.name), profile_type: String(row.profile_type) } : null,
      },
    ]),
  ) as Record<string, { enabled: boolean; profile: { id: string; name: string; profile_type: string } | null }>;
}
// Menyalakan AI butuh data profil yang sudah dipasang; data profil tidak pernah dibuat otomatis.
export async function setEnabled(svc: AIService, account: string, session: string, enabled: boolean) {
  await transaction(async c => {
    await lockAccount(c, account);
    if (enabled) {
      const [rows] = await assistantsSql.lockDataProfileId(c, [account, session]);
      if (!rows[0]?.data_profile_id)
        throw new ApiError(409, 'no_profile', 'Pasang data profil ke sesi ini terlebih dahulu.');
    }
    await assistantsSql.upsertEnabled(c, [account, session, enabled]);
  });
  return { enabled };
}
export async function insertDataProfile(
  svc: AIService,
  c: PoolConnection,
  account: string,
  type: string,
  name: string,
  from?: RowDataPacket,
) {
  await requireAvailableGraph(c, type);
  const [count] = await dataProfilesSql.countByAccount(c, [account]);
  if (Number(count[0].n) >= 100) throw new ApiError(409, 'data_profile_limit', 'Maksimal 100 data profil per akun.');
  const id = randomUUID();
  await dataProfilesSql.insert(c, [
    id,
    account,
    type,
    name,
    String(from?.behavior ?? ''),
    String(from?.fallback_number ?? ''),
    Boolean(from?.fallback_notify),
  ]);
  return id;
}
export function dataProfileId(svc: AIService, value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value))
    throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
  return value;
}
export async function ownedDataProfile(svc: AIService, account: string, value: unknown) {
  const id = dataProfileId(svc, value);
  const [rows] = await dataProfilesSql.findOwned(db, [id, account]);
  if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
  return id;
}
export function profileView(svc: AIService, row: RowDataPacket) {
  return {
    behavior: String(row.behavior ?? ''),
    fallback_number: String(row.fallback_number ?? ''),
    fallback_notify: Boolean(row.fallback_notify),
    revision: Number(row.revision ?? 0),
  };
}
export async function dataProfiles(svc: AIService, account: string) {
  const [rows] = await dataProfilesSql.listWithCounts(db, [account]);
  const [attached] = await assistantsSql.listAttachments(db, [account]);
  const enabled = await enabledProfiles();
  return Promise.all(
    rows.map(async row => ({
      id: String(row.id),
      profile_type: String(row.profile_type),
      profile_name: (await profileDefinition(row.profile_type)).name,
      profile_enabled: enabled.has(row.profile_type),
      name: String(row.name),
      records: Number(row.records),
      updated_at: row.updated_at,
      sessions: attached.filter(a => a.data_profile_id === row.id).map(a => String(a.session_id)),
    })),
  );
}
export async function dataProfile(svc: AIService, account: string, value: unknown) {
  const id = dataProfileId(svc, value);
  const [rows] = await dataProfilesSql.find(db, [id, account]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
  const [attached] = await assistantsSql.listSessionsOfProfile(db, [account, id]);
  return {
    id,
    profile_type: String(row.profile_type),
    profile_name: (await profileDefinition(row.profile_type)).name,
    profile_enabled: (await enabledProfiles()).has(row.profile_type),
    name: String(row.name),
    sessions: attached.map(a => String(a.session_id)),
    ...profileView(svc, row),
  };
}
export async function createDataProfile(svc: AIService, account: string, body: unknown) {
  const input = object(body),
    name = text(input.name, 100, 'Nama data profil');
  if (!name) throw fail('Nama data profil wajib diisi');
  const copyFrom = input.copy_from === undefined ? undefined : dataProfileId(svc, input.copy_from);
  // Klien memilih sendiri apakah record milik pelanggan (booking, pendaftaran, dll.) ikut digandakan.
  if (input.copy_customer_records !== undefined && typeof input.copy_customer_records !== 'boolean')
    throw fail('Pilihan salin record pelanggan tidak valid');
  const copyCustomer = input.copy_customer_records === true;
  const recordFiles: string[] = [];
  let id: string;
  try {
    id = await transaction(async c => {
      await lockAccount(c, account);
      let from: RowDataPacket | undefined, type: string;
      if (copyFrom) {
        const [rows] = await dataProfilesSql.share(c, [copyFrom, account]);
        from = rows[0];
        if (!from) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
        type = String(from.profile_type);
      } else type = (await profileDefinition(input.profile_type)).id;
      if (!(await enabledProfiles()).has(type))
        throw new ApiError(409, 'profile_disabled', 'Profil AI ini sedang dinonaktifkan admin.');
      const [taken] = await dataProfilesSql.lockByName(c, [account, name]);
      if (taken[0]) throw new ApiError(409, 'name_taken', 'Nama data profil sudah dipakai.');
      const created = await insertDataProfile(svc, c, account, type, name, from);
      if (copyFrom) {
        await copyGraphRecords(c, account, copyFrom, created, copyCustomer, recordFiles);
        await copyCollectionSources(c, account, copyFrom, created);
      }
      return created;
    });
  } catch (error) {
    await removeRecordFiles(account, recordFiles);
    throw error;
  }
  return svc.dataProfile(account, id);
}
export async function renameDataProfile(svc: AIService, account: string, value: unknown, body: unknown) {
  const id = dataProfileId(svc, value),
    name = text(object(body).name, 100, 'Nama data profil');
  if (!name) throw fail('Nama data profil wajib diisi');
  await transaction(async c => {
    await lockAccount(c, account);
    const [rows] = await dataProfilesSql.lockOwned(c, [id, account]);
    if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
    const [taken] = await dataProfilesSql.findOtherWithName(c, [account, name, id]);
    if (taken[0]) throw new ApiError(409, 'name_taken', 'Nama data profil sudah dipakai.');
    await dataProfilesSql.rename(c, [name, id]);
  });
  return svc.dataProfile(account, id);
}
export async function deleteDataProfile(svc: AIService, account: string, value: unknown) {
  const id = dataProfileId(svc, value);
  const files = await transaction(async c => {
    await lockAccount(c, account);
    const [rows] = await dataProfilesSql.lockOwned(c, [id, account]);
    if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
    const [attached] = await assistantsSql.lockSessionsOfProfile(c, [account, id]);
    if (attached.length)
      throw new ApiError(
        409,
        'data_profile_in_use',
        'Data profil masih dipasang di sesi ' +
          attached.map(a => a.session_id).join(', ') +
          '. Cabut dari sesi terlebih dahulu.',
      );
    const records = await profileFiles(c, account, id);
    await dataProfilesSql.deleteOwned(c, [id, account]);
    return records;
  });
  await removeRecordFiles(account, files);
  return { ok: true };
}
export async function attachProfile(svc: AIService, account: string, session: string, body: unknown) {
  const input = object(body);
  if (input.data_profile_id !== null && typeof input.data_profile_id !== 'string')
    throw fail('Data profil wajib dipilih');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw fail('Status asisten wajib valid');
  const target = input.data_profile_id === null ? null : dataProfileId(svc, input.data_profile_id);
  await transaction(async c => {
    await lockAccount(c, account);
    let profile: RowDataPacket | undefined;
    if (target) {
      const [rows] = await dataProfilesSql.shareSummary(c, [target, account]);
      profile = rows[0];
      if (!profile) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
      if (!(await enabledProfiles()).has(String(profile.profile_type)))
        throw new ApiError(409, 'profile_disabled', 'Profil AI ini sedang dinonaktifkan admin.');
    }
    const [current] = await assistantsSql.lockAttachment(c, [account, session]);
    const previous = current[0]?.data_profile_id ? String(current[0].data_profile_id) : null;
    const enabled = target
      ? input.enabled === undefined
        ? Boolean(current[0]?.enabled)
        : input.enabled === true
      : false;
    await assistantsSql.upsertAttachment(c, [account, session, enabled, target]);
    if (previous === target) return;
    const [customers] = await conversationsSql.lockCustomersOfSession(c, [account, session]);
    await conversationsSql.clearMemoryOfSession(c, [account, session]);
    const note = !profile
      ? 'Profil AI dicabut; AI berhenti membalas'
      : previous
        ? 'Profil diganti ke ' + profile.name + '; memori AI dikosongkan'
        : 'Profil AI dipasang: ' + profile.name;
    for (const row of customers) await recordNote(account, session, String(row.customer), note, c);
  });
  return svc.assistant(account, session);
}
// Bidang data profil yang terpasang di sesi; sesi tanpa data profil tidak punya apa pun untuk disimpan.
export async function saveField(svc: AIService, account: string, session: string, field: string, value: unknown) {
  const [rows] = await assistantsSql.findDataProfileId(db, [account, session]);
  if (!rows[0]?.data_profile_id)
    throw new ApiError(409, 'no_profile', 'Pasang data profil ke sesi ini terlebih dahulu.');
  await saveProfileField(svc, account, String(rows[0].data_profile_id), field, value);
  return svc.assistant(account, session);
}
export async function saveDataProfileField(
  svc: AIService,
  account: string,
  value: unknown,
  field: string,
  input: unknown,
) {
  const id = await svc.ownedDataProfile(account, value);
  await saveProfileField(svc, account, id, field, input);
  return svc.dataProfile(account, id);
}
export async function saveProfileField(
  svc: AIService,
  account: string,
  profile: string,
  field: string,
  value: unknown,
) {
  // Isi bisnis ada di koleksi (Asisten AI › Knowledge); di sini hanya perilaku AI dan nomor fallback tim.
  if (field === 'behavior') {
    await dataProfilesSql.updateBehavior(db, [text(value, 2000, 'Perilaku AI'), profile, account]);
    return;
  }
  if (field === 'fallback_number' || field === 'fallback_notify') {
    const [rows] = await dataProfilesSql.findFallback(db, [profile, account]);
    const current = {
      fallback_number: String(rows[0]?.fallback_number ?? ''),
      fallback_notify: Boolean(rows[0]?.fallback_notify),
    };
    const fallbackNumber =
      field === 'fallback_number' ? (value === '' ? '' : text(value, 20, 'Nomor fallback')) : current.fallback_number;
    if (fallbackNumber && !/^[1-9][0-9]{5,14}$/.test(fallbackNumber))
      throw fail('Nomor fallback harus nomor internasional tanpa +');
    const fallbackNotify = field === 'fallback_notify' ? value === true : current.fallback_notify;
    await dataProfilesSql.updateFallback(db, [
      fallbackNumber,
      Boolean(fallbackNumber) && fallbackNotify,
      profile,
      account,
    ]);
    return;
  }
  throw fail('Bidang tidak dikenal');
}
export async function assistant(svc: AIService, account: string, session: string) {
  const [rows] = await assistantsSql.findWithProfile(db, [account, session]);
  const row = rows[0],
    attached = row?.data_profile_id ? String(row.data_profile_id) : null;
  const view = attached
    ? profileView(svc, row)
    : { behavior: '', fallback_number: '', fallback_notify: false, revision: 0 };
  return {
    enabled: Boolean(row?.enabled) && Boolean(attached),
    data_profile: attached ? { id: attached, name: String(row.name), profile_type: String(row.profile_type) } : null,
    profile_enabled: attached ? (await enabledProfiles()).has(String(row.profile_type)) : false,
    ...view,
  };
}

// Hapus paksa profil AI oleh pemilik: profil dinonaktifkan dulu (tidak bisa dipasang lagi), lalu setiap data profil
// klien yang memakainya dicabut dari sesinya dan dihapus beserta record dan filenya lewat jalur yang sama dengan
// tombol Cabut dan Hapus klien, baru profilnya dihapus. Revisi draft tetap dicek agar tidak menghapus versi lain.
export async function forceDeleteProfile(svc: AIService, actor: string, id: string, value: unknown) {
  const input = object(value);
  const graph = await findGraph(id);
  if (!graph) throw new ApiError(404, 'profile_not_found', 'Profil tidak ditemukan.');
  if (input.revision !== graph.revision)
    throw new ApiError(409, 'workflow_conflict', 'Draft berubah. Muat ulang sebelum menghapus.');
  await setProfileEnabled(actor, id, false);
  const [profiles] = await dataProfilesSql.listByType(db, [id]);
  let sessions = 0;
  for (const p of profiles) {
    const account = String(p.account_id),
      dataProfile = String(p.id);
    const [attached] = await assistantsSql.listSessionsOfProfile(db, [account, dataProfile]);
    for (const a of attached) {
      await attachProfile(svc, account, String(a.session_id), { data_profile_id: null });
      sessions++;
    }
    await deleteDataProfile(svc, account, dataProfile);
  }
  await deleteGraph(actor, id, { revision: graph.revision });
  await auditEventsSql.insert(db, [actor, 'graph_force_deleted:' + id + ':' + profiles.length]);
  return { deleted: true, data_profiles: profiles.length, sessions };
}
