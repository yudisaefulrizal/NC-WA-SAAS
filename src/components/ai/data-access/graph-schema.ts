// Penyimpanan versi profil dan record JSON. Struktur koleksi ikut satu snapshot definisi agar publikasi atomik.
import { db } from '../../../libraries/db.js';
export async function migrateGraphs() {
  // ID node dinamis boleh sepanjang 32 karakter dan dipakai juga dalam jejak serta tiket.
  for (const table of ['ai_usage', 'ai_agent_failures', 'ai_fallbacks', 'ai_trace_log']) {
    const column = table === 'ai_trace_log' ? 'node' : 'agent';
    const [columns] = await db.query<import('mysql2/promise').RowDataPacket[]>(
      'SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
      [table, column],
    );
    if (Number(columns[0]?.CHARACTER_MAXIMUM_LENGTH) < 32)
      await db.query(
        'ALTER TABLE ' +
          table +
          ' MODIFY ' +
          column +
          ' VARCHAR(32) ' +
          (['ai_fallbacks', 'ai_trace_log'].includes(table) ? 'NOT NULL' : 'NULL'),
      );
  }

  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_graph_profiles (id VARCHAR(32) PRIMARY KEY,draft JSON NOT NULL,active JSON NULL,revision INT UNSIGNED NOT NULL DEFAULT 1,published_revision INT UNSIGNED NOT NULL DEFAULT 0,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_graph_versions (profile_id VARCHAR(32) NOT NULL,revision INT UNSIGNED NOT NULL,definition JSON NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(profile_id,revision),FOREIGN KEY(profile_id) REFERENCES ai_graph_profiles(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_data_records (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,data_profile_id CHAR(36) NOT NULL,collection_id VARCHAR(32) NOT NULL,data JSON NOT NULL,revision INT UNSIGNED NOT NULL DEFAULT 1,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,KEY record_scope(account_id,data_profile_id,collection_id,id),FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE CASCADE,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  // Koleksi "milik pelanggan" menyimpan nomor pengirim per record; koleksi umum membiarkannya kosong.
  const [recordColumns] = await db.query<import('mysql2/promise').RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_data_records'",
  );
  const has = (name: string) => recordColumns.some(c => c.COLUMN_NAME === name);
  if (!has('customer'))
    await db.query('ALTER TABLE ai_data_records ADD COLUMN customer VARCHAR(100) COLLATE utf8mb4_bin NULL');
  if (!has('updated_at'))
    await db.query(
      'ALTER TABLE ai_data_records ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
  const [indexes] = await db.query<import('mysql2/promise').RowDataPacket[]>(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_data_records' AND INDEX_NAME='record_customer'",
  );
  if (!indexes.length)
    await db.query(
      'ALTER TABLE ai_data_records ADD KEY record_customer(account_id,data_profile_id,collection_id,customer)',
    );
  // File field File/gambar. record_id kosong berarti baru diunggah dan belum disimpan ke record.
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_record_files (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,data_profile_id CHAR(36) NOT NULL,record_id CHAR(36) NULL,filename VARCHAR(255) NOT NULL,mimetype VARCHAR(150) NOT NULL,media_type VARCHAR(10) NOT NULL,size_bytes INT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,KEY record_file_scope(account_id,data_profile_id,record_id),FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE CASCADE,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  // Koleksi yang diganti API milik klien. Tanpa baris berarti koleksi memakai tabel aplikasi (ai_data_records).
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_collection_sources (account_id CHAR(36) NOT NULL,data_profile_id CHAR(36) NOT NULL,collection_id VARCHAR(32) NOT NULL,endpoint VARCHAR(512) NOT NULL,secret TEXT NOT NULL,PRIMARY KEY(data_profile_id,collection_id),FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE CASCADE,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS ai_graph_mutations (account_id CHAR(36) NOT NULL,data_profile_id CHAR(36) NOT NULL,request_key CHAR(64) NOT NULL,result JSON NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,data_profile_id,request_key),FOREIGN KEY(data_profile_id) REFERENCES ai_data_profiles(id) ON DELETE CASCADE,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
}
