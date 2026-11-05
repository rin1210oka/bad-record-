import test from 'node:test';
import assert from 'node:assert/strict';
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

test('得点は終了点・2点差・上限を固定せず、0以上の整数を受け付ける',()=>{for(const [a,b,expected] of [[15,14,true],[11,9,true],[21,20,true],[31,29,true],[100,99,true],[0,0,true],[10,10,true],[-1,21,false],[21.5,19,false],[NaN,2,false],[Infinity,2,false],[Number.MAX_SAFE_INTEGER+1,0,false]])assert.equal(domain.validGame(a,b),expected,`${a}-${b}`)});

test('1セットや4セット以上を受け付け、空・片側欠落・不正得点を拒否',()=>{for(const scores of [[[15,8]],[[21,15],[21,16],[21,17]],Array.from({length:8},(_,i)=>[i,i+1])])assert.deepEqual(domain.validateScores(scores),scores);for(const scores of [[],[[5]],[[5,null]],[[5,'3']],[[5,3,2]],[[5,-1]]])assert.throws(()=>domain.validateScores(scores))});

test('半角・ひらがな・全角空白・分離した濁点を統一',()=>{
  for(const [input,expected] of [['ヤマダ タロウ','ヤマダタロウ'],['ﾔﾏﾀﾞﾀﾛｳ','ヤマダタロウ'],['やまだ　たろう','ヤマダタロウ'],['う\u3099ぃくたー','ヴィクター'],['ジョージュ ショーン','ジョージュショーン']]){assert.equal(names.normalizeMemberName(input),expected);assert.equal(names.memberNameError(input),'');}
});

test('名前は漢字・英数字・記号・長音のみを拒否',()=>{for(const name of ['山田太郎','YAMADA','タロウ1','ヤマダ・タロウ','😀','ーー',' '.repeat(4),'ア'.repeat(61)])assert.notEqual(names.memberNameError(name),'',name)});

test('獲得セット数を比較し、総得点で勝敗を決めない',()=>{assert.equal(matchResult([[15,8]]).outcome,'win');assert.equal(matchResult([[21,0],[0,2],[0,2]]).outcome,'loss');const r=matchResult([[11,6],[9,15],[31,30],[7,11]]);assert.equal(r.a,2);assert.equal(r.b,2);assert.equal(r.outcome,'draw');});

test('同点セットは双方の獲得セット数に加えない',()=>{const r=matchResult([[10,10],[15,10],[7,11]]);assert.equal(r.a,1);assert.equal(r.b,1);assert.equal(r.drawnSets,1);assert.equal(r.draw,true);assert.equal(matchResult([[0,0]]).outcome,'draw');});

test('集計は引き分けを別件数にし、勝率の分母から除く',()=>{assert.deepEqual(matchSummary([{outcome:'win'},{outcome:'loss'},{outcome:'draw'}]),{total:3,wins:1,losses:1,draws:1,winRate:50});assert.deepEqual(matchSummary([{outcome:'draw'}]),{total:1,wins:0,losses:0,draws:1,winRate:null});});

test('生年月日から通常の高校入学年度を算出し、4月1日と2日を区別',()=>{assert.equal(cohort.highSchoolEntryYear('2010-04-01'),2025);assert.equal(cohort.highSchoolEntryYear('2010-04-02'),2026);assert.equal(cohort.highSchoolEntryYear('2010-03-31'),2025);assert.equal(cohort.highSchoolEntryYear('2011-04-01'),2026);assert.equal(cohort.highSchoolEntryYear('2012-02-29'),2027);assert.equal(cohort.highSchoolEntryYear('2010-02-29'),null);});

test('年度は日本時間の4月1日に切り替わる',()=>{assert.equal(cohort.schoolYear('2027-03-31'),2026);assert.equal(cohort.schoolYear('2027-04-01'),2027);assert.equal(cohort.japanDate(new Date('2027-03-31T14:59:59Z')),'2027-03-31');assert.equal(cohort.japanDate(new Date('2027-03-31T15:00:00Z')),'2027-04-01');});

test('内部在籍歴のある選手は高1→高2→高3→OB・OG',()=>{const m={stageMode:'cohort',cohortYear:2026,affiliation:'internal',internalHistory:true};for(const [date,label]of[['2026-11-01','高1'],['2027-04-01','高2'],['2028-04-01','高3'],['2029-04-01','OB・OG']])assert.equal(cohort.memberStage(m,date).label,label);});

test('外部高校生は同じ学年計算で卒業相当後は一般',()=>{const m={stageMode:'cohort',cohortYear:2026,affiliation:'external',internalHistory:false};assert.equal(cohort.memberStage(m,'2027-11-01').label,'高2');assert.equal(cohort.memberStage(m,'2029-04-01').label,'一般');assert.equal(cohort.memberStage({...m,affiliation:'internal'},'2029-04-01').label,'一般');});

test('成人後の初登録は内部でも一般、在籍歴を明示すればOB・OG',()=>{const base={name:'ヤマダタロウ',group:'',status:'active',affiliation:'internal',stageMode:'cohort',cohortYear:2010};const adult=domain.memberInput(base,undefined,'2026-11-01');assert.equal(adult.internalHistory,false);assert.equal(cohort.memberStage(adult,'2026-11-01').label,'一般');assert.equal(cohort.memberStage({...adult,internalHistory:true},'2026-11-01').label,'OB・OG');const student=domain.memberInput({...base,cohortYear:2025},undefined,'2026-11-01');assert.equal(student.internalHistory,true);assert.equal(cohort.memberStage({...student,affiliation:'external'},'2030-01-01').label,'OB・OG');});

test('学年の補正は指定年度から進級し、過去年度は変えない',()=>{const m={stageMode:'cohort',cohortYear:2024,internalHistory:true,gradeOverrides:{'2026':2}};assert.equal(cohort.memberStage(m,'2025-11-01').label,'高2');assert.equal(cohort.memberStage(m,'2026-11-01').label,'高2');assert.equal(cohort.memberStage(m,'2027-11-01').label,'高3');assert.equal(cohort.memberStage(m,'2028-04-01').label,'OB・OG');});

test('一般・未設定への明示変更は過去の学年補正より優先',()=>{const m={stageMode:'general',cohortYear:null,internalHistory:false,gradeOverrides:{'2025':1}};assert.equal(cohort.memberStage(m,'2026-11-01').label,'一般');assert.equal(cohort.memberStage({...m,internalHistory:true},'2026-11-01').label,'OB・OG');assert.equal(cohort.memberStage({...m,stageMode:'unspecified'},'2026-11-01').label,'未設定');});

test('補正保存は以前の年度を維持し、旧クライアントの編集でも新情報を失わない',()=>{const old={id:'m',name:'ヤマダタロウ',group:'',status:'active',version:1,affiliation:'internal',stageMode:'cohort',cohortYear:2024,internalHistory:true,gradeOverrides:{'2025':1}};const next=domain.memberInput({name:old.name,group:'',status:'active',gradeOverride:'2'},old,'2026-11-01');assert.deepEqual(next.gradeOverrides,{'2025':1,'2026':2});assert.equal(next.internalHistory,true);assert.equal(next.cohortYear,2024);const auto=domain.memberInput({name:old.name,group:'',status:'active',gradeOverride:'auto'},{...old,gradeOverrides:next.gradeOverrides},'2026-11-01');assert.deepEqual(auto.gradeOverrides,{'2025':1});});

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

test('期生は1〜9999の整数かnullだけを受け付ける',()=>{
  const base={name:'アオキ',group:'',status:'active',hasTeamHistory:true};
  for(const generation of [1,34,9999])assert.equal(domain.memberInput({...base,generation}).generation,generation);
  for(const generation of [0,-1,10000,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'34','',false,[],{}])assert.throws(()=>domain.memberInput({...base,generation}),/期生/);
  assert.equal(domain.memberInput({...base,generation:null}).generation,null);
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
