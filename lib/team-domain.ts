import {normalizeMemberName,memberNameError} from './member-name';
import {japanDate,schoolYear,memberStage} from './member-cohort';
import type {CohortFields,MemberSnapshot} from './member-cohort';
export class TeamError extends Error { constructor(message:string,public status=400,public code?:string){super(message)} }
export type Member={id:string;name:string;group:string;status:'active'|'inactive';version:number;deletedAt?:string|null}&CohortFields;
export type MatchInput={date:string;category:'公式戦'|'練習試合'|'ゲーム練';event:string;discipline:'シングルス'|'ダブルス';opponentType:'internal'|'external';sideAIds:string[];sideBIds:string[];opponents:string[];scores:number[][];memo:string;memberSnapshots?:Record<string,MemberSnapshot>};
export function text(value:unknown,max:number,label:string,required=false){if(typeof value!=='string'){if(!required&&value==null)return '';throw new TeamError(`${label}を入力してください。`)}const clean=value.trim();if(required&&!clean||clean.length>max)throw new TeamError(`${label}は${required?'1〜':''}${max}文字で入力してください。`);return clean;}
export function normal(value:string){return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g,' ').trim()}
export function memberInput(body:any,previous?:Member,date=japanDate()){
  if(typeof body.name!=='string')throw new TeamError('選手名を入力してください。');
  const name=normalizeMemberName(body.name),error=memberNameError(name);
  if(error)throw new TeamError(error);
  const group=text(body.group,60,'所属先・備考');
  if(!['active','inactive'].includes(body.status))throw new TeamError('在籍状態を選択してください。');
  const hasHistoryChoice=body.hasTeamHistory!==undefined;
  if(hasHistoryChoice&&typeof body.hasTeamHistory!=='boolean')throw new TeamError('この部への所属経験を「はい」「いいえ」から選択してください。');
  const affiliation=hasHistoryChoice?(body.hasTeamHistory?'internal':'external'):body.affiliation??previous?.affiliation??'unspecified';
  if(!['internal','external','unspecified'].includes(affiliation))throw new TeamError('所属ラベルを選択してください。');
  const generation=body.generation===undefined?previous?.generation??null:body.generation;
  if(generation!==null&&(!Number.isSafeInteger(generation)||generation<1||generation>9999))throw new TeamError('期生は1〜9999の整数で入力してください。');
  const stageMode=body.stageMode??previous?.stageMode??'unspecified';
  if(!['cohort','general','unspecified'].includes(stageMode))throw new TeamError('学年の管理方法を選択してください。');
  let cohortYear=body.cohortYear===undefined?previous?.cohortYear??null:body.cohortYear;
  if(cohortYear!==null&&(!Number.isInteger(cohortYear)||cohortYear<1900||cohortYear>schoolYear(date)+20))throw new TeamError('高校入学の基準年度を正しく入力してください。');
  if(stageMode==='cohort'&&cohortYear===null)throw new TeamError('学年の自動計算には高校入学の基準年度が必要です。');
  if(stageMode!=='cohort')cohortYear=null;
  const gradeOverrides={...previous?.gradeOverrides};
  if(body.gradeOverride!==undefined){
    const value=String(body.gradeOverride),year=String(schoolYear(date));
    if(value==='auto')delete gradeOverrides[year];
    else if(value==='general')gradeOverrides[year]='general';
    else if(['1','2','3'].includes(value))gradeOverrides[year]=Number(value) as 1|2|3;
    else throw new TeamError('学年の補正を選択してください。');
  }
  let internalHistory=previous?.internalHistory??false;
  if(hasHistoryChoice)internalHistory=body.hasTeamHistory;
  else if(body.internalHistory!==undefined){if(typeof body.internalHistory!=='boolean')throw new TeamError('内部在籍歴を確認してください。');internalHistory=body.internalHistory;}
  else if(!previous)internalHistory=affiliation==='internal'&&memberStage({stageMode,cohortYear,gradeOverrides},date).grade!==null;
  return {name,group,status:body.status,affiliation,stageMode,cohortYear,internalHistory,generation,gradeOverrides,nameKey:JSON.stringify([normal(name),normal(group)])};
}
export function validGame(a:number,b:number){return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>=0&&b>=0;}
export function validateScores(scores:unknown):number[][]{
  if(!Array.isArray(scores)||scores.length<1)throw new TeamError('1セット以上の得点を入力してください。');
  for(const score of scores){
    if(!Array.isArray(score)||score.length!==2||!validGame(score[0],score[1]))throw new TeamError('各セットの両側の得点を、0以上の整数で入力してください。');
  }
  return scores;
}
export function matchInput(body:any, members:Member[], previous?:MatchInput):MatchInput {
  const date=text(body.date,10,'試合日',true);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new TeamError('正しい試合日を入力してください。');
  if(!['公式戦','練習試合','ゲーム練'].includes(body.category))throw new TeamError('試合区分を選択してください。');
  if(!['シングルス','ダブルス'].includes(body.discipline))throw new TeamError('種目を選択してください。');
  if(!['internal','external'].includes(body.opponentType))throw new TeamError('対戦相手の種類を選択してください。');
  const count=body.discipline==='シングルス'?1:2;
  function ids(value:unknown,required:boolean){if(!required)return [];if(!Array.isArray(value)||value.length!==count||value.some(id=>typeof id!=='string')||new Set(value).size!==count)throw new TeamError(`出場選手を${count}人選択してください。`);for(const id of value){const m=members.find(m=>m.id===id);if(!m)throw new TeamError('登録されていない選手が選択されています。');const wasParticipant=[...(previous?.sideAIds||[]),...(previous?.sideBIds||[])].includes(id);if(m.deletedAt&&!wasParticipant)throw new TeamError('削除済みの選手は新しい試合に登録できません。先に選手を復元してください。');if(m.status!=='active'&&!wasParticipant)throw new TeamError('休止中の選手は新しい試合に登録できません。');}return value as string[];}
  const sideAIds=ids(body.sideAIds,true),sideBIds=ids(body.sideBIds,body.opponentType==='internal');
  if(sideAIds.some(id=>sideBIds.includes(id)))throw new TeamError('同じ選手を両側に登録することはできません。');
  let opponents:string[]=[];if(body.opponentType==='external'){if(!Array.isArray(body.opponents)||body.opponents.length!==count)throw new TeamError(`対戦相手を${count}人入力してください。`);opponents=body.opponents.map((v:unknown)=>text(v,60,'対戦相手',true));}
  return {date,category:body.category,event:text(body.event,100,'大会名・対戦校'),discipline:body.discipline,opponentType:body.opponentType,sideAIds,sideBIds,opponents,scores:validateScores(body.scores),memo:text(body.memo,1500,'メモ')};
}
export function fingerprint(m:MatchInput){const a=[...m.sideAIds].sort().join('|'),b=m.opponentType==='internal'?[...m.sideBIds].sort().join('|'):m.opponents.map(normal).sort().join('|');const flip=m.opponentType==='internal'&&a>b;return JSON.stringify([m.date,m.category,normal(m.event),m.discipline,m.opponentType,flip?b:a,flip?a:b,m.scores.map(s=>flip?[s[1],s[0]]:s)]);}
export function version(value:unknown){if(!Number.isInteger(value)||Number(value)<1)throw new TeamError('最新の記録を読み込み直してください。',409);return value as number;}
