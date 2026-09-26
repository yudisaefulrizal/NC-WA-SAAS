// Query tabel ai_settings untuk komponen ai. Dipanggil lewat namespace, misalnya
// `settingsSql.shareMemoryLimit(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function shareMemoryLimit(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');
}
export function find(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT * FROM ai_settings WHERE id=1');
}
export function enableProfileRouting(c: Executor) {
  return c.query('UPDATE ai_settings SET profile_routing_enabled=TRUE WHERE id=1');
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_settings(id,endpoint,model,secret,input_rate,output_rate,memory_limit,context_memory_limit,trace_enabled,credit_price,model_cheap,model_medium,model_smart,model_structured,model_decision,tidy_prompt) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE endpoint=VALUES(endpoint),model=VALUES(model),secret=VALUES(secret),input_rate=VALUES(input_rate),output_rate=VALUES(output_rate),memory_limit=VALUES(memory_limit),context_memory_limit=VALUES(context_memory_limit),trace_enabled=VALUES(trace_enabled),credit_price=VALUES(credit_price),model_cheap=VALUES(model_cheap),model_medium=VALUES(model_medium),model_smart=VALUES(model_smart),model_structured=VALUES(model_structured),model_decision=VALUES(model_decision),tidy_prompt=VALUES(tidy_prompt)',
    params,
  );
}
