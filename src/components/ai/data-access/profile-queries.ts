// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectProfileTypesId(c:Executor){return c.query<RowDataPacket[]>('SELECT id FROM ai_profile_types WHERE enabled=TRUE');}
export function selectDataProfilesDISTINCTProfileTypeByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT DISTINCT profile_type FROM ai_data_profiles WHERE account_id=?',params);}
export function selectWorkflow(c:Executor){return c.query<RowDataPacket[]>('SELECT profile_type,revision,active_version,published_revision FROM ai_workflow');}
export function selectDataProfiles(c:Executor){return c.query<RowDataPacket[]>('SELECT p.profile_type,COUNT(DISTINCT p.id) AS data_profiles,COUNT(a.session_id) AS sessions FROM ai_data_profiles p LEFT JOIN ai_assistants a ON a.data_profile_id=p.id GROUP BY p.profile_type');}
export function upsertProfileTypes(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO ai_profile_types(id,enabled) VALUES (?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',params);}
export function insertAuditEvents(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',params);}
export function selectWorkflowByProfileType(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT * FROM ai_workflow WHERE profile_type=?',params);}
export function selectWorkflowActiveByProfileType(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT active FROM ai_workflow WHERE profile_type=?',params);}
export function insertIgnoreWorkflow(c:Executor,params:SqlValue[]){return c.execute('INSERT IGNORE INTO ai_workflow(profile_type,draft,tool_defaults_version,layanan_merge_version,profil_perusahaan_rename_version,profil_perusahaan_narrow_version) VALUES (?,?,2,1,1,1)',params);}
export function lockWorkflowRevisionByProfileType(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT revision FROM ai_workflow WHERE profile_type=? FOR UPDATE',params);}
export function updateWorkflowActiveByProfileType(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_workflow SET active=draft,active_version=active_version+1,published_revision=revision WHERE profile_type=?',params);}
export function updateWorkflowDraftByProfileType(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_workflow SET draft=?,revision=revision+1 WHERE profile_type=?',params);}
