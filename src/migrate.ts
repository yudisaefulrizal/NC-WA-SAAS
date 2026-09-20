import {migrateAutoShare} from './auto-share-schema.js';
import {migrateAI} from './ai-schema.js';
import { db } from './db.js';
try {
await db.query(`CREATE TABLE IF NOT EXISTS accounts (id CHAR(36) PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, password_hash VARCHAR(256) NOT NULL, role ENUM('user','owner') NOT NULL DEFAULT 'user', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS login_sessions (token_hash CHAR(64) PRIMARY KEY, account_id CHAR(36) NOT NULL, expires_at DATETIME NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS api_keys (id CHAR(36) PRIMARY KEY, account_id CHAR(36) NOT NULL, key_hash CHAR(64) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS audit_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, account_id CHAR(36) NOT NULL, action VARCHAR(80) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS plans (id VARCHAR(36) PRIMARY KEY, name VARCHAR(100) NOT NULL, price INT UNSIGNED NOT NULL, credits INT UNSIGNED NOT NULL, session_limit INT UNSIGNED NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB`);
await db.query(`INSERT IGNORE INTO plans (id,name,price,credits,session_limit,active) VALUES ('basic','Dasar Gratis',0,100,1,TRUE)`);
await db.query(`CREATE TABLE IF NOT EXISTS wallets (account_id CHAR(36) PRIMARY KEY, period CHAR(7) NOT NULL, balance INT UNSIGNED NOT NULL, quota INT UNSIGNED NOT NULL, session_limit INT UNSIGNED NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS credit_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, account_id CHAR(36) NOT NULL, period CHAR(7) NOT NULL, reason VARCHAR(32) NOT NULL, amount INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY one_grant(account_id,period,reason), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS credit_reservations (account_id CHAR(36) NOT NULL, request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL, payload_hash CHAR(64) NOT NULL, period CHAR(7) NOT NULL, status ENUM('reserved','unknown','sent','failed') NOT NULL DEFAULT 'reserved', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(account_id,request_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS outbound_results (account_id CHAR(36) NOT NULL, request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL, message_id VARCHAR(255) NOT NULL, recipient VARCHAR(100) NOT NULL, PRIMARY KEY(account_id,request_id), FOREIGN KEY(account_id,request_id) REFERENCES credit_reservations(account_id,request_id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS webhook_subscriptions (id VARCHAR(40) PRIMARY KEY,account_id CHAR(36) NOT NULL,url VARCHAR(4096) NOT NULL,session_id VARCHAR(64),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS webhook_deliveries (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,subscription_id VARCHAR(40) NOT NULL,payload JSON NOT NULL,attempts INT NOT NULL DEFAULT 0,next_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX delivery_due(next_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,FOREIGN KEY(subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE) ENGINE=InnoDB`);
// Additive upgrades are checked against information_schema for repeatable local migrations.
async function column(table:string,name:string,definition:string){
 const [rows]=await db.execute<any[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,name]);
 if(!rows.length)await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
await db.query('ALTER TABLE wallets MODIFY period VARCHAR(64) NOT NULL');
await db.query('ALTER TABLE credit_reservations MODIFY period VARCHAR(64) NOT NULL');
await column('wallets','plan_id',"VARCHAR(36) NOT NULL DEFAULT 'basic'");
await column('wallets','expires_at','DATETIME(3) NULL');
await column('accounts','suspended','BOOLEAN NOT NULL DEFAULT FALSE');
await db.query(`CREATE TABLE IF NOT EXISTS package_activations (id VARCHAR(64) PRIMARY KEY,account_id CHAR(36) NOT NULL,plan_id VARCHAR(36) NOT NULL,credits INT UNSIGNED NOT NULL,session_limit INT UNSIGNED NOT NULL,activated_at DATETIME(3) NOT NULL,expires_at DATETIME(3) NOT NULL,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS recovery_codes (account_id CHAR(36) PRIMARY KEY,code_hash CHAR(64) NOT NULL,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS payment_config (id CHAR(36) PRIMARY KEY,environment ENUM('sandbox','production') NOT NULL,secret TEXT NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS payment_settings (id INT PRIMARY KEY,config_id CHAR(36) NOT NULL,FOREIGN KEY(config_id) REFERENCES payment_config(id)) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS payment_orders (id VARCHAR(64) PRIMARY KEY,account_id CHAR(36) NOT NULL,plan_id VARCHAR(36) NOT NULL,plan_name VARCHAR(100) NOT NULL,price INT UNSIGNED NOT NULL,fee INT UNSIGNED NOT NULL,total INT UNSIGNED NOT NULL,credits INT UNSIGNED NOT NULL,session_limit INT UNSIGNED NOT NULL,config_id CHAR(36) NOT NULL,environment ENUM('sandbox','production') NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'creating',transaction_id VARCHAR(100),qr_url VARCHAR(512),created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,checked_at DATETIME,activated_at DATETIME,UNIQUE KEY one_transaction(environment,transaction_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,FOREIGN KEY(config_id) REFERENCES payment_config(id)) ENGINE=InnoDB`);
await db.query(`CREATE TABLE IF NOT EXISTS credit_adjustments (account_id CHAR(36) NOT NULL,request_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,actor_id CHAR(36) NOT NULL,amount INT NOT NULL,reason VARCHAR(200) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,request_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
await column('payment_orders','expires_at','DATETIME NULL');
await column('payment_orders','kind',"VARCHAR(16) NOT NULL DEFAULT 'whatsapp'");
await column('plans','max_share_assets','INT UNSIGNED NOT NULL DEFAULT 20');
await column('plans','max_share_storage_bytes','BIGINT UNSIGNED NOT NULL DEFAULT 104857600');
await db.query("UPDATE plans SET max_share_assets=10,max_share_storage_bytes=52428800 WHERE id='basic' AND max_share_assets=20 AND max_share_storage_bytes=104857600");
await migrateAI();
await migrateAutoShare();
console.log('Migrasi fondasi dan AI selesai.');
} finally { await db.end(); }
