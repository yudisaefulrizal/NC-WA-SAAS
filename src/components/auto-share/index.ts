// Auto Share: contacts, templates, scheduled sends, the worker that delivers them, and its HTTP routes.
// Other components and src/http use this component only through the names exported here.
export {AssetStore} from './data-access/asset-store.js';
export {migrateAutoShare} from './data-access/schema.js';
export {createAutoShare} from './domain/auto-share.js';
export {assetPublicRoutes} from './entry-points/public-routes.js';
export {autoShareRouter} from './entry-points/routes.js';
