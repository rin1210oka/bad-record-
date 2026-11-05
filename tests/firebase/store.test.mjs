import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDocs,collection,Timestamp} from 'firebase/firestore';
const hash=s=>createHash('sha256').update(s).digest('hex');
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compile(file){return ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;}
const names=url(compile('lib/member-name.ts')),cohort=url(compile('lib/member-cohort.ts'));
const domain=url(compile('lib/team-domain.ts').replaceAll("'./member-name'",JSON.stringify(names)).replaceAll("'./member-cohort'",JSON.stringify(cohort)));
const codec=url(compile('firebase-web/codec.ts'));
const firestoreReal=import.meta.resolve('firebase/firestore');
const firestore=url('export * from '+JSON.stringify(firestoreReal)+';import {getDocs as realGetDocs} from '+JSON.stringify(firestoreReal)+';export async function getDocs(q){const value=await realGetDocs(q);const hold=globalThis.__pauseStoreRead;if(hold)await hold();return value;}');
let env,store;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-shuttle-note',firestore:{rules:fs.readFileSync('firestore.rules','utf8'),host:'127.0.0.1',port:8080}});});
after(async()=>{await env?.cleanup();delete globalThis.__storeDb;delete globalThis.__storeAuth;});
beforeEach(async()=>{
  delete globalThis.__pauseStoreRead;
  await env.clearFirestore();
  globalThis.__storeDb=env.authenticatedContext('self',{email:'self@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
  globalThis.__storeAuth={currentUser:{uid:'self',email:'self@example.invalid'}};
  const firebase=url('export const db=globalThis.__storeDb;export const auth=globalThis.__storeAuth;');
  store=await import(url(compile('firebase-web/store.ts').replaceAll("'firebase/firestore'",JSON.stringify(firestore)).replaceAll("'./firebase'",JSON.stringify(firebase)).replaceAll("'../lib/team-domain'",JSON.stringify(domain)).replaceAll("'../lib/member-cohort'",JSON.stringify(cohort)).replaceAll("'./codec'",JSON.stringify(codec))+'\n//'+crypto.randomUUID()));
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'joinKeys',hash('random-test-phrase')),{enabled:true,expiresAt:Timestamp.fromMillis(Date.now()+86400000)}));
});
const profile={name:'アオキ',group:'',status:'active',hasTeamHistory:true,stageMode:'cohort',cohortYear:2026,generation:80};
async function join(){await store.joinTeam('random-test-phrase',profile);store.setUnlocked(true);}
const call=(path,method='GET',body)=>store.firebaseRequest(path,method,body);
async function fixture(){await join();const {member}=await call('/api/members','POST',{...profile,name:'イノウエ'});const input={id:crypto.randomUUID(),date:'2026-11-04',category:'ゲーム練',event:'',discipline:'シングルス',opponentType:'internal',sideAIds:['self-self'],sideBIds:[member.id],opponents:[],scores:[[15,14],[2,5],[6,6],[4,1]],memo:''};return {member,input};}
test('自分の登録からチーム取得、Google UIDとのひも付け、端末ロックを実保存で確認',async()=>{
  await join();const data=await call('/api/team');assert.equal(data.members.length,1);assert.equal(data.viewer.memberId,'self-self');assert.equal(data.viewer.role,'member');
  store.setUnlocked(false);await assert.rejects(call('/api/team'),/ロック/);
});
test('実保存で試合再送・逆側からの重複・明示した別試合・競合を検証',async()=>{
  const {input}=await fixture();const first=await call('/api/matches','POST',input);await call('/api/matches','POST',input);
  await assert.rejects(call('/api/matches','POST',{...input,id:crypto.randomUUID(),sideAIds:input.sideBIds,sideBIds:input.sideAIds,scores:input.scores.map(([a,b])=>[b,a])}),e=>e.code==='duplicate_match');
  await call('/api/matches','POST',{...input,id:crypto.randomUUID(),allowDuplicate:true});
  const results=await Promise.allSettled([call('/api/matches/'+first.match.id,'PATCH',{...input,version:1,memo:'更新A'}),call('/api/matches/'+first.match.id,'PATCH',{...input,version:1,memo:'更新B'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const data=await call('/api/team');assert.equal(data.matches.length,2);assert.deepEqual(data.matches[0].scores,input.scores);
});
test('メンバー編集・同名重複・論理削除・復元を実保存で確認',async()=>{
  const {member}=await fixture();await call('/api/members/'+member.id,'PATCH',{...profile,name:'イノウエ',version:1,generation:79});
  await assert.rejects(call('/api/members','POST',{...profile,name:'イノウエ'}),/同じ名前/);
  await call('/api/members/'+member.id,'DELETE',{version:2});let data=await call('/api/team');assert.ok(data.members.find(m=>m.id===member.id).deletedAt);
  await call('/api/members/'+member.id+'/restore','POST',{version:3});data=await call('/api/team');assert.equal(data.members.find(m=>m.id===member.id).generation,79);assert.equal(data.members.find(m=>m.id===member.id).deletedAt,null);
});
test('振り返りは競合検出付きで保存し、試合削除後も履歴と本文を保持',async()=>{
  const {input}=await fixture();await call('/api/matches','POST',input);const path='/api/matches/'+input.id+'/feedback';
  await call(path,'PUT',{version:0,goodPoints:'よかった',improvements:'改善',nextAction:'続ける'});
  await assert.rejects(call(path,'PUT',{version:0,goodPoints:'古い版',improvements:'',nextAction:''}),/更新/);
  await call('/api/matches/'+input.id,'DELETE',{version:1});const data=await call('/api/team');assert.equal(data.matches.length,0);
  const feedback=await call(path);assert.equal(feedback.feedback.goodPoints,'よかった');assert.equal(feedback.archived,true);assert.deepEqual(feedback.context.scores,input.scores);
  const journal=await call('/api/feedback');assert.equal(journal.feedback.length,1);assert.equal(journal.feedback[0].archived,true);
  await call(path,'DELETE',{version:1});assert.equal((await call('/api/feedback')).feedback.length,0);
});
test('生年月日を保存せず、日本の年度区切りと将来の卒業表示を維持',async()=>{
  await join();const p=(await call('/api/team')).members[0];assert.equal('birthDate' in p,false);
  const c=await import(cohort);assert.equal(c.memberStage(p,'2027-03-31').label,'高1');assert.equal(c.memberStage(p,'2027-04-01').label,'高2');assert.equal(c.memberClassification(p,'2029-04-01'),'OB/OG・80期生');
});

test('ロック前に始まった振り返り取得は、同じ人が再解除した後でも表示しない',async()=>{
  const {input}=await fixture();await call('/api/matches','POST',input);
  await call('/api/matches/'+input.id+'/feedback','PUT',{version:0,goodPoints:'非公開の本文',improvements:'',nextAction:''});
  let entered,release;const reached=new Promise(resolve=>{entered=resolve;});const held=new Promise(resolve=>{release=resolve;});
  globalThis.__pauseStoreRead=()=>{delete globalThis.__pauseStoreRead;entered();return held;};
  const pending=call('/api/feedback');await reached;
  store.setUnlocked(false);store.setUnlocked(true);release();
  await assert.rejects(pending,e=>e.status===401);
  const current=await call('/api/feedback');assert.equal(current.feedback.length,1);
});
