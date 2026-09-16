import mysql from 'mysql2/promise';
export const db = mysql.createPool({host:process.env.DB_HOST ?? 'localhost',user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:8,timezone:'+00:00'});
// Account-row locks serialize each tenant; avoid gap locks across unrelated new wallets.
db.on('connection',connection=>{connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');connection.query("SET time_zone='+00:00'");});
