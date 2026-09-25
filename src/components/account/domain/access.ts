// Cara gateway mengenali akun, lewat API key atau sesi login, dan apakah akun itu masih boleh bertindak.
import { db } from '../../../libraries/db.js';
import * as accountsSql from '../data-access/accounts-queries.js';
import * as apiKeysSql from '../data-access/api-keys-queries.js';
import * as loginSessionsSql from '../data-access/login-sessions-queries.js';
export const accountStatus = (id: string) => accountsSql.findSuspended(db, [id]);
export const accountByApiKeyHash = (hash: string) => apiKeysSql.findAccountIdByHash(db, [hash]);
export const accountByLoginToken = (hash: string) => loginSessionsSql.findAccountIdByToken(db, [hash]);
export const activeAccount = (id: string) => accountsSql.findActive(db, [id]);
