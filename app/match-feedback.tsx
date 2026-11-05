"use client";

import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {FeedbackContext,MatchFeedback} from '../lib/feedback-store';
import {getClientBackend} from '../lib/client-backend';

type FeedbackResponse={feedback:MatchFeedback|null;context:FeedbackContext;archived:boolean;canCreate:boolean};
type JournalEntry={matchId:string;context:FeedbackContext;version:number;updatedAt:string;archived:boolean};
async function request<T>(url:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  const backend=getClientBackend();
  if(backend){signal?.throwIfAborted();const value=await backend<T>(url,method,body);signal?.throwIfAborted();return value;}
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',signal,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({error:'通信を確認して、もう一度お試しください。'})) as {error?:string};
  if(response.status===401)window.dispatchEvent(new Event('access-expired'));
  if(!response.ok)throw new Error(result.error||'振り返りを取得できませんでした。');
  return result as T;
}
function FeedbackDialog({title,close,busy=false,children}:{title:string;close:()=>void;busy?:boolean;children:React.ReactNode}){
  const dialog=useRef<HTMLDialogElement>(null),heading=useId();
  useEffect(()=>{dialog.current?.showModal();},[]);
  return <dialog ref={dialog} className="modal feedback-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(!busy)close();}}>
    <div className="modal-heading"><div><span className="eyebrow">MY MATCH JOURNAL</span><h2 id={heading}>{title}</h2></div><button className="icon-button" type="button" disabled={busy} onClick={close} aria-label="振り返りを閉じる">×</button></div>
    <p className="feedback-private">本人だけに表示・チームの共有メモには入りません</p>{children}
  </dialog>;
}
function MatchContext({context,archived=false}:{context:FeedbackContext;archived?:boolean}){
  return <div className="feedback-match-context"><div><time>{context.date.replaceAll('-','.')}</time><span>{context.category}</span><span>{context.discipline}</span>{archived&&<span>試合一覧から削除済み</span>}</div>{context.event&&<p>{context.event}</p>}<strong>{context.sideA.join('・')} <small>vs</small> {context.sideB.join('・')}</strong><p>{context.scores.map(score=>score.join('−')).join(' / ')}</p></div>;
}
export function MatchFeedbackModal({matchId,onClose,onSaved}:{matchId:string;onClose:()=>void;onSaved:(message:string)=>void}){
  const [record,setRecord]=useState<FeedbackResponse|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[deleteConfirm,setDeleteConfirm]=useState(false);
  const [goodPoints,setGoodPoints]=useState(''),[improvements,setImprovements]=useState(''),[nextAction,setNextAction]=useState('');
  const endpoint='/api/matches/'+encodeURIComponent(matchId)+'/feedback';
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try{const data=await request<FeedbackResponse>(endpoint,'GET',undefined,signal);setRecord(data);setGoodPoints(data.feedback?.goodPoints||'');setImprovements(data.feedback?.improvements||'');setNextAction(data.feedback?.nextAction||'');}
    catch(failure){if(!signal?.aborted)setError((failure as Error).message);}
    finally{if(!signal?.aborted)setLoading(false);}
  },[endpoint]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  const dirty=Boolean(record)&&(goodPoints!==(record?.feedback?.goodPoints||'')||improvements!==(record?.feedback?.improvements||'')||nextAction!==(record?.feedback?.nextAction||''));
  const close=()=>{if(busy)return;if(dirty&&!window.confirm('保存していない振り返りがあります。保存せずに閉じますか？'))return;onClose();};
  async function save(event:React.FormEvent){
    event.preventDefault();if(!record||loading||busy)return;setBusy(true);setError('');
    try{await request<FeedbackResponse>(endpoint,'PUT',{version:record.feedback?.version??0,goodPoints,improvements,nextAction});onSaved('自分の振り返りを保存しました。');}
    catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
  }
  async function remove(){
    if(!record?.feedback||busy)return;setBusy(true);setError('');
    try{await request(endpoint,'DELETE',{version:record.feedback.version});onSaved('自分の振り返りを削除しました。');}
    catch(failure){setError((failure as Error).message);setDeleteConfirm(false);}finally{setBusy(false);}
  }
  return <FeedbackDialog title="自分の振り返り" close={close} busy={busy}>
    {loading?<p className="feedback-loading" role="status">自分の振り返りを読み込んでいます…</p>:record?<>
      <MatchContext context={record.context} archived={record.archived}/>
      {record.archived&&<p className="form-hint">試合一覧から削除された後も、保存した自分の振り返りは残ります。</p>}
      <form onSubmit={save}><fieldset disabled={busy} className="form-body feedback-fields">
        <label>よかったこと<textarea rows={3} maxLength={2000} value={goodPoints} onChange={event=>setGoodPoints(event.target.value)} placeholder="できたプレーや、続けたいこと"/></label>
        <label>改善したいこと<textarea rows={3} maxLength={2000} value={improvements} onChange={event=>setImprovements(event.target.value)} placeholder="困った場面や、見直したいこと"/></label>
        <label>次に取り組むこと<textarea rows={3} maxLength={2000} value={nextAction} onChange={event=>setNextAction(event.target.value)} placeholder="次の練習や試合で意識すること"/></label>
      </fieldset>{error&&<p className="form-error" role="alert">{error}</p>}
        {deleteConfirm&&<div className="feedback-delete-confirm"><p>この振り返りを削除しますか？</p><button type="button" className="text-button" disabled={busy} onClick={()=>setDeleteConfirm(false)}>戻る</button><button type="button" className="text-button member-delete-button" disabled={busy} onClick={()=>void remove()}>削除を確定</button></div>}
        <div className="form-actions feedback-form-actions">{record.feedback&&!deleteConfirm&&<button type="button" className="text-button member-delete-button" disabled={busy} onClick={()=>setDeleteConfirm(true)}>振り返りを削除</button>}<button type="button" className="secondary" disabled={busy} onClick={close}>閉じる</button><button className="primary" type="submit" disabled={busy||![goodPoints,improvements,nextAction].some(value=>value.trim())}>{busy?'保存中…':'振り返りを保存'}</button></div>
      </form>
    </>:<>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary" type="button" onClick={()=>void load()}>再読み込み</button><button className="primary" type="button" onClick={onClose}>閉じる</button></div></>}
  </FeedbackDialog>;
}
export function FeedbackJournal({onClose,onSelect}:{onClose:()=>void;onSelect:(matchId:string)=>void}){
  const [hasMore,setHasMore]=useState(false),[loadingMore,setLoadingMore]=useState(false);
  const [entries,setEntries]=useState<JournalEntry[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const controller=new AbortController();setError('');setEntries(null);void request<{feedback:JournalEntry[];hasMore?:boolean}>('/api/feedback','GET',undefined,controller.signal).then(data=>{setEntries(data.feedback);setHasMore(Boolean(data.hasMore));}).catch(failure=>{if(!controller.signal.aborted)setError((failure as Error).message);});return()=>controller.abort();},[retry]);
  async function more(){setLoadingMore(true);try{const data=await request<{feedback:JournalEntry[];hasMore?:boolean}>('/api/feedback?more=1');setEntries(current=>[...(current||[]),...data.feedback.filter(entry=>!current?.some(old=>old.matchId===entry.matchId))]);setHasMore(Boolean(data.hasMore));}catch(e){setError((e as Error).message);}finally{setLoadingMore(false);}}
  return <FeedbackDialog title="自分の振り返り一覧" close={onClose}>
    {error?<><p className="form-error" role="alert">{error}</p><button type="button" className="secondary" onClick={()=>setRetry(value=>value+1)}>再読み込み</button></>:entries===null?<p className="feedback-loading" role="status">読み込んでいます…</p>:entries.length?<ul className="feedback-journal-list">{entries.map(entry=><li key={entry.matchId}><button type="button" className="feedback-journal-entry" onClick={()=>onSelect(entry.matchId)}><MatchContext context={entry.context} archived={entry.archived}/><span className="feedback-journal-open">振り返りを開く ↗</span></button></li>)}</ul>:<div className="feedback-empty"><h3>振り返りはまだありません</h3><p>出場した試合の「自分の振り返り」から書けます。<br/>保存した振り返りは、この一覧で読み返せます。</p></div>}
    {hasMore&&entries&&<button className="secondary" disabled={loadingMore} onClick={()=>void more()}>{loadingMore?'読み込み中…':'もっと見る'}</button>}
  </FeedbackDialog>;
}
