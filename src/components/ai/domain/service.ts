import {defaultTools,type AITools} from './pipeline/runner.js';
import {setTimeout as delay} from 'node:timers/promises';
import {type SessionManager} from '../../whatsapp/index.js';
import type {IncomingMessage} from '../../whatsapp/index.js';
import {ProductImageStore} from './profiles/cs/product-images.js';
import {resolve} from 'node:path';
import {callAI,type AIConfig,type AITransport} from './provider.js';
import * as settings from './settings.js';
import * as logs from './logs.js';
import * as wallet from './wallet.js';
import * as trial from './trial.js';
import * as dataProfiles from './data-profiles.js';
import * as conversations from './conversations.js';
import * as runtime from './runtime.js';
// The Asisten AI service. Each responsibility lives in its own module (settings, logs, wallet, trial,
// data-profiles, conversations, runtime); this class holds the shared state and keeps one method per
// operation so callers, and tests that override config(), use it as before.
export class AIService {
 queues=new Map<string,Promise<void>>();
 queued=0;
 productImages=new ProductImageStore(resolve('auth','_product-images'));
 constructor(readonly transport:AITransport=callAI,readonly wait:(milliseconds:number)=>Promise<void>=async milliseconds=>{await delay(milliseconds);},readonly tools:AITools=defaultTools){}
 config():Promise<AIConfig>{return settings.loadConfig(this);}
 configuration(){return settings.configuration(this);}
 providerProfiles(){return settings.providerProfiles(this);}
 saveProviderProfile(body:unknown){return settings.saveProviderProfile(this,body);}
 deleteProviderProfile(id:unknown){return settings.deleteProviderProfile(this,id);}
 setProviderRoutes(body:unknown){return settings.setProviderRoutes(this,body);}
 testProviderProfile(body:unknown){return settings.testProviderProfile(this,body);}
 configure(actor:string,body:unknown){return settings.configure(this,actor,body);}
 test(tier:unknown='medium'){return settings.testTier(this,tier);}
 modelUsage(){return logs.modelUsage(this);}
 agentFailures(value:unknown){return logs.agentFailures(this,value);}
 agentFailureDetail(id:unknown){return logs.agentFailureDetail(this,id);}
 traceRequests(value:unknown){return logs.traceRequests(this,value);}
 traceLog(requestId:unknown){return logs.traceLog(this,requestId);}
 trial(account:string,body:unknown){return trial.trial(this,account,body);}
 wallet(account:string){return wallet.walletSummary(this,account);}
 usage(account:string){return wallet.recentUsage(this,account);}
 usagePage(account:string,value:unknown){return wallet.usagePage(this,account,value);}
 sessionProfiles(account:string){return dataProfiles.sessionProfiles(this,account);}
 setEnabled(account:string,session:string,enabled:boolean){return dataProfiles.setEnabled(this,account,session,enabled);}
 sessionProfile(account:string,session:string){return dataProfiles.sessionProfile(this,account,session);}
 ensureSessionProfile(account:string,session:string){return dataProfiles.ensureSessionProfile(this,account,session);}
 ownedDataProfile(account:string,value:unknown){return dataProfiles.ownedDataProfile(this,account,value);}
 profileType(account:string,profile:string){return dataProfiles.profileType(this,account,profile);}
 dataProfiles(account:string){return dataProfiles.dataProfiles(this,account);}
 dataProfile(account:string,value:unknown){return dataProfiles.dataProfile(this,account,value);}
 createDataProfile(account:string,body:unknown){return dataProfiles.createDataProfile(this,account,body);}
 renameDataProfile(account:string,value:unknown,body:unknown){return dataProfiles.renameDataProfile(this,account,value,body);}
 deleteDataProfile(account:string,value:unknown){return dataProfiles.deleteDataProfile(this,account,value);}
 attachProfile(account:string,session:string,body:unknown){return dataProfiles.attachProfile(this,account,session,body);}
 saveField(account:string,session:string,field:string,value:unknown){return dataProfiles.saveField(this,account,session,field,value);}
 saveDataProfileField(account:string,value:unknown,field:string,input:unknown){return dataProfiles.saveDataProfileField(this,account,value,field,input);}
 assistant(account:string,session:string){return dataProfiles.assistant(this,account,session);}
 saveAssistant(account:string,session:string,body:unknown){return dataProfiles.saveAssistant(this,account,session,body);}
 registerSystemMessage(account:string,session:string,messageId:string){return conversations.registerSystemMessage(this,account,session,messageId);}
 answerFallback(account:string,manager:SessionManager,session:string,id:string,body:unknown){return conversations.answerFallback(this,account,manager,session,id,body);}
 manualOutgoing(account:string,session:string,message:IncomingMessage){return conversations.manualOutgoing(this,account,session,message);}
 knownOrigin(account:string,session:string,messageId:string){return conversations.knownOrigin(this,account,session,messageId);}
 dashboardReply(account:string,manager:SessionManager,session:string,customer:string,body:unknown,key:unknown){return conversations.dashboardReply(this,account,manager,session,customer,body,key);}
 removeSession(account:string,session:string){return conversations.removeSession(this,account,session);}
 conversations(account:string,session:string){return conversations.conversations(this,account,session);}
 fallbacks(account:string,session:string,value:unknown){return conversations.fallbacks(this,account,session,value);}
 removeFallback(account:string,session:string,id:string){return conversations.removeFallback(this,account,session,id);}
 applyFallbackKnowledge(account:string,session:string,id:string,body:unknown){return conversations.applyFallbackKnowledge(this,account,session,id,body);}
 conversation(account:string,session:string,customer:string,body:unknown){return conversations.updateConversation(this,account,session,customer,body);}
 adjust(actor:string,account:string,body:unknown){return wallet.adjust(this,actor,account,body);}
 incoming(account:string,manager:SessionManager,session:string,message:IncomingMessage){return runtime.incoming(this,account,manager,session,message);}
 stop(){return runtime.stop(this);}
 recover(account?:string){return runtime.recover(this,account);}
}
export const ai=new AIService();
