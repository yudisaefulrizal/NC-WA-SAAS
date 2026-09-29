// Tabel Instagram DM lewat Zernio: akun Zernio milik klien, akun Instagram yang terpasang sebagai sesi, dan
// nama pelanggan Instagram. Hanya CREATE IF NOT EXISTS, jadi aman dijalankan ulang oleh npm run migrate.
import { db } from '../../../libraries/db.js';
export async function migrateInstagram() {
  // Kunci API dan secret webhook disimpan terenkripsi; key_hash mencegah satu akun Zernio dipasang dua kali.
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_zernio_accounts (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,name VARCHAR(60) NOT NULL,api_key TEXT NOT NULL,key_hash CHAR(64) NOT NULL,key_hint VARCHAR(8) NOT NULL,profile_id VARCHAR(64) NOT NULL,webhook_id VARCHAR(64) NULL,webhook_secret TEXT NOT NULL,status ENUM('active','invalid') NOT NULL DEFAULT 'active',last_event_at DATETIME NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY zernio_key(key_hash),UNIQUE KEY zernio_name(account_id,name),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_channels (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,zernio_account_id CHAR(36) NOT NULL,ig_account_id VARCHAR(64) NOT NULL,username VARCHAR(100) NOT NULL,status ENUM('active','disconnected') NOT NULL DEFAULT 'active',created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(account_id,session_id),UNIQUE KEY channel_account(zernio_account_id,ig_account_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,FOREIGN KEY(zernio_account_id) REFERENCES instagram_zernio_accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  // Urutan daftar memakai created_at; milidetik supaya akun yang ditambah berurutan cepat tidak tertukar.
  for (const table of ['instagram_zernio_accounts', 'instagram_channels'])
    await db.query(`ALTER TABLE ${table} MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`);
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_contacts (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,username VARCHAR(100) NOT NULL DEFAULT '',name VARCHAR(100) NOT NULL DEFAULT '',updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY(account_id,session_id,customer),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
}
