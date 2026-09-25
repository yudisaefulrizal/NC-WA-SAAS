import {ai} from '../components/ai/index.js';
import {studio as defaultStudio} from '../components/ai/index.js';
import {payments as defaultPayments} from './services.js';
import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gateway as defaultGateway} from './gateway.js';
import {ApiError} from '../libraries/errors.js';
import {referral as defaultReferral} from '../components/referral/index.js';
import {publicAccountRoutes,sessionAuth,accountRoutes,accountAdminRoutes} from '../components/account/index.js';
import {billingPublicRoutes,billingRoutes,billingAdminRoutes} from '../components/billing/index.js';
import {aiAccountRoutes,aiAdminRoutes} from '../components/ai/index.js';
import {referralRoutes,referralAdminRoutes} from '../components/referral/index.js';
import {assetPublicRoutes} from '../components/auto-share/index.js';

export function createApp(gateway=defaultGateway,payments=defaultPayments,studio=defaultStudio,referral=defaultReferral){
const app=express();
const configuredOrigin=new URL(process.env.APP_ORIGIN??'http://127.0.0.1:8067');
if(configuredOrigin.origin!==(process.env.APP_ORIGIN??'http://127.0.0.1:8067')||!['http:','https:'].includes(configuredOrigin.protocol))throw new Error('APP_ORIGIN harus berupa origin HTTP/HTTPS tanpa path');
if(process.env.NODE_ENV==='production'&&configuredOrigin.protocol!=='https:')throw new Error('Produksi memerlukan APP_ORIGIN HTTPS');
if(process.env.TRUST_PROXY_HOPS&&!/^[0-3]$/.test(process.env.TRUST_PROXY_HOPS))throw new Error('TRUST_PROXY_HOPS harus 0–3');
app.disable('x-powered-by');app.set('trust proxy',process.env.TRUST_PROXY_HOPS?Number(process.env.TRUST_PROXY_HOPS):false); app.use(helmet());
// Long free text (jadwal up to 8.000 characters, program descriptions) can pass 16 KB once encoded as UTF-8.
const largeText=/^\/(?:sessions\/[A-Za-z0-9_-]+\/ai|ai\/data-profiles\/[0-9a-f-]{36})\/(?:field|programs(?:\/[0-9a-f-]{36})?)$/;const normalJson=express.json({limit:'16kb'}),assistantJson=express.json({limit:'64kb'}),studioJson=express.json({limit:'128kb'});app.use((req,res,next)=>(req.path.startsWith('/api/admin/ai/studio')?studioJson:req.method==='PUT'&&/^\/sessions\/[A-Za-z0-9_-]+\/ai$/.test(req.path)||largeText.test(req.path)?assistantJson:normalJson)(req,res,next));
billingPublicRoutes(app,{payments,gateway});
assetPublicRoutes(app,{gateway});
const origin=process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
app.use(['/auto-share','/sessions','/ai','/stats','/webhooks','/media','/events'],rateLimit({windowMs:60000,limit:120}));
app.use((req,res,next)=>{if(['/stats','/sessions','/webhooks','/events'].includes(req.path)||['/auto-share/','/sessions/','/ai/','/webhooks/','/media/'].some(prefix=>req.path.startsWith(prefix))){gateway.router(req,res,next);}else next();});
app.use(['/api','/sessions','/ai','/stats','/webhooks','/media','/events'],(_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
app.use('/api',rateLimit({windowMs:60000,limit:120}));
app.use('/api', (req,res,next)=> {if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')!==origin){res.status(403).json({error:'invalid_origin'});return;}next();});
app.use('/api/auth',rateLimit({windowMs:900000,limit:20}));
publicAccountRoutes(app,{});
sessionAuth(app,{});
accountRoutes(app,{gateway});
billingRoutes(app,{payments,gateway});
aiAccountRoutes(app,{});
referralRoutes(app,{referral});
app.use('/api/admin',(_req,res,next)=>{if(res.locals.account.role!=='owner'){res.status(403).json({error:'forbidden'});return;}next();});
accountAdminRoutes(app,{gateway});
billingAdminRoutes(app,{payments});
app.get('/dashboard/admin/ai-studio',(_req,res)=>res.type('html').send(page('ai-studio/index.html')));
aiAdminRoutes(app,{studio});
referralAdminRoutes(app,{referral});
// Browsers happily keep serving a stale script after a deploy, which looks exactly like a broken
// feature. Each page is rewritten at startup so its own assets carry a content hash; a changed file
// gets a new URL, and an unchanged one keeps being reused from cache.
const assetVersions=new Map<string,string>();
const cacheRenderedPages=process.env.NODE_ENV==='production';
function versioned(name:string){
 const cached=assetVersions.get(name);
 if(cacheRenderedPages&&cached)return cached;
 let stamp='0';
 try{stamp=createHash('sha256').update(readFileSync('public/'+name)).digest('hex').slice(0,12);}catch{}
 const url='/'+name+'?v='+stamp;
 if(cacheRenderedPages)assetVersions.set(name,url);
 return url;
}
const pages=new Map<string,string>();
function page(name:string){
 const cached=pages.get(name);
 if(cacheRenderedPages&&cached)return cached;
 // Every local script and stylesheet the page links gets its content hash.
 const html=readFileSync('public/'+name,'utf8').replace(/(src|href)="\/([^"?#]+\.(?:js|css))"/g,(_m,attr,file)=>`${attr}="${versioned(file)}"`);
 if(cacheRenderedPages)pages.set(name,html);
 return html;
}
// A hashed URL can never go stale, so it is cached hard; everything else keeps revalidating.
// Pages are only served through page(), so folders never answer with their raw index.html.
app.use(express.static('public',{index:false,redirect:false,setHeaders:(res,_path)=>{if(res.req?.query?.v)res.setHeader('Cache-Control','public, max-age=31536000, immutable');}}));
app.get(['/','/login','/register','/dashboard','/dashboard/ai','/dashboard/auto-share','/dashboard/admin/ai','/dashboard/admin/profiles','/dashboard/nomor','/dashboard/integrasi','/dashboard/pemakaian','/dashboard/paket','/dashboard/referral','/dashboard/admin','/dashboard/admin/plans','/dashboard/admin/accounts','/dashboard/admin/settings','/dashboard/admin/payments','/dashboard/admin/failures','/dashboard/admin/health','/dashboard/admin/referral','/dashboard/dokumentasi','/dashboard/uji-pesan'],(_req,res)=>res.type('html').send(page('dashboard/index.html')));
app.use((_req,res)=>res.status(404).json({error:'not_found'}));
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(res.headersSent){_next(err);return;}if(err instanceof ApiError){res.status(err.status).json({error:err.code,message:err.message});return;}const status=(err as {status?:number}).status;res.status(status===400||status===413?status:500).json({error:status===400||status===413?'invalid_request':'internal_error'});});

return app;
}
export const app=createApp();
