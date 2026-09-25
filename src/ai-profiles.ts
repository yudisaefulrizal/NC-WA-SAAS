import type {RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {ApiError} from './engine/sessions.js';
import {record} from './ai-data.js';
import {defaultWorkflow,workflowInput,csStudioMeta,studioMeta} from './ai-workflow.js';
import {csPipeline,type Pipeline} from './ai-agents.js';
import {eduPipeline} from './ai-edu.js';

// A profile is a pipeline shipped with NC-WA: its nodes, tools, the shape of the data it reads (its
// "data profile") and the session menu the dashboard shows for it are fixed in code. The owner only tunes
// each node in AI Studio and switches the profile on or off for every client at once.
export interface ProfileDefinition {
 id:string;name:string;description:string;nodeSummary:string;
 // The runtime pipeline: specialists, prompts, tools and default tiers (see ai-agents.ts).
 pipeline:Pipeline;
 // Session tabs shown while a session runs this profile; Percakapan (chat history) is always available.
 tabs:readonly string[];
 defaultWorkflow():unknown;
 workflowInput(value:unknown):unknown;
 studioMeta():Record<string,unknown>;
}
export const profileDefinitions:Readonly<Record<string,ProfileDefinition>>={
 cs:{id:'cs',name:'CS Usaha',description:'Membalas pelanggan dari knowledge usaha, katalog produk, pesanan masuk, dan fallback tim.',nodeSummary:'Router, 5 specialist, Pesanan, Context',pipeline:csPipeline,tabs:['knowledge','orders','usage','trial'],defaultWorkflow:()=>defaultWorkflow(csPipeline),workflowInput:value=>workflowInput(value,csPipeline),studioMeta:csStudioMeta},
 pendidikan:{id:'pendidikan',name:'CS Lembaga Pendidikan',description:'Menjawab calon siswa, wali, dan siswa aktif dari profil lembaga, program, jadwal, dokumen, dan kontak. Tidak menyimpan data pribadi.',nodeSummary:'Router, 7 specialist, Context',pipeline:eduPipeline,tabs:['knowledge','edu_program','edu_jadwal','edu_dokumen','edu_kontak','usage','trial'],defaultWorkflow:()=>defaultWorkflow(eduPipeline),workflowInput:value=>workflowInput(value,eduPipeline),studioMeta:()=>studioMeta(eduPipeline)},
};
// New profiles arrive switched off, so the owner tunes them in AI Studio before clients can pick them.
export const enabledByDefault=(id:string)=>id==='cs';
export function profileDefinition(id:unknown):ProfileDefinition{if(typeof id!=='string'||!Object.hasOwn(profileDefinitions,id))throw new ApiError(404,'profile_not_found','Profil AI tidak ditemukan');return profileDefinitions[id];}
const nodeCount=(definition:ProfileDefinition)=>Object.keys(record(record(definition.defaultWorkflow()).nodes)).length;
const summary=(definition:ProfileDefinition)=>({id:definition.id,name:definition.name,description:definition.description,tabs:definition.tabs,nodes:nodeCount(definition),node_summary:definition.nodeSummary});

export async function enabledProfiles(){const [rows]=await db.query<RowDataPacket[]>('SELECT id FROM ai_profile_types WHERE enabled=TRUE');const enabled=new Set(rows.map(row=>String(row.id)));return new Set(Object.keys(profileDefinitions).filter(id=>enabled.has(id)));}
// What a client sees: profiles the owner has switched on (the only ones it may pick), plus any profile its
// data profiles already use, so the dashboard can still draw those sessions while the owner has it switched off.
export async function clientProfiles(account:string){
 const enabled=await enabledProfiles();
 const [used]=await db.execute<RowDataPacket[]>('SELECT DISTINCT profile_type FROM ai_data_profiles WHERE account_id=?',[account]);const own=new Set(used.map(row=>String(row.profile_type)));
 return Object.values(profileDefinitions).filter(d=>enabled.has(d.id)||own.has(d.id)).map(d=>({...summary(d),enabled:enabled.has(d.id)}));
}
export async function adminProfiles(){
 const enabled=await enabledProfiles();
 const [workflows]=await db.query<RowDataPacket[]>('SELECT profile_type,revision,active_version,published_revision FROM ai_workflow');
 const [usage]=await db.query<RowDataPacket[]>('SELECT p.profile_type,COUNT(DISTINCT p.id) AS data_profiles,COUNT(a.session_id) AS sessions FROM ai_data_profiles p LEFT JOIN ai_assistants a ON a.data_profile_id=p.id GROUP BY p.profile_type');
 return Object.values(profileDefinitions).map(definition=>{const workflow=workflows.find(w=>w.profile_type===definition.id),use=usage.find(u=>u.profile_type===definition.id);
  return {...summary(definition),enabled:enabled.has(definition.id),active_version:Number(workflow?.active_version??0),revision:Number(workflow?.revision??0),published_revision:Number(workflow?.published_revision??0),sessions:Number(use?.sessions??0),data_profiles:Number(use?.data_profiles??0)};});
}
export async function setProfileEnabled(actor:string,id:unknown,value:unknown){
 const definition=profileDefinition(id);if(typeof value!=='boolean')throw new ApiError(400,'invalid_request','Status profil wajib valid');
 await db.execute('INSERT INTO ai_profile_types(id,enabled) VALUES (?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',[definition.id,value]);
 await db.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',[actor,(value?'ai_profile_enabled:':'ai_profile_disabled:')+definition.id]);
 return adminProfiles();
}

// Each profile keeps its own draft and published workflow, edited and published separately in AI Studio.
const parse=(definition:ProfileDefinition,value:unknown)=>definition.workflowInput(typeof value==='string'?JSON.parse(value):value);
export async function workflowState(profile:unknown='cs'){
 const definition=profileDefinition(profile);
 const [rows]=await db.execute<RowDataPacket[]>('SELECT * FROM ai_workflow WHERE profile_type=?',[definition.id]);const row=rows[0];
 return {profile:definition.id,profile_name:definition.name,enabled:(await enabledProfiles()).has(definition.id),draft:row?parse(definition,row.draft):definition.defaultWorkflow(),active:row?.active?parse(definition,row.active):definition.defaultWorkflow(),revision:Number(row?.revision??0),active_version:Number(row?.active_version??0),published_revision:Number(row?.published_revision??0),...definition.studioMeta()};
}
export async function activeWorkflow(profile:string='cs'){const definition=profileDefinition(profile);const [rows]=await db.execute<RowDataPacket[]>('SELECT active FROM ai_workflow WHERE profile_type=?',[definition.id]);return rows[0]?.active?parse(definition,rows[0].active):definition.defaultWorkflow();}
export async function changeWorkflow(actor:string,profile:unknown,value:unknown,publish=false){
 const definition=profileDefinition(profile);
 const body=record(value);if(!Number.isSafeInteger(body.revision)||Number(body.revision)<0)throw new ApiError(400,'invalid_revision','Revision wajib valid.');
 const draft=publish?undefined:definition.workflowInput(body.draft),c=await db.getConnection();
 try{
  await c.beginTransaction();
  // The one-time topology resets in ai-schema.ts are recorded as already applied, so a later migrate never resets this row.
  await c.execute('INSERT IGNORE INTO ai_workflow(profile_type,draft,tool_defaults_version,layanan_merge_version,profil_perusahaan_rename_version,profil_perusahaan_narrow_version) VALUES (?,?,2,1,1,1)',[definition.id,JSON.stringify(definition.defaultWorkflow())]);
  const [rows]=await c.execute<RowDataPacket[]>('SELECT revision FROM ai_workflow WHERE profile_type=? FOR UPDATE',[definition.id]);
  if(Number(rows[0].revision)!==body.revision)throw new ApiError(409,'workflow_conflict','Draft berubah di tempat lain. Muat ulang sebelum menyimpan.');
  if(publish)await c.execute('UPDATE ai_workflow SET active=draft,active_version=active_version+1,published_revision=revision WHERE profile_type=?',[definition.id]);
  else await c.execute('UPDATE ai_workflow SET draft=?,revision=revision+1 WHERE profile_type=?',[JSON.stringify(draft),definition.id]);
  await c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',[actor,(publish?'ai_workflow_published:':'ai_workflow_draft_saved:')+definition.id]);
  await c.commit();
 }catch(error){await c.rollback();throw error;}finally{c.release();}
 return workflowState(definition.id);
}
