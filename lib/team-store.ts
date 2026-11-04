import {TeamError,memberInput,matchInput,fingerprint,version,normal} from './team-domain';
import type {Member} from './team-domain';
import {normalizeMemberName} from './member-name';
import {japanDate,schoolYear,memberSnapshot} from './member-cohort';
import type {MemberSnapshot} from './member-cohort';
export type Actor={id:string;name:string;memberId?:string|null;role?:'admin'|'member';loginId?:string};
const memberFrom=(r:any):Member=>({id:r.id,name:r.name,group:r.group_name,status:r.status,version:r.version,affiliation:r.affiliation||'unspecified',stageMode:r.stage_mode||'unspecified',cohortYear:r.cohort_year??null,internalHistory:Boolean(r.internal_history),generation:r.generation??null,gradeOverrides:JSON.parse(r.grade_overrides||'{}'),deletedAt:r.deleted_at??null});
const matchFrom=(r:any)=>({...JSON.parse(r.payload),id:r.id,version:r.version,createdByName:r.created_by_name,createdAt:r.created_at,updatedAt:r.updated_at});
export function teamStore(db:D1Database){
  async function allMembers(){const {results}=await db.prepare('SELECT * FROM team_members ORDER BY created_at,id').all();return results.map(memberFrom)}
  async function bootstrap(actor:Actor){const [members,rows]=await Promise.all([allMembers(),db.prepare('SELECT * FROM team_matches WHERE deleted_at IS NULL ORDER BY match_date DESC,created_at DESC').all()]);return {members,matches:rows.results.map(matchFrom),viewer:{id:actor.id,name:actor.name,memberId:actor.memberId??null,role:actor.role??'member',loginId:actor.loginId??''},updatedAt:new Date().toISOString(),today:japanDate(),currentSchoolYear:schoolYear()};}
  async function writeMember(body:any,id?:string){
    const existing=await allMembers();
    const previous=id?existing.find(member=>member.id===id):undefined;
    if(id&&!previous)throw new TeamError('この選手は見つかりません。再読み込みしてください。',404);
    if(previous?.deletedAt)throw new TeamError('削除済みの選手です。編集するには先に復元してください。',409);
    const input=memberInput(body,previous),now=new Date().toISOString();
    // Also check legacy hiragana/spaced names without silently renaming existing records.
    if(existing.some(m=>!m.deletedAt&&m.id!==id&&normalizeMemberName(m.name)===input.name&&normal(m.group)===normal(input.group)))throw new TeamError('同じ名前・所属のメンバーが登録されています。',409);
    if(id){const v=version(body.version);const result=await db.prepare('UPDATE team_members SET name=?,group_name=?,status=?,name_key=?,affiliation=?,stage_mode=?,cohort_year=?,internal_history=?,generation=?,grade_overrides=?,version=version+1,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL').bind(input.name,input.group,input.status,input.nameKey,input.affiliation,input.stageMode,input.cohortYear,input.internalHistory?1:0,input.generation,JSON.stringify(input.gradeOverrides),now,id,v).run();if(result.meta.changes===0)throw new TeamError('このメンバーは別の人が更新しました。再読み込みして確認してください。',409);}else{id=crypto.randomUUID();await db.prepare('INSERT INTO team_members (id,name,group_name,status,name_key,affiliation,stage_mode,cohort_year,internal_history,generation,grade_overrides,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,input.name,input.group,input.status,input.nameKey,input.affiliation,input.stageMode,input.cohortYear,input.internalHistory?1:0,input.generation,JSON.stringify(input.gradeOverrides),now,now).run();}
    const row=await db.prepare('SELECT * FROM team_members WHERE id=?').bind(id).first();return {member:memberFrom(row)};
  }
  async function deleteMember(id:string,body:any){
    const now=new Date().toISOString();
    const result=await db.prepare('UPDATE team_members SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL').bind(now,now,id,version(body.version)).run();
    if(result.meta.changes===0)throw new TeamError('別の人が更新または削除しました。再読み込みして確認してください。',409);
    return {ok:true};
  }
  async function restoreMember(id:string,body:any){
    const expected=version(body.version),members=await allMembers(),member=members.find(member=>member.id===id);
    if(!member)throw new TeamError('この選手は見つかりません。',404);
    if(!member.deletedAt||member.version!==expected)throw new TeamError('この選手は別の人が更新または復元しました。再読み込みしてください。',409);
    if(members.some(other=>other.id!==id&&!other.deletedAt&&normalizeMemberName(other.name)===normalizeMemberName(member.name)&&normal(other.group)===normal(member.group)))throw new TeamError('同じ名前・所属の選手がすでに登録されています。現在の登録を確認してから復元してください。',409);
    const result=await db.prepare('UPDATE team_members SET deleted_at=NULL,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NOT NULL').bind(new Date().toISOString(),id,expected).run();
    if(result.meta.changes===0)throw new TeamError('この選手は別の人が更新または復元しました。再読み込みしてください。',409);
    return {member:memberFrom(await db.prepare('SELECT * FROM team_members WHERE id=?').bind(id).first())};
  }
  async function writeMatch(body:any,actor:Actor,id?:string){
    const old=id?await db.prepare('SELECT * FROM team_matches WHERE id=? AND deleted_at IS NULL').bind(id).first<any>():null;
    if(id&&!old)throw new TeamError('この試合は削除されたか、見つかりません。',404);
    if(!id&&(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.id)))throw new TeamError('保存用IDを作成できませんでした。もう一度お試しください。');
    const existingPost=!id?await db.prepare('SELECT * FROM team_matches WHERE id=?').bind(body.id).first<any>():null;
    const members=await allMembers(),oldPayload=old?JSON.parse(old.payload):undefined;
    const input=matchInput(body,members,oldPayload||(existingPost?JSON.parse(existingPost.payload):undefined));
    const now=new Date().toISOString(),submittedPayload=JSON.stringify(input);
    // Resolve retries before searching for a different, explicitly permitted rematch.
    if(!id){
      const existing=existingPost;
      if(existing){
        const stored=JSON.parse(existing.payload);delete stored.format;delete stored.memberSnapshots;
        if(!existing.deleted_at&&JSON.stringify(stored)===submittedPayload)return {match:matchFrom(existing)};
        throw new TeamError('この保存IDの内容はすでに保存されています。閉じて試合一覧を確認してください。',409);
      }
    }
    // Explicit repeated practice matches retain their own occurrence when edited.
    const separate=body.allowDuplicate===true||old?.fingerprint.includes('\noccurrence:');
    const baseKey=fingerprint(input),key=baseKey+(separate?'\noccurrence:'+(id||body.id):'');
    // Legacy payloads included a first-to format. Compare semantic scores too, without rewriting history.
    if(!separate&&(!old||fingerprint(JSON.parse(old.payload))!==baseKey)){
      const {results}=await db.prepare('SELECT id,payload FROM team_matches WHERE match_date=? AND deleted_at IS NULL').bind(input.date).all<any>();
      if(results.some(row=>row.id!==(id||body.id)&&fingerprint(JSON.parse(row.payload))===baseKey))throw new TeamError('同じ日・選手・得点の試合が記録されています。別の試合であれば、確認して保存できます。',409,'duplicate_match');
    }
    // Freeze labels for the match date; do not invent missing history on legacy memo edits.
    const memberSnapshots:Record<string,MemberSnapshot>={};
    for(const memberId of [...input.sideAIds,...input.sideBIds]){
      const wasParticipant=oldPayload&&[...oldPayload.sideAIds,...oldPayload.sideBIds].includes(memberId);
      if(oldPayload&&oldPayload.date===input.date&&wasParticipant){
        if(oldPayload.memberSnapshots?.[memberId])memberSnapshots[memberId]=oldPayload.memberSnapshots[memberId];
      }else{
        const member=members.find(member=>member.id===memberId)!;
        memberSnapshots[memberId]=memberSnapshot(member,input.date);
      }
    }
    const payload=JSON.stringify({...input,...(Object.keys(memberSnapshots).length?{memberSnapshots}:{})});
    if(id){
      const result=await db.prepare('UPDATE team_matches SET match_date=?,payload=?,fingerprint=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL')
        .bind(input.date,payload,key,actor.id,now,id,version(body.version)).run();
      if(result.meta.changes===0)throw new TeamError('この試合は別の人が更新しました。再読み込みして確認してください。',409);
    }else{
      id=body.id;
      await db.prepare('INSERT INTO team_matches (id,match_date,payload,fingerprint,created_by,created_by_name,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(id,input.date,payload,key,actor.id,actor.name,actor.id,now,now).run();
    }
    return {match:matchFrom(await db.prepare('SELECT * FROM team_matches WHERE id=?').bind(id).first())};
  }
  async function deleteMatch(id:string,body:any,actor:Actor){const now=new Date().toISOString();const result=await db.prepare('UPDATE team_matches SET deleted_at=?,updated_at=?,updated_by=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL').bind(now,now,actor.id,id,version(body.version)).run();if(result.meta.changes===0)throw new TeamError('別の人が更新または削除しました。再読み込みしてください。',409);return {ok:true};}
  return {bootstrap,writeMember,deleteMember,restoreMember,writeMatch,deleteMatch};
}
