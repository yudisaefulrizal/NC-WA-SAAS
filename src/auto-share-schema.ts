import {db} from './db.js';
export async function migrateAutoShare(){
 await db.query(`CREATE TABLE IF NOT EXISTS share_assets (
 id CHAR(36) PRIMARY KEY, account_id CHAR(36) NOT NULL, filename VARCHAR(255) NOT NULL,
 mimetype VARCHAR(100) NOT NULL, media_type VARCHAR(16) NOT NULL, size_bytes INT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX asset_account(account_id,created_at),
 FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
 ) ENGINE=InnoDB`);
 await db.query(`CREATE TABLE IF NOT EXISTS auto_share_settings (
 account_id CHAR(36) PRIMARY KEY, auto_add_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
 ) ENGINE=InnoDB`);
 await db.query(`CREATE TABLE IF NOT EXISTS daftar_kontak (
 id CHAR(36) PRIMARY KEY, account_id CHAR(36) NOT NULL, nomor VARCHAR(100) NOT NULL, nama VARCHAR(100) NULL,
 kelompkontak VARCHAR(100) NOT NULL DEFAULT '', UNIQUE KEY contact_unique(account_id,nomor),
 INDEX contact_group(account_id,kelompkontak), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
 ) ENGINE=InnoDB`);
 await db.query(`CREATE TABLE IF NOT EXISTS auto_share_templates (
 id CHAR(36) PRIMARY KEY, account_id CHAR(36) NOT NULL, name VARCHAR(100) NOT NULL,
 session_id VARCHAR(64) NOT NULL, message TEXT NOT NULL, contacts JSON NOT NULL, groups_json JSON NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE, next_at DATETIME(3), interval_minutes INT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX schedule_due(enabled,next_at),
 FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
 ) ENGINE=InnoDB`);
 await db.query(`CREATE TABLE IF NOT EXISTS auto_share_runs (
 id CHAR(36) PRIMARY KEY, account_id CHAR(36) NOT NULL, template_id CHAR(36) NOT NULL,
 template_name VARCHAR(100) NOT NULL, session_id VARCHAR(64) NOT NULL, message TEXT NOT NULL,
 source VARCHAR(16) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'queued',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), finished_at DATETIME(3),
 INDEX run_queue(status,created_at), INDEX run_account(account_id,created_at),
 FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
 ) ENGINE=InnoDB`);
 await db.query("ALTER TABLE auto_share_runs MODIFY status VARCHAR(32) NOT NULL DEFAULT 'queued'");
 await db.query(`CREATE TABLE IF NOT EXISTS auto_share_deliveries (
 id CHAR(36) PRIMARY KEY, run_id CHAR(36) NOT NULL, nomor VARCHAR(100) NOT NULL,
 position INT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending', error VARCHAR(500), message_id VARCHAR(255),
 UNIQUE KEY run_recipient(run_id,nomor), FOREIGN KEY(run_id) REFERENCES auto_share_runs(id) ON DELETE CASCADE
 ) ENGINE=InnoDB`);
 async function column(table:string,name:string,definition:string){
  const [rows]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,name]);
  if(!rows.length)await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
 }
 async function foreignKey(table:string,constraint:string,definition:string){
  const [rows]=await db.execute<any[]>('SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?',[table,constraint]);
  if(!rows.length)await db.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY ${definition}`);
 }
 async function index(table:string,name:string,definition:string){
  const [rows]=await db.execute<any[]>('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',[table,name]);
  if(!rows.length)await db.query(`ALTER TABLE ${table} ADD ${definition}`);
 }
 await column('share_assets','public_token','CHAR(32) NULL');
 await column('daftar_kontak','nama','VARCHAR(100) NULL');
 await index('share_assets','public_token','UNIQUE INDEX public_token(public_token)');
 await column('auto_share_templates','media_type',"VARCHAR(16) NOT NULL DEFAULT 'text'");
 await column('auto_share_templates','media_url','VARCHAR(4096) NULL');
 await column('auto_share_templates','filename','VARCHAR(255) NULL');
 await column('auto_share_templates','content_migrated','BOOLEAN NOT NULL DEFAULT FALSE');
 await column('auto_share_templates','asset_id','CHAR(36) NULL');
 await foreignKey('auto_share_templates','fk_template_asset','(asset_id) REFERENCES share_assets(id) ON DELETE SET NULL');
 await column('auto_share_runs','job_id','CHAR(36) NULL');
 await column('auto_share_runs','job_name','VARCHAR(100) NULL');
 await column('auto_share_runs','media_type',"VARCHAR(16) NOT NULL DEFAULT 'text'");
 await column('auto_share_runs','media_url','VARCHAR(4096) NULL');
 await column('auto_share_runs','filename','VARCHAR(255) NULL');
 await column('auto_share_runs','asset_id','CHAR(36) NULL');
 await column('auto_share_templates','source_mode',"VARCHAR(16) NOT NULL DEFAULT 'none'");
 await column('auto_share_templates','source_endpoint',"VARCHAR(512) NOT NULL DEFAULT ''");
 await column('auto_share_templates','source_secret','TEXT NULL');
 await column('auto_share_templates','media_source',"VARCHAR(16) NOT NULL DEFAULT 'asset'");
 await column('auto_share_templates','media_variable',"VARCHAR(40) NOT NULL DEFAULT ''");
 await column('auto_share_templates','tidy','BOOLEAN NOT NULL DEFAULT FALSE');
 await column('auto_share_templates','tidy_note',"VARCHAR(500) NOT NULL DEFAULT ''");
 await column('auto_share_runs','tidied','BOOLEAN NOT NULL DEFAULT FALSE');
 await column('auto_share_runs','tidy_note','VARCHAR(60) NULL');
 await column('auto_share_runs','source_data','JSON NULL');
 // Assets fetched from a template source belong to one run only: excluded from the account quota
 // and removed once the run settles. No foreign key, so deleting a run never drops the row before
 // its file is cleaned from disk.
 await column('share_assets','run_id','CHAR(36) NULL');
 await index('share_assets','asset_run','INDEX asset_run(run_id)');
 await db.query(`CREATE TABLE IF NOT EXISTS auto_share_jobs (
 id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,name VARCHAR(100) NOT NULL,session_id VARCHAR(64) NOT NULL,
 contacts JSON NOT NULL,groups_json JSON NOT NULL,template_ids JSON NOT NULL,rotation_index INT UNSIGNED NOT NULL DEFAULT 0,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,next_at DATETIME(3),interval_minutes INT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX job_due(enabled,next_at),
 FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
 const c=await db.getConnection();
 try{await c.beginTransaction();
  await c.query(`INSERT IGNORE INTO auto_share_jobs(id,account_id,name,session_id,contacts,groups_json,template_ids,enabled,next_at,interval_minutes,created_at)
   SELECT id,account_id,name,session_id,contacts,groups_json,JSON_ARRAY(id),enabled,next_at,interval_minutes,created_at FROM auto_share_templates WHERE content_migrated=FALSE`);
  await c.query(`UPDATE auto_share_runs r JOIN auto_share_templates t ON t.id=r.template_id AND t.account_id=r.account_id SET r.job_id=t.id,r.job_name=t.name WHERE t.content_migrated=FALSE AND r.job_id IS NULL`);
  await c.query('UPDATE auto_share_templates SET content_migrated=TRUE,enabled=FALSE WHERE content_migrated=FALSE');
  await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}

}
