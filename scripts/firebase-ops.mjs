// Owner-only maintenance. Uses the Firebase CLI's existing Google login;
// never writes OAuth tokens or service-account keys into this repository.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const auth=require('firebase-tools/lib/auth');
const {requireAuth}=require('firebase-tools/lib/requireAuth');
const {Client}=require('firebase-tools/lib/apiv2');
const emulate=process.argv.includes('--emulator');
const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST;
if(emulate&&(!emulatorHost||!/^127\.0\.0\.1:[0-9]+$/.test(emulatorHost)))throw Error('エミュレーターは127.0.0.1上の専用ポートだけに接続できます。');
const project=emulate?'demo-shuttle-note':JSON.parse(await fs.readFile('.firebaserc','utf8')).projects.default;
const command=process.argv[2]||'status';
const prefix=`projects/${project}/databases/(default)/documents`;
async function client(origin){
  const account=auth.getProjectDefaultAccount(process.cwd());
  if(!account)throw Error('先に firebase login で、このプロジェクトの所有者としてログインしてください。');
  await requireAuth({project,projectRoot:process.cwd(),...account});
  return new Client({urlPrefix:origin,apiVersion:'v1'});
}
async function firestore(){
  if(!emulate)return client('https://firestore.googleapis.com');
  const c=new Client({urlPrefix:`http://${emulatorHost}`,apiVersion:'v1',auth:false});
  const request=c.request.bind(c);
  c.request=options=>request({...options,headers:{...options.headers,Authorization:'Bearer owner'}});
  return c;
}
async function assertSpark(){
  if(emulate)return;
  const c=await client('https://cloudbilling.googleapis.com');
  const result=await c.get(`projects/${project}/billingInfo`);
  if(result.body.billingEnabled)throw Error('課金が有効です。Sparkでの運用を確認するまで処理しません。');
}
const hash=s=>createHash('sha256').update(s).digest('hex');
async function backup(){
  const c=await firestore(),documents=[];
  async function walk(parent){
    let collectionToken;
    do{
      const result=await c.post(`${parent}:listCollectionIds`,{pageSize:1000,...(collectionToken?{pageToken:collectionToken}:{})});
      for(const id of result.body.collectionIds||[]){
        let documentToken;
        do{
          const query=new URLSearchParams({pageSize:'300',showMissing:'true',...(documentToken?{pageToken:documentToken}:{})});
          const page=await c.get(`${parent}/${encodeURIComponent(id)}?${query}`);
          for(const d of page.body.documents||[]){
            if(d.fields)documents.push({name:d.name,fields:d.fields,updateTime:d.updateTime});
            await walk(d.name);
          }
          documentToken=page.body.nextPageToken;
        }while(documentToken);
      }
      collectionToken=result.body.nextPageToken;
    }while(collectionToken);
  }
  await walk(prefix);
  await fs.mkdir('backups',{recursive:true});
  const output=path.join('backups',`firebase-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  const snapshot={format:1,project,createdAt:new Date().toISOString(),documents};
  await fs.writeFile(output,JSON.stringify(snapshot,null,2),{flag:'wx'});
  console.log(`バックアップを保存しました（${documents.length}文書）：${output}`);
  console.log('振り返りや参加用情報を含みます。GitHubへ追加せず、安全な場所にもコピーしてください。');
}
async function main(){
  if(command==='status'){
    await assertSpark();const c=await client('https://firestore.googleapis.com');
    const database=await c.get(`projects/${project}/databases/(default)`);
    console.log(JSON.stringify({project,billingEnabled:false,database:database.body.name,locationId:database.body.locationId},null,2));return;
  }
  if(command==='backup'){await backup();return;}
  if(command==='join-code'){
    await assertSpark();
    const phrase=randomBytes(12).toString('base64url');
    const c=await firestore(),expiresAt=new Date(Date.now()+365*86400000).toISOString();
    await c.post(`${prefix}/joinKeys?documentId=${hash(phrase)}`,{fields:{enabled:{booleanValue:true},expiresAt:{timestampValue:expiresAt}}});
    await fs.mkdir('.firebase-tools',{recursive:true});
    await fs.writeFile('.firebase-tools/team-access.txt',`部の合言葉：${phrase}\n新規参加の受付期限：${expiresAt}\nURL：https://${project}.web.app/\n`);
    console.log('新規参加用の合言葉を .firebase-tools/team-access.txt に保存しました。ソースには含めていません。');
    console.log('新規参加は1年間受け付けます。期限後も登録済みの人は利用できます。更新は保守担当が行います。');return;
  }
  if(command==='restore'){
    const file=process.argv[3];if(!file)throw Error('復元するバックアップファイルを指定してください。');
    const snapshot=JSON.parse(await fs.readFile(file,'utf8'));
    if(snapshot.format!==1||snapshot.project!==project||!Array.isArray(snapshot.documents))throw Error('同じプロジェクトの正しい形式のバックアップだけを復元できます。');
    const c=await firestore(),writes=[];
    // Restore only into an empty database; do not overwrite any later records.
    const collections=await c.post(`${prefix}:listCollectionIds`,{pageSize:1000});
    if(collections.body.collectionIds?.length)throw Error('復元先は空ではありません。現行データを上書きしないため中止しました。');
    for(const d of snapshot.documents){
      if(typeof d.name!=='string'||!d.name.startsWith(prefix+'/')||!d.fields)throw Error('バックアップの文書パスが不正です。');
      writes.push({update:{name:d.name,fields:d.fields},currentDocument:{exists:false}});
    }
    if(!process.argv.includes('--apply')){console.log(`復元予定：${writes.length}文書。書込みは行っていません。確認後に --apply を指定してください。`);return;}
    for(let i=0;i<writes.length;i+=200)await c.post(`projects/${project}/databases/(default)/documents:commit`,{writes:writes.slice(i,i+200)});
    console.log(`${writes.length}文書を復元しました。途中で失敗した場合は公開を再開せず、保存済みバックアップと照合してください。`);return;
  }
  throw Error('対応する操作：status / backup / join-code / restore');
}
main().catch(error=>{console.error(error.message||'処理できませんでした。');process.exitCode=1;});
