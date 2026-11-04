import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import ts from 'typescript';
const compile=file=>ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const memberNameUrl=url(compile('../lib/member-name.ts'));
const names=await import(memberNameUrl);
const cohortUrl=url(compile('../lib/member-cohort.ts'));
const cohort=await import(cohortUrl);
const resultUrl=url(compile('../lib/match-result.ts'));
const {matchResult,matchSummary}=await import(resultUrl);
const {memberMatchHistory,summarizeMemberMatches}=await import(url(compile('../lib/member-stats.ts').replaceAll("'./match-result'",JSON.stringify(resultUrl)).replaceAll('"./match-result"',JSON.stringify(resultUrl))));
const domainUrl=url(compile('../lib/team-domain.ts').replaceAll("'./member-name'",JSON.stringify(memberNameUrl)).replaceAll("'./member-cohort'",JSON.stringify(cohortUrl)));
const domain=await import(domainUrl);
const {teamStore}=await import(url(compile('../lib/team-store.ts').replaceAll("'./team-domain'",JSON.stringify(domainUrl)).replaceAll("'./member-name'",JSON.stringify(memberNameUrl)).replaceAll("'./member-cohort'",JSON.stringify(cohortUrl))));
const actor={id:'account-a',name:'記録係A'};
const other={id:'account-b',name:'記録係B'};
function database(){const db=new DatabaseSync(':memory:');for(const migration of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));return {prepare(sql){let values=[];return {bind(...args){values=args;return this},async all(){return {results:db.prepare(sql).all(...values)}},async first(){return db.prepare(sql).get(...values)||null},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}}}}}}}
async function fixture(){const store=teamStore(database());const members=[];for(const name of ['アオキ','イトウ','ウエダ','エンドウ'])members.push((await store.writeMember({name,group:'',status:'active'})).member);const input={id:crypto.randomUUID(),date:'2026-11-01',category:'ゲーム練',event:'',discipline:'シングルス',format:2,opponentType:'internal',sideAIds:[members[0].id],sideBIds:[members[1].id],opponents:[],scores:[[21,19],[18,21],[30,29]],memo:''};return {store,members,input}}
test('得点は終了点・2点差・上限を固定せず、0以上の整数を受け付ける',()=>{for(const [a,b,expected] of [[15,14,true],[11,9,true],[21,20,true],[31,29,true],[100,99,true],[0,0,true],[10,10,true],[-1,21,false],[21.5,19,false],[NaN,2,false],[Infinity,2,false],[Number.MAX_SAFE_INTEGER+1,0,false]])assert.equal(domain.validGame(a,b),expected,`${a}-${b}`)});
test('1セットや4セット以上を受け付け、空・片側欠落・不正得点を拒否',()=>{for(const scores of [[[15,8]],[[21,15],[21,16],[21,17]],Array.from({length:8},(_,i)=>[i,i+1])])assert.deepEqual(domain.validateScores(scores),scores);for(const scores of [[],[[5]],[[5,null]],[[5,'3']],[[5,3,2]],[[5,-1]]])assert.throws(()=>domain.validateScores(scores))});
test('共通保存では別の入力者から同じ記録が見える',async()=>{const {store,input}=await fixture();await store.writeMatch(input,actor);const data=await store.bootstrap(other);assert.equal(data.members.length,4);assert.equal(data.matches.length,1);assert.equal(data.matches[0].createdByName,'記録係A');assert.equal(data.viewer.name,'記録係B')});
test('同じ部内試合を逆側から登録しても重複を防ぐ',async()=>{const {store,input}=await fixture();await store.writeMatch(input,actor);await assert.rejects(store.writeMatch({...input,id:crypto.randomUUID(),sideAIds:input.sideBIds,sideBIds:input.sideAIds,scores:input.scores.map(([a,b])=>[b,a])},other),e=>e.code==='duplicate_match');assert.equal((await store.bootstrap(actor)).matches.length,1)});
test('保存の再送は同じ1件を返す',async()=>{const {store,input}=await fixture();await store.writeMatch(input,actor);await store.writeMatch(input,actor);assert.equal((await store.bootstrap(actor)).matches.length,1)});
test('同じIDでメモだけ変わった再送を成功扱いしない',async()=>{const {store,input}=await fixture();await store.writeMatch(input,actor);await assert.rejects(store.writeMatch({...input,memo:'再送時の別メモ'},actor),e=>e.status===409);assert.equal((await store.bootstrap(actor)).matches[0].memo,'')});
test('確認した別のゲーム練は同条件でも保存できる',async()=>{const {store,input}=await fixture();await store.writeMatch(input,actor);const again={...input,id:crypto.randomUUID(),allowDuplicate:true};const {match}=await store.writeMatch(again,other);await store.writeMatch(again,other);await store.writeMatch({...again,memo:'2試合目',version:1,allowDuplicate:false},other,match.id);assert.equal((await store.bootstrap(actor)).matches.length,2)});
test('同条件の別試合が追加された後も、元の保存の再送は成功する',async()=>{const {store,input}=await fixture();const first=await store.writeMatch(input,actor);await store.writeMatch({...input,id:crypto.randomUUID(),allowDuplicate:true},other);const retried=await store.writeMatch(input,actor);assert.equal(retried.match.id,first.match.id);assert.equal((await store.bootstrap(actor)).matches.length,2);});
test('古い版での更新・削除は新しい内容を上書きしない',async()=>{const {store,input}=await fixture();const {match}=await store.writeMatch(input,actor);await store.writeMatch({...input,memo:'更新済み',version:match.version},other,match.id);await assert.rejects(store.writeMatch({...input,memo:'古い更新',version:1},actor,match.id),e=>e.status===409);await assert.rejects(store.deleteMatch(match.id,{version:1},actor),e=>e.status===409);assert.equal((await store.bootstrap(actor)).matches[0].memo,'更新済み')});
test('削除後に一覧から消え、再登録できる',async()=>{const {store,input}=await fixture();const {match}=await store.writeMatch(input,actor);await store.deleteMatch(match.id,{version:match.version},actor);assert.equal((await store.bootstrap(actor)).matches.length,0);await store.writeMatch({...input,id:crypto.randomUUID()},other);assert.equal((await store.bootstrap(actor)).matches.length,1)});
test('同じ選手の両側登録と存在しない選手を拒否',async()=>{const {store,input}=await fixture();await assert.rejects(store.writeMatch({...input,sideBIds:input.sideAIds},actor),e=>e.status===400);await assert.rejects(store.writeMatch({...input,sideAIds:['missing']},actor),e=>e.status===400)});
test('ダブルスは両側2名を記録し、ペアの選択順で重複しない',async()=>{const {store,input,members}=await fixture();const doubles={...input,discipline:'ダブルス',sideAIds:members.slice(0,2).map(m=>m.id),sideBIds:members.slice(2).map(m=>m.id)};await store.writeMatch(doubles,actor);await assert.rejects(store.writeMatch({...doubles,id:crypto.randomUUID(),sideAIds:[...doubles.sideAIds].reverse()},other),e=>e.code==='duplicate_match');await assert.rejects(store.writeMatch({...doubles,sideBIds:[members[2].id]},actor),e=>e.status===400)});
test('休止後も履歴を保持し、新規の出場登録を防ぐ',async()=>{const {store,input,members}=await fixture();const {match}=await store.writeMatch(input,actor);await store.writeMember({...members[0],status:'inactive'},members[0].id);await store.writeMatch({...input,version:1,memo:'既存の修正'},actor,match.id);await assert.rejects(store.writeMatch({...input,id:crypto.randomUUID(),date:'2026-11-02'},actor),/休止中/);assert.equal((await store.bootstrap(actor)).matches.length,1)});
test('外部対戦は相手の氏名で保存',async()=>{const {store,input}=await fixture();const {match}=await store.writeMatch({...input,category:'公式戦',opponentType:'external',sideBIds:[],opponents:['対戦校 選手']},actor);assert.deepEqual(match.opponents,['対戦校 選手']);assert.deepEqual(match.sideBIds,[])});
test('不正な日付と空白のみの名前を拒否',async()=>{const {store,input}=await fixture();await assert.rejects(store.writeMatch({...input,date:'2026-02-30'},actor),/試合日/);await assert.rejects(store.writeMember({name:'　',group:'',status:'active'}),/選手名/)});
test('半角・ひらがな・全角空白・分離した濁点を統一',()=>{
  for(const [input,expected] of [['ヤマダ タロウ','ヤマダタロウ'],['ﾔﾏﾀﾞﾀﾛｳ','ヤマダタロウ'],['やまだ　たろう','ヤマダタロウ'],['う\u3099ぃくたー','ヴィクター'],['ジョージュ ショーン','ジョージュショーン']]){assert.equal(names.normalizeMemberName(input),expected);assert.equal(names.memberNameError(input),'');}
});
test('名前は漢字・英数字・記号・長音のみを拒否',()=>{for(const name of ['山田太郎','YAMADA','タロウ1','ヤマダ・タロウ','😀','ーー',' '.repeat(4),'ア'.repeat(61)])assert.notEqual(names.memberNameError(name),'',name)});
test('APIから直接入力しても正規化して保存し、表記ゆれの重複を防ぐ',async()=>{const store=teamStore(database());const {member}=await store.writeMember({name:'やまだ　ﾀﾛｳ',group:'2年',status:'active'});assert.equal(member.name,'ヤマダタロウ');await assert.rejects(store.writeMember({name:'ﾔﾏﾀﾞ ﾀﾛｳ',group:'2年',status:'active'}),e=>e.status===409);await assert.rejects(store.writeMember({name:'山田太郎',group:'',status:'active'}),/読みをカタカナ/)});
test('登録名の変更後も選手IDと試合とのつながりを保持',async()=>{const {store,input,members}=await fixture();await store.writeMatch(input,actor);await store.writeMember({...members[0],name:'あおき たろう'},members[0].id);const data=await store.bootstrap(actor),renamed=data.members.find(m=>m.id===members[0].id);assert.equal(renamed.name,'アオキタロウ');assert.deepEqual(data.matches[0].sideAIds,[members[0].id]);});
test('以前のひらがな名との重複を検出し、既存名は閲覧で変更しない',async()=>{const db=database(),store=teamStore(db),now=new Date().toISOString();await db.prepare('INSERT INTO team_members (id,name,group_name,status,name_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind('legacy','やまだ たろう','2年','active','legacy-key',now,now).run();await assert.rejects(store.writeMember({name:'ヤマダタロウ',group:'2年',status:'active'}),e=>e.status===409);assert.equal((await store.bootstrap(actor)).members[0].name,'やまだ たろう');});
test('選手詳細は部内戦のサイドBから勝敗・得点を表示し、元記録を変えない',async()=>{const {input,members}=await fixture();const history=memberMatchHistory([input],members[1].id);assert.equal(history.length,1);assert.equal(history[0].won,false);assert.deepEqual(history[0].scores,[[19,21],[21,18],[29,30]]);assert.deepEqual(history[0].oppositeIds,input.sideAIds);assert.deepEqual(input.scores,[[21,19],[18,21],[30,29]]);assert.deepEqual(summarizeMemberMatches(history),{total:1,wins:0,losses:1,draws:0,winRate:0});});
test('選手詳細は区分を切り替えて集計し、日付の新しい順に表示',async()=>{const {input,members}=await fixture();const official={...input,id:crypto.randomUUID(),date:'2026-11-02',category:'公式戦',opponentType:'external',sideBIds:[],opponents:['相手']};const history=memberMatchHistory([input,official],members[0].id);assert.equal(history[0].match.id,official.id);assert.equal(memberMatchHistory([input,official],members[1].id,'公式戦').length,0);assert.equal(memberMatchHistory([input,official],members[0].id,'ゲーム練').length,1);assert.deepEqual(summarizeMemberMatches([]),{total:0,wins:0,losses:0,draws:0,winRate:null});});
test('ダブルスの選手詳細は選手の所属する側のペアを示す',async()=>{const {input,members}=await fixture();const match={...input,discipline:'ダブルス',sideAIds:members.slice(0,2).map(m=>m.id),sideBIds:members.slice(2).map(m=>m.id)};const history=memberMatchHistory([match],members[3].id);assert.deepEqual(history[0].ownIds,match.sideBIds);assert.deepEqual(history[0].oppositeIds,match.sideAIds);assert.equal(history[0].gamesWon,1);assert.equal(history[0].gamesLost,2);});
test('獲得セット数を比較し、総得点で勝敗を決めない',()=>{assert.equal(matchResult([[15,8]]).outcome,'win');assert.equal(matchResult([[21,0],[0,2],[0,2]]).outcome,'loss');const r=matchResult([[11,6],[9,15],[31,30],[7,11]]);assert.equal(r.a,2);assert.equal(r.b,2);assert.equal(r.outcome,'draw');});
test('同点セットは双方の獲得セット数に加えない',()=>{const r=matchResult([[10,10],[15,10],[7,11]]);assert.equal(r.a,1);assert.equal(r.b,1);assert.equal(r.drawnSets,1);assert.equal(r.draw,true);assert.equal(matchResult([[0,0]]).outcome,'draw');});
test('4セット以上の引き分けを保存して再取得・編集できる',async()=>{const {store,input}=await fixture();const scores=[[15,9],[8,11],[31,29],[7,15]];const {match}=await store.writeMatch({...input,format:undefined,scores},actor);assert.deepEqual(match.scores,scores);assert.equal(matchResult(match.scores).outcome,'draw');await store.writeMatch({...match,scores:[...scores,[3,2],[1,4]]},other,match.id);const saved=(await store.bootstrap(actor)).matches[0];assert.equal(saved.scores.length,6);assert.equal(matchResult(saved.scores).draw,true);});
test('部内の引き分けは両選手で引き分けとなり、敗戦にしない',async()=>{const {input,members}=await fixture();const match={...input,scores:[[15,9],[8,11],[10,10]]};for(const member of members.slice(0,2)){const h=memberMatchHistory([match],member.id);assert.equal(h[0].won,false);assert.equal(h[0].lost,false);assert.equal(h[0].drawn,true);assert.equal(h[0].gamesWon,1);assert.equal(h[0].gamesLost,1);assert.deepEqual(summarizeMemberMatches(h),{total:1,wins:0,losses:0,draws:1,winRate:null});}});
test('集計は引き分けを別件数にし、勝率の分母から除く',()=>{assert.deepEqual(matchSummary([{outcome:'win'},{outcome:'loss'},{outcome:'draw'}]),{total:3,wins:1,losses:1,draws:1,winRate:50});assert.deepEqual(matchSummary([{outcome:'draw'}]),{total:1,wins:0,losses:0,draws:1,winRate:null});});
test('旧形式の記録も編集・重複検出でき、得点を保持する',async()=>{const db=database(),store=teamStore(db),now=new Date().toISOString();const members=[];for(const name of ['アオキ','イトウ'])members.push((await store.writeMember({name,status:'active',group:''})).member);const legacy={date:'2026-11-01',category:'ゲーム練',event:'',discipline:'シングルス',format:2,opponentType:'internal',sideAIds:[members[0].id],sideBIds:[members[1].id],opponents:[],scores:[[21,15],[21,18]],memo:''};const id=crypto.randomUUID();await db.prepare('INSERT INTO team_matches (id,match_date,payload,fingerprint,created_by,created_by_name,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,legacy.date,JSON.stringify(legacy),'legacy-key',actor.id,actor.name,actor.id,now,now).run();await assert.rejects(store.writeMatch({...legacy,id:crypto.randomUUID()},other),e=>e.code==='duplicate_match');const {match}=await store.writeMatch({...legacy,version:1,memo:'変更'},actor,id);assert.equal(match.id,id);assert.deepEqual(match.scores,legacy.scores);assert.equal(match.format,undefined);});
test('生年月日から通常の高校入学年度を算出し、4月1日と2日を区別',()=>{assert.equal(cohort.highSchoolEntryYear('2010-04-01'),2025);assert.equal(cohort.highSchoolEntryYear('2010-04-02'),2026);assert.equal(cohort.highSchoolEntryYear('2010-03-31'),2025);assert.equal(cohort.highSchoolEntryYear('2011-04-01'),2026);assert.equal(cohort.highSchoolEntryYear('2012-02-29'),2027);assert.equal(cohort.highSchoolEntryYear('2010-02-29'),null);});
test('年度は日本時間の4月1日に切り替わる',()=>{assert.equal(cohort.schoolYear('2027-03-31'),2026);assert.equal(cohort.schoolYear('2027-04-01'),2027);assert.equal(cohort.japanDate(new Date('2027-03-31T14:59:59Z')),'2027-03-31');assert.equal(cohort.japanDate(new Date('2027-03-31T15:00:00Z')),'2027-04-01');});
test('内部在籍歴のある選手は高1→高2→高3→OB・OG',()=>{const m={stageMode:'cohort',cohortYear:2026,affiliation:'internal',internalHistory:true};for(const [date,label]of[['2026-11-01','高1'],['2027-04-01','高2'],['2028-04-01','高3'],['2029-04-01','OB・OG']])assert.equal(cohort.memberStage(m,date).label,label);});
test('外部高校生は同じ学年計算で卒業相当後は一般',()=>{const m={stageMode:'cohort',cohortYear:2026,affiliation:'external',internalHistory:false};assert.equal(cohort.memberStage(m,'2027-11-01').label,'高2');assert.equal(cohort.memberStage(m,'2029-04-01').label,'一般');assert.equal(cohort.memberStage({...m,affiliation:'internal'},'2029-04-01').label,'一般');});
test('成人後の初登録は内部でも一般、在籍歴を明示すればOB・OG',()=>{const base={name:'ヤマダタロウ',group:'',status:'active',affiliation:'internal',stageMode:'cohort',cohortYear:2010};const adult=domain.memberInput(base,undefined,'2026-11-01');assert.equal(adult.internalHistory,false);assert.equal(cohort.memberStage(adult,'2026-11-01').label,'一般');assert.equal(cohort.memberStage({...adult,internalHistory:true},'2026-11-01').label,'OB・OG');const student=domain.memberInput({...base,cohortYear:2025},undefined,'2026-11-01');assert.equal(student.internalHistory,true);assert.equal(cohort.memberStage({...student,affiliation:'external'},'2030-01-01').label,'OB・OG');});
test('学年の補正は指定年度から進級し、過去年度は変えない',()=>{const m={stageMode:'cohort',cohortYear:2024,internalHistory:true,gradeOverrides:{'2026':2}};assert.equal(cohort.memberStage(m,'2025-11-01').label,'高2');assert.equal(cohort.memberStage(m,'2026-11-01').label,'高2');assert.equal(cohort.memberStage(m,'2027-11-01').label,'高3');assert.equal(cohort.memberStage(m,'2028-04-01').label,'OB・OG');});
test('一般・未設定への明示変更は過去の学年補正より優先',()=>{const m={stageMode:'general',cohortYear:null,internalHistory:false,gradeOverrides:{'2025':1}};assert.equal(cohort.memberStage(m,'2026-11-01').label,'一般');assert.equal(cohort.memberStage({...m,internalHistory:true},'2026-11-01').label,'OB・OG');assert.equal(cohort.memberStage({...m,stageMode:'unspecified'},'2026-11-01').label,'未設定');});
test('補正保存は以前の年度を維持し、旧クライアントの編集でも新情報を失わない',()=>{const old={id:'m',name:'ヤマダタロウ',group:'',status:'active',version:1,affiliation:'internal',stageMode:'cohort',cohortYear:2024,internalHistory:true,gradeOverrides:{'2025':1}};const next=domain.memberInput({name:old.name,group:'',status:'active',gradeOverride:'2'},old,'2026-11-01');assert.deepEqual(next.gradeOverrides,{'2025':1,'2026':2});assert.equal(next.internalHistory,true);assert.equal(next.cohortYear,2024);const auto=domain.memberInput({name:old.name,group:'',status:'active',gradeOverride:'auto'},{...old,gradeOverrides:next.gradeOverrides},'2026-11-01');assert.deepEqual(auto.gradeOverrides,{'2025':1});});
test('生年月日はAPIの返却値やDB保存項目に含めない',async()=>{const db=database(),store=teamStore(db);const {member}=await store.writeMember({name:'サトウハナコ',group:'',status:'active',affiliation:'external',stageMode:'cohort',cohortYear:2026,birthDate:'2010-08-01'});assert.equal(member.cohortYear,2026);assert.equal('birthDate' in member,false);assert.equal(JSON.stringify(await db.prepare('SELECT * FROM team_members').all()).includes('2010-08-01'),false);});
test('新規の試合は試合日の学年と記録時の所属を保持し、選手編集で変わらない',async()=>{const {store,input,members}=await fixture();await store.writeMember({...members[0],affiliation:'internal',stageMode:'cohort',cohortYear:2025,internalHistory:true},members[0].id);const {match}=await store.writeMatch({...input,date:'2026-11-01'},actor);assert.deepEqual(match.memberSnapshots[members[0].id],{affiliation:'internal',gradeLabel:'高2',schoolYear:2026,cohortYear:2025});let m=(await store.bootstrap(actor)).members.find(m=>m.id===members[0].id);await store.writeMember({...m,affiliation:'external',cohortYear:2024},m.id);assert.equal((await store.writeMatch({...input,date:'2026-11-01'},actor)).match.id,match.id);const saved=(await store.writeMatch({...match,memo:'後で訂正'},actor,match.id)).match;assert.equal(saved.memberSnapshots[members[0].id].gradeLabel,'高2');assert.equal(saved.memberSnapshots[members[0].id].affiliation,'internal');});
test('旧試合のメモ編集で当時の属性を作り足さない',async()=>{const db=database(),store=teamStore(db),now=new Date().toISOString();const a=(await store.writeMember({name:'アオキ',status:'active',group:'',affiliation:'internal',stageMode:'cohort',cohortYear:2025})).member,b=(await store.writeMember({name:'イトウ',status:'active',group:''})).member;const old={date:'2026-11-01',category:'ゲーム練',event:'',discipline:'シングルス',opponentType:'internal',sideAIds:[a.id],sideBIds:[b.id],opponents:[],scores:[[15,8]],memo:''},id=crypto.randomUUID();await db.prepare('INSERT INTO team_matches (id,match_date,payload,fingerprint,created_by,created_by_name,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,old.date,JSON.stringify(old),'legacy',actor.id,actor.name,actor.id,now,now).run();const {match}=await store.writeMatch({...old,memo:'訂正',version:1},actor,id);assert.equal(match.memberSnapshots,undefined);const dated=(await store.writeMatch({...match,date:'2027-01-01'},actor,id)).match;assert.equal(dated.memberSnapshots[a.id].gradeLabel,'高2');});
test('選手削除は復元可能で、元のIDと所属・学年を保持する',async()=>{const store=teamStore(database());const {member}=await store.writeMember({name:'スズキハナコ',group:'クラブ',status:'active',affiliation:'external',stageMode:'cohort',cohortYear:2026,internalHistory:false});await store.deleteMember(member.id,{version:member.version});let removed=(await store.bootstrap(actor)).members.find(m=>m.id===member.id);assert.ok(removed.deletedAt);assert.equal(removed.version,2);const restored=(await store.restoreMember(member.id,{version:removed.version})).member;assert.equal(restored.id,member.id);assert.equal(restored.deletedAt,null);assert.equal(restored.cohortYear,2026);assert.equal(restored.affiliation,'external');assert.equal(restored.version,3);});
test('試合に出ている選手を削除しても名前・試合・当時情報を保持する',async()=>{const {store,members,input}=await fixture();const {match}=await store.writeMatch(input,actor);await store.deleteMember(members[0].id,{version:members[0].version});const data=await store.bootstrap(other);assert.equal(data.matches[0].id,match.id);assert.deepEqual(data.matches[0].memberSnapshots,match.memberSnapshots);assert.equal(data.members.find(m=>m.id===members[0].id).name,'アオキ');assert.ok(data.members.find(m=>m.id===members[0].id).deletedAt);});
test('削除済み選手は新規試合で拒否し、既存試合の編集はできる',async()=>{const {store,members,input}=await fixture();const {match}=await store.writeMatch(input,actor);await store.deleteMember(members[0].id,{version:1});await assert.rejects(store.writeMatch({...input,id:crypto.randomUUID(),date:'2026-11-02'},actor),/削除済み/);const changed=(await store.writeMatch({...match,memo:'保存済み試合の訂正'},actor,match.id)).match;assert.equal(changed.memo,'保存済み試合の訂正');});
test('選手削除後も保存済み試合の同じPOST再送は成功する',async()=>{const {store,members,input}=await fixture();const {match}=await store.writeMatch(input,actor);await store.deleteMember(members[0].id,{version:1});assert.equal((await store.writeMatch(input,actor)).match.id,match.id);assert.equal((await store.bootstrap(actor)).matches.length,1);});
test('選手の削除・復元は古い版での操作を拒否する',async()=>{const {store,members}=await fixture(),m=members[0];const edited=(await store.writeMember({...m,group:'編集後'},m.id)).member;await assert.rejects(store.deleteMember(m.id,{version:1}),e=>e.status===409);await store.deleteMember(m.id,{version:edited.version});await assert.rejects(store.restoreMember(m.id,{version:edited.version}),e=>e.status===409);const removed=(await store.bootstrap(actor)).members.find(p=>p.id===m.id);await store.restoreMember(m.id,{version:removed.version});await assert.rejects(store.deleteMember(m.id,{version:removed.version}),e=>e.status===409);});
test('削除後に同名選手を再登録でき、重複する場合の復元は止める',async()=>{const {store,members}=await fixture(),m=members[0];await store.deleteMember(m.id,{version:1});const newMember=(await store.writeMember({name:m.name,group:m.group,status:'active'})).member;assert.notEqual(newMember.id,m.id);const removed=(await store.bootstrap(actor)).members.find(p=>p.id===m.id);await assert.rejects(store.restoreMember(m.id,{version:removed.version}),/同じ名前/);await store.deleteMember(newMember.id,{version:newMember.version});assert.equal((await store.restoreMember(m.id,{version:removed.version})).member.id,m.id);});
test('削除済み選手の直接編集は復元まで拒否する',async()=>{const {store,members}=await fixture(),m=members[0];await store.deleteMember(m.id,{version:1});await assert.rejects(store.writeMember({...m,name:'アオキタロウ',version:2},m.id),/先に復元/);assert.equal((await store.bootstrap(actor)).members.find(p=>p.id===m.id).name,m.name);});

test('分岐の初期値は所属と在籍歴が一致する場合だけ選択し、旧情報の矛盾は確認する',()=>{
  assert.equal(cohort.teamHistoryChoice({affiliation:'internal',internalHistory:true}),true);
  assert.equal(cohort.teamHistoryChoice({affiliation:'external',internalHistory:false}),false);
  for(const member of [{},{affiliation:'internal',internalHistory:false},{affiliation:'external',internalHistory:true},{affiliation:'unspecified',internalHistory:false},{affiliation:'internal'},{affiliation:'external'}])assert.equal(cohort.teamHistoryChoice(member),null);
});

test('所属経験の回答から内部・外部を決め、旧フィールドの矛盾した指定に優先する',()=>{
  const base={name:'サトウハナコ',group:'',status:'active',stageMode:'cohort',cohortYear:2026};
  for(const [hasTeamHistory,affiliation,afterGraduation]of[[true,'internal','OB・OG'],[false,'external','一般']]){
    const member=domain.memberInput({...base,hasTeamHistory,affiliation:'不正な旧値',internalHistory:'不正な旧値'},undefined,'2026-11-01');
    assert.equal(member.affiliation,affiliation);assert.equal(member.internalHistory,hasTeamHistory);
    for(const [date,label]of[['2026-11-01','高1'],['2027-04-01','高2'],['2028-04-01','高3'],['2029-04-01',afterGraduation]])assert.equal(cohort.memberStage(member,date).label,label);
  }
});

test('卒業後の初登録でも所属経験があればOB・OG、なければ外部・一般になる',()=>{
  const base={name:'タナカタロウ',group:'',status:'active',stageMode:'cohort',cohortYear:2010};
  for(const stageMode of ['cohort','general']){
    const alumni=domain.memberInput({...base,stageMode,hasTeamHistory:true},undefined,'2026-11-01');
    const visitor=domain.memberInput({...base,stageMode,hasTeamHistory:false},undefined,'2026-11-01');
    assert.equal(alumni.affiliation,'internal');assert.equal(cohort.memberStage(alumni,'2026-11-01').label,'OB・OG');
    assert.equal(visitor.affiliation,'external');assert.equal(cohort.memberStage(visitor,'2026-11-01').label,'一般');
  }
});

test('所属経験は真偽値のみ受け付け、文字列やnullを未回答扱いにしない',()=>{
  const base={name:'アオキ',group:'',status:'active'};
  for(const hasTeamHistory of [null,0,1,'true','false','',[],{}])assert.throws(()=>domain.memberInput({...base,hasTeamHistory}),/所属経験/);
  assert.equal(domain.memberInput({...base,hasTeamHistory:false}).affiliation,'external');
});

test('所属経験を送らない旧クライアントは既存の所属・在籍歴・補正を変更しない',()=>{
  for(const [affiliation,internalHistory]of[['external',true],['internal',false],['unspecified',false]]){
    const previous={id:'legacy-member',name:'アオキ',group:'',status:'active',version:1,affiliation,internalHistory,stageMode:'cohort',cohortYear:2010,gradeOverrides:{'2025':3}};
    const updated=domain.memberInput({name:'アオキ',group:'備考の変更',status:'inactive'},previous,'2026-11-01');
    assert.equal(updated.affiliation,affiliation);assert.equal(updated.internalHistory,internalHistory);assert.equal(updated.cohortYear,2010);assert.deepEqual(updated.gradeOverrides,{'2025':3});
  }
});

test('分岐型で登録しても生年月日は保存せず、基準年度だけを保持する',async()=>{
  const db=database(),store=teamStore(db),birthDate='2010-08-01';
  const {member}=await store.writeMember({name:'スズキハナコ',group:'',status:'active',hasTeamHistory:true,stageMode:'cohort',cohortYear:cohort.highSchoolEntryYear(birthDate),birthDate});
  assert.equal(member.affiliation,'internal');assert.equal(member.internalHistory,true);assert.equal(member.cohortYear,2026);assert.equal('birthDate'in member,false);
  const persisted=JSON.stringify(await db.prepare('SELECT * FROM team_members').all());assert.equal(persisted.includes(birthDate),false);
});

test('所属経験の分岐を変更しても保存済み試合の所属・学年は変わらず、新規試合に反映する',async()=>{
  const {store,members,input}=await fixture();
  const {member}=await store.writeMember({...members[0],hasTeamHistory:true,stageMode:'cohort',cohortYear:2025},members[0].id);
  const {match}=await store.writeMatch(input,actor);
  const before={affiliation:'internal',gradeLabel:'高2',schoolYear:2026,cohortYear:2025};
  assert.deepEqual(match.memberSnapshots[member.id],before);
  await store.writeMember({...member,hasTeamHistory:false},member.id);
  assert.deepEqual((await store.bootstrap(actor)).matches[0].memberSnapshots[member.id],before);
  const edited=(await store.writeMatch({...match,memo:'所属経験変更後の訂正'},actor,match.id)).match;
  assert.deepEqual(edited.memberSnapshots[member.id],before);
  const next=(await store.writeMatch({...input,id:crypto.randomUUID(),date:'2026-11-02'},actor)).match;
  assert.deepEqual(next.memberSnapshots[member.id],{...before,affiliation:'external'});
});

test('期生は1〜9999の整数かnullだけを受け付ける',()=>{
  const base={name:'アオキ',group:'',status:'active',hasTeamHistory:true};
  for(const generation of [1,34,9999])assert.equal(domain.memberInput({...base,generation}).generation,generation);
  for(const generation of [0,-1,10000,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'34','',false,[],{}])assert.throws(()=>domain.memberInput({...base,generation}),/期生/);
  assert.equal(domain.memberInput({...base,generation:null}).generation,null);
});

test('期生を保存・編集でき、旧形式の編集で省略しても元の期生を保持する',async()=>{
  const store=teamStore(database());
  const {member}=await store.writeMember({name:'アオキ',group:'',status:'active',hasTeamHistory:true,stageMode:'cohort',cohortYear:2026,generation:34});
  assert.equal(member.generation,34);assert.equal((await store.bootstrap(actor)).members[0].generation,34);
  const renamed=(await store.writeMember({name:'アオキタロウ',group:'備考変更',status:'active',version:member.version},member.id)).member;
  assert.equal(renamed.generation,34);assert.equal(renamed.id,member.id);
  const corrected=(await store.writeMember({...renamed,generation:35},member.id)).member;
  assert.equal(corrected.generation,35);
  const cleared=(await store.writeMember({...corrected,generation:null},member.id)).member;
  assert.equal(cleared.generation,null);assert.equal((await store.bootstrap(actor)).members[0].generation,null);
});

test('外部の初登録は期生未設定で、内部から切り替えても隠れた期生を省略編集で失わない',async()=>{
  const store=teamStore(database());
  assert.equal((await store.writeMember({name:'イトウ',group:'',status:'active',hasTeamHistory:false})).member.generation,null);
  const {member}=await store.writeMember({name:'アオキ',group:'',status:'active',hasTeamHistory:true,stageMode:'general',generation:12});
  const external=(await store.writeMember({name:member.name,group:'',status:'active',hasTeamHistory:false,version:member.version},member.id)).member;
  assert.equal(external.generation,12);assert.equal(cohort.memberClassification(external,'2026-11-01'),'外部・一般');
  const internal=(await store.writeMember({name:external.name,group:'',status:'active',hasTeamHistory:true,version:external.version},external.id)).member;
  assert.equal(cohort.memberClassification(internal,'2026-11-01'),'OB/OG・12期生');
});

test('選手を削除・復元しても期生は元のIDとともに保持する',async()=>{
  const store=teamStore(database());
  const {member}=await store.writeMember({name:'アオキ',group:'',status:'active',hasTeamHistory:true,generation:34});
  await store.deleteMember(member.id,{version:member.version});
  const deleted=(await store.bootstrap(actor)).members[0];assert.equal(deleted.generation,34);
  const restored=(await store.restoreMember(member.id,{version:deleted.version})).member;
  assert.equal(restored.id,member.id);assert.equal(restored.generation,34);
});

test('内部は年度で現役からOB/OGへ変わり、期生は進級や卒業で変えない',()=>{
  const member={affiliation:'internal',internalHistory:true,stageMode:'cohort',cohortYear:2026,generation:34};
  for(const date of ['2026-11-01','2027-04-01','2029-03-31'])assert.equal(cohort.memberClassification(member,date),'現役・34期生');
  assert.equal(cohort.memberClassification(member,'2029-04-01'),'OB/OG・34期生');
  assert.equal(cohort.memberClassification({...member,gradeOverrides:{'2028':2}},'2029-04-01'),'現役・34期生');
  assert.equal(cohort.memberClassification({...member,gradeOverrides:{'2028':2}},'2030-04-01'),'OB/OG・34期生');
});

test('外部は学年・一般を表示し、期生や旧在籍歴は表示に混ぜない',()=>{
  const member={affiliation:'external',internalHistory:false,stageMode:'cohort',cohortYear:2026,generation:34};
  for(const [date,label]of[['2026-11-01','外部・高1'],['2027-04-01','外部・高2'],['2028-04-01','外部・高3'],['2029-04-01','外部・一般']])assert.equal(cohort.memberClassification(member,date),label);
  assert.equal(cohort.memberClassification({...member,internalHistory:true},'2029-04-01'),'外部・一般');
  assert.equal(cohort.memberClassification({...member,stageMode:'general'},'2026-11-01'),'外部・一般');
});

test('期生や学年のない旧選手には不明を表示し、現役やOB/OGを推測しない',()=>{
  const internal={affiliation:'internal',internalHistory:true,stageMode:'cohort',cohortYear:2026};
  assert.equal(cohort.memberClassification(internal,'2026-11-01'),'現役・期生未設定');
  assert.equal(cohort.memberClassification(internal,'2029-04-01'),'OB/OG・期生未設定');
  assert.equal(cohort.memberClassification({...internal,stageMode:'unspecified',generation:34},'2026-11-01'),'内部・学年未設定・34期生');
  assert.equal(cohort.memberClassification({...internal,stageMode:'general',internalHistory:false,generation:34},'2026-11-01'),'内部・一般・34期生');
  assert.equal(cohort.memberClassification({...internal,affiliation:'external',stageMode:'unspecified'},'2026-11-01'),'外部・学年未設定');
  assert.equal(cohort.memberClassification({...internal,affiliation:'external',cohortYear:2027},'2026-11-01'),'外部・高校入学前');
  assert.equal(cohort.memberClassification({},'2026-11-01'),'所属未設定・学年未設定');
});

test('期生の編集は保存済み試合の学年・所属スナップショットを変えない',async()=>{
  const {store,members,input}=await fixture();
  const {member}=await store.writeMember({...members[0],hasTeamHistory:true,stageMode:'cohort',cohortYear:2026,generation:34},members[0].id);
  const {match}=await store.writeMatch(input,actor),before=match.memberSnapshots[member.id];
  const changed=(await store.writeMember({...member,generation:35},member.id)).member;
  assert.equal(changed.generation,35);assert.equal('generation'in before,false);
  assert.deepEqual((await store.bootstrap(actor)).matches[0].memberSnapshots[member.id],before);
  const edited=(await store.writeMatch({...match,memo:'期生変更後のメモ'},actor,match.id)).match;
  assert.deepEqual(edited.memberSnapshots[member.id],before);
});

test('名前順より所属グループを優先し、内部現役→OB・OG→外部→所属未設定で並べる',()=>{
  const members=[
    {id:'unknown',name:'アオキ',affiliation:'unspecified',stageMode:'cohort',cohortYear:2024},
    {id:'external',name:'イトウ',affiliation:'external',stageMode:'cohort',cohortYear:2024},
    {id:'alumni',name:'ウエダ',affiliation:'internal',internalHistory:true,stageMode:'general',generation:78},
    {id:'student',name:'ワタナベ',affiliation:'internal',internalHistory:true,stageMode:'cohort',cohortYear:2026}
  ];
  assert.deepEqual(cohort.sortMembers(members,'2026-11-02').map(m=>m.id),['student','alumni','external','unknown']);
});

test('現役は高3→高2→高1、同じ学年は期生番号より50音を優先する',()=>{
  const base={affiliation:'internal',internalHistory:true,stageMode:'cohort'};
  const members=[
    {...base,id:'year1',name:'アオキ',cohortYear:2026,generation:80},
    {...base,id:'year2',name:'イトウ',cohortYear:2025,generation:79},
    {...base,id:'year3-z',name:'ワタナベ',cohortYear:2024,generation:77},
    {...base,id:'year3-a',name:'アオキ',cohortYear:2024,generation:78},
    {...base,id:'unknown',name:'アオキ',stageMode:'unspecified'}
  ];
  assert.deepEqual(cohort.sortMembers(members,'2026-11-02').map(m=>m.id),['year3-a','year3-z','year2','year1','unknown']);
});

test('OB・OGは期生番号の小さい順、同じ期生は50音順、期生不明は最後に並べる',()=>{
  const base={affiliation:'internal',internalHistory:true,stageMode:'general'};
  const members=[
    {...base,id:'missing',name:'アオキ'},
    {...base,id:'80',name:'アオキ',generation:80},
    {...base,id:'78-z',name:'ワタナベ',generation:78},
    {...base,id:'invalid',name:'イトウ',generation:0},
    {...base,id:'79',name:'アオキ',generation:79},
    {...base,id:'78-a',name:'アオキ',generation:78}
  ];
  assert.deepEqual(cohort.sortMembers(members,'2026-11-02').map(m=>m.id),['78-a','78-z','79','80','missing','invalid']);
});

test('外部は高3→高2→高1→高校入学前→一般→未設定で並び、旧在籍歴でもOB扱いしない',()=>{
  const base={affiliation:'external',internalHistory:false,stageMode:'cohort'};
  const members=[
    {...base,id:'unknown',name:'アオキ',stageMode:'unspecified'},
    {...base,id:'adult-z',name:'ワタナベ',stageMode:'general'},
    {...base,id:'adult-a',name:'アオキ',cohortYear:2020,internalHistory:true},
    {...base,id:'before',name:'イトウ',cohortYear:2027},
    {...base,id:'year1',name:'アオキ',cohortYear:2026},
    {...base,id:'year2',name:'イトウ',cohortYear:2025},
    {...base,id:'year3',name:'ワタナベ',cohortYear:2024}
  ];
  assert.deepEqual(cohort.sortMembers(members,'2026-11-02').map(m=>m.id),['year3','year2','year1','before','adult-a','adult-z','unknown']);
});

test('同学年の名前は50音順で、半角カナ・ひらがなも日本語の読み順で比較する',()=>{
  const base={affiliation:'internal',internalHistory:true,stageMode:'cohort',cohortYear:2024};
  const members=['ワタナベ','ハシモト','ニシノ','スズキ','オカモト','ﾐﾔﾓﾄ','いとう','アオキ'].map(name=>({...base,name}));
  assert.deepEqual(cohort.sortMembers(members,'2026-11-02').map(m=>m.name),['アオキ','いとう','オカモト','スズキ','ニシノ','ハシモト','ﾐﾔﾓﾄ','ワタナベ']);
  const voiced=['パバ','ババ','ハバ','ハハ'].map(name=>({...base,name}));
  assert.deepEqual(cohort.sortMembers(voiced,'2026-11-02').map(m=>m.name),['ハハ','ハバ','ババ','パバ']);
  const sameReading=[{...base,name:'ババ',group:'イ高校',id:'a'},{...base,name:'ばば',group:'ア高校',id:'b'}];
  assert.deepEqual(cohort.sortMembers(sameReading,'2026-11-02').map(m=>m.id),['b','a']);
});

test('同名選手は所属先とIDで安定して並び、元の配列や選手情報を変更しない',()=>{
  const base={name:'アオキ',affiliation:'external',stageMode:'general'};
  const members=Object.freeze([
    Object.freeze({...base,id:'b',group:'イ高校'}),
    Object.freeze({...base,id:'z',group:'ア高校'}),
    Object.freeze({...base,id:'a',group:'イ高校'})
  ]);
  const before=JSON.stringify(members),sorted=cohort.sortMembers(members,'2026-11-02');
  assert.notEqual(sorted,members);assert.deepEqual(sorted.map(m=>m.id),['z','a','b']);
  assert.equal(JSON.stringify(members),before);assert.equal(sorted[0],members[1]);
  assert.equal(cohort.compareMembers(members[0],members[0],'2026-11-02'),0);
});

test('表示年度に応じて卒業を反映し、GWや候補の非表示で所属グループを変えない',()=>{
  const base={affiliation:'internal',internalHistory:true,stageMode:'cohort'};
  const older={...base,id:'older',name:'アオキ',cohortYear:2024,generation:79,status:'inactive'};
  const younger={...base,id:'younger',name:'イトウ',cohortYear:2025,generation:80,status:'active'};
  const members=[younger,older];
  assert.deepEqual(cohort.sortMembers(members,'2026-05-10').map(m=>m.id),['older','younger']);
  assert.deepEqual(cohort.sortMembers(members,'2027-03-31').map(m=>m.id),['older','younger']);
  assert.deepEqual(cohort.sortMembers(members,'2027-04-01').map(m=>m.id),['younger','older']);
  assert.equal(cohort.memberClassification(older,'2026-05-10'),'現役・79期生');
  assert.equal(cohort.memberClassification(older,'2027-04-01'),'OB/OG・79期生');
});
