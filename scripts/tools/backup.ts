import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,cp,chmod,readFile} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {db} from '../../src/libraries/db.js';
import {acquireEngineLock} from '../../src/libraries/runtime-lock.js';
// Stop the app first: this lock makes database + auth a consistent offline snapshot.
const lock=await acquireEngineLock();const temporary=await mkdtemp(join(tmpdir(),'ncwa-backup-'));
async function run(command:string,args:string[],output?:string){
 const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});child.stderr.resume();
 const finished=new Promise<void>((yes,no)=>{child.once('error',()=>no(new Error(command+' tidak tersedia')));child.once('exit',code=>code===0?yes():no(new Error(command+' gagal; periksa izin database dan ruang disk')));});
 await Promise.all([finished,output?pipeline(child.stdout,createWriteStream(output,{mode:0o600,flags:'wx'})):(async()=>{child.stdout.resume();})()]);
}
try{
 const database=process.env.DB_NAME;if(!database||! /^[A-Za-z0-9_]+$/.test(database))throw new Error('DB_NAME tidak valid');
 const quote=(v:string)=>'"'+v.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n').replaceAll('\r','\\r')+'"';
 const config=join(temporary,'client.cnf');await writeFile(config,'[client]\nhost='+quote(process.env.DB_HOST??'localhost')+'\nuser='+quote(process.env.DB_USER??'')+'\npassword='+quote(process.env.DB_PASSWORD??'')+'\n',{mode:0o600});
 const snapshot=join(temporary,'snapshot');await mkdir(snapshot,{mode:0o700});
 await run('mysqldump',['--defaults-file='+config,'--single-transaction','--no-tablespaces','--set-gtid-purged=OFF',database],join(snapshot,'database.sql'));
 await cp(resolve('auth'),join(snapshot,'auth'),{recursive:true}).catch(e=>{if(e.code!=='ENOENT')throw e;});
 await writeFile(join(snapshot,'runtime.env'),await readFile('.env'),{mode:0o600});
 const tables:Record<string,number>={};const [names]=await db.query<any[]>('SHOW TABLES');for(const row of names){const name=String(Object.values(row)[0]);if(!/^[a-z_]+$/.test(name))throw new Error('Nama tabel tidak didukung backup');const [count]=await db.query<any[]>('SELECT COUNT(*) AS total FROM `'+name+'`');tables[name]=Number(count[0].total);}
 await writeFile(join(snapshot,'manifest.json'),JSON.stringify({application:'nc-wa-saas',database,createdAt:new Date().toISOString(),format:1,tables},null,2),{mode:0o600});
 const root=resolve('data/backups');await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
 const output=join(root,'ncwa-'+new Date().toISOString().replaceAll(':','-')+'.tar.gz');
 await run('tar',['-czf',output,'-C',snapshot,'.']);await chmod(output,0o600);console.log('Backup selesai: '+output);
}finally{await rm(temporary,{recursive:true,force:true});await lock.release();await db.end();}
