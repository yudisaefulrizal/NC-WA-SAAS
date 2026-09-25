// Runs the tests on a temporary MySQL of their own, so they never share a queue with the development server.
// No arguments: every test/**/*.test.ts. Arguments: those tests or scripts (browser checks) in order, e.g.
//   npm run test:isolated -- test/components/ai/edu.test.ts scripts/checks/browser-ai-edu-check.ts
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import mysql from 'mysql2/promise';
const exec=promisify(execFile),binary=process.env.MYSQLD_PATH??'/www/server/mysql/bin/mysqld';
const temporary=await mkdtemp(join(tmpdir(),'ncwa-share-tests-'));
let daemon:ReturnType<typeof spawn>|undefined,connection:mysql.Connection|undefined;
try{
 const datadir=join(temporary,'mysql'),socket=join(temporary,'mysql.sock');await mkdir(datadir,{mode:0o700});
 const common=['--no-defaults','--basedir='+dirname(dirname(binary)),'--datadir='+datadir,'--log-error='+join(temporary,'mysql.log')];
 await exec(binary,[...common,'--initialize-insecure'],{timeout:60000});
 daemon=spawn(binary,[...common,'--socket='+socket,'--pid-file='+join(temporary,'mysql.pid'),'--skip-networking','--mysqlx=0','--skip-log-bin','--innodb-buffer-pool-size=64M'],{stdio:'ignore'});
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){if(daemon.exitCode!==null)throw Error('MySQL sementara gagal');try{connection=await mysql.createConnection({socketPath:socket,user:'root'});break;}catch{await new Promise(r=>setTimeout(r,200));}}
 if(!connection)throw Error('MySQL sementara tidak siap');await connection.query('CREATE DATABASE share_test');
 const env={...process.env,DB_SOCKET:socket,DB_USER:'root',DB_PASSWORD:'',DB_NAME:'share_test',AUTO_SHARE_ISOLATED:'1'};
 async function run(args:string[]){await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','--env-file=.env',...args],{env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Pemeriksaan gagal: '+args.join(' '))));});}
 await run(['src/migrate.ts']);
 const extra=process.argv.slice(2);
 if(extra.length)for(const script of extra)await run(script.endsWith('.test.ts')?['--test','--test-concurrency=1',script]:[script]);
 else{const {readdir}=await import('node:fs/promises');const tests:string[]=[];const walk=async(d:string)=>{for(const e of await readdir(d,{withFileTypes:true})){if(e.isDirectory())await walk(d+'/'+e.name);else if(e.name.endsWith('.test.ts'))tests.push(d+'/'+e.name);}};await walk('test');await run(['--test','--test-concurrency=1',...tests.sort()]);}
}finally{
 if(connection){try{await connection.query('SHUTDOWN');}catch{}await connection.end().catch(()=>{});}
 if(daemon&&daemon.exitCode===null){const closed=new Promise<void>(r=>daemon!.once('exit',()=>r()));daemon.kill('SIGTERM');await closed;}
 await rm(temporary,{recursive:true,force:true});
}
