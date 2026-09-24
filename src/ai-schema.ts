import {db} from './db.js';
import {defaultWorkflow} from './ai-workflow.js';
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
 await db.query(`CREATE TABLE IF NOT EXISTS ai_provider_profiles (id CHAR(36) PRIMARY KEY,name VARCHAR(100) NOT NULL,provider VARCHAR(20) NOT NULL,endpoint VARCHAR(512) NOT NULL,secret TEXT NOT NULL,model_cheap VARCHAR(100) NOT NULL DEFAULT '',model_medium VARCHAR(100) NOT NULL DEFAULT '',model_smart VARCHAR(100) NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
 await db.query(`CREATE TABLE IF NOT EXISTS ai_provider_routes (tier VARCHAR(16) PRIMARY KEY,profile_id CHAR(36) NOT NULL,model VARCHAR(100) NOT NULL,FOREIGN KEY(profile_id) REFERENCES ai_provider_profiles(id) ON DELETE RESTRICT) ENGINE=InnoDB`);
 await db.query("INSERT INTO ai_provider_profiles(id,name,provider,endpoint,secret) SELECT UUID(),'Konfigurasi AI sebelumnya',CASE WHEN endpoint LIKE 'https://openrouter.ai/%' THEN 'openrouter' WHEN endpoint LIKE 'https://ai.sumopod.com/%' THEN 'sumopod' ELSE 'compatible' END,endpoint,secret FROM ai_settings WHERE id=1 AND NOT EXISTS(SELECT 1 FROM ai_provider_profiles)");
 for(const tier of ['cheap','medium','smart'])await db.query(`INSERT IGNORE INTO ai_provider_routes(tier,profile_id,model) SELECT '${tier}',id,COALESCE((SELECT ${tier==='cheap'?'model_cheap':tier==='medium'?'model_medium':'model_smart'} FROM ai_settings WHERE id=1),(SELECT model FROM ai_settings WHERE id=1)) FROM ai_provider_profiles ORDER BY created_at LIMIT 1`);
 const dataTables=[
 `CREATE TABLE IF NOT EXISTS ai_data_sources (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,kind ENUM('products','orders') NOT NULL,mode ENUM('builtin','endpoint') NOT NULL DEFAULT 'builtin',endpoint VARCHAR(512) NOT NULL DEFAULT '',secret TEXT NOT NULL,PRIMARY KEY(account_id,session_id,kind),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_products (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,name VARCHAR(150) COLLATE utf8mb4_bin NOT NULL,type ENUM('product','service') NOT NULL,description VARCHAR(500) NOT NULL,price BIGINT UNSIGNED NOT NULL,stock INT UNSIGNED NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(account_id,session_id,name),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_orders (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,input_hash CHAR(64) NOT NULL,customer VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,items JSON NOT NULL,total BIGINT UNSIGNED NOT NULL,status ENUM('baru','dibayar','diproses','selesai','dibatalkan') NOT NULL DEFAULT 'baru',notes VARCHAR(1000) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(account_id,session_id,id),UNIQUE KEY order_request(account_id,session_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_product_images (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,size_bytes INT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX product_image_session(account_id,session_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`
 ];
 for(const sql of dataTables)await db.query(sql);
 const [orderColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_orders','input_hash']);
 if(!orderColumns.length)await db.query("ALTER TABLE ai_orders ADD COLUMN input_hash CHAR(64) NOT NULL DEFAULT ''");
 // Existing rows keep their status by name; "dibayar" sits between "baru" and "diproses".
 const [statusColumn]=await db.execute<any[]>('SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_orders','status']);
 if(statusColumn[0]&&!String(statusColumn[0].COLUMN_TYPE).includes("'dibayar'"))await db.query("ALTER TABLE ai_orders MODIFY status ENUM('baru','dibayar','diproses','selesai','dibatalkan') NOT NULL DEFAULT 'baru'");
 const [contextColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_conversations','router_context']);
 if(!contextColumns.length)await db.query('ALTER TABLE ai_conversations ADD COLUMN router_context VARCHAR(200) NULL');
 const [usageColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_usage','agent']);
 if(!usageColumns.length)await db.query('ALTER TABLE ai_usage ADD COLUMN agent VARCHAR(20) NULL');
 const [tidyPrompt]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_settings','tidy_prompt']);
 if(!tidyPrompt.length)await db.query("ALTER TABLE ai_settings ADD COLUMN tidy_prompt TEXT NULL");
 const [assistantFallback]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','fallback_number']);
 if(!assistantFallback.length)await db.query("ALTER TABLE ai_assistants ADD COLUMN fallback_number VARCHAR(20) NOT NULL DEFAULT ''");
 const [assistantFallbackNotify]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','fallback_notify']);
 if(!assistantFallbackNotify.length)await db.query('ALTER TABLE ai_assistants ADD COLUMN fallback_notify BOOLEAN NOT NULL DEFAULT FALSE');
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
 for(const [table,column,definition] of [['ai_settings','profile_routing_enabled','BOOLEAN NOT NULL DEFAULT FALSE'],['ai_settings','model_cheap','VARCHAR(100) NULL'],['ai_settings','model_medium','VARCHAR(100) NULL'],['ai_settings','model_smart','VARCHAR(100) NULL'],['ai_provider_profiles','model_cheap',"VARCHAR(100) NOT NULL DEFAULT ''"],['ai_provider_profiles','model_medium',"VARCHAR(100) NOT NULL DEFAULT ''"],['ai_provider_profiles','model_smart',"VARCHAR(100) NOT NULL DEFAULT ''"],['ai_settings','context_memory_limit','INT UNSIGNED NOT NULL DEFAULT 6'],['ai_settings','trace_enabled','BOOLEAN NOT NULL DEFAULT FALSE'],['ai_usage','model_calls','JSON NULL'],['ai_conversations','full_auto','BOOLEAN NOT NULL DEFAULT FALSE'],['ai_agent_failures','model','VARCHAR(100) NULL'],['ai_agent_failures','prompt','JSON NULL'],['ai_agent_failures','raw_output','MEDIUMTEXT NULL'],['ai_agent_failures','router_context','VARCHAR(200) NULL'],['ai_products','image_id','CHAR(36) NULL'],...profileFields.map(field=>['ai_assistants','profil_'+field,'TEXT NULL'] as [string,string,string])]){
 const [columns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
 if(!columns.length)await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
 }
 await db.query('UPDATE ai_settings SET profile_routing_enabled=TRUE WHERE id=1 AND EXISTS(SELECT 1 FROM ai_provider_routes)');
 await db.query('UPDATE ai_provider_profiles p JOIN ai_provider_routes r ON r.profile_id=p.id JOIN ai_settings s ON s.id=1 SET p.model_cheap=IF(p.model_cheap=\'\',COALESCE(s.model_cheap,s.model),p.model_cheap),p.model_medium=IF(p.model_medium=\'\',COALESCE(s.model_medium,s.model),p.model_medium),p.model_smart=IF(p.model_smart=\'\',COALESCE(s.model_smart,s.model),p.model_smart)');
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
 await db.query("UPDATE ai_workflow SET draft=IF(JSON_LENGTH(JSON_EXTRACT(draft,'$.nodes.lainnya.tools'))=0,JSON_SET(draft,'$.nodes.lainnya.tools',JSON_ARRAY('get_knowledge','get_products','check_order')),draft),active=IF(active IS NULL,NULL,IF(JSON_LENGTH(JSON_EXTRACT(active,'$.nodes.lainnya.tools'))=0,JSON_SET(active,'$.nodes.lainnya.tools',JSON_ARRAY('get_knowledge','get_products','check_order')),active)),tool_defaults_version=1 WHERE tool_defaults_version<1");
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
 await db.query("UPDATE ai_workflow SET draft=IF(JSON_CONTAINS(JSON_EXTRACT(draft,'$.nodes.layanan.tools'),'\"send_product_image\"'),draft,JSON_ARRAY_APPEND(draft,'$.nodes.layanan.tools','send_product_image')),active=IF(active IS NULL,NULL,IF(JSON_CONTAINS(JSON_EXTRACT(active,'$.nodes.layanan.tools'),'\"send_product_image\"'),active,JSON_ARRAY_APPEND(active,'$.nodes.layanan.tools','send_product_image'))),tool_defaults_version=2 WHERE tool_defaults_version<2");
}
