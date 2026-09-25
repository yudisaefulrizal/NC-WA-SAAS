// Tabel referral: dibuat bila belum ada dan hanya ditambah, jadi aman dijalankan ulang oleh npm run migrate.
import { db } from '../../../libraries/db.js';
export async function migrateReferral() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_settings (id INT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT TRUE,commission_percent INT UNSIGNED NOT NULL DEFAULT 10,referrer_signup_wa_credits INT UNSIGNED NOT NULL DEFAULT 0,referrer_signup_ai_credits INT UNSIGNED NOT NULL DEFAULT 0,referee_signup_wa_credits INT UNSIGNED NOT NULL DEFAULT 0,referee_signup_ai_credits INT UNSIGNED NOT NULL DEFAULT 0,min_payout_amount INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB`,
  );
  await db.query(`INSERT IGNORE INTO referral_settings (id) VALUES (1)`);
  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_codes (account_id CHAR(36) PRIMARY KEY,code VARCHAR(16) NOT NULL UNIQUE,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS referrals (id CHAR(36) PRIMARY KEY,referrer_id CHAR(36) NOT NULL,referred_id CHAR(36) NOT NULL UNIQUE,code VARCHAR(16) NOT NULL,status ENUM('pending','qualified') NOT NULL DEFAULT 'pending',created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,qualified_at DATETIME NULL,INDEX referrer_idx(referrer_id),FOREIGN KEY(referrer_id) REFERENCES accounts(id) ON DELETE CASCADE,FOREIGN KEY(referred_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  // Mengunci nomor WhatsApp ke referral pertama yang pernah diloloskannya, untuk seluruh sistem dan selamanya.
  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_qualified_numbers (phone_number VARCHAR(32) PRIMARY KEY,referral_id CHAR(36) NOT NULL,qualified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(referral_id) REFERENCES referrals(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_earnings (id CHAR(36) PRIMARY KEY,referrer_id CHAR(36) NOT NULL,referral_id CHAR(36) NOT NULL,order_id VARCHAR(64) NOT NULL UNIQUE,amount INT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX referrer_idx(referrer_id),FOREIGN KEY(referrer_id) REFERENCES accounts(id) ON DELETE CASCADE,FOREIGN KEY(referral_id) REFERENCES referrals(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_profiles (account_id CHAR(36) PRIMARY KEY,bank_name VARCHAR(100) NOT NULL,bank_account_name VARCHAR(150) NOT NULL,bank_account_number VARCHAR(50) NOT NULL,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_payouts (id CHAR(36) PRIMARY KEY,referrer_id CHAR(36) NOT NULL,amount INT UNSIGNED NOT NULL,bank_name VARCHAR(100) NOT NULL,bank_account_name VARCHAR(150) NOT NULL,bank_account_number VARCHAR(50) NOT NULL,status ENUM('requested','paid','rejected') NOT NULL DEFAULT 'requested',note VARCHAR(500),created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,processed_at DATETIME NULL,processed_by CHAR(36) NULL,INDEX referrer_idx(referrer_id),FOREIGN KEY(referrer_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  // Komisi khusus per akun yang diatur pemilik ("Agen Resmi"); tidak terlihat oleh akun itu sendiri.
  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_agents (account_id CHAR(36) PRIMARY KEY,commission_percent INT UNSIGNED NOT NULL,note VARCHAR(300),set_by CHAR(36) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
}
