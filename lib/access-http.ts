import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {TeamError} from './team-domain';
import {accessStore,requireAccess,sessionToken,SESSION_COOKIE} from './access-store';

const headers={'Cache-Control':'no-store, private','Vary':'Cookie'};
const failure=(error:unknown)=>{
 if(error instanceof TeamError)return Response.json({error:error.message,...(error.code?{code:error.code}:{})},{status:error.status,headers});
 if(/UNIQUE constraint failed/.test(String(error)))return Response.json({error:'別の操作で登録済みになりました。再読み込みして確認してください。'},{status:409,headers});
 console.error('access-api',error);return Response.json({error:'ログインの保存先に接続できません。時間をおいてお試しください。'},{status:500,headers});
};
export async function setupAllowed(){
 const expected=env.ACCESS_SETUP_OWNER_EMAIL;if(!expected)return false;
 const user=await getChatGPTUser();return Boolean(user&&user.email.trim().toLocaleLowerCase()===expected.trim().toLocaleLowerCase());
}
function database(){if(!env.DB)throw new TeamError('保存先の準備ができていません。',503);return env.DB}
function store(){return accessStore(database(),env.ACCESS_PEPPER||'')}
function cookie(request:Request,token:string,clear=false){return SESSION_COOKIE+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(clear?'0':String(30*24*60*60))+(new URL(request.url).protocol==='https:'?'; Secure':'')}
async function readBody(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new TeamError('別のサイトからの操作は受け付けていません。',403);if(!request.headers.get('content-type')?.includes('application/json'))throw new TeamError('入力形式を確認してください。',415);const raw=await request.text();if(raw.length>8000)throw new TeamError('入力内容が長すぎます。',413);let body;try{body=JSON.parse(raw)}catch{throw new TeamError('入力内容を読み取れませんでした。')}if(!body||typeof body!=='object'||Array.isArray(body))throw new TeamError('入力内容を確認してください。');return body}
export async function accessStatus(request:Request){try{const access=store(),viewer=await access.resolveSession(sessionToken(request)),needsSetup=await access.needsSetup();return Response.json({authenticated:Boolean(viewer),needsSetup,setupAllowed:needsSetup&&await setupAllowed(),...(viewer?{viewer}:{})},{headers})}catch(error){return failure(error)}}
export async function initialMembers(){try{const access=store();if(!(await access.needsSetup())||!(await setupAllowed()))throw new TeamError('初期設定は管理担当だけが行えます。',403);return Response.json(await access.setupMembers(),{headers})}catch(error){return failure(error)}}
export async function administration(request:Request){try{return Response.json(await store().adminData(await requireAccess(request,database(),env.ACCESS_PEPPER||'')),{headers})}catch(error){return failure(error)}}
export async function accessAction(request:Request){try{
 const access=store(),body=await readBody(request);let result:any;
 if(['setup','login','register','recover'].includes(body.action)){
   // The global limits apply even when an address header is unavailable or forged.
   await access.throttle(request.headers.get('cf-connecting-ip')||'');
   if(body.action==='setup'){if(!(await setupAllowed()))throw new TeamError('初期設定は管理担当だけが行えます。',403);result=await access.setup(body)}
   else if(body.action==='login')result=await access.login(body);
   else if(body.action==='register')result=await access.register(body);
   else result=await access.recover(body);
 }else if(body.action==='logout'){result=await access.logout(sessionToken(request));return Response.json(result,{headers:{...headers,'Set-Cookie':cookie(request,'',true)}})}
 else{
   const viewer=await requireAccess(request,database(),env.ACCESS_PEPPER||'');
   await access.throttle('account:'+viewer.id);
   switch(body.action){
     case 'changePin':result=await access.changePin(viewer,body);break;
     case 'renewRecovery':result=await access.renewRecovery(viewer,body);break;
     case 'invite':result=await access.invite(viewer,body);break;
     case 'revokeInvite':result=await access.revokeInvite(viewer,body);break;
     case 'revokeAccount':result=await access.revokeAccount(viewer,body);break;
     case 'restoreAccount':result=await access.restoreAccount(viewer,body);break;
     case 'setRole':result=await access.setRole(viewer,body);break;
     case 'changePhrase':result=await access.changePhrase(viewer,body);break;
     default:throw new TeamError('操作を確認してください。');
   }
 }
 const {sessionToken:token,...data}=result;
 return Response.json(data,{headers:{...headers,...(token?{'Set-Cookie':cookie(request,token)}:{})}});
 }catch(error){return failure(error)}}
