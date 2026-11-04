import {env} from 'cloudflare:workers';
import {requireAccess} from './access-store';
import {TeamError} from './team-domain';
import {teamStore} from './team-store';
import type {Actor} from './team-store';
const responseHeaders={'Cache-Control':'no-store, private','Vary':'Cookie'};
export async function teamRequest(request:Request,action:(store:ReturnType<typeof teamStore>,actor:Actor,body:any)=>Promise<unknown>){try{
 if(!env.DB)throw new TeamError('保存先の準備ができていません。しばらくしてから再読み込みしてください。',503);
 const user=await requireAccess(request,env.DB,env.ACCESS_PEPPER||'');
 let body={};if(request.method!=='GET'){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new TeamError('別のサイトからの更新は受け付けていません。',403);if(!request.headers.get('content-type')?.includes('application/json'))throw new TeamError('入力形式を確認してください。',415);const raw=await request.text();if(raw.length>20000)throw new TeamError('入力内容が長すぎます。',413);try{body=JSON.parse(raw)}catch{throw new TeamError('入力内容を読み取れませんでした。')}if(!body||typeof body!=='object'||Array.isArray(body))throw new TeamError('入力内容を確認してください。');}
 return Response.json(await action(teamStore(env.DB),user,body),{headers:responseHeaders});
 }catch(error){if(error instanceof TeamError)return Response.json({error:error.message,...(error.code?{code:error.code}:{})},{status:error.status,headers:responseHeaders});const message=String(error);if(/UNIQUE constraint failed/.test(message))return Response.json({error:message.includes('team_members')?'同じ名前・所属のメンバーが登録されています。':'同じ日・選手・得点の試合が記録されています。別の試合であれば、確認して保存できます。',code:message.includes('team_members')?'duplicate_member':'duplicate_match'},{status:409,headers:responseHeaders});console.error('team-api',error);return Response.json({error:'保存先との通信に失敗しました。入力内容を残したまま、もう一度お試しください。'},{status:500,headers:responseHeaders});}
}
