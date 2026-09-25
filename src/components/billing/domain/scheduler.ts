// Penjadwal paket dasar: tiap 30 detik memperbarui wallet akun yang periode dasarnya sudah lewat atau yang
// paket berbayarnya kedaluwarsa, 100 akun per putaran.
import { db } from '../../../libraries/db.js';
import { basicPeriod, basicWallet } from './plans.js';
import * as accountsSql from '../data-access/accounts-queries.js';

export async function refreshBasicAccounts(now = new Date()) {
  let cursor = '';
  let count = 0;
  for (;;) {
    const [rows] = await accountsSql.listDueForRenewal(db, [cursor, basicPeriod(now), now]);
    if (!rows.length) return count;
    for (const row of rows) {
      await basicWallet(row.id, now);
      cursor = row.id;
      count++;
    }
  }
}
export function startBasicScheduler() {
  let pending: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || pending) return;
    pending = refreshBasicAccounts()
      .then(() => {})
      .catch(() => {
        console.error('Reset kredit dasar gagal; akan dicoba kembali.');
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
