import {db} from './db.js';
export async function migrateAI(){
 const tables=[
 `CREATE TABLE IF NOT EXISTS ai_workflow (id INT PRIMARY KEY,draft JSON NOT NULL,active JSON NULL,revision INT UNSIGNED NOT NULL DEFAULT 0,active_version INT UNSIGNED NOT NULL DEFAULT 0,published_revision INT UNSIGNED NOT NULL DEFAULT 0,tool_defaults_version INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_message_origins (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,message_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,origin ENUM('system','manual') NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,session_id,message_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_settings (id INT PRIMARY KEY, endpoint VARCHAR(512) NOT NULL, model VARCHAR(100) NOT NULL, secret TEXT NOT NULL, input_rate INT UNSIGNED NOT NULL DEFAULT 1, output_rate INT UNSIGNED NOT NULL DEFAULT 2, memory_limit INT UNSIGNED NOT NULL DEFAULT 60, credit_price INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_assistants (account_id CHAR(36) NOT NULL, session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE, knowledge TEXT NOT NULL, behavior TEXT NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY(account_id,session_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_wallets (account_id CHAR(36) PRIMARY KEY,balance INT UNSIGNED NOT NULL DEFAULT 0,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_conversations (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,paused BOOLEAN NOT NULL DEFAULT FALSE,messages JSON NOT NULL,revision INT UNSIGNED NOT NULL DEFAULT 0,PRIMARY KEY(account_id,session_id,customer),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_usage (account_id CHAR(36) NOT NULL,request_id CHAR(64) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,status VARCHAR(32) NOT NULL,input_words INT UNSIGNED NOT NULL DEFAULT 0,output_words INT UNSIGNED NOT NULL DEFAULT 0,input_rate INT UNSIGNED NOT NULL,output_rate INT UNSIGNED NOT NULL,reserved INT UNSIGNED NOT NULL DEFAULT 0,charged INT UNSIGNED NOT NULL DEFAULT 0,model VARCHAR(100) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_adjustments (account_id CHAR(36) NOT NULL,request_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,actor_id CHAR(36) NOT NULL,amount INT NOT NULL,reason VARCHAR(200) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`
 ];
 for(const sql of tables)await db.query(sql);
 const dataTables=[
 `CREATE TABLE IF NOT EXISTS ai_data_sources (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,kind ENUM('products','orders') NOT NULL,mode ENUM('builtin','endpoint') NOT NULL DEFAULT 'builtin',endpoint VARCHAR(512) NOT NULL DEFAULT '',secret TEXT NOT NULL,PRIMARY KEY(account_id,session_id,kind),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_products (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,name VARCHAR(150) NOT NULL,type ENUM('product','service') NOT NULL,description VARCHAR(500) NOT NULL,price BIGINT UNSIGNED NOT NULL,stock INT UNSIGNED NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(account_id,session_id,id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS ai_orders (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,input_hash CHAR(64) NOT NULL,customer VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,items JSON NOT NULL,total BIGINT UNSIGNED NOT NULL,status ENUM('baru','diproses','selesai','dibatalkan') NOT NULL DEFAULT 'baru',notes VARCHAR(1000) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(account_id,session_id,id),UNIQUE KEY order_request(account_id,session_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`
 ];
 for(const sql of dataTables)await db.query(sql);
 const [orderColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_orders','input_hash']);
 if(!orderColumns.length)await db.query("ALTER TABLE ai_orders ADD COLUMN input_hash CHAR(64) NOT NULL DEFAULT ''");
 const [contextColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_conversations','router_context']);
 if(!contextColumns.length)await db.query('ALTER TABLE ai_conversations ADD COLUMN router_context VARCHAR(200) NULL');
 const [usageColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_usage','agent']);
 if(!usageColumns.length)await db.query('ALTER TABLE ai_usage ADD COLUMN agent VARCHAR(20) NULL');
 const [assistantFallback]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','fallback_number']);
 if(!assistantFallback.length)await db.query("ALTER TABLE ai_assistants ADD COLUMN fallback_number VARCHAR(20) NOT NULL DEFAULT ''");
 const [assistantFallbackNotify]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants','fallback_notify']);
 if(!assistantFallbackNotify.length)await db.query('ALTER TABLE ai_assistants ADD COLUMN fallback_notify BOOLEAN NOT NULL DEFAULT FALSE');
 await db.query(`CREATE TABLE IF NOT EXISTS ai_fallbacks (id VARCHAR(48) PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,fallback_number VARCHAR(20) NOT NULL,status ENUM('waiting','answered','resolved','failed','expired') NOT NULL DEFAULT 'waiting',agent VARCHAR(20) NOT NULL,reason VARCHAR(500) NOT NULL,question VARCHAR(1000) NOT NULL,router_context VARCHAR(200) NULL,messages JSON NOT NULL,source_message_id VARCHAR(255) NOT NULL,notification_message_id VARCHAR(255) NULL,confirmation_message_id VARCHAR(255) NULL,staff_answer TEXT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,answered_at DATETIME NULL,resolved_at DATETIME NULL,UNIQUE KEY fallback_source(account_id,session_id,source_message_id),UNIQUE KEY fallback_notification(account_id,session_id,notification_message_id),INDEX fallback_customer(account_id,session_id,customer,status),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
 // TEXT is stored off-page (unlike VARCHAR), so 13 profile columns don't hit InnoDB's row-size limit.
 // TEXT can't carry a DEFAULT in this MySQL version; callers always coalesce NULL to '' (see ai.ts).
 // knowledge is superseded by the profil_* columns (composed on read) but kept, now nullable, to preserve old data.
 await db.query('ALTER TABLE ai_assistants MODIFY knowledge TEXT NULL');
 const profileFields=['nama','deskripsi','bidang','alamat','kontak','jam_operasional','cara_pemesanan','pembayaran','kebijakan','faq','lainnya'];
 let addedProfilLainnya=false;
 for(const [table,column,definition] of [['ai_settings','model_cheap','VARCHAR(100) NULL'],['ai_settings','model_medium','VARCHAR(100) NULL'],['ai_settings','model_smart','VARCHAR(100) NULL'],['ai_usage','model_calls','JSON NULL'],['ai_conversations','full_auto','BOOLEAN NOT NULL DEFAULT FALSE'],...profileFields.map(field=>['ai_assistants','profil_'+field,'TEXT NULL'] as [string,string,string])]){
  const [columns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
 if(!columns.length){await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);if(table==='ai_assistants'&&column==='profil_lainnya')addedProfilLainnya=true;}
 }
 // One-time carry-over: existing free-text knowledge moves into the new "Lainnya" field so it isn't silently dropped.
 if(addedProfilLainnya)await db.query("UPDATE ai_assistants SET profil_lainnya=knowledge WHERE knowledge IS NOT NULL AND knowledge<>''");
 // Product/price live in the dedicated products table; the freeform profile fields for them were removed.
 for(const column of ['profil_produk_layanan','profil_harga']){
  const [columns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_assistants',column]);
  if(columns.length)await db.query(`ALTER TABLE ai_assistants DROP COLUMN ${column}`);
 }
 const [workflowColumns]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['ai_workflow','tool_defaults_version']);
 if(!workflowColumns.length)await db.query('ALTER TABLE ai_workflow ADD COLUMN tool_defaults_version INT UNSIGNED NOT NULL DEFAULT 0');
 await db.query("UPDATE ai_workflow SET draft=IF(JSON_LENGTH(JSON_EXTRACT(draft,'$.nodes.lainnya.tools'))=0,JSON_SET(draft,'$.nodes.lainnya.tools',JSON_ARRAY('get_knowledge','get_products','check_order')),draft),active=IF(active IS NULL,NULL,IF(JSON_LENGTH(JSON_EXTRACT(active,'$.nodes.lainnya.tools'))=0,JSON_SET(active,'$.nodes.lainnya.tools',JSON_ARRAY('get_knowledge','get_products','check_order')),active)),tool_defaults_version=1 WHERE tool_defaults_version<1");

}
