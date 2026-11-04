"use client";

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAccess, accessRequest } from './access-context';
import type { AccessViewer } from './access-context';
import { PinField } from './access-fields';
import { normalizeMemberName } from '../lib/member-name';

type Account = { id: string; memberId: string | null; name: string; role: 'admin' | 'member'; disabled: boolean; loginId: string };
type Invite = { id: string; memberId: string; name: string; role: 'admin' | 'member'; expiresAt: string; loginId: string };
type TeamMember = { id: string; name: string; group: string; deletedAt?: string | null };
type AdminData = { accounts: Account[]; invites: Invite[] };
type IssuedInvite = { inviteCode: string; loginId: string; name: string; expiresAt: string };

function AccessDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null), closer = useRef(close);
  closer.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closer.current(); }
      if (event.key !== 'Tab' || !dialog.current) return;
      const targets = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = targets[0], last = targets[targets.length - 1];
      if (!first) return event.preventDefault();
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return createPortal(<div className="access-dialog-backdrop"><div className="access-dialog" role="dialog" aria-modal="true" aria-labelledby="access-dialog-title" ref={dialog} tabIndex={-1}><header className="access-dialog-heading"><div><span className="access-step">YOUR TEAM ACCESS</span><h2 id="access-dialog-title">{title}</h2></div><button type="button" className="access-close" aria-label="閉じる" onClick={close}>×</button></header>{children}</div></div>, document.body);
}

function PersonalSettings() {
  const { viewer, refresh, recordRecovery } = useAccess();
  const [currentPin, setCurrentPin] = useState(''), [pin, setPin] = useState(''), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [recoveryPin, setRecoveryPin] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!/^\d{6}$/.test(pin) || !/^\d{6}$/.test(currentPin)) return setError('番号は数字6桁で入力してください。');
    if (pin !== confirmation) return setError('確認用の番号が一致していません。');
    setBusy(true);
    try { await accessRequest('/api/access', { action: 'changePin', currentPin, pin }); setCurrentPin(''); setPin(''); setConfirmation(''); setMessage('入場番号を変更しました。他の端末からは再入場が必要です。'); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function renewRecovery(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try { const result = await accessRequest<{ viewer: AccessViewer; recoveryCode: string }>('/api/access', { action: 'renewRecovery', currentPin: recoveryPin }); setRecoveryPin(''); recordRecovery(result); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <><dl className="access-identity"><div><dt>ログイン名</dt><dd>{viewer.loginId}</dd></div><div><dt>選手・利用者</dt><dd>{viewer.name}</dd></div><div><dt>権限</dt><dd>{viewer.role === 'admin' ? '管理担当' : 'メンバー'}</dd></div></dl><p className="access-help">ログイン名は登録時のものです。選手名を編集しても変わりません。</p>{error && <p className="access-error" role="alert">{error}</p>}{message && <p className="access-success" role="status">{message}</p>}<h3 className="access-section-title">個人用の入場番号を変更</h3><form className="access-form" onSubmit={save}><fieldset disabled={busy}><PinField label="今の入場番号" value={currentPin} onChange={setCurrentPin} /><PinField label="新しい入場番号" value={pin} onChange={setPin} fresh /><PinField label="新しい番号をもう一度入力" value={confirmation} onChange={setConfirmation} fresh /></fieldset><button className="primary" disabled={busy}>{busy ? '処理しています…' : '入場番号を変更'}</button></form><p className="access-help">番号を忘れた場合や入力制限がかかった場合は、ログアウト後に「番号を忘れた・入場できない」から復旧コードを使えます。</p><details className="access-phrase-settings"><summary>復旧コードを発行し直す</summary><p className="access-help">今までの復旧コードは使えなくなります。他の端末からは再入場が必要です。</p><form className="access-form" onSubmit={renewRecovery}><fieldset disabled={busy}><PinField label="今の入場番号で確認" value={recoveryPin} onChange={setRecoveryPin} /></fieldset><button className="primary" disabled={busy}>新しい復旧コードを発行</button></form></details></>;
}

function AdminSettings() {
  const { viewer, refresh } = useAccess();
  const [data, setData] = useState<AdminData | null>(null), [members, setMembers] = useState<TeamMember[]>([]), [query, setQuery] = useState(''), [memberId, setMemberId] = useState(''), [role, setRole] = useState<'admin' | 'member'>('member');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [phrase, setPhrase] = useState(''), [currentPin, setCurrentPin] = useState('');
  const [pendingStop, setPendingStop] = useState<Account | null>(null);
  async function load() {
    setLoading(true);
    try { const [admin, team] = await Promise.all([accessRequest<AdminData>('/api/access/admin'), accessRequest<{ members: TeamMember[] }>('/api/team')]); setData(admin); setMembers(team.members.filter(member => !member.deletedAt)); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function mutate(body: Record<string, unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await accessRequest('/api/access', body); setNotice(success); setPendingStop(null); await load(); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function invite(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setIssued(null);
    if (!memberId) return setError('招待する選手を選んでください。');
    setBusy(true);
    try { const result = await accessRequest<IssuedInvite>('/api/access', { action: 'invite', memberId, role }); setIssued(result); await load(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function changePhrase(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try { await accessRequest('/api/access', { action: 'changePhrase', teamPhrase: phrase, currentPin }); setPhrase(''); setCurrentPin(''); setNotice('部の合言葉を変更しました。新しい合言葉を部のメンバーに共有してください。'); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  const selected = members.find(member => member.id === memberId);
  const visible = members.filter(member => normalizeMemberName(`${member.name} ${member.group}`).includes(normalizeMemberName(query))).slice(0, 8);
  const dateLabel = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  return <div className="access-admin">{error && <p className="access-error" role="alert">{error}</p>}{notice && <p className="access-success" role="status">{notice}</p>}{loading && !data ? <p role="status">管理情報を読み込んでいます…</p> : <>
    <h3 className="access-section-title">選手を招待する</h3><p className="access-help">招待コードは選んだ選手専用で、1回だけ使えます。本人に直接渡してください。</p>
    <form className="access-form" onSubmit={invite}><fieldset disabled={busy}><label>招待する選手を検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="選手名の一部を入力" /></label><div className="access-member-options" role="group" aria-label="招待する選手">{visible.map(member => <label className="access-member-option" key={member.id}><input type="radio" name="invite-member" checked={member.id === memberId} onChange={() => setMemberId(member.id)} /><span>{member.name}{member.group && <small>{member.group}</small>}</span></label>)}{!visible.length && <p className="access-help">該当する選手がいません。先にメンバー管理で選手を登録してください。</p>}</div>{selected && <p className="access-selected">選択中：{selected.name}</p>}<label>権限<select value={role} onChange={event => setRole(event.target.value as 'admin' | 'member')}><option value="member">メンバー</option><option value="admin">管理担当</option></select></label>{role === 'admin' && <p className="access-help">管理担当は招待・利用停止・管理の引き継ぎができます。個人の振り返りは閲覧できません。</p>}</fieldset><button className="primary" disabled={busy || !memberId}>{busy ? '処理しています…' : '招待コードを発行'}</button></form>
    {issued && <section className="access-issued" aria-label="発行した招待コード"><strong>{issued.name} さんへの招待</strong><dl className="access-identity"><div><dt>ログイン名</dt><dd>{issued.loginId}</dd></div></dl><label className="access-code-label">招待コード<input readOnly value={issued.inviteCode} aria-label="発行した招待コード" onFocus={event => event.currentTarget.select()} autoComplete="off" spellCheck={false} /></label><p className="access-help">有効期限：{dateLabel(issued.expiresAt)}<br />このコードと部の合言葉を本人に伝え、入場画面の「初めての方」から登録してもらってください。コードはこの画面でのみ表示します。</p><button type="button" className="text-button" onClick={() => setIssued(null)}>コードの表示を閉じる</button></section>}
    <h3 className="access-section-title">未使用の招待</h3><ul className="access-management-list">{data?.invites.map(item => <li key={item.id}><div><strong>{item.name}</strong><small>{item.role === 'admin' ? '管理担当' : 'メンバー'} ／ {dateLabel(item.expiresAt)} まで</small></div><button type="button" className="text-button" disabled={busy} onClick={() => void mutate({ action: 'revokeInvite', inviteId: item.id }, '招待を取り消しました。')}>取り消す</button></li>)}</ul>{!data?.invites.length && <p className="access-help">未使用の招待はありません。</p>}
    <h3 className="access-section-title">登録済みの利用者・管理の引き継ぎ</h3><p className="access-help">引き継ぐ相手を管理担当に変更してから、自分をメンバーに変更できます。管理担当が0人になる操作はできません。</p><ul className="access-management-list">{data?.accounts.map(account => <li key={account.id}><div><strong>{account.name}{account.id === viewer.id && <span className="access-you">自分</span>}</strong><small>{account.disabled ? '利用停止中' : account.role === 'admin' ? '管理担当' : 'メンバー'} ／ {account.loginId}</small></div>{account.disabled ? <button className="text-button" type="button" disabled={busy} onClick={() => void mutate({ action: 'restoreAccount', accountId: account.id }, '利用を再開しました。本人の入場番号で再入場できます。')}>利用を再開</button> : <div className="access-account-actions"><button className="text-button" type="button" disabled={busy} onClick={() => void mutate({ action: 'setRole', accountId: account.id, role: account.role === 'admin' ? 'member' : 'admin' }, '権限を変更しました。')}>{account.role === 'admin' ? 'メンバーに変更' : '管理担当に変更'}</button>{account.id !== viewer.id && <button className="text-button access-danger" type="button" disabled={busy} onClick={() => setPendingStop(account)}>利用停止</button>}</div>}</li>)}</ul>
    {pendingStop && <div className="access-stop-confirm" role="alert"><p><strong>{pendingStop.name}</strong> さんの入場を停止します。選手情報と試合記録は残ります。個人の振り返りが他の利用者へ移ることはありません。</p><div><button className="secondary" type="button" disabled={busy} onClick={() => setPendingStop(null)}>キャンセル</button><button className="primary" type="button" disabled={busy} onClick={() => void mutate({ action: 'revokeAccount', accountId: pendingStop.id }, '利用を停止しました。')}>入場を停止する</button></div></div>}
    <details className="access-phrase-settings"><summary>部の合言葉を変更する</summary><form className="access-form" onSubmit={changePhrase}><fieldset disabled={busy}><label>新しい部の合言葉<input type="password" required minLength={8} maxLength={200} value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="new-password" /><span className="access-field-note">8文字以上で設定してください。</span></label><PinField label="自分の入場番号で確認" value={currentPin} onChange={setCurrentPin} /></fieldset><button className="primary" disabled={busy}>合言葉を変更</button></form></details>
  </>}</div>;
}

export function AccessControls() {
  const { viewer, logout } = useAccess();
  const [open, setOpen] = useState(false), [section, setSection] = useState<'personal' | 'admin'>('personal'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function leave() {
    setBusy(true); setError('');
    try { await logout(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <><button type="button" className="access-account-button" onClick={() => setOpen(true)} aria-label="自分の入場設定を開く"><span className="access-account-name">{viewer.name}</span><span className="avatar" aria-hidden="true">{viewer.name.slice(0, 1)}</span><span className="access-account-caret" aria-hidden="true">⌄</span></button>{open && <AccessDialog title="入場の設定" close={() => !busy && setOpen(false)}><div className="access-settings-tabs" role="group" aria-label="入場設定の種類"><button className={section === 'personal' ? 'selected' : ''} type="button" onClick={() => setSection('personal')}>自分の設定</button>{viewer.role === 'admin' && <button className={section === 'admin' ? 'selected' : ''} type="button" onClick={() => setSection('admin')}>招待と管理</button>}</div>{section === 'admin' && viewer.role === 'admin' ? <AdminSettings /> : <PersonalSettings />}{error && <p className="access-error" role="alert">{error}</p>}<div className="access-logout"><p>共用端末では、使い終わったらログアウトしてください。</p><button type="button" className="secondary" disabled={busy} onClick={() => void leave()}>{busy ? '処理しています…' : 'ログアウト'}</button></div></AccessDialog>}</>;
}
