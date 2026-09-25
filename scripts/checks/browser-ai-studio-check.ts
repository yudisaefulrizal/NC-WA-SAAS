import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {db} from '../../src/libraries/db.js';
import {digest} from '../../src/libraries/security.js';
import {createGateway} from '../../src/http/gateway.js';
import {AIStudio} from '../../src/components/ai/domain/studio.js';
import {defaults,type AITransport} from '../../src/components/ai/domain/provider.js';
import {defaultWorkflow} from '../../src/components/ai/domain/pipeline/workflow.js';
import {activeWorkflow,changeWorkflow,workflowState} from '../../src/components/ai/domain/profiles/registry.js';
import {screenshots} from './screenshots.js';

const temporary=await mkdtemp(join(tmpdir(),'ncwa-studio-browser-'));
const slot=net.createServer();await new Promise<void>(r=>slot.listen(0,'127.0.0.1',r));const port=(slot.address() as net.AddressInfo).port;await new Promise<void>(r=>slot.close(()=>r()));
const origin='http://127.0.0.1:'+port;process.env.APP_ORIGIN=origin;
const {createApp}=await import('../../src/http/app.js');
const transport:AITransport=async(c,m)=>{
 await new Promise(r=>setTimeout(r,150));
 const input=m.filter(x=>x.role==='user').at(-1)!.content;
 if(c.call_role==='router')return JSON.stringify({sub_agent:'layanan',s_p_o_konteks:'Pelanggan memesan produk',isi_pesan:input});
 if(c.call_role==='context')return 'pelanggan-menunggu-pesanan';
 if(c.call_role==='pesanan')return JSON.stringify({lengkap:true,items:[{product_name:JSON.parse(m[1].content).produk[0],quantity:1}],notes:''});
 if(m.some(x=>x.content.startsWith('Tool result create_order')))return JSON.stringify({answer:'Pesanan SIM-1 dibuat.'});
 if(m.some(x=>x.content.startsWith('Tool result get_products')))return JSON.stringify({tool:'create_order',query:'1 produk pertama'});
 return JSON.stringify({tool:'get_products',query:''});
};
const runner=new AIStudio(transport,async()=>({...defaults,model_cheap:'cheap-fixture',model_medium:'medium-fixture',model_smart:'smart-fixture',secret:'browser-fixture'}),async()=>{});
const gateway=createGateway(()=>async(_id,update)=>{update({status:'connected'});return {close(){},async logout(){}};},temporary);
const server=createApp(gateway,undefined,runner).listen(port,'127.0.0.1');
const owner=randomUUID(),client=randomUUID(),ownerToken=randomUUID(),clientToken=randomUUID();
const [original]=await db.query<any[]>('SELECT * FROM ai_workflow WHERE profile_type=\'cs\'');
let browser;
try{
 for(const [id,role,token] of [[owner,'owner',ownerToken],[client,'user',clientToken]]){await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)',[id,id+'@test.invalid','unused',role]);await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[digest(token),id]);}
 await changeWorkflow(owner,'cs',{revision:(await workflowState()).revision,draft:defaultWorkflow()});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:'ncwa_session',value:ownerToken,url:origin}]);
 const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/dashboard/admin/ai-studio');await page.locator('#studio').waitFor();
 assert.equal(await page.locator('#nodes [data-node]').count(),18);
 // Phones use a list of the workflow nodes instead of the canvas; it carries the 8 CS nodes.
 assert.equal(await page.locator('#node-list [data-node]').count(),8);
 await page.getByRole('button',{name:'Node Pesanan terstruktur',exact:true}).click();
 assert.equal(await page.locator('#order-settings').isVisible(),true);assert.equal(await page.locator('#router-settings').isVisible(),false);assert.ok((await page.locator('#order-schema').textContent())?.includes('enum'));assert.equal(await page.locator('#node-tier').inputValue(),'structured');
 assert.equal(await page.locator('#nodes [data-node="pesanan"] small').textContent(),'Model terstruktur');
 assert.equal(await page.locator('#node-structured-output').isChecked(),true);assert.equal(await page.locator('#node-structured-output').isDisabled(),true);
 await page.locator('#node-tier').selectOption('cheap');
 assert.equal(await page.locator('#node-structured-output').isChecked(),false);assert.equal(await page.locator('#node-structured-output').isDisabled(),false);
 assert.equal(await page.locator('#nodes [data-node="pesanan"] small').textContent(),'Model murah');
 await page.locator('#node-tier').selectOption('structured');assert.equal(await page.locator('#node-structured-output').isChecked(),true);
 await page.getByRole('button',{name:'Node Router',exact:true}).click();
 assert.ok((await page.locator('#router-schema').textContent())?.includes('enum'));
 await page.locator('#node-structured-output').check();
 await page.locator('#node-prompt').fill('Router khusus browser. Pilih salah satu kategori yang ditentukan.');await page.locator('#node-tier').selectOption('smart');
 assert.equal(await page.locator('#send').isDisabled(),true);await page.getByRole('button',{name:'Simpan draft',exact:true}).click();await page.locator('#notice').filter({hasText:'Draft tersimpan'}).waitFor();
 await page.reload();await page.locator('#studio').waitFor();assert.equal(await page.locator('#node-tier').inputValue(),'smart');
 assert.equal(await page.locator('#node-structured-output').isChecked(),true);
 await page.locator('#chat-input').fill('Pesan produk');await page.locator('#send').click();await page.locator('#nodes [data-node="router"][data-state="running"]').waitFor();
 await page.locator('#chat-log').getByText('Pesanan SIM-1 dibuat.',{exact:true}).waitFor();
 assert.equal(await page.locator('#context-value').textContent(),'pelanggan-menunggu-pesanan');assert.ok(await page.locator('#trace-list').getByRole('button').count()>8);
 await page.getByRole('button',{name:'Node Buat pesanan',exact:true}).click();assert.ok((await page.locator('#node-output').textContent())?.includes('SIM-1'));
 await page.locator('#publish').click();await page.locator('#confirm-publish').click();await page.locator('#notice').filter({hasText:'Versi aktif diperbarui'}).waitFor();
 assert.equal((await activeWorkflow() as any).nodes.router.tier,'smart');
 await mkdir(screenshots,{recursive:true});await page.screenshot({path:join(screenshots,'studio-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(screenshots,'studio-mobile.png'),fullPage:true});
 await page.locator('#reset').click();assert.equal(await page.locator('#chat-log .bubble').count(),0);
 await page.locator('#chat-input').fill('Uji pembatalan');await page.locator('#send').click();await page.locator('#stop').click();await page.locator('#notice').filter({hasText:'dihentikan'}).waitFor();
 assert.deepEqual(errors,[]);
 const clientContext=await browser.newContext();await clientContext.addCookies([{name:'ncwa_session',value:clientToken,url:origin}]);const clientPage=await clientContext.newPage();await clientPage.goto(origin+'/dashboard/admin/ai-studio');await clientPage.locator('#access').filter({hasText:'hanya tersedia untuk pemilik'}).waitFor();assert.equal(await clientPage.locator('#studio').isVisible(),false);
 console.log('AI Studio browser: node editing, draft save/reload, live trace, simulation, publish, cancel, mobile and owner access passed');
}finally{
 await browser?.close();await gateway.stop();await new Promise<void>(r=>server.close(()=>r()));
 if(!original[0])await db.query("DELETE FROM ai_workflow WHERE profile_type='cs'");else{const r=original[0];await db.execute("UPDATE ai_workflow SET draft=?,active=?,revision=?,active_version=?,published_revision=? WHERE profile_type='cs'",[typeof r.draft==='string'?r.draft:JSON.stringify(r.draft),r.active?(typeof r.active==='string'?r.active:JSON.stringify(r.active)):null,r.revision,r.active_version,r.published_revision]);}
 for(const id of [owner,client]){await db.execute('DELETE FROM audit_events WHERE account_id=?',[id]);await db.execute('DELETE FROM accounts WHERE id=?',[id]);}
 await db.end();await rm(temporary,{recursive:true,force:true});
}
