// Tabel Asisten AI dan migrasinya. Semua langkah aman dijalankan ulang oleh npm run migrate; migrasi lama tetap
// disimpan karena database yang belum diperbarui masih melewatinya.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateGraphs } from './graph-schema.js';
import { db } from '../../../libraries/db.js';
import { storageRoot } from '../../../libraries/storage.js';

// Riwayat chat WhatsApp untuk tampilan Percakapan (lihat domain/chat.ts).
const chatTable = `CREATE TABLE IF NOT EXISTS ai_chat_messages (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(20) NOT NULL,message_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,direction ENUM('in','out','note') NOT NULL,origin ENUM('customer','ai','manual','api','system') NOT NULL,type VARCHAR(20) NOT NULL DEFAULT 'text',text TEXT NOT NULL,status ENUM('sent','delivered','read') NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(account_id,session_id,message_id),KEY chat_by_customer(account_id,session_id,customer,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`;

export async function migrateAI() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS ai_message_origins (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,message_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,origin ENUM('system','manual') NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,session_id,message_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_settings (id INT PRIMARY KEY, endpoint VARCHAR(512) NOT NULL, model VARCHAR(100) NOT NULL, secret TEXT NOT NULL, input_rate INT UNSIGNED NOT NULL DEFAULT 1, output_rate INT UNSIGNED NOT NULL DEFAULT 2, memory_limit INT UNSIGNED NOT NULL DEFAULT 60, credit_price INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_assistants (account_id CHAR(36) NOT NULL, session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE, revision INT UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY(account_id,session_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_wallets (account_id CHAR(36) PRIMARY KEY,balance INT UNSIGNED NOT NULL DEFAULT 0,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_conversations (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,paused BOOLEAN NOT NULL DEFAULT FALSE,messages JSON NOT NULL,revision INT UNSIGNED NOT NULL DEFAULT 0,PRIMARY KEY(account_id,session_id,customer),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_usage (account_id CHAR(36) NOT NULL,request_id CHAR(64) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,status VARCHAR(32) NOT NULL,input_words INT UNSIGNED NOT NULL DEFAULT 0,output_words INT UNSIGNED NOT NULL DEFAULT 0,input_rate INT UNSIGNED NOT NULL,output_rate INT UNSIGNED NOT NULL,reserved INT UNSIGNED NOT NULL DEFAULT 0,charged INT UNSIGNED NOT NULL DEFAULT 0,model VARCHAR(100) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_adjustments (account_id CHAR(36) NOT NULL,request_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,actor_id CHAR(36) NOT NULL,amount INT NOT NULL,reason VARCHAR(200) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_agent_failures (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,request_id CHAR(64) NOT NULL,agent VARCHAR(20) NULL,error VARCHAR(100) NOT NULL,message VARCHAR(4000) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX failure_account(account_id,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_trace_log (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,request_id CHAR(64) NOT NULL,node VARCHAR(20) NOT NULL,state VARCHAR(20) NOT NULL,model VARCHAR(100) NULL,attempt INT UNSIGNED NULL,duration_ms INT UNSIGNED NULL,input JSON NULL,output JSON NULL,error VARCHAR(200) NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX trace_request(account_id,request_id,id),INDEX trace_account(account_id,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  ];
  for (const sql of tables) await db.query(sql);
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_provider_profiles (id CHAR(36) PRIMARY KEY,name VARCHAR(100) NOT NULL,provider VARCHAR(20) NOT NULL,endpoint VARCHAR(512) NOT NULL,secret TEXT NOT NULL,model_cheap VARCHAR(100) NOT NULL DEFAULT '',model_medium VARCHAR(100) NOT NULL DEFAULT '',model_smart VARCHAR(100) NOT NULL DEFAULT '',model_structured VARCHAR(100) NOT NULL DEFAULT '',model_decision VARCHAR(100) NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_provider_routes (tier VARCHAR(16) PRIMARY KEY,profile_id CHAR(36) NOT NULL,model VARCHAR(100) NOT NULL,FOREIGN KEY(profile_id) REFERENCES ai_provider_profiles(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
  );
  await db.query(
    "INSERT INTO ai_provider_profiles(id,name,provider,endpoint,secret) SELECT UUID(),'Konfigurasi AI sebelumnya',CASE WHEN endpoint LIKE 'https://openrouter.ai/%' THEN 'openrouter' WHEN endpoint LIKE 'https://ai.sumopod.com/%' THEN 'sumopod' ELSE 'compatible' END,endpoint,secret FROM ai_settings WHERE id=1 AND NOT EXISTS(SELECT 1 FROM ai_provider_profiles)",
  );
  for (const tier of ['cheap', 'medium', 'smart'])
    await db.query(
      `INSERT IGNORE INTO ai_provider_routes(tier,profile_id,model) SELECT '${tier}',id,COALESCE((SELECT ${tier === 'cheap' ? 'model_cheap' : tier === 'medium' ? 'model_medium' : 'model_smart'} FROM ai_settings WHERE id=1),(SELECT model FROM ai_settings WHERE id=1)) FROM ai_provider_profiles ORDER BY created_at LIMIT 1`,
    );
  await db.query(chatTable);
  const [contextColumns] = await db.execute<any[]>(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
    ['ai_conversations', 'router_context'],
  );
  if (!contextColumns.length)
    await db.query('ALTER TABLE ai_conversations ADD COLUMN router_context VARCHAR(200) NULL');
  const [usageColumns] = await db.execute<any[]>(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
    ['ai_usage', 'agent'],
  );
  if (!usageColumns.length) await db.query('ALTER TABLE ai_usage ADD COLUMN agent VARCHAR(20) NULL');
  const [tidyPrompt] = await db.execute<any[]>(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
    ['ai_settings', 'tidy_prompt'],
  );
  if (!tidyPrompt.length) await db.query('ALTER TABLE ai_settings ADD COLUMN tidy_prompt TEXT NULL');
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_fallbacks (id VARCHAR(48) PRIMARY KEY,account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,fallback_number VARCHAR(20) NOT NULL,status ENUM('waiting','answered','resolved','failed','expired') NOT NULL DEFAULT 'waiting',agent VARCHAR(20) NOT NULL,reason VARCHAR(500) NOT NULL,question VARCHAR(1000) NOT NULL,router_context VARCHAR(200) NULL,messages JSON NOT NULL,source_message_id VARCHAR(255) NOT NULL,notification_message_id VARCHAR(255) NULL,confirmation_message_id VARCHAR(255) NULL,staff_answer TEXT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,answered_at DATETIME NULL,resolved_at DATETIME NULL,UNIQUE KEY fallback_source(account_id,session_id,source_message_id),UNIQUE KEY fallback_notification(account_id,session_id,notification_message_id),INDEX fallback_customer(account_id,session_id,customer,status),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  for (const [table, column, definition] of [
    // Kredit AI dari paket: dipakai lebih dulu dari saldo hasil beli, dan hangus di plan_expires_at.
    ['ai_wallets', 'plan_balance', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['ai_wallets', 'plan_quota', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['ai_wallets', 'plan_expires_at', 'DATETIME(3) NULL'],
    ['ai_wallets', 'plan_period', 'VARCHAR(64) NULL'],
    // Bagian reservasi yang diambil dari kredit paket, supaya refund kembali ke wadah asalnya.
    ['ai_usage', 'reserved_plan', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['ai_settings', 'profile_routing_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
    ['ai_settings', 'model_cheap', 'VARCHAR(100) NULL'],
    ['ai_settings', 'model_medium', 'VARCHAR(100) NULL'],
    ['ai_settings', 'model_smart', 'VARCHAR(100) NULL'],
    ['ai_settings', 'model_structured', 'VARCHAR(100) NULL'],
    ['ai_settings', 'model_decision', 'VARCHAR(100) NULL'],
    ['ai_provider_profiles', 'model_cheap', "VARCHAR(100) NOT NULL DEFAULT ''"],
    ['ai_provider_profiles', 'model_medium', "VARCHAR(100) NOT NULL DEFAULT ''"],
    ['ai_provider_profiles', 'model_smart', "VARCHAR(100) NOT NULL DEFAULT ''"],
    ['ai_provider_profiles', 'model_structured', "VARCHAR(100) NOT NULL DEFAULT ''"],
    ['ai_provider_profiles', 'model_decision', "VARCHAR(100) NOT NULL DEFAULT ''"],
    ['ai_settings', 'context_memory_limit', 'INT UNSIGNED NOT NULL DEFAULT 6'],
    ['ai_settings', 'trace_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
    ['ai_usage', 'model_calls', 'JSON NULL'],
    ['ai_conversations', 'full_auto', 'BOOLEAN NOT NULL DEFAULT FALSE'],
    ['ai_agent_failures', 'model', 'VARCHAR(100) NULL'],
    ['ai_agent_failures', 'prompt', 'JSON NULL'],
    ['ai_agent_failures', 'raw_output', 'MEDIUMTEXT NULL'],
    ['ai_agent_failures', 'router_context', 'VARCHAR(200) NULL'],
    // Sesi WhatsApp yang mengirim notifikasi tim, bila berbeda dari sesi pelanggan (tiket dari sesi Instagram).
    ['ai_fallbacks', 'notify_session_id', 'VARCHAR(64) COLLATE utf8mb4_bin NULL'],
  ]) {
    const [columns] = await db.execute<any[]>(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
      [table, column],
    );
    if (!columns.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  // Ringkasan node Context kini tanpa batas 200 karakter; kolom lama VARCHAR(200) dijadikan TEXT.
  for (const table of ['ai_conversations', 'ai_fallbacks', 'ai_agent_failures']) {
    const [columns] = await db.execute<any[]>(
      "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='router_context'",
      [table],
    );
    if (columns[0]?.DATA_TYPE === 'varchar') await db.query(`ALTER TABLE ${table} MODIFY router_context TEXT NULL`);
  }
  await db.query(
    'UPDATE ai_settings SET profile_routing_enabled=TRUE WHERE id=1 AND EXISTS(SELECT 1 FROM ai_provider_routes)',
  );
  await db.query(
    "UPDATE ai_provider_profiles p JOIN ai_provider_routes r ON r.profile_id=p.id JOIN ai_settings s ON s.id=1 SET p.model_cheap=IF(p.model_cheap='',COALESCE(s.model_cheap,s.model),p.model_cheap),p.model_medium=IF(p.model_medium='',COALESCE(s.model_medium,s.model),p.model_medium),p.model_smart=IF(p.model_smart='',COALESCE(s.model_smart,s.model),p.model_smart)",
  );
  // Tier Terstruktur dimulai dengan model dan rute Murah; pemilik lalu memilih model yang mendukung JSON Schema.
  await db.query('UPDATE ai_settings SET model_structured=COALESCE(model_cheap,model) WHERE model_structured IS NULL');
  await db.query("UPDATE ai_provider_profiles SET model_structured=model_cheap WHERE model_structured=''");
  await db.query(
    "INSERT IGNORE INTO ai_provider_routes(tier,profile_id,model) SELECT 'structured',r.profile_id,p.model_structured FROM ai_provider_routes r JOIN ai_provider_profiles p ON p.id=r.profile_id WHERE r.tier='cheap'",
  );
  // Tier Keputusan disiapkan dari rute Murah tanpa memindahkan node Router secara otomatis.
  await db.query('UPDATE ai_settings SET model_decision=COALESCE(model_cheap,model) WHERE model_decision IS NULL');
  await db.query("UPDATE ai_provider_profiles SET model_decision=model_cheap WHERE model_decision=''");
  await db.query(
    "INSERT IGNORE INTO ai_provider_routes(tier,profile_id,model) SELECT 'decision',r.profile_id,p.model_decision FROM ai_provider_routes r JOIN ai_provider_profiles p ON p.id=r.profile_id WHERE r.tier='cheap'",
  );
  await migrateProfiles();
  await migrateGraphs();
  await dropStaticProfiles();
}

const hasColumn = async (table: string, column: string) => {
  const [rows] = await db.execute<any[]>(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
    [table, column],
  );
  return rows.length > 0;
};
// Multi-profil: data profil adalah isi milik klien untuk satu profil graf, bisa dipasang ke banyak sesi.
async function migrateProfiles() {
  await db.query(
    'CREATE TABLE IF NOT EXISTS ai_profile_types (id VARCHAR(32) PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB',
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_data_profiles (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,profile_type VARCHAR(32) NOT NULL,name VARCHAR(100) NOT NULL,behavior TEXT NOT NULL,fallback_number VARCHAR(20) NOT NULL DEFAULT '',fallback_notify BOOLEAN NOT NULL DEFAULT FALSE,revision INT UNSIGNED NOT NULL DEFAULT 0,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY data_profile_name(account_id,name),KEY data_profile_type(account_id,profile_type),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  if (!(await hasColumn('ai_assistants', 'data_profile_id')))
    await db.query(
      'ALTER TABLE ai_assistants ADD COLUMN data_profile_id CHAR(36) NULL, ADD KEY assistant_data_profile(data_profile_id), ADD CONSTRAINT assistant_data_profile_fk FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE SET NULL',
    );
  for (const [table, column, definition] of [
    ['ai_usage', 'profile_type', 'VARCHAR(32) NULL'],
    ['ai_usage', 'data_profile_id', 'CHAR(36) NULL'],
    ['ai_trace_log', 'profile_type', 'VARCHAR(32) NULL'],
  ])
    if (!(await hasColumn(table, column))) await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
// Profil bawaan CS Usaha, CS Lembaga Pendidikan, Tester AI, dan AI Studio sudah dihapus; semua profil sekarang graf.
// Data profil milik profil itu dihapus bersama isi tabel, kolom, dan filenya, dan sesi yang memakainya kehilangan data
// profilnya. Pengaturan sesi dari sebelum ada data profil (perilaku dan knowledge di ai_assistants) ikut dibuang.
// User database aplikasi tidak punya hak DROP, jadi tabelnya hanya dikosongkan; pemilik membuangnya sekali dengan
// akun admin MySQL memakai perintah yang dicetak di akhir migrasi.
const staticTables = [
  'ai_edu_documents',
  'ai_edu_contacts',
  'ai_edu_programs',
  'ai_product_images',
  'ai_orders',
  'ai_products',
  'ai_data_sources',
  'ai_workflow',
];
async function dropStaticProfiles() {
  const [rows] = await db.query<any[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${staticTables.map(t => "'" + t + "'").join(',')})`,
  );
  // Tabel anak lebih dulu, supaya foreign key ke data profil tidak menahan penghapusan.
  const legacyTables = staticTables.filter(t => rows.some(r => r.TABLE_NAME === t));
  for (const table of legacyTables) await db.query(`DELETE FROM ${table}`);
  await db.query("DELETE FROM ai_data_profiles WHERE profile_type NOT LIKE 'g\\_%'");
  await db.query("DELETE FROM ai_profile_types WHERE id NOT LIKE 'g\\_%'");
  const drop = async (table: string, condition: string) => {
    const [columns] = await db.query<any[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='${table}' AND (${condition})`,
    );
    if (columns.length)
      await db.query(`ALTER TABLE ${table} ` + columns.map(c => 'DROP COLUMN ' + c.COLUMN_NAME).join(', '));
  };
  await drop('ai_data_profiles', "COLUMN_NAME LIKE 'profil\\_%' OR COLUMN_NAME LIKE 'edu\\_%'");
  await drop(
    'ai_assistants',
    "COLUMN_NAME IN ('behavior','fallback_number','fallback_notify','knowledge') OR COLUMN_NAME LIKE 'profil\\_%'",
  );
  // Foto produk dan dokumen Pendidikan hanya ada di instalasi yang pernah punya tabelnya.
  if (!legacyTables.length) return;
  for (const folder of ['product-images', 'ai-documents'])
    await rm(join(storageRoot, 'files', folder), { recursive: true, force: true });
  console.log(
    'Tabel profil statis sudah kosong. Buang sekali dengan akun admin MySQL: DROP TABLE ' +
      legacyTables.join(', ') +
      ';',
  );
}
