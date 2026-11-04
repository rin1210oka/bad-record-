import {env} from 'cloudflare:workers';
import {requireAccess} from './access-store';
import {TeamError} from './team-domain';
import {feedbackStore} from './feedback-store';
import type {FeedbackActor} from './feedback-store';

export async function feedbackRequest(request:Request,action:(store:ReturnType<typeof feedbackStore>,actor:FeedbackActor,body:any)=>Promise<unknown>){
  try{
    if(!env.DB)throw new TeamError('保存先の準備ができていません。',503);
    const pepper=(env as unknown as Record<string,string>).ACCESS_PEPPER;
    if(!pepper)throw new TeamError('入場の準備ができていません。管理担当に確認してください。',503);
    const actor=await requireAccess(request,env.DB,pepper);
    let body:any={};
    if(request.method!=='GET'){
      const origin=request.headers.get('origin');
      if(origin!==new URL(request.url).origin)throw new TeamError('この画面からもう一度操作してください。',403);
      if(!request.headers.get('content-type')?.includes('application/json'))throw new TeamError('入力形式を確認してください。',415);
      const raw=await request.text();
      if(new TextEncoder().encode(raw).byteLength>30000)throw new TeamError('入力内容が長すぎます。',413);
      try{body=JSON.parse(raw);}catch{throw new TeamError('入力内容を読み取れませんでした。');}
      if(!body||typeof body!=='object'||Array.isArray(body))throw new TeamError('入力内容を確認してください。');
    }
    return Response.json(await action(feedbackStore(env.DB),actor,body),{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    if(error instanceof TeamError)return Response.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});
    console.error('feedback-api failed');
    return Response.json({error:'振り返りを保存先から取得できませんでした。入力を残したまま、もう一度お試しください。'},{status:500,headers:{'Cache-Control':'no-store'}});
  }
}
