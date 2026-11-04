import {TeamError} from './team-domain';

export type FeedbackActor = {id:string;memberId:string|null};
export type FeedbackContext = {date:string;category:string;event:string;discipline:string;sideA:string[];sideB:string[];scores:number[][]};
export type MatchFeedback = {matchId:string;goodPoints:string;improvements:string;nextAction:string;version:number;createdAt:string;updatedAt:string};
const fromRow=(row:any):MatchFeedback=>({matchId:row.match_id,goodPoints:row.good_points,improvements:row.improvements,nextAction:row.next_action,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
function noteText(value:unknown,label:string){if(typeof value!=='string'||value.length>2000)throw new TeamError(`${label}は2000文字以内で入力してください。`);return value.trim();}
function expectedVersion(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<0)throw new TeamError('振り返りを読み込み直してから保存してください。');return Number(value);}

export function feedbackStore(db:D1Database){
  const ownRow=(matchId:string,actor:FeedbackActor)=>db.prepare('SELECT * FROM team_match_feedback WHERE owner_id=? AND match_id=?').bind(actor.id,matchId).first<any>();
  async function matchRow(matchId:string){return db.prepare('SELECT * FROM team_matches WHERE id=?').bind(matchId).first<any>();}
  function participates(row:any,actor:FeedbackActor){if(!row||row.deleted_at||!actor.memberId)return false;const payload=JSON.parse(row.payload);return [...(payload.sideAIds||[]),...(payload.sideBIds||[])].includes(actor.memberId);}
  async function contextOf(row:any):Promise<FeedbackContext>{
    const payload=JSON.parse(row.payload),{results}=await db.prepare('SELECT id,name FROM team_members').all<any>();
    const nameOf=(id:string)=>results.find(member=>member.id===id)?.name||'登録済みの選手';
    return {date:payload.date,category:payload.category,event:payload.event||'',discipline:payload.discipline,sideA:payload.sideAIds.map(nameOf),sideB:payload.opponentType==='internal'?payload.sideBIds.map(nameOf):payload.opponents,scores:payload.scores};
  }
  async function get(matchId:string,actor:FeedbackActor){
    const [saved,match]=await Promise.all([ownRow(matchId,actor),matchRow(matchId)]);
    if(saved)return {feedback:fromRow(saved),context:JSON.parse(saved.match_context) as FeedbackContext,archived:!match||Boolean(match.deleted_at),canCreate:false};
    if(!participates(match,actor))throw new TeamError('この試合に出場した本人だけが、自分の振り返りを書けます。',403);
    return {feedback:null,context:await contextOf(match),archived:false,canCreate:true};
  }
  async function save(matchId:string,actor:FeedbackActor,body:any){
    const goodPoints=noteText(body.goodPoints,'よかったこと'),improvements=noteText(body.improvements,'改善したいこと'),nextAction=noteText(body.nextAction,'次に取り組むこと'),version=expectedVersion(body.version);
    if(!goodPoints&&!improvements&&!nextAction)throw new TeamError('いずれかの欄に振り返りを入力してください。');
    const previous=await ownRow(matchId,actor),now=new Date().toISOString();
    if(previous){
      const updated=await db.prepare('UPDATE team_match_feedback SET good_points=?,improvements=?,next_action=?,version=version+1,updated_at=? WHERE owner_id=? AND match_id=? AND version=?').bind(goodPoints,improvements,nextAction,now,actor.id,matchId,version).run();
      if(updated.meta.changes===0)throw new TeamError('別の画面で振り返りが更新されました。入力を控えてから読み込み直してください。',409);
    }else{
      const match=await matchRow(matchId);
      if(!participates(match,actor))throw new TeamError('この試合に出場した本人だけが、自分の振り返りを書けます。',403);
      if(version!==0)throw new TeamError('振り返りが変更されています。入力を控えてから読み込み直してください。',409);
      const result=await db.prepare('INSERT INTO team_match_feedback (owner_id,match_id,owner_member_id,match_context,good_points,improvements,next_action,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?) ON CONFLICT(owner_id,match_id) DO NOTHING').bind(actor.id,matchId,actor.memberId,JSON.stringify(await contextOf(match)),goodPoints,improvements,nextAction,now,now).run();
      if(result.meta.changes===0)throw new TeamError('別の画面で振り返りが保存されました。入力を控えてから読み込み直してください。',409);
    }
    return get(matchId,actor);
  }
  async function remove(matchId:string,actor:FeedbackActor,body:any){
    const version=expectedVersion(body.version);
    const result=await db.prepare('DELETE FROM team_match_feedback WHERE owner_id=? AND match_id=? AND version=?').bind(actor.id,matchId,version).run();
    if(result.meta.changes===0)throw new TeamError('振り返りが変更または削除されています。読み込み直して確認してください。',409);
    return {ok:true};
  }
  async function list(actor:FeedbackActor){
    const {results}=await db.prepare('SELECT f.match_id,f.match_context,f.version,f.updated_at,m.deleted_at,m.id AS existing_match_id FROM team_match_feedback f LEFT JOIN team_matches m ON m.id=f.match_id WHERE f.owner_id=? ORDER BY f.updated_at DESC,f.match_id').bind(actor.id).all<any>();
    return {feedback:results.map(row=>({matchId:row.match_id,context:JSON.parse(row.match_context) as FeedbackContext,version:row.version,updatedAt:row.updated_at,archived:!row.existing_match_id||Boolean(row.deleted_at)}))};
  }
  return {get,save,remove,list};
}
