import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {onAuthStateChanged,signInWithPopup,signOut,setPersistence,browserLocalPersistence,reauthenticateWithPopup,type User} from 'firebase/auth';
import {auth,provider,configured} from './firebase';
import {firebaseRequest,setUnlocked,membership,viewer as loadViewer,joinTeam} from './store';
import {hasDevicePin,setDevicePin,verifyDevicePin} from './pin';
import {installClientBackend} from '../lib/client-backend';
import TeamApp,{MemberForm} from '../app/team-app';
import {AccessContext,type AccessViewer} from '../app/access-context';
import '../app/globals.css';
import '../app/access.css';
import './style.css';

import {accessErrorMessage as message} from './errors';

function Gate(){
  const [user,setUser]=useState<User|null>(null),[viewer,setViewer]=useState<AccessViewer|null>(null);
  const [step,setStep]=useState('loading'),[phrase,setPhrase]=useState(''),[pin,setPin]=useState(''),[confirmPin,setConfirmPin]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[registering,setRegistering]=useState(false),[failures,setFailures]=useState(0);
  const freshLogin=useRef(false),active=useRef(false),sequence=useRef(0);
  const phase=useRef(step);phase.current=step;
  function lock(){active.current=false;setUnlocked(false);setPin('');setConfirmPin('');setFailures(0);setStep('unlock');}
  async function refresh(){const token=sequence.current,id=auth.currentUser?.uid;const v=await loadViewer();if(token!==sequence.current||id!==auth.currentUser?.uid)throw new Error('入場状態が変わりました。もう一度確認してください。');setViewer(v);}
  async function logout(){sequence.current++;active.current=false;setUnlocked(false);setViewer(null);setPhrase('');setPin('');freshLogin.current=false;await signOut(auth);setStep('phrase');}
  useEffect(()=>{
    if(!configured){setStep('configuration');return;}
    const unsubscribe=onAuthStateChanged(auth,current=>{
      const token=++sequence.current;active.current=false;setUnlocked(false);setUser(current);setError('');
      if(!current){setViewer(null);setStep('phrase');return;}
      setStep('loading');
      void (async()=>{try{
        const m=await membership();if(token!==sequence.current)return;
        if(!m){setStep('join');return;}
        if(!m.active)throw new Error('このアカウントは利用停止中です。保守担当に確認してください。');
        const v=await loadViewer();if(token!==sequence.current)return;setViewer(v);
        setStep(hasDevicePin(current.uid)?'unlock':freshLogin.current?'setupPin':'reauth');
      }catch(e){if(token===sequence.current){setError(message(e));setStep('error');}}})();
    });
    return()=>{sequence.current++;unsubscribe();active.current=false;setUnlocked(false);};
  },[]);
  useEffect(()=>{
    installClientBackend(async<T,>(url:string,method:string,body?:unknown)=>{
      if(phase.current==='join'&&url==='/api/members'&&method==='POST'){
        try{await joinTeam(phrase,body as Record<string,unknown>);const v=await loadViewer();setViewer(v);setPhrase('');return {member:{id:v.memberId}} as T;}
        catch(e){throw new Error(message(e));}
      }
      if(!active.current)throw new Error('4桁PINでロックを解除してください。');
      return firebaseRequest<T>(url,method,body);
    });
  },[phrase]);
  useEffect(()=>{
    const reset=(event:StorageEvent)=>{if(user&&event.key==='shuttle-note:device-pin:v1:'+user.uid&&phase.current==='ready')lock();};
    const expired=()=>{active.current=false;setUnlocked(false);setStep('error');setError('入場状態を確認してください。Googleで再ログインできます。');};
    window.addEventListener('storage',reset);window.addEventListener('access-expired',expired);
    return()=>{window.removeEventListener('storage',reset);window.removeEventListener('access-expired',expired);};
  },[user]);
  async function google(reauth=false){
    setBusy(true);setError('');
    try{
      if(reauth&&auth.currentUser){await reauthenticateWithPopup(auth.currentUser,provider);freshLogin.current=true;setPin('');setConfirmPin('');setStep('setupPin');}
      else{freshLogin.current=true;await setPersistence(auth,browserLocalPersistence);await signInWithPopup(auth,provider);}
    }catch(e){freshLogin.current=false;setError(message(e));}finally{setBusy(false);}
  }
  async function submitPin(e:React.FormEvent){
    e.preventDefault();if(!user||busy)return;setBusy(true);setError('');
    try{
      if(!/^\d{4}$/.test(pin))throw new Error('数字4桁で入力してください。');
      if(step==='setupPin'){
        if(!freshLogin.current)throw new Error('Googleで再認証してください。');
        if(pin!==confirmPin)throw new Error('確認用のPINが一致していません。');
        await setDevicePin(user.uid,pin);
      }else{
        if(failures>=5)throw new Error('Googleで再認証してPINを設定し直してください。');
        if(!await verifyDevicePin(user.uid,pin)){setFailures(n=>n+1);throw new Error('PINが違います。忘れた場合はGoogleで再設定できます。');}
      }
      await refresh();active.current=true;setUnlocked(true);setPin('');setConfirmPin('');setPhrase('');setStep('ready');freshLogin.current=false;
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  const accountControls=<div className="firebase-account"><span>{viewer?.name}</span><button className="text-button" onClick={()=>{if(confirm('未保存の入力は失われます。ロックしますか？'))lock();}}>ロック</button><button className="text-button" onClick={()=>{if(confirm('未保存の入力は失われます。ログアウトしますか？'))void logout().catch(e=>setError(message(e)));}}>ログアウト</button></div>;
  if(step==='ready'&&viewer)return <AccessContext.Provider value={{viewer,refresh,logout,recordRecovery:()=>{},controls:accountControls}}><TeamApp key={viewer.id}/></AccessContext.Provider>;
  const pinField=(label:string,value:string,change:(v:string)=>void)=><label>{label}<input className="access-pin" type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete="off" value={value} onChange={e=>change(e.target.value.replace(/[^0-9]/g,''))}/></label>;
  return <div className="access-shell"><div className="access-brand"><span className="access-brand-symbol" aria-hidden="true">↗</span><span>Shuttle Note<small>TEAM MATCH JOURNAL</small></span></div><div className="access-layout"><section className="access-intro"><div className="eyebrow">ONE TEAM. EVERY MATCH.</div><h1>一試合ずつ、<br/>チームの力に。</h1><p>現役も、卒業してからも。<br/>試合の記録と、自分だけの振り返りを。</p><div className="access-court" aria-hidden="true"><span/><i/></div></section><section className="access-card" aria-label="チームへの入場">
    <span className="access-step">YOUR TEAM, YOUR JOURNAL</span>
    {step==='loading'?<p role="status">入場情報を確認しています…</p>:step==='configuration'?<><h2>公開の準備中です</h2><p>チームの接続設定が済むと利用できます。記録はまだ送信されません。</p></>:step==='phrase'?<><h2>チームの記録へ、ようこそ。</h2><p className="access-description">部で共有された合言葉を入力してください。参加の確認はGoogleログイン後に行います。</p><form className="access-form" onSubmit={e=>{e.preventDefault();setError('');setStep('google');}}><label>部の合言葉<input type="password" required maxLength={200} autoComplete="off" value={phrase} onChange={e=>setPhrase(e.target.value)}/></label><button className="primary access-submit">次へ</button></form></>:step==='google'?<><h2>Googleで本人確認</h2><p className="access-description">卒業後も使う個人のGoogleアカウントを選んでください。</p><button className="primary access-submit" disabled={busy} onClick={()=>void google()}>Googleでログイン</button><button className="text-button" onClick={()=>setStep('phrase')}>合言葉の入力へ戻る</button></>:step==='join'?<><h2>自分の選手情報を登録</h2><p className="access-description">入力は初回だけ。名前は全角カタカナで登録します。登録後に、この端末の4桁PINを設定します。</p>{!phrase&&<label>部の合言葉<input type="password" maxLength={200} autoComplete="off" value={phrase} onChange={e=>setPhrase(e.target.value)}/></label>}<button className="primary access-submit" disabled={!phrase} onClick={()=>setRegistering(true)}>自分の情報を入力する</button>{registering&&<MemberForm member={null} onSaved={()=>{setRegistering(false);setStep(freshLogin.current?'setupPin':'reauth');}} onClose={()=>setRegistering(false)}/>}</>:step==='setupPin'||step==='unlock'?<><h2>{step==='setupPin'?'この端末の4桁PINを作成':'4桁PINでロック解除'}</h2><p className="access-description">{viewer?.name}さんの記録。PINはこの端末の簡易ロックです。</p><form className="access-form" onSubmit={submitPin}><fieldset disabled={busy||step==='unlock'&&failures>=5}>{pinField('4桁PIN',pin,setPin)}{step==='setupPin'&&pinField('もう一度入力',confirmPin,setConfirmPin)}</fieldset><button className="primary access-submit" disabled={busy||step==='unlock'&&failures>=5}>{busy?'確認しています…':step==='setupPin'?'PINを設定して利用開始':'ロックを解除'}</button></form>{step==='unlock'&&<button className="text-button firebase-reset" disabled={busy} onClick={()=>void google(true)}>PINを忘れた・変更する（Googleで確認）</button>}<p className="access-help">個人端末の画面ロックと併用してください。共用端末ではログアウトしてください。</p></>:step==='reauth'?<><h2>この端末を確認する</h2><p>Googleで再認証して、この端末のPINを設定してください。</p><button className="primary access-submit" disabled={busy} onClick={()=>void google(true)}>Googleで確認する</button></>:<><h2>入場を確認してください</h2><button className="primary access-submit" onClick={()=>void logout()}>ログイン画面へ戻る</button></>}
    {error&&<p className="access-error" role="alert">{error}</p>}{user&&step!=='loading'&&<button className="text-button firebase-reset" disabled={busy} onClick={()=>void logout()}>別のGoogleアカウントを使う・ログアウト</button>}
  </section></div><footer className="access-footer">SHUTTLE NOTE <span>記録が、次の一歩になる。</span></footer></div>;
}
const root=import.meta.hot?.data.root??createRoot(document.getElementById('root')!);
if(import.meta.hot)import.meta.hot.data.root=root;
root.render(<Gate/>);
