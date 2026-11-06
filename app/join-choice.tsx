import {useCallback,useEffect,useRef,useState} from 'react';
import {MemberForm} from './team-app';
import {membership,ownLinkRequest,prepareJoin,requestPlayerLink,type JoinPlayer,type LinkRequest} from '../firebase-web/store';
import {memberClassification,sortMembers} from '../lib/member-cohort';
import {normalizeMemberName} from '../lib/member-name';

type Mode='checking'|'verify'|'choose'|'existing'|'pending'|'rejected';
export default function JoinChoice({phrase,onPhraseChange,onJoined,userUid}:{phrase:string;onPhraseChange:(value:string)=>void;onJoined:()=>Promise<void>;userUid:string}){
  const [mode,setMode]=useState<Mode>('checking'),[players,setPlayers]=useState<JoinPlayer[]>([]),[link,setLink]=useState<LinkRequest|null>(null);
  const [targetId,setTargetId]=useState(''),[approverUid,setApproverUid]=useState(''),[targetQuery,setTargetQuery]=useState(''),[approverQuery,setApproverQuery]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[registering,setRegistering]=useState(false);
  const joined=useRef(onJoined);joined.current=onJoined;
  const currentPhrase=useRef(phrase);currentPhrase.current=phrase;
  const alive=useRef(true),checking=useRef(false);
  const check=useCallback(async()=>{
    if(checking.current)return;checking.current=true;
    try{const m=await membership();if(!alive.current)return;if(m?.active){await joined.current();return;}
      const r=await ownLinkRequest();if(!alive.current)return;setLink(r);setError('');
      if(r?.status==='pending'||r?.status==='rejected'){setMode(r.status);}
      else if(currentPhrase.current){try{const rows=await prepareJoin(currentPhrase.current);if(alive.current){setPlayers(sortMembers(rows));setMode('choose');}}catch(e){if(alive.current){setMode('verify');setError((e as {code?:string}).code==='permission-denied'?'合言葉が違うか、受付期限が切れています。確認して入力し直してください。':(e as Error).message);}}}
      else setMode('verify');
    }catch(e){if(alive.current)setError((e as Error).message);}finally{checking.current=false;}
  },[]);
  useEffect(()=>{alive.current=true;void check();return()=>{alive.current=false;};},[check]);
  useEffect(()=>{if(mode!=='pending')return;const refresh=()=>{if(document.visibilityState==='visible')void check();};const timer=setInterval(refresh,10000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[mode,check]);
  const report=(failure:unknown)=>setError((failure as {code?:string}).code==='permission-denied'?'合言葉の有効期限、選んだ選手、確認先の状態を確認してください。':(failure as Error).message);
  async function verify(event:React.FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{const rows=await prepareJoin(phrase);if(alive.current){setPlayers(sortMembers(rows));setMode('choose');}}catch(e){if(alive.current)report(e);}finally{if(alive.current)setBusy(false);}}
  async function send(){if(busy||!targetId||!approverUid)return;setBusy(true);setError('');try{await requestPlayerLink(targetId,approverUid);if(alive.current)await check();}catch(e){if(alive.current)report(e);}finally{if(alive.current)setBusy(false);}}
  const matches=(player:JoinPlayer,value:string)=>normalizeMemberName([player.name,player.group,memberClassification(player)].join(' ')).includes(normalizeMemberName(value));
  const available=players.filter(p=>p.ownerUid===null),approvers=players.filter(p=>p.ownerUid&&p.ownerUid!==userUid);
  const target=players.find(p=>p.id===targetId),approver=players.find(p=>p.ownerUid===approverUid);
  return <div className="join-choice">
    {mode==='checking'?<><p role="status">参加登録を確認しています…</p>{error&&<button type="button" className="secondary" onClick={()=>void check()}>再確認</button>}</>:mode==='verify'?<><h2>自分の選手情報を登録</h2><p className="access-description">名簿に自分がいる場合は、その選手情報とアカウントを結び付けられます。</p><form className="access-form" onSubmit={verify}><label>部の合言葉<input type="password" required maxLength={200} autoComplete="off" value={phrase} onChange={e=>onPhraseChange(e.target.value)}/></label><button className="primary access-submit" disabled={busy}>{busy?'確認中…':'合言葉を確認して次へ'}</button></form></>:mode==='choose'?<><h2>登録方法を選ぶ</h2><p className="access-description">すでに名簿に名前がある場合は、重ねて登録せず下の方法を選んでください。</p><button className="primary access-submit" onClick={()=>setRegistering(true)}>新しく自分を登録する</button><button className="secondary access-submit" onClick={()=>setMode('existing')}>名簿にある自分と結び付ける</button></>:mode==='existing'?<><h2>名簿の自分を選ぶ</h2><p className="access-description">選んだ名前が本人のものか、知っている参加者1人に確認をお願いします。連携済みの選手は選べません。</p>
      <fieldset disabled={busy} className="join-fields"><label>自分の名前を検索<input type="search" value={targetQuery} onChange={e=>setTargetQuery(e.target.value)} placeholder="名前で検索"/></label>
      <ul className="join-player-list">{available.filter(p=>matches(p,targetQuery)).map(p=><li key={p.id}><button type="button" className={targetId===p.id?'is-selected':''} aria-pressed={targetId===p.id} onClick={()=>setTargetId(p.id)}><strong>{p.name}</strong><small>{memberClassification(p)}{p.group?'・'+p.group:''}</small></button></li>)}</ul>{!available.filter(p=>matches(p,targetQuery)).length&&<p className="form-hint">選べる選手がいません。新規登録が必要か、連携済みでないか確認してください。</p>}
      {target&&<><p className="join-selected">選択した選手：<strong>{target.name}</strong></p><label>確認をお願いする参加者を検索<input type="search" value={approverQuery} onChange={e=>setApproverQuery(e.target.value)} placeholder="あなたを知っている参加者"/></label><ul className="join-player-list">{approvers.filter(p=>matches(p,approverQuery)).map(p=><li key={p.id}><button type="button" className={approverUid===p.ownerUid?'is-selected':''} aria-pressed={approverUid===p.ownerUid} onClick={()=>setApproverUid(p.ownerUid!)}><strong>{p.name}</strong><small>{memberClassification(p)}</small></button></li>)}</ul>{!approvers.length&&<p className="form-hint">確認できる参加者がまだいません。先に利用している部員に相談してください。</p>}{approver&&<p className="join-selected">確認先：<strong>{approver.name}</strong></p>}<button type="button" className="primary access-submit" disabled={!approverUid} onClick={()=>void send()}>{busy?'送信中…':'この人に本人確認をお願いする'}</button></>}
      <button type="button" className="text-button" onClick={()=>{setMode('choose');setError('');}}>登録方法の選択に戻る</button></fieldset></>:mode==='pending'?<><h2>本人確認を待っています</h2><p className="access-description">「{link?.playerName}」との紐づけを、指名した参加者に依頼しました。その人のアプリから確認できます。</p><p className="join-selected">確認番号：<strong>{userUid.slice(0,8)}</strong></p><p className="form-hint">確認先の人に、この番号と自分の名前を伝えてください。承認されると自動で次へ進みます。</p><button className="secondary access-submit" onClick={()=>void check()}>承認状況を確認する</button></>:<><h2>紐づけは承認されませんでした</h2><p className="access-description">選んだ名簿が自分のものか、確認をお願いした人と直接確認してください。別の人への頼み直しはできません。</p></>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    {(mode==='choose'||mode==='existing')&&<button type="button" disabled={busy} className="text-button" onClick={()=>{setMode('verify');setTargetId('');setApproverUid('');setPlayers([]);setError('');}}>合言葉の確認に戻る</button>}
    {registering&&<MemberForm member={null} onSaved={()=>{setRegistering(false);void joined.current().catch(e=>setError((e as Error).message));}} onClose={()=>setRegistering(false)}/>}
  </div>;
}
