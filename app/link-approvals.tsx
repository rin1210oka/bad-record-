import {useCallback,useEffect,useRef,useState} from 'react';
import {clientRequest} from '../lib/client-backend';
type PendingRequest={uid:string;playerName:string};
export default function LinkApprovals(){
  const [requests,setRequests]=useState<PendingRequest[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null);
  const mounted=useRef(true);
  const load=useCallback(async()=>{try{const data=await clientRequest<{requests:PendingRequest[]}>('/api/link-requests');if(mounted.current){setRequests(data.requests);setError('');}}catch(e){if(mounted.current)setError((e as Error).message);}},[]);
  useEffect(()=>{mounted.current=true;void load();const refresh=()=>{if(document.visibilityState==='visible')void load();};const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',refresh);};},[load]);
  async function decide(item:PendingRequest,approve:boolean){if(busy)return;if(!confirm(approve?item.playerName+'さん本人からの依頼であることを、名前と確認番号で直接確認しましたか？':item.playerName+'さんの紐づけを承認せず終了しますか？'))return;setBusy(item.uid);setError('');try{await clientRequest('/api/link-requests/'+encodeURIComponent(item.uid),'POST',{approve});if(mounted.current)await load();}catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setBusy(null);}}
  if(!requests.length&&!error)return null;
  return <section className="link-approvals" aria-label="あなたへの本人確認依頼"><h2>あなたへの本人確認依頼</h2>{error&&<p className="form-error" role="alert">{error}<button type="button" className="text-button" onClick={()=>void load()}>再確認</button></p>}{requests.length>0&&<p>申請者本人に名前と確認番号を直接確認してから、承認してください。</p>}{requests.map(item=><article key={item.uid}><div><strong>{item.playerName}</strong><small>確認番号：{item.uid.slice(0,8)}</small></div><div className="link-approval-actions"><button type="button" className="secondary" disabled={busy!==null} onClick={()=>void decide(item,false)}>承認しない</button><button type="button" className="primary" disabled={busy!==null} onClick={()=>void decide(item,true)}>{busy===item.uid?'処理中…':'本人と確認して承認'}</button></div></article>)}</section>;
}
