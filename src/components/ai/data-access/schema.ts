import {db} from '../../../libraries/db.js';
import {defaultWorkflow} from '../domain/pipeline/workflow.js';
import {chatTable} from '../domain/chat.js';
import {profileDefinitions,enabledByDefault} from '../domain/profiles/registry.js';
import {profileFields} from '../domain/profiles/cs/knowledge.js';
import {randomUUID} from 'node:crypto';

export async function migrateAI(){
 const tables=[
 `CREATE TABLE IF NOT EXISTS ai_workflow (id INT PRIMARY KEY,draft JSON NOT NULL,active JSON NULL,revision INT UNSIGNED NOT NULL DEFAULT 0,active_version INT UNSIGNED NOT NULL DEFAULT 0,published_revision INT UNSIGNED NOT NULL DEFAULT 0,tool_defaults_version INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_message_origins (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,message_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,origin ENUM('system','manual') NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,session_id,message_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_settings (id INT PRIMARY KEY, endpoint VARCHAR(512) NOT NULL, model VARCHAR(100) NOT NULL, secret TEXT NOT NULL, input_rate INT UNSIGNED NOT NULL DEFAULT 1, output_rate INT UNSIGNED NOT NULL DEFAULT 2, memory_limit INT UNSIGNED NOT NULL DEFAULT 60, credit_price INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_assistants (account_id CHAR(36) NOT NULL, session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE, behavior TEXT NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY(account_id,session_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_wallets (account_id CHAR(36) PRIMARY KEY,balance INT UNSIGNED NOT NULL DEFAULT 0,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_conversations (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,paused BOOLEAN NOT NULL DEFAULT FALSE,messages JSON NOT NULL,revision INT UNSIGNED NOT NULL DEFAULT 0,PRIMARY KEY(account_id,session_id,customer),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_usage (account_id CHAR(36) NOT NULL,request_id CHAR(64) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,status VARCHAR(32) NOT NULL,input_words INT UNSIGNED NOT NULL DEFAULT 0,output_words INT UNSIGNED NOT NULL DEFAULT 0,input_rate INT UNSIGNED NOT NULL,output_rate INT UNSIGNED NOT NULL,reserved INT UNSIGNED NOT NULL DEFAULT 0,charged INT UNSIGNED NOT NULL DEFAULT 0,model VARCHAR(100) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_adjustments (account_id CHAR(36) NOT NULL,request_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,actor_id CHAR(36) NOT NULL,amount INT NOT NULL,reason VARCHAR(200) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_agent_failures (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,request_id CHAR(64) NOT NULL,agent VARCHAR(20) NULL,error VARCHAR(100) NOT NULL,message VARCHAR(4000) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX failure_account(account_id,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_trace_log (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,request_id CHAR(64) NOT NULL,node VARCHAR(20) NOT NULL,state VARCHAR(20) NOT NULL,model VARCHAR(100) NULL,attempt INT UNSIGNED NULL,duration_ms INT UNSIGNED NULL,input JSON NULL,output JSON NULL,error VARCHAR(200) NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX trace_request(account_id,request_id,id),INDEX trace_account(account_id,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`
 ];
 for(const sql of tables)await db.query(sql);
 await db.query(`CREATE TABLE IF NOT EXISTS ai_provider_profiles (id CHAR(36) PRIMARY KEY,name VARCHAR(100) NOT NULL,provider VARCHAR(20) NOT NULL,endpoint VARCHAR(512) NOT NULL,secret TEXT NOT NULL,model_cheap VARCHAR(100) NOT NULL DEFAULT '',model_medium VARCHAR(100) NOT NULL DEFAULT '',model_smart VARCHAR(100) NOT NULL DEFAULT '',model_structured VARCHAR(100) NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
 await db.query(`CREATE TABLE IF NOT EXISTS ai_provider_routes (tier VARCHAR(16) PRIMARY KEY,profile_id CHAR(36) NOT NULL,model VARCHAR(100) NOT NULL,FOREIGN KEY(profile_id) REFERENCES ai_provider_profiles(id) ON DELETE RESTRICT) ENGINE=InnoDB`);
 await db.query("INSERT INTO ai_provider_profiles(id,name,provider,endpoint,secret) SELECT UUID(),'Konfigurasi AI sebelumnya',CASE WHEN endpoint LIKE 'https://openrouter.ai/%' THEN 'openrouter' WHEN endpoint LIKE 'https://ai.sumopod.com/%' THEN 'sumopod' ELSE 'compatible' END,endpoint,secret FROM ai_settings WHERE id=1 AND NOT EXISTS(SELECT 1 FROM ai_provider_profiles)");
 for(const tier of ['cheap','medium','smart'])await db.query(`INSERT IGNORE INTO ai_provider_routes(tier,profile_id,model) SELECT '${tier}',id,COALESCE((SELECT ${tier==='cheap'?'model_cheap':tier==='medium'?'model_medium':'model_smart'} FROM ai_settings WHERE id=1),(SELECT model FROM ai_settings WHERE id=1)) FROM ai_provider_profiles ORDER BY created_at LIMIT 1`);
 const dataTables=[
 `CREATE TABLE IF NOT EXISTS ai_data_sources (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,kind ENUM('products','orders') NOT NULL,mode ENUM('builtin','endpoint') NOT NULL DEFAULT 'builtin',endpoint VARCHAR(512) NOT NULL DEFAULT '',secret TEXT NOT NULL,PRIMARY KEY(account_id,session_id,kind),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_products (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,name VARCHAR(150) COLLATE utf8mb4_bin NOT NULL,type ENUM('product','service') NOT NULL,description VARCHAR(500) NOT NULL,price BIGINT UNSIGNED NOT NULL,stock INT UNSIGNED NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(account_id,session_id,name),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_orders (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,input_hash CHAR(64) NOT NULL,customer VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,items JSON NOT NULL,total BIGINT UNSIGNED NOT NULL,status ENUM('pesanan_masuk','dibayar','diproses','selesai','dibatalkan') NOT NULL DEFAULT 'pesanan_masuk',notes VARCHAR(1000) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(account_id,session_id,id),UNIQUE KEY order_request(account_id,session_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_product_images (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,size_bytes INT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX product_image_session(account_id,session_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`
 ];
 for(const sql of dataTables)await db.query(sql);
 await db.query(chatTable);
 const [orderColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_orders','input_hash']);
 if(!orderColumns.length)await db.query("ALTER TABLE ai_orders ADD COLUMN input_hash CHAR(64) NOT NULL DEFAULT ''");
 // Order statuses are exactly pesanan_masuk, dibayar, diproses, selesai, dibatalkan. Older tables used
 // "baru" (and lacked "dibayar"): widen first so every row stays valid, rename "baru", then drop it.
 const finalStatuses="'pesanan_masuk','dibayar','diproses','selesai','dibatalkan'";
 const [statusColumn]=await db.execute<any[]>('SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_orders','status']);
 if(statusColumn[0]&&String(statusColumn[0].COLUMN_TYPE)!==`enum(${finalStatuses})`){
  await db.query(`ALTER TABLE ai_orders MODIFY status ENUM('baru',${finalStatuses}) NOT NULL DEFAULT 'pesanan_masuk'`);
  await db.query("UPDATE ai_orders SET status='pesanan_masuk' WHERE status='baru'");
  await db.query(`ALTER TABLE ai_orders MODIFY status ENUM(${finalStatuses}) NOT NULL DEFAULT 'pesanan_masuk'`);
 }
 const [contextColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_conversations','router_context']);
 if(!contextColumns.length)await db.query('ALTER TABLE ai_conversations ADD COLUMN router_context VARCHAR(200) NULL');
 const [usageColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_usage','agent']);
 if(!usageColumns.length)await db.query('ALTER TABLE ai_usage ADD COLUMN agent VARCHAR(20) NULL');
 const [tidyPrompt]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_settings','tidy_prompt']);
 if(!tidyPrompt.length)await db.query("ALTER TABLE ai_settings ADD COLUMN tidy_prompt TEXT NULL");
 // Before multi-profile, knowledge/behavior/fallback lived on ai_assistants; these column migrations only apply to that
 // legacy shape. migrateProfiles() (end of this file) moves them into ai_data_profiles and drops them here.
 const [legacyAssistantColumn]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','behavior']);
 const legacyAssistants=legacyAssistantColumn.length>0;
 const [assistantFallback]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','fallback_number']);
 if(legacyAssistants&&!assistantFallback.length)await db.query("ALTER TABLE ai_assistants ADD COLUMN fallback_number VARCHAR(20) NOT NULL DEFAULT ''");
 const [assistantFallbackNotify]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','fallback_notify']);
 if(legacyAssistants&&!assistantFallbackNotify.length)await db.query('ALTER TABLE ai_assistants ADD COLUMN fallback_notify BOOLEAN NOT NULL DEFAULT FALSE');
 await db.query(`CREATE TABLE IF NOT EXISTS ai_fallbacks (id VARCHAR(48) PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,fallback_number VARCHAR(20) NOT NULL,status ENUM('waiting','answered','resolved','failed','expired') NOT NULL DEFAULT 'waiting',agent VARCHAR(20) NOT NULL,reason VARCHAR(500) NOT NULL,question VARCHAR(1000) NOT NULL,router_context VARCHAR(200) NULL,messages JSON NOT NULL,source_message_id VARCHAR(255) NOT NULL,notification_message_id VARCHAR(255) NULL,confirmation_message_id VARCHAR(255) NULL,staff_answer TEXT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,answered_at DATETIME NULL,resolved_at DATETIME NULL,UNIQUE KEY fallback_source(account_id,session_id,source_message_id),UNIQUE KEY fallback_notification(account_id,session_id,notification_message_id),INDEX fallback_customer(account_id,session_id,customer,status),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
 // TEXT is stored off-page (unlike VARCHAR), so 13 profile columns don't hit InnoDB's row-size limit.
 // TEXT can't carry a DEFAULT in this MySQL version; callers always coalesce NULL to '' (see ai.ts).
 const [legacyKnowledgeColumn]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','knowledge']);
 if(legacyKnowledgeColumn.length)await db.query('ALTER TABLE ai_assistants MODIFY knowledge TEXT NULL');
 const profileFields=['usaha','cara_pemesanan','pembayaran','kebijakan','faq'];
 // profil_lainnya is deprecated (folded into FAQ below) but still needed transiently as the legacy knowledge carry-over target.
 const [existingProfilLainnya]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','profil_lainnya']);
 let addedProfilLainnya=false;
 if(legacyKnowledgeColumn.length&&!existingProfilLainnya.length){await db.query('ALTER TABLE ai_assistants ADD COLUMN profil_lainnya TEXT NULL');addedProfilLainnya=true;}
 for(const [table,column,definition] of [['ai_settings','profile_routing_enabled','BOOLEAN NOT NULL DEFAULT FALSE'],['ai_settings','model_cheap','VARCHAR(100) NULL'],['ai_settings','model_medium','VARCHAR(100) NULL'],['ai_settings','model_smart','VARCHAR(100) NULL'],['ai_settings','model_structured','VARCHAR(100) NULL'],['ai_provider_profiles','model_cheap',"VARCHAR(100) NOT NULL DEFAULT ''"],['ai_provider_profiles','model_medium',"VARCHAR(100) NOT NULL DEFAULT ''"],['ai_provider_profiles','model_smart',"VARCHAR(100) NOT NULL DEFAULT ''"],['ai_provider_profiles','model_structured',"VARCHAR(100) NOT NULL DEFAULT ''"],['ai_settings','context_memory_limit','INT UNSIGNED NOT NULL DEFAULT 6'],['ai_settings','trace_enabled','BOOLEAN NOT NULL DEFAULT FALSE'],['ai_usage','model_calls','JSON NULL'],['ai_conversations','full_auto','BOOLEAN NOT NULL DEFAULT FALSE'],['ai_agent_failures','model','VARCHAR(100) NULL'],['ai_agent_failures','prompt','JSON NULL'],['ai_agent_failures','raw_output','MEDIUMTEXT NULL'],['ai_agent_failures','router_context','VARCHAR(200) NULL'],['ai_products','image_id','CHAR(36) NULL'],...(legacyAssistants?profileFields.map(field=>['ai_assistants','profil_'+field,'TEXT NULL'] as [string,string,string]):[])]){
 const [columns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
 if(!columns.length)await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
 }
 await db.query('UPDATE ai_settings SET profile_routing_enabled=TRUE WHERE id=1 AND EXISTS(SELECT 1 FROM ai_provider_routes)');
 await db.query('UPDATE ai_provider_profiles p JOIN ai_provider_routes r ON r.profile_id=p.id JOIN ai_settings s ON s.id=1 SET p.model_cheap=IF(p.model_cheap=\'\',COALESCE(s.model_cheap,s.model),p.model_cheap),p.model_medium=IF(p.model_medium=\'\',COALESCE(s.model_medium,s.model),p.model_medium),p.model_smart=IF(p.model_smart=\'\',COALESCE(s.model_smart,s.model),p.model_smart)');
 // The Terstruktur tier starts with the Murah model and route; the admin then picks a model that supports JSON Schema.
 await db.query('UPDATE ai_settings SET model_structured=COALESCE(model_cheap,model) WHERE model_structured IS NULL');
 await db.query("UPDATE ai_provider_profiles SET model_structured=model_cheap WHERE model_structured=''");
 await db.query("INSERT IGNORE INTO ai_provider_routes(tier,profile_id,model) SELECT 'structured',r.profile_id,p.model_structured FROM ai_provider_routes r JOIN ai_provider_profiles p ON p.id=r.profile_id WHERE r.tier='cheap'");
 // One-time carry-over: existing free-text knowledge moves into "Lainnya" first, then folded into FAQ below.
 if(addedProfilLainnya)await db.query("UPDATE ai_assistants SET profil_lainnya=knowledge WHERE knowledge IS NOT NULL AND knowledge<>''");
 // knowledge is fully superseded by profil_* (composed on read); drop it now that the carry-over above ran.
 if(legacyKnowledgeColumn.length)await db.query('ALTER TABLE ai_assistants DROP COLUMN knowledge');
 // "Lainnya" removed as a separate field; anything in it (including staff answers applied from resolved fallback tickets) folds into FAQ.
 const [profilLainnyaColumn]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','profil_lainnya']);
 if(profilLainnyaColumn.length){
  await db.query("UPDATE ai_assistants SET profil_faq=TRIM(BOTH '\\n\\n' FROM CONCAT_WS('\\n\\n',NULLIF(profil_faq,''),NULLIF(profil_lainnya,'')))");
  await db.query('ALTER TABLE ai_assistants DROP COLUMN profil_lainnya');
 }
 // Product/price live in the dedicated products table; the freeform profile fields for them were removed.
 for(const column of ['profil_produk_layanan','profil_harga']){
  const [columns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants',column]);
  if(columns.length)await db.query(`ALTER TABLE ai_assistants DROP COLUMN ${column}`);
 }
 // Bidang is folded into Deskripsi (one-time carry-over before dropping) rather than kept as a separate field.
 const [bidangColumn]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','profil_bidang']);
 if(bidangColumn.length){
  await db.query("UPDATE ai_assistants SET profil_deskripsi=TRIM(CONCAT(COALESCE(profil_deskripsi,''),IF(profil_deskripsi IS NOT NULL AND profil_deskripsi<>'' AND profil_bidang IS NOT NULL AND profil_bidang<>'','\\n\\n',''),COALESCE(profil_bidang,''))) WHERE profil_bidang IS NOT NULL AND profil_bidang<>''");
  await db.query('ALTER TABLE ai_assistants DROP COLUMN profil_bidang');
 }
 // Nama/Deskripsi/Alamat/Kontak/Jam operasional merged into one free-text "Profil usaha" field (one-time carry-over before dropping).
 const [usahaSourceColumns]=await db.execute<any[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_assistants' AND COLUMN_NAME IN ('profil_nama','profil_deskripsi','profil_alamat','profil_kontak','profil_jam_operasional')");
 if(usahaSourceColumns.length){
  await db.query(`UPDATE ai_assistants SET profil_usaha=TRIM(BOTH '\\n\\n' FROM CONCAT_WS('\\n\\n',NULLIF(profil_nama,''),NULLIF(profil_deskripsi,''),NULLIF(profil_alamat,''),NULLIF(profil_kontak,''),NULLIF(profil_jam_operasional,'')))`);
  for(const column of ['profil_nama','profil_deskripsi','profil_alamat','profil_kontak','profil_jam_operasional'])await db.query(`ALTER TABLE ai_assistants DROP COLUMN ${column}`);
 }
 // Product code removed (name-based identity avoids the duplicate-name confusion a separate code invited); unit folded into description as free text.
 const [productIdColumn]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_products','id']);
 if(productIdColumn.length){
  const [productUnitColumn]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_products','unit']);
  // Two old codes could share a name; keep only the most recently defined (highest id) row per name before name becomes the primary key.
  await db.query('DELETE p1 FROM ai_products p1 INNER JOIN ai_products p2 ON p1.account_id=p2.account_id AND p1.session_id=p2.session_id AND p1.name=p2.name AND p1.id<p2.id');
  if(productUnitColumn.length)await db.query("UPDATE ai_products SET description=TRIM(BOTH ' ' FROM CONCAT(description,IF(description<>'' AND unit IS NOT NULL AND unit<>'',' | ',''),IF(unit IS NOT NULL AND unit<>'',CONCAT('Satuan: ',unit),'')))");
  await db.query('ALTER TABLE ai_products DROP PRIMARY KEY, ADD PRIMARY KEY(account_id,session_id,name), DROP COLUMN id'+(productUnitColumn.length?', DROP COLUMN unit':''));
 }
 const [workflowColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_workflow','tool_defaults_version']);
 if(!workflowColumns.length)await db.query('ALTER TABLE ai_workflow ADD COLUMN tool_defaults_version INT UNSIGNED NOT NULL DEFAULT 0');
 await db.query("UPDATE ai_workflow SET draft=IF(JSON_LENGTH(JSON_EXTRACT(draft,'$.nodes.lainnya.tools'))=0,JSON_SET(draft,'$.nodes.lainnya.tools',JSON_ARRAY('get_knowledge','get_products','check_order')),draft),active=IF(active IS NULL,NULL,IF(JSON_LENGTH(JSON_EXTRACT(active,'$.nodes.lainnya.tools'))=0,JSON_SET(active,'$.nodes.lainnya.tools',JSON_ARRAY('get_knowledge','get_products','check_order')),active)),tool_defaults_version=1 WHERE id=1 AND tool_defaults_version<1");
 // Sub-agents transaksi/konsultasi/dukungan/keluhan merged into one "layanan" node; old node keys no longer validate, so reset to the new default topology.
 const [mergedColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_workflow','layanan_merge_version']);
 if(!mergedColumns.length)await db.query('ALTER TABLE ai_workflow ADD COLUMN layanan_merge_version INT UNSIGNED NOT NULL DEFAULT 0');
 const [mergedRows]=await db.query<any[]>('SELECT layanan_merge_version FROM ai_workflow WHERE id=1');
 if(mergedRows[0]&&mergedRows[0].layanan_merge_version<1){
  const fresh=JSON.stringify(defaultWorkflow());
  await db.query('UPDATE ai_workflow SET draft=?,active=IF(active IS NULL,NULL,?),revision=revision+1,layanan_merge_version=1 WHERE id=1',[fresh,fresh]);
 }
 // Agent "informasi" renamed to "profil_perusahaan" for clarity; old node key no longer validates, so reset again.
 const [renamedColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_workflow','profil_perusahaan_rename_version']);
 if(!renamedColumns.length)await db.query('ALTER TABLE ai_workflow ADD COLUMN profil_perusahaan_rename_version INT UNSIGNED NOT NULL DEFAULT 0');
 const [renamedRows]=await db.query<any[]>('SELECT profil_perusahaan_rename_version FROM ai_workflow WHERE id=1');
 if(renamedRows[0]&&renamedRows[0].profil_perusahaan_rename_version<1){
  const fresh=JSON.stringify(defaultWorkflow());
  await db.query('UPDATE ai_workflow SET draft=?,active=IF(active IS NULL,NULL,?),revision=revision+1,profil_perusahaan_rename_version=1 WHERE id=1',[fresh,fresh]);
 }
 // profil_perusahaan no longer has get_products (product/price questions moved fully to layanan); old node's tools no longer validate, so reset again.
 const [narrowedColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_workflow','profil_perusahaan_narrow_version']);
 if(!narrowedColumns.length)await db.query('ALTER TABLE ai_workflow ADD COLUMN profil_perusahaan_narrow_version INT UNSIGNED NOT NULL DEFAULT 0');
 const [narrowedRows]=await db.query<any[]>('SELECT profil_perusahaan_narrow_version FROM ai_workflow WHERE id=1');
 if(narrowedRows[0]&&narrowedRows[0].profil_perusahaan_narrow_version<1){
  const fresh=JSON.stringify(defaultWorkflow());
  await db.query('UPDATE ai_workflow SET draft=?,active=IF(active IS NULL,NULL,?),revision=revision+1,profil_perusahaan_narrow_version=1 WHERE id=1',[fresh,fresh]);
 }
 // New send_product_image tool granted to the existing "layanan" node's tool list, without touching any custom prompt/model already saved.
 // Runs after the topology migrations above so the "layanan" node is guaranteed to exist.
 await db.query("UPDATE ai_workflow SET draft=IF(JSON_CONTAINS(JSON_EXTRACT(draft,'$.nodes.layanan.tools'),'\"send_product_image\"'),draft,JSON_ARRAY_APPEND(draft,'$.nodes.layanan.tools','send_product_image')),active=IF(active IS NULL,NULL,IF(JSON_CONTAINS(JSON_EXTRACT(active,'$.nodes.layanan.tools'),'\"send_product_image\"'),active,JSON_ARRAY_APPEND(active,'$.nodes.layanan.tools','send_product_image'))),tool_defaults_version=2 WHERE id=1 AND tool_defaults_version<2");
 await migrateProfiles();
}

const hasColumn=async(table:string,column:string)=>{const [rows]=await db.execute<any[]>('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);return rows.length>0;};
const hasIndex=async(table:string,name:string)=>{const [rows]=await db.execute<any[]>('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',[table,name]);return rows.length>0;};
const primaryKey=async(table:string)=>{const [rows]=await db.execute<any[]>("SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX",[table]);return rows.map(row=>String(row.COLUMN_NAME));};
// Session-keyed business data moves to the data profile its session now uses. Every such session got a data
// profile first, so a row left without one means the move is incomplete: stop instead of dropping data.
async function linkToDataProfile(table:string){
 await db.query(`UPDATE ${table} t JOIN ai_assistants a ON a.account_id=t.account_id AND a.session_id=t.session_id SET t.data_profile_id=a.data_profile_id WHERE t.data_profile_id IS NULL`);
 const [left]=await db.query<any[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE data_profile_id IS NULL`);
 if(Number(left[0].n))throw Error(`Migrasi data profil berhenti: ${left[0].n} baris ${table} belum punya data profil.`);
}
// Multi-profile: a profile is a pipeline shipped in code (ai-profiles.ts); a data profile is the client's content
// for one profile, attachable to any number of sessions. Runs after every legacy migration above, re-runnable.
async function migrateProfiles(){
 await db.query('CREATE TABLE IF NOT EXISTS ai_profile_types (id VARCHAR(32) PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB');
 for(const id of Object.keys(profileDefinitions))await db.execute('INSERT IGNORE INTO ai_profile_types(id,enabled) VALUES (?,?)',[id,enabledByDefault(id)]);
 // The single global workflow (id=1) becomes the CS profile's workflow; other profiles get their own rows.
 if(!await hasColumn('ai_workflow','profile_type')){
  await db.query('ALTER TABLE ai_workflow ADD COLUMN profile_type VARCHAR(32) NULL, ADD UNIQUE KEY workflow_profile(profile_type)');
  await db.query("UPDATE ai_workflow SET profile_type='cs' WHERE id=1");
  await db.query('ALTER TABLE ai_workflow MODIFY id INT NOT NULL AUTO_INCREMENT');
 }
 const fields=profileFields.map(field=>'profil_'+field);
 await db.query(`CREATE TABLE IF NOT EXISTS ai_data_profiles (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,profile_type VARCHAR(32) NOT NULL,name VARCHAR(100) NOT NULL,behavior TEXT NOT NULL,${fields.map(field=>field+' TEXT NOT NULL').join(',')},fallback_number VARCHAR(20) NOT NULL DEFAULT '',fallback_notify BOOLEAN NOT NULL DEFAULT FALSE,revision INT UNSIGNED NOT NULL DEFAULT 0,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY data_profile_name(account_id,name),KEY data_profile_type(account_id,profile_type),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
 if(!await hasColumn('ai_assistants','data_profile_id'))await db.query('ALTER TABLE ai_assistants ADD COLUMN data_profile_id CHAR(36) NULL, ADD KEY assistant_data_profile(data_profile_id), ADD CONSTRAINT assistant_data_profile_fk FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE SET NULL');
 for(const [table,column,definition] of [['ai_usage','profile_type','VARCHAR(32) NULL'],['ai_usage','data_profile_id','CHAR(36) NULL'],['ai_trace_log','profile_type','VARCHAR(32) NULL']])if(!await hasColumn(table,column))await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
 const legacy=await hasColumn('ai_assistants','behavior');
 if(legacy){
  // Every session that has settings or business data gets a CS data profile named after it, attached, with
  // its AI switch unchanged, so clients see the same behavior right after the upgrade.
  for(const table of ['ai_products','ai_orders','ai_data_sources','ai_product_images'])if(await hasColumn(table,'session_id')&&!(await primaryKey(table))[0]?.startsWith('data_profile'))await db.query(`INSERT IGNORE INTO ai_assistants(account_id,session_id,enabled,behavior) SELECT DISTINCT account_id,session_id,FALSE,'' FROM ${table} WHERE session_id IS NOT NULL`);
  const [assistants]=await db.query<any[]>(`SELECT account_id,session_id,behavior,fallback_number,fallback_notify,${fields.join(',')} FROM ai_assistants WHERE data_profile_id IS NULL`);
  for(const row of assistants){
   const c=await db.getConnection();
   try{
    await c.beginTransaction();
    const [taken]=await c.execute<any[]>('SELECT name FROM ai_data_profiles WHERE account_id=? FOR UPDATE',[row.account_id]);const names=new Set(taken.map(t=>String(t.name).toLowerCase()));
    const base='CS – '+row.session_id;let name=base;for(let n=2;names.has(name.toLowerCase());n++)name=base+' ('+n+')';
    const id=randomUUID();
    await c.execute(`INSERT INTO ai_data_profiles(id,account_id,profile_type,name,behavior,fallback_number,fallback_notify,${fields.join(',')}) VALUES (?,?,'cs',?,?,?,?,${fields.map(()=>'?').join(',')})`,[id,row.account_id,name,String(row.behavior??''),String(row.fallback_number??''),Boolean(row.fallback_notify),...fields.map(field=>String(row[field]??''))]);
    await c.execute('UPDATE ai_assistants SET data_profile_id=? WHERE account_id=? AND session_id=? AND data_profile_id IS NULL',[id,row.account_id,row.session_id]);
    await c.commit();
   }catch(error){await c.rollback();throw error;}finally{c.release();}
  }
 }
 // Products, sources and photos now belong to the data profile; each table keeps its own index on account_id
 // for the account foreign key before the old (account_id,session_id,...) primary key is dropped.
 for(const [table,key] of [['ai_products','name'],['ai_data_sources','kind']]){
  if(!await hasColumn(table,'session_id'))continue;
  if(!await hasColumn(table,'data_profile_id'))await db.query(`ALTER TABLE ${table} ADD COLUMN data_profile_id CHAR(36) NULL AFTER account_id`);
  await linkToDataProfile(table);
  if(!await hasIndex(table,table+'_account'))await db.query(`ALTER TABLE ${table} ADD KEY ${table}_account(account_id)`);
  await db.query(`ALTER TABLE ${table} DROP PRIMARY KEY, MODIFY data_profile_id CHAR(36) NOT NULL, ADD PRIMARY KEY(data_profile_id,${key}), DROP COLUMN session_id, ADD CONSTRAINT ${table}_data_profile_fk FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE CASCADE`);
 }
 if(await hasColumn('ai_product_images','session_id')){
  if(!await hasColumn('ai_product_images','data_profile_id'))await db.query('ALTER TABLE ai_product_images ADD COLUMN data_profile_id CHAR(36) NULL AFTER account_id');
  await linkToDataProfile('ai_product_images');
  if(!await hasIndex('ai_product_images','ai_product_images_account'))await db.query('ALTER TABLE ai_product_images ADD KEY ai_product_images_account(account_id)');
  await db.query('ALTER TABLE ai_product_images DROP INDEX product_image_session, DROP COLUMN session_id, MODIFY data_profile_id CHAR(36) NOT NULL, ADD KEY product_image_profile(data_profile_id), ADD CONSTRAINT ai_product_images_data_profile_fk FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE CASCADE');
 }
 // Orders belong to the data profile too; session_id stays as the session the order came from (NULL when
 // created from the Data Profil page), so several sessions sharing one data profile collect orders in one place.
 if((await primaryKey('ai_orders'))[0]!=='data_profile_id'){
  if(!await hasColumn('ai_orders','data_profile_id'))await db.query('ALTER TABLE ai_orders ADD COLUMN data_profile_id CHAR(36) NULL AFTER account_id');
  await linkToDataProfile('ai_orders');
  if(!await hasIndex('ai_orders','ai_orders_account'))await db.query('ALTER TABLE ai_orders ADD KEY ai_orders_account(account_id)');
  await db.query('ALTER TABLE ai_orders DROP PRIMARY KEY, DROP INDEX order_request, MODIFY data_profile_id CHAR(36) NOT NULL, MODIFY session_id VARCHAR(64) COLLATE utf8mb4_bin NULL, ADD PRIMARY KEY(data_profile_id,id), ADD UNIQUE KEY order_request(data_profile_id,request_id), ADD CONSTRAINT ai_orders_data_profile_fk FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE CASCADE');
 }
 if(legacy){const columns=[];for(const column of ['behavior','fallback_number','fallback_notify',...fields])if(await hasColumn('ai_assistants',column))columns.push(column);if(columns.length)await db.query('ALTER TABLE ai_assistants '+columns.map(column=>'DROP COLUMN '+column).join(', '));}
 await migrateEducation();
}
// CS Lembaga Pendidikan: its text fields live on ai_data_profiles (FAQ reuses profil_faq); programs, contacts and
// documents get their own tables, removed with the data profile. Re-runnable.
async function migrateEducation(){
 for(const [column,definition] of [['edu_lembaga','TEXT NULL'],['edu_jadwal','TEXT NULL']])if(!await hasColumn('ai_data_profiles',column))await db.query(`ALTER TABLE ai_data_profiles ADD COLUMN ${column} ${definition}`);
 // Forms of address moved into Perilaku AI and the institution kind into the Profil Lembaga text; their columns are dropped.
 for(const column of ['edu_peserta','edu_wali','edu_pendidik','edu_kind'])if(await hasColumn('ai_data_profiles',column))await db.query(`ALTER TABLE ai_data_profiles DROP COLUMN ${column}`);
 const owned=(name:string)=>`KEY ${name}_account(account_id),KEY ${name}_profile(data_profile_id),CONSTRAINT ${name}_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,CONSTRAINT ${name}_data_profile_fk FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE CASCADE`;
 await db.query(`CREATE TABLE IF NOT EXISTS ai_edu_programs (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,data_profile_id CHAR(36) NOT NULL,name VARCHAR(150) NOT NULL,description TEXT NOT NULL,position INT UNSIGNED NOT NULL DEFAULT 0,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY edu_program_name(data_profile_id,name),${owned('ai_edu_programs')}) ENGINE=InnoDB`);
 await db.query(`CREATE TABLE IF NOT EXISTS ai_edu_contacts (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,data_profile_id CHAR(36) NOT NULL,bagian VARCHAR(100) NOT NULL,kontak VARCHAR(150) NOT NULL,deskripsi VARCHAR(300) NOT NULL,position INT UNSIGNED NOT NULL DEFAULT 0,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,${owned('ai_edu_contacts')}) ENGINE=InnoDB`);
 // file_id names the file on disk once "Ganti file" replaced the original (NULL: the file is named after id).
 await db.query(`CREATE TABLE IF NOT EXISTS ai_edu_documents (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,data_profile_id CHAR(36) NOT NULL,file_id CHAR(36) NULL,filename VARCHAR(255) NOT NULL,mimetype VARCHAR(150) NOT NULL,media_type ENUM('image','document') NOT NULL,size_bytes INT UNSIGNED NOT NULL,description VARCHAR(300) NOT NULL,position INT UNSIGNED NOT NULL DEFAULT 0,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,${owned('ai_edu_documents')}) ENGINE=InnoDB`);
 if(!await hasColumn('ai_edu_documents','position'))await db.query('ALTER TABLE ai_edu_documents ADD COLUMN position INT UNSIGNED NOT NULL DEFAULT 0 AFTER description');
}
