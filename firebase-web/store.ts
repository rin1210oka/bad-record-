import {collection,doc,getDoc,getDocs,query,where,orderBy,limit,startAfter,runTransaction,serverTimestamp,Timestamp,type DocumentData,type QueryDocumentSnapshot} from 'firebase/firestore';
import {auth,db} from './firebase';
import {TeamError,memberInput,matchInput,fingerprint,normal,version,type Member,type MatchInput} from '../lib/team-domain';
import {memberSnapshot,japanDate,schoolYear} from '../lib/member-cohort';
import type {AccessViewer} from '../app/access-context';
import {encodeMatch,decodeMatch} from './codec';

type Row=DocumentData;
export let unlocked=false;
let sessionEpoch=0;
export function setUnlocked(value:boolean){sessionEpoch++;unlocked=value;if(!value){membersCache=[];memberRows.clear();matchesCache.clear();since=null;memberSince=null;journalCursor=null;}}
let membersCache:Member[]=[],memberRows=new Map<string,Member>(),matchesCache=new Map<string,Row>(),since:Timestamp|null=null,memberSince:Timestamp|null=null;
const uuid=()=>crypto.randomUUID();
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
const memberRef=(id:string)=>doc(db,'players',id);
const matchRef=(id:string)=>doc(db,'matches',id);
const nameKey=(m:{name:string;group:string})=>JSON.stringify([normal(m.name),normal(m.group)]);
const conflict=()=>new TeamError('別の画面で更新されました。入力を控えてから再読み込みしてください。',409);
const feedbackRef=(uid:string,id:string)=>doc(db,'privateUsers',uid,'feedback',id);
function uid(){if(!auth.currentUser)throw new TeamError('Googleでログインしてください。',401);return auth.currentUser.uid;}
function captureSession(){return {epoch:sessionEpoch,id:uid()};}
function assertSession(scope:ReturnType<typeof captureSession>){if(scope.epoch!==sessionEpoch||auth.currentUser?.uid!==scope.id)throw new TeamError('入場状態が変わりました。もう一度ロックを解除してください。',401);}
export async function membership(){const scope=captureSession(),snap=await getDoc(doc(db,'memberships',scope.id));assertSession(scope);return snap.exists()?snap.data():null;}
export async function viewer():Promise<AccessViewer>{
  const scope=captureSession(),id=scope.id,m=await membership();assertSession(scope);if(!m?.active)throw new TeamError('部への参加登録を確認してください。',403);
  const p=await getDoc(memberRef(m.playerId));assertSession(scope);if(!p.exists())throw new TeamError('選手情報を確認してください。');
  return {id,memberId:m.playerId,name:p.data().name};
}
export async function joinTeam(phrase:string,body:Row){
  const scope=captureSession(),id=scope.id,input=memberInput(body),joinKey=await digest(phrase),key=await digest(nameKey(input));
  const membershipRef=doc(db,'memberships',id),player=memberRef('self-'+id),lock=doc(db,'playerNames',key);
  await runTransaction(db,async tx=>{
    const [joined,named,p]=await Promise.all([tx.get(membershipRef),tx.get(lock),tx.get(player)]);
    assertSession(scope);
    if(joined.exists())throw new TeamError('すでに登録されています。再読み込みしてください。',409);
    if(named.exists()||p.exists())throw new TeamError('同じ名前・所属の登録があります。他人の選手とはひも付けず、登録内容を確認してください。',409);
    tx.set(membershipRef,{playerId:player.id,active:true,joinKey,createdAt:serverTimestamp()});
    tx.set(player,{...input,id:player.id,ownerUid:id,version:1,deletedAt:null,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),nameLock:key});
    tx.set(lock,{playerId:player.id,key:nameKey(input)});
  });
  assertSession(scope);
}
async function allMembers(){
  const scope=captureSession();
  const rows=await getDocs(memberSince?query(collection(db,'players'),where('updatedAt','>=',memberSince)):collection(db,'players'));
  assertSession(scope);
  for(const row of rows.docs){const value=row.data();memberRows.set(row.id,value as Member);if(value.updatedAt instanceof Timestamp&&(!memberSince||value.updatedAt.toMillis()>memberSince.toMillis()))memberSince=value.updatedAt;}
  membersCache=[...memberRows.values()];return membersCache;
}
async function bootstrap(){
  const scope=captureSession();
  const actor=await viewer();
  // Include tombstones in incremental reads, so deleted matches disappear without a full reload.
  const rows=await getDocs(since?query(collection(db,'matches'),where('updatedAt','>=',since)):collection(db,'matches'));
  assertSession(scope);
  for(const d of rows.docs){const row=decodeMatch(d.data());matchesCache.set(d.id,row);if(row.updatedAt instanceof Timestamp&&(!since||row.updatedAt.toMillis()>since.toMillis()))since=row.updatedAt;}
  const members=await allMembers();
  return {members,matches:[...matchesCache.values()].filter(m=>!m.deletedAt).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)),viewer:actor,today:japanDate(),currentSchoolYear:schoolYear(),updatedAt:new Date().toISOString()};
}
async function writeMember(body:Row,id?:string,operation='write'){
  const target=memberRef(id||uuid());
  return runTransaction(db,async tx=>{
    const previousSnap=await tx.get(target),previous=previousSnap.exists()?previousSnap.data():null;
    if(id&&(!previous||previous.version!==version(body.version)))throw conflict();
    if(previous?.deletedAt&&operation==='write')throw new TeamError('削除済みの選手です。先に復元してください。',409);
    const input=operation==='write'?memberInput(body,previous as Member|undefined):previous!;
    const key=await digest(nameKey(input as Member)),keyRef=doc(db,'playerNames',key),named=await tx.get(keyRef);
    if(operation!=='delete'&&named.exists()&&named.data().playerId!==target.id)throw new TeamError('同じ名前・所属のメンバーが登録されています。',409);
    if(operation==='restore'&&!previous?.deletedAt)throw conflict();
    if(operation==='delete'&&previous?.deletedAt)throw conflict();
    if(previous?.nameLock&&previous.nameLock!==key){const oldRef=doc(db,'playerNames',previous.nameLock);await tx.get(oldRef);tx.delete(oldRef);}
    const data={...previous,...input,id:target.id,ownerUid:previous?.ownerUid??null,version:(previous?.version||0)+1,deletedAt:operation==='delete'?serverTimestamp():null,createdAt:previous?.createdAt??serverTimestamp(),updatedAt:serverTimestamp(),nameLock:key};
    tx.set(target,data);
    if(operation==='delete')tx.delete(keyRef);else tx.set(keyRef,{playerId:target.id,key:nameKey(input as Member)});
    return {member:data,ok:true};
  });
}
function publicInput(row:Row){return matchInput(row,membersCache,row as MatchInput);}
async function writeMatch(body:Row,id?:string,remove=false){
  const actor=await viewer();await allMembers();
  const target=matchRef(id||body.id||'invalid');
  if(!id&&!/^[0-9a-f-]{36}$/i.test(target.id))throw new TeamError('保存用IDを確認してください。');
  return runTransaction(db,async tx=>{
    const snap=await tx.get(target),old=snap.exists()?decodeMatch(snap.data()):null;
    if(id&&(!old||old.deletedAt||old.version!==version(body.version)))throw conflict();
    const input=remove?publicInput(old!):matchInput(body,membersCache,old as MatchInput|undefined);
    if(!id&&old){if(!old.deletedAt&&JSON.stringify(publicInput(old))===JSON.stringify(input))return {match:old};throw conflict();}
    const canonical=fingerprint(input),key=await digest(canonical),newRef=doc(db,'matchKeys',key),newSnap=await tx.get(newRef);
    const oldRef=old?.matchKey&&old.matchKey!==key?doc(db,'matchKeys',old.matchKey):null;
    const oldSnap=oldRef?await tx.get(oldRef):null;
    const ids:string[]=newSnap.data()?.ids||[];
    const separate=body.allowDuplicate===true||old?.separate===true;
    if(!remove&&!separate&&old?.canonical!==canonical&&ids.some(value=>value!==target.id))throw new TeamError('同じ日・選手・得点の試合が記録されています。別の試合であれば、確認して保存できます。',409,'duplicate_match');
    const snapshots:Row={};
    for(const playerId of [...input.sideAIds,...input.sideBIds]){
      if(old?.date===input.date&&[...old.sideAIds,...old.sideBIds].includes(playerId)){if(old.memberSnapshots?.[playerId])snapshots[playerId]=old.memberSnapshots[playerId];}
      else snapshots[playerId]=memberSnapshot(membersCache.find(p=>p.id===playerId)!,input.date);
    }
    const data={...input,id:target.id,memberSnapshots:remove?old!.memberSnapshots:snapshots,canonical,matchKey:key,separate,version:(old?.version||0)+1,createdBy:old?.createdBy??actor.id,createdByName:old?.createdByName??actor.name,createdAt:old?.createdAt??serverTimestamp(),updatedBy:actor.id,updatedAt:serverTimestamp(),deletedAt:remove?serverTimestamp():null};
    if(oldRef)tx.set(oldRef,{ids:(oldSnap?.data()?.ids||[]).filter((value:string)=>value!==target.id),canonical:old!.canonical});
    tx.set(newRef,{ids:remove?ids.filter(value=>value!==target.id):[...new Set([...ids,target.id])],canonical});
    tx.set(target,encodeMatch(data));
    return {match:data,ok:true};
  });
}
function participates(match:Row|null,playerId:string|null){return Boolean(match&&!match.deletedAt&&playerId&&[...match.sideAIds,...match.sideBIds].includes(playerId));}
async function contextOf(match:Row){
  if(!membersCache.length)await allMembers();
  const name=(id:string)=>membersCache.find(p=>p.id===id)?.name||'登録済みの選手';
  return {date:match.date,category:match.category,event:match.event,discipline:match.discipline,sideA:match.sideAIds.map(name),sideB:match.opponentType==='internal'?match.sideBIds.map(name):match.opponents,scores:match.scores};
}
async function feedback(id:string,method:string,body:Row):Promise<Row>{
  const actor=await viewer(),ref=feedbackRef(actor.id,id),target=matchRef(id);
  if(method==='GET'){
    const [f,m]=await Promise.all([getDoc(ref),getDoc(target)]);const match=m.exists()?decodeMatch(m.data()):null;
    if(f.exists())return {feedback:f.data(),context:decodeMatch(f.data().context),archived:!match||Boolean(match.deletedAt),canCreate:false};
    if(!participates(match,actor.memberId))throw new TeamError('出場した本人だけが振り返りを書けます。',403);
    return {feedback:null,context:await contextOf(match!),archived:false,canCreate:true};
  }
  if(!membersCache.length)await allMembers();
  await runTransaction(db,async tx=>{
    const [f,m]=await Promise.all([tx.get(ref),tx.get(target)]),old=f.exists()?f.data():null;
    if((old?.version??0)!==body.version)throw conflict();
    if(method==='DELETE'){if(!old)throw conflict();tx.delete(ref);return;}
    if(!old&&!participates(m.exists()?m.data():null,actor.memberId))throw new TeamError('出場した本人だけが振り返りを書けます。',403);
    const context=old?.context??encodeMatch(await contextOf(decodeMatch(m.data()!)));
    const fields:Row={};for(const key of ['goodPoints','improvements','nextAction']){if(typeof body[key]!=='string'||body[key].length>2000)throw new TeamError('各欄は2000文字以内で入力してください。');fields[key]=body[key].trim();}
    if(!Object.values(fields).some(Boolean))throw new TeamError('いずれかの欄に振り返りを入力してください。');
    tx.set(ref,{...fields,matchId:id,ownerId:actor.id,ownerMemberId:actor.memberId,context,version:(old?.version??0)+1,createdAt:old?.createdAt??serverTimestamp(),updatedAt:serverTimestamp()});
  });
  return method==='DELETE'?{ok:true}:feedback(id,'GET',{});
}
let journalCursor:QueryDocumentSnapshot|null=null;
async function journal(more:boolean){
  const scope=captureSession(),id=scope.id;if(!more)journalCursor=null;
  const base=[orderBy('updatedAt','desc'),orderBy('__name__','desc'),limit(20)];
  const result=await getDocs(query(collection(db,'privateUsers',id,'feedback'),...base,...(journalCursor?[startAfter(journalCursor)]:[])));
  assertSession(scope);
  journalCursor=result.docs.at(-1)??journalCursor;
  const feedback=await Promise.all(result.docs.map(async d=>{const row=d.data(),m=await getDoc(matchRef(row.matchId));return {matchId:row.matchId,context:decodeMatch(row.context),version:row.version,updatedAt:row.updatedAt?.toDate().toISOString(),archived:!m.exists()||Boolean(m.data()?.deletedAt)};}));
  return {feedback,hasMore:result.size===20};
}
export async function firebaseRequest<T>(url:string,method:string,raw?:unknown):Promise<T>{
  if(!unlocked)throw new TeamError('4桁PINでロックを解除してください。',401);
  const scope=captureSession();
  const body=(raw||{}) as Row;let value:unknown;
  try{
    if(url==='/api/team'&&method==='GET')value=await bootstrap();
    else if(url.startsWith('/api/feedback')&&method==='GET')value=await journal(url.includes('more=1'));
    else if(/^\/api\/matches\/[^/]+\/feedback$/.test(url))value=await feedback(decodeURIComponent(url.split('/')[3]),method,body);
    else if(url==='/api/members'&&method==='POST')value=await writeMember(body);
    else if(/^\/api\/members\/[^/]+(?:\/restore)?$/.test(url))value=await writeMember(body,url.split('/')[3],url.endsWith('/restore')?'restore':method==='DELETE'?'delete':'write');
    else if(url==='/api/matches'&&method==='POST')value=await writeMatch(body);
    else if(/^\/api\/matches\/[^/]+$/.test(url))value=await writeMatch(body,url.split('/')[3],method==='DELETE');
    else throw new TeamError('この操作には対応していません。');
    assertSession(scope);
    if(!unlocked)throw new TeamError('ロックされています。',401);
    return value as T;
  }catch(error){
    if(error instanceof TeamError)throw error;
    const code=(error as {code?:string}).code;
    if(code==='permission-denied')throw new TeamError('このデータを操作する権限がありません。参加登録と接続を確認してください。',403);
    if(code==='resource-exhausted')throw new TeamError('無料枠の利用上限に達しました。時間をおいて再度お試しください。',429);
    if(code==='aborted')throw conflict();
    throw new TeamError('保存先に接続できません。入力を残したまま、接続を確認してください。',503);
  }
}
