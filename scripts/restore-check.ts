import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import mysql from 'mysql2/promise';
const exec=promisify(execFile),archive=process.argv[2];
if(!archive)throw new Error('Usage: npm run test:restore -- data/backups/file.tar.gz');
const binary=process.env.MYSQLD_PATH??'/www/server/mysql/bin/mysqld';
const temporary=await mkdtemp(join(tmpdir(),'ncwa-restore-check-'));let daemon:ReturnType<typeof spawn>|undefined,connection:mysql.Connection|undefined;
try{
 const snapshot=join(temporary,'snapshot');await mkdir(snapshot,{mode:0o700});
 const listing=(await exec('tar',['-tzf',resolve(archive)])).stdout.split('\n').filter(Boolean);if(listing.some(name=>name.startsWith('/')||name.split('/').includes('..')))throw new Error('Path arsip tidak valid');
 await exec('tar',['-xzf',resolve(archive),'-C',snapshot]);
 const manifest=JSON.parse(await readFile(join(snapshot,'manifest.json'),'utf8'));if(manifest.application!=='nc-wa-saas'||!manifest.tables)throw new Error('Manifest backup tidak valid atau belum memuat hitungan tabel');
 const datadir=join(temporary,'mysql'),socket=join(temporary,'mysql.sock');await mkdir(datadir,{mode:0o700});
 const common=['--no-defaults','--basedir='+dirname(dirname(binary)),'--datadir='+datadir,'--log-error='+join(temporary,'mysql.log')];
 await exec(binary,[...common,'--initialize-insecure'],{timeout:60000});
 daemon=spawn(binary,[...common,'--socket='+socket,'--pid-file='+join(temporary,'mysql.pid'),'--skip-networking','--mysqlx=0','--skip-log-bin','--innodb-buffer-pool-size=64M'],{stdio:'ignore'});
 let startupError=false;daemon.once('error',()=>{startupError=true;});
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){if(startupError||daemon.exitCode!==null)throw new Error('MySQL sementara gagal dimulai');try{connection=await mysql.createConnection({socketPath:socket,user:'root',timezone:'+00:00'});break;}catch{await new Promise(r=>setTimeout(r,200));}}
 if(!connection)throw new Error('MySQL sementara tidak siap');
 await connection.query('CREATE DATABASE restore_fixture');
 const importer=spawn('mysql',['--no-defaults','--socket='+socket,'--user=root','restore_fixture'],{stdio:['pipe','ignore','ignore']});
 const finished=new Promise<void>((yes,no)=>{importer.once('error',()=>no(new Error('mysql client tidak tersedia')));importer.once('exit',code=>code===0?yes():no(new Error('Import SQL gagal')));});
 await Promise.all([finished,pipeline(createReadStream(join(snapshot,'database.sql')),importer.stdin)]);
 await connection.query('USE restore_fixture');let total=0;
 for(const [table,count] of Object.entries(manifest.tables)){if(!/^[a-z_]+$/.test(table))throw new Error('Nama tabel manifest tidak valid');const [rows]=await connection.query<any[]>('SELECT COUNT(*) AS total FROM `'+table+'`');if(Number(rows[0].total)!==count)throw new Error('Jumlah baris hasil restore tidak cocok');total++;}
 await mkdir('data',{recursive:true});await writeFile('data/restore-check.json',JSON.stringify({checkedAt:new Date().toISOString(),tables:total,result:'passed',scope:'Offline archive imported into isolated temporary MySQL; no WhatsApp network connection.'},null,2));console.log('Restore check lulus: '+total+' tabel pada MySQL sementara; database aplikasi tidak diubah.');
}finally{
 if(connection){try{await connection.query('SHUTDOWN');}catch{}await connection.end().catch(()=>{});}
 if(daemon&&daemon.exitCode===null){const closed=new Promise<void>(r=>daemon!.once('exit',()=>r()));daemon.kill('SIGTERM');await closed;}
 await rm(temporary,{recursive:true,force:true});
}
