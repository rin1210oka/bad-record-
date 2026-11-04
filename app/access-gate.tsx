"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import TeamApp from './team-app';
import { AccessContext, accessRequest } from './access-context';
import type { AccessState, AccessViewer } from './access-context';
import { PinField } from './access-fields';
import './access.css';

type Mode = 'login' | 'register' | 'recover' | 'setup';
type SetupMember = { id: string; name: string; group: string };
type EntryResult = { viewer: AccessViewer; recoveryCode?: string };

export function RecoveryRecord({ result, onContinue }: { result: EntryResult & { recoveryCode: string }; onContinue: () => void }) {
  const [recorded, setRecorded] = useState(false);
  return <section className="access-recovery-record" aria-labelledby="recovery-record-title">
    <span className="access-step">REGISTRATION COMPLETE</span><h2 id="recovery-record-title">復旧コードを控えてください</h2>
    <p>6桁の番号を忘れたときや、入力を間違えて入場できなくなったときに使います。この画面を閉じると、同じコードは表示できません。</p>
    <dl className="access-identity"><div><dt>ログイン名</dt><dd>{result.viewer.loginId}</dd></div><div><dt>選手・利用者</dt><dd>{result.viewer.name}</dd></div></dl>
    <label className="access-code-label">復旧コード<input value={result.recoveryCode} readOnly aria-label="復旧コード" onFocus={event => event.currentTarget.select()} autoComplete="off" spellCheck={false} /></label>
    <p className="access-help">自分だけが見られる場所に保管してください。復旧に使うと新しいコードに切り替わります。</p>
    <label className="access-checkbox"><input type="checkbox" checked={recorded} onChange={event => setRecorded(event.target.checked)} /><span>ログイン名と復旧コードを控えました</span></label>
    <button type="button" className="primary access-submit" disabled={!recorded} onClick={onContinue}>チームの記録へ</button>
  </section>;
}

export default function AccessGate() {
  const [state, setState] = useState<AccessState | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('login'), [busy, setBusy] = useState(false);
  const [loginId, setLoginId] = useState(''), [pin, setPin] = useState(''), [confirmation, setConfirmation] = useState(''), [teamPhrase, setTeamPhrase] = useState('');
  const [inviteCode, setInviteCode] = useState(''), [recoveryCode, setRecoveryCode] = useState('');
  const [setupMembers, setSetupMembers] = useState<SetupMember[]>([]), [memberId, setMemberId] = useState(''), [name, setName] = useState(''), [memberQuery, setMemberQuery] = useState('');
  const [recoveryRecord, setRecoveryRecord] = useState<(EntryResult & { recoveryCode: string }) | null>(null);
  const requestSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const next = await accessRequest<AccessState>('/api/access');
      if (sequence !== requestSequence.current) return;
      setState(next); setError('');
      setMode(current => next.needsSetup && next.setupAllowed ? 'setup' : current === 'setup' ? 'login' : current);
    } catch (err) { if (sequence === requestSequence.current) { setState(previous => previous?.authenticated ? previous : null); setError((err as Error).message); } }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const expired = () => { setState(null); setLoading(true); void refresh(); };
    const focused = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('access-expired', expired);
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    const timer = window.setInterval(focused, 60_000);
    return () => { ++requestSequence.current; window.clearInterval(timer); window.removeEventListener('access-expired', expired); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', focused); };
  }, [refresh]);
  useEffect(() => {
    if (!state?.needsSetup || !state.setupAllowed) return;
    let active = true;
    accessRequest<{ members: SetupMember[] }>('/api/access/setup').then(data => { if (active) setSetupMembers(data.members); }).catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [state?.needsSetup, state?.setupAllowed]);
  const logout = useCallback(async () => {
    ++requestSequence.current;
    await accessRequest('/api/access', { action: 'logout' });
    ++requestSequence.current;
    setState({ authenticated: false, needsSetup: false, setupAllowed: false }); setMode('login'); setPin(''); setConfirmation(''); setTeamPhrase(''); setRecoveryRecord(null);
  }, []);
  function chooseMode(next: Mode) { setMode(next); setError(''); setPin(''); setConfirmation(''); setRecoveryCode(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!/^\d{6}$/.test(pin)) return setError('個人用の番号は、数字6桁で入力してください。');
    if (mode !== 'login' && pin !== confirmation) return setError('確認用の番号が一致していません。');
    setBusy(true);
    try {
      const body = mode === 'setup' ? { action: mode, pin, teamPhrase, ...(memberId ? { memberId } : { name }) } : mode === 'login' ? { action: mode, loginId: loginId.trim(), pin, teamPhrase } : mode === 'register' ? { action: mode, inviteCode: inviteCode.trim(), pin, teamPhrase } : { action: mode, loginId: loginId.trim(), recoveryCode: recoveryCode.trim(), pin, teamPhrase };
      const result = await accessRequest<EntryResult>('/api/access', body);
      setPin(''); setConfirmation(''); setTeamPhrase(''); setInviteCode(''); setRecoveryCode('');
      if (result.recoveryCode) setRecoveryRecord(result as EntryResult & { recoveryCode: string });
      else await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  if (state?.authenticated && state.viewer && !recoveryRecord) return <AccessContext.Provider value={{ viewer: state.viewer, refresh, logout, recordRecovery: setRecoveryRecord }}>{error && <div className="access-connection-warning" role="status"><span>入場状態を確認できません。入力内容はこの画面に残っています。</span><button type="button" onClick={() => void refresh()}>再確認</button></div>}<TeamApp key={state.viewer.id} /></AccessContext.Provider>;
  const titles: Record<Mode, string> = { login: 'チームの記録へ、ようこそ。', register: '自分の入場番号を設定する', recover: '入場番号を再設定する', setup: 'チームの入口を準備する' };
  const descriptions: Record<Mode, string> = { login: '部の合言葉と、自分の6桁の番号で入場できます。', register: '管理担当から受け取った招待コードで、選手情報とひも付けます。', recover: '控えておいた復旧コードを使って、新しい6桁の番号を設定します。', setup: '最初の管理担当と、部の合言葉を設定します。選手の皆さんにメールアドレスやChatGPTアカウントは不要です。' };
  const visibleMembers = setupMembers.filter(member => `${member.name} ${member.group}`.normalize('NFKC').includes(memberQuery.normalize('NFKC'))).slice(0, 8);
  return <div className="access-shell"><div className="access-brand"><span className="access-brand-symbol" aria-hidden="true">↗</span><span>Shuttle Note<small>TEAM MATCH JOURNAL</small></span></div><div className="access-layout"><section className="access-intro"><div className="eyebrow">ONE TEAM. EVERY MATCH.</div><h1>一試合ずつ、<br />チームの力に。</h1><p>現役も、卒業してからも。<br />積み重ねた試合と、次につながる振り返りを。</p><div className="access-court" aria-hidden="true"><span /><i /></div><div className="access-intro-note"><strong>チームの記録と、自分の振り返り。</strong><p>試合結果はチームで共有。<br />個人の振り返りは、書いた本人だけに表示します。</p></div></section><section className="access-card" aria-label="チームへの入場">
    {recoveryRecord ? <RecoveryRecord result={recoveryRecord} onContinue={() => { setRecoveryRecord(null); setLoading(true); void refresh(); }} /> : loading ? <div className="access-loading" role="status"><div className="loader" /><p>入場情報を確認しています…</p></div> : !state ? <><h2>接続を確認してください</h2><p className="access-error" role="alert">{error}</p><button className="primary access-submit" onClick={() => { setLoading(true); void refresh(); }}>もう一度読み込む</button></> : state.needsSetup && !state.setupAllowed ? <><span className="access-step">TEAM SETUP</span><h2>チームの準備中です</h2><p>最初の管理担当による設定が済むと、招待コードで登録できるようになります。管理担当の方は、このサイトを作成したアカウントで初期設定を開いてください。</p><a className="primary access-submit" href="/signin-with-chatgpt?return_to=%2F" target="_top">管理担当の初期設定へ</a><button className="text-button access-refresh" onClick={() => void refresh()}>設定状況を確認する</button></> : <>
      <span className="access-step">{mode === 'setup' ? 'FIRST STEP' : mode === 'register' ? 'JOIN YOUR TEAM' : mode === 'recover' ? 'ACCOUNT RECOVERY' : 'WELCOME BACK'}</span><h2>{titles[mode]}</h2><p className="access-description">{descriptions[mode]}</p>
      <form className="access-form" onSubmit={submit}><fieldset disabled={busy}>
        {mode === 'setup' && <><fieldset className="access-member-picker"><legend>自分の選手情報 <small>任意</small></legend><input type="search" value={memberQuery} onChange={event => setMemberQuery(event.target.value)} placeholder="登録済みの選手を検索" aria-label="自分の選手情報を検索" /><div className="access-member-options"><label className="access-member-option"><input type="radio" name="setup-member" checked={!memberId} onChange={() => setMemberId('')} /><span>選手とひも付けずに管理する</span></label>{visibleMembers.map(member => <label className="access-member-option" key={member.id}><input type="radio" name="setup-member" checked={memberId === member.id} onChange={() => setMemberId(member.id)} /><span>{member.name}{member.group && <small>{member.group}</small>}</span></label>)}</div>{!memberId && <label>管理担当の表示名<input required maxLength={60} value={name} onChange={event => setName(event.target.value)} autoComplete="nickname" /></label>}</fieldset></>}
        {(mode === 'login' || mode === 'recover') && <label>名前（ログイン名）<input required maxLength={100} value={loginId} onChange={event => setLoginId(event.target.value)} autoComplete="username" placeholder="登録時のログイン名" /></label>}
        {mode === 'register' && <label>招待コード<input required value={inviteCode} onChange={event => setInviteCode(event.target.value)} autoComplete="off" spellCheck={false} /></label>}
        {mode === 'recover' && <label>復旧コード<input required value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} autoComplete="off" spellCheck={false} /></label>}
        <label>{mode === 'setup' ? '部の合言葉を決める' : '部の合言葉'}<input type="password" required minLength={mode === 'setup' ? 8 : undefined} maxLength={200} value={teamPhrase} onChange={event => setTeamPhrase(event.target.value)} autoComplete={mode === 'setup' ? 'new-password' : 'off'} />{mode === 'setup' && <span className="access-field-note">8文字以上。部のメンバーに共有する合言葉です。</span>}</label>
        <PinField label={mode === 'login' ? '個人用の入場番号' : '個人用の入場番号を決める'} value={pin} onChange={setPin} fresh={mode !== 'login'} />
        {mode !== 'login' && <PinField label="入場番号をもう一度入力" value={confirmation} onChange={setConfirmation} fresh />}
      </fieldset>{error && <p className="access-error" role="alert">{error}</p>}<button className="primary access-submit" disabled={busy}>{busy ? '確認しています…' : mode === 'setup' ? 'チームの入口を作る' : mode === 'register' ? '登録する' : mode === 'recover' ? '新しい番号に切り替える' : '入場する'}</button></form>
      {mode === 'setup' ? <p className="access-help">最初の管理担当は、招待コードの発行と管理の引き継ぎができます。</p> : <nav className="access-alternate" aria-label="入場の手続き">{mode !== 'login' && <button className="text-button" onClick={() => chooseMode('login')}>入場画面に戻る</button>}{mode !== 'register' && <button className="text-button" onClick={() => chooseMode('register')}>初めての方・招待コードで登録</button>}{mode !== 'recover' && <button className="text-button" onClick={() => chooseMode('recover')}>番号を忘れた・入場できない</button>}</nav>}
      <p className="access-device-note">自分の端末では入場状態が一定期間保たれます。共用端末では、使い終わったらログアウトしてください。</p>
    </>}
  </section></div><footer className="access-footer">SHUTTLE NOTE <span>記録が、次の一歩になる。</span></footer></div>;
}

