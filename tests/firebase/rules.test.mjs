import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,writeBatch,runTransaction,Timestamp,serverTimestamp} from 'firebase/firestore';
const hash=s=>createHash('sha256').update(s).digest('hex');
let env;
const google={email:'example@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const client=id=>env.authenticatedContext(id,google).firestore();
const name='アオキ';
function player(id,ownerUid=null){const nameKey=JSON.stringify([name.toLowerCase(),'']);return {id,ownerUid,name,group:'',status:'active',affiliation:'internal',stageMode:'cohort',cohortYear:2026,internalHistory:true,generation:80,gradeOverrides:{},nameKey,nameLock:hash(nameKey),version:1,deletedAt:null,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};}
function match(){return {id:'m',date:'2026-11-04',category:'ゲーム練',event:'',discipline:'シングルス',opponentType:'internal',sideAIds:['pa'],sideBIds:['pb'],opponents:[],scores:['15:9','8:11','7:7','4:1'],memo:'',memberSnapshots:{},canonical:'test-match',matchKey:hash('test-match'),separate:false,version:1,createdBy:'a',createdByName:name,updatedBy:'a',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),deletedAt:null};}
function note(){return {matchId:'m',ownerId:'a',ownerMemberId:'pa',context:{date:'2026-11-04',category:'ゲーム練',event:'',discipline:'シングルス',sideA:[name],sideB:['イノウエ'],scores:['15:9']},goodPoints:'よかった',improvements:'',nextAction:'次も練習',version:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};}
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-shuttle-note',firestore:{rules:fs.readFileSync('firestore.rules','utf8'),host:'127.0.0.1',port:8080}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{const db=c.firestore(),b=writeBatch(db);
    for(const [id,p] of [['a','pa'],['b','pb']]){b.set(doc(db,'memberships',id),{active:true,playerId:p});b.set(doc(db,'players',p),player(p,id));}
    b.set(doc(db,'matches','m'),match());b.set(doc(db,'matchKeys',hash('test-match')),{canonical:'test-match',ids:['m']});
    b.set(doc(db,'joinKeys',hash('a-long-random-test-phrase')),{enabled:true,expiresAt:Timestamp.fromMillis(Date.now()+86400000)});
    await b.commit();
  });
});
test('未認証・Google認証だけ・別プロバイダーは共有データを読めない',async()=>{
  await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(),'players')));
  await assertFails(getDocs(collection(client('outsider'),'players')));
  await assertFails(getDocs(collection(env.authenticatedContext('a',{email_verified:true,firebase:{sign_in_provider:'password'}}).firestore(),'players')));
  await assertSucceeds(getDocs(collection(client('a'),'players')));
});
test('正しい合言葉なら本人の参加情報・選手・名前予約をまとめて作成できる',async()=>{
  const db=client('new'),p=player('self-new','new'),b=writeBatch(db);
  b.set(doc(db,'players',p.id),p);b.set(doc(db,'playerNames',p.nameLock),{playerId:p.id,key:p.nameKey});
  b.set(doc(db,'memberships','new'),{active:true,playerId:p.id,joinKey:hash('a-long-random-test-phrase'),createdAt:serverTimestamp()});
  await assertSucceeds(b.commit());await assertSucceeds(getDocs(collection(db,'players')));
});
test('誤った合言葉・他人のUID・既存選手の取得は拒否される',async()=>{
  const db=client('outsider');
  await assertFails(setDoc(doc(db,'memberships','outsider'),{active:true,playerId:'pa',joinKey:hash('wrong'),createdAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db,'memberships','someone-else'),{active:true,playerId:'self-outsider',joinKey:hash('a-long-random-test-phrase'),createdAt:serverTimestamp()}));
  await assertFails(getDoc(doc(db,'players','pa')));
  await assertFails(getDoc(doc(db,'joinKeys',hash('a-long-random-test-phrase'))));
  await assertFails(getDocs(collection(db,'joinKeys')));
});
test('有効期限切れと停止中の合言葉は参加できない',async()=>{
  for(const gate of [{enabled:false,expiresAt:Timestamp.fromMillis(Date.now()+100000)},{enabled:true,expiresAt:Timestamp.fromMillis(0)}]){
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'joinKeys',hash('a-long-random-test-phrase')),gate));
    const db=client('new'),p=player('self-new','new'),b=writeBatch(db);b.set(doc(db,'players',p.id),p);b.set(doc(db,'playerNames',p.nameLock),{playerId:p.id,key:p.nameKey});b.set(doc(db,'memberships','new'),{active:true,playerId:p.id,joinKey:hash('a-long-random-test-phrase'),createdAt:serverTimestamp()});await assertFails(b.commit());
  }
});
test('参加資格・選手の所有者は本人でも勝手に変更できない',async()=>{
  const db=client('a');await assertFails(updateDoc(doc(db,'memberships','a'),{playerId:'pb'}));await assertFails(updateDoc(doc(db,'players','pa'),{ownerUid:'b',version:2,updatedAt:serverTimestamp()}));
});
test('本人の振り返りだけを作成・取得・一覧・編集・削除できる',async()=>{
  const a=client('a'),b=client('b'),ref=doc(a,'privateUsers','a','feedback','m');
  await assertSucceeds(setDoc(ref,note()));await assertSucceeds(getDoc(ref));await assertSucceeds(getDocs(collection(a,'privateUsers','a','feedback')));
  await assertFails(getDoc(doc(b,'privateUsers','a','feedback','m')));await assertFails(getDocs(collection(b,'privateUsers','a','feedback')));
  await assertFails(updateDoc(doc(b,'privateUsers','a','feedback','m'),{goodPoints:'他人による変更',version:2,updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(b,'privateUsers','a','feedback','m')));
  await assertSucceeds(updateDoc(ref,{goodPoints:'本人の更新',version:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{goodPoints:'古い版',version:2,updatedAt:serverTimestamp()}));await assertSucceeds(deleteDoc(ref));
});
test('フィードバックの所有者変更・試合時点の情報変更・文字数超過を拒否',async()=>{
  const db=client('a'),ref=doc(db,'privateUsers','a','feedback','m');await setDoc(ref,note());
  await assertFails(updateDoc(ref,{ownerId:'b',version:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{context:{...note().context,event:'書換'},version:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{goodPoints:'あ'.repeat(2001),version:2,updatedAt:serverTimestamp()}));
});
test('出場していない人は新しい振り返りを書けない',async()=>{
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'memberships','c'),{active:true,playerId:'pc'}));
  await assertFails(setDoc(doc(client('c'),'privateUsers','c','feedback','m'),{...note(),ownerId:'c',ownerMemberId:'pc'}));
});
test('試合削除後も既存の本人の振り返りは閲覧・編集できる',async()=>{
  const db=client('a'),ref=doc(db,'privateUsers','a','feedback','m');await setDoc(ref,note());
  await updateDoc(doc(db,'matches','m'),{deletedAt:serverTimestamp(),version:2,updatedAt:serverTimestamp()});
  await assertSucceeds(getDoc(ref));await assertSucceeds(updateDoc(ref,{nextAction:'続ける',version:2,updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(client('b'),'privateUsers','b','feedback','m'),{...note(),ownerId:'b',ownerMemberId:'pb'}));
});
test('試合は得点やセット数を固定せず保存でき、古い版・物理削除を拒否',async()=>{
  const db=client('a'),ref=doc(db,'matches','m');
  await assertSucceeds(updateDoc(ref,{memo:'更新',version:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{memo:'上書き',version:2,updatedAt:serverTimestamp()}));await assertFails(deleteDoc(ref));
  assert.equal((await getDoc(ref)).data().scores.length,4);
});
test('不正な得点や重複した出場者を拒否',async()=>{
  const db=client('a'),ref=doc(db,'matches','m');
  for(const scores of [[],['-1:2'],['1.5:2'],['1:2;3:4'],['1:2:3'],['9007199254740992:1']])await assertFails(updateDoc(ref,{scores,version:2,updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref,{scores:['9007199254740991:0'],version:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{sideBIds:['pa'],version:3,updatedAt:serverTimestamp()}));
});
test('同時編集はトランザクションで再評価され古い版を拒否する',async()=>{
  const ref=doc(client('a'),'matches','m');
  const save=()=>runTransaction(ref.firestore,async tx=>{const row=await tx.get(ref);if(row.data().version!==1)throw Error('conflict');tx.update(ref,{memo:'更新',version:2,updatedAt:serverTimestamp()});});
  const results=await Promise.allSettled([save(),save()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await getDoc(ref)).data().version,2);
});
