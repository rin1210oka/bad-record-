import { useEffect, useRef, useState } from 'react';
import { memberMatchHistory, summarizeMemberMatches } from '../lib/member-stats';
import type { MemberMatch } from '../lib/member-stats';
import { affiliationLabel, memberClassification, memberStage, schoolYear } from '../lib/member-cohort';
import type { CohortFields, MemberSnapshot } from '../lib/member-cohort';

type Member = { id: string; name: string; group: string; status: 'active' | 'inactive'; version: number; deletedAt?: string | null } & CohortFields;
type RecordedMatch = MemberMatch & { memberSnapshots?: Record<string, MemberSnapshot> };

export default function MemberDetail({ member, members, matches, onClose, onEdit }: {
  member: Member; members: Member[]; matches: RecordedMatch[]; onClose: () => void; onEdit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState('all');
  const [historyYear, setHistoryYear] = useState('all');
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const currentStage = memberStage(member);
  const availableYears = [...new Set([currentStage.schoolYear, ...memberMatchHistory(matches, member.id).map(item => schoolYear(item.match.date))])].sort((a, b) => b - a);
  const datedMatches = historyYear === 'all' ? matches : matches.filter(match => schoolYear(match.date) === Number(historyYear));
  const history = memberMatchHistory(datedMatches, member.id, category);
  const stats = summarizeMemberMatches(history);
  const nameOf = (id: string) => members.find(item => item.id === id)?.name || '登録済みの選手';
  return <dialog className="modal member-detail" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="member-detail-title">
    <div className="modal-heading"><div><span className="eyebrow">PLAYER PROFILE</span><h2 id="member-detail-title">選手の情報</h2></div><button type="button" className="icon-button detail-close" onClick={onClose} aria-label="選手の情報を閉じる">×</button></div>
    <div className="profile-heading"><span className="profile-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span><div><h3>{member.name}{member.deletedAt && <span className="member-deleted-badge">削除済み</span>}</h3><p>{member.group || '所属先の登録なし'}{!member.deletedAt && <span className={`member-status ${member.status}`}>{member.status === 'active' ? '候補に表示' : '候補から非表示'}</span>}</p><p className="profile-cohort-line"><span className="type-badge classification-badge">{memberClassification(member)}</span>{member.affiliation === 'internal' && currentStage.grade !== null && <span className="type-badge">学年：{currentStage.label}</span>}<span>{currentStage.schoolYear}年度</span></p></div>{!member.deletedAt && <button className="secondary profile-edit" type="button" onClick={onEdit}>登録情報を編集</button>}</div>
    {member.deletedAt && <p className="profile-deleted-note">この選手は削除済みです。過去の試合・成績は引き続き確認できます。メンバー管理の「削除済みの選手」から復元できます。</p>}
    <div className="profile-section-title"><h3>出場成績</h3><div className="profile-filters"><label className="profile-filter">年度<select value={historyYear} onChange={event => setHistoryYear(event.target.value)} aria-label="選手成績の年度"><option value="all">すべての年度</option>{availableYears.map(year => <option key={year} value={year}>{year}年度</option>)}</select></label><label className="profile-filter">試合区分<select value={category} onChange={event => setCategory(event.target.value)} aria-label="選手成績の試合区分"><option value="all">すべての区分</option>{['公式戦', '練習試合', 'ゲーム練'].map(value => <option key={value}>{value}</option>)}</select></label></div></div>
    <section className="profile-stats" aria-label="選手の成績"><div><span>出場</span><strong>{stats.total}<small>試合</small></strong></div><div><span>勝ち</span><strong>{stats.wins}<small>勝</small></strong></div><div><span>負け</span><strong>{stats.losses}<small>敗</small></strong></div><div><span>引き分け</span><strong>{stats.draws}<small>分</small></strong></div><div><span>勝率</span><strong>{stats.winRate ?? '—'}<small>%</small></strong></div></section>
    <p className="profile-hint">部内の対戦も含めて、この選手側の勝敗・得点を表示しています。勝率は引き分けを除いて計算します。</p>
    <div className="profile-section-title history-heading"><h3>試合履歴</h3><span>{history.length} 試合</span></div>
    {history.length ? <div className="profile-history">{history.map(({ match, won, drawn, outcome, scores, ownIds, oppositeIds, opponents, gamesWon, gamesLost }) => {
      const snapshot = match.memberSnapshots?.[member.id];
      return <article className="profile-match" key={match.id}>
      <div className="match-meta"><time dateTime={match.date}>{match.date.replaceAll('-', '.')}</time><span className={`category-badge ${match.category === '公式戦' ? 'official' : ''}`}>{match.category}</span><span className="discipline">{match.discipline}</span>{match.opponentType === 'internal' && <span className="internal-tag">部内</span>}</div>
      <p className="profile-match-cohort">{snapshot ? `当時：${affiliationLabel(snapshot.affiliation)}・${snapshot.gradeLabel}（${snapshot.schoolYear}年度）` : '当時の所属・学年は未記録'}</p>
      {match.event && <p className="profile-match-event">{match.event}</p>}
      <div className="profile-match-main"><div className="profile-match-players"><strong className="profile-player-names">{ownIds.map(id => <span key={id}>{nameOf(id)}</span>)}</strong><span>vs</span><strong className="profile-player-names">{oppositeIds.length ? oppositeIds.map(id => <span key={id}>{nameOf(id)}</span>) : opponents.map((name, index) => <span key={index}>{name}</span>)}</strong></div><div className="profile-result"><span className={"result-tag " + outcome}>{drawn ? '引き分け' : won ? 'WIN' : 'LOSE'}</span><strong>{gamesWon} − {gamesLost}</strong></div></div>
      <div className="score-detail">{scores.map(([own, other], index) => <span key={index}><small>セット{index + 1}</small> {own}–{other}</span>)}</div>{match.memo && <p className="match-memo">{match.memo}</p>}
    </article>; })}</div> : <div className="profile-empty"><span aria-hidden="true">◇</span><h4>{category === 'all' && historyYear === 'all' ? 'まだ試合の記録がありません' : 'この条件の試合はまだありません'}</h4><p>{category === 'all' && historyYear === 'all' ? 'この選手が出場した試合を登録すると、ここに表示されます。' : '年度や試合区分を切り替えて、成績を確認できます。'}</p></div>}
    <div className="form-actions"><button className="secondary" type="button" onClick={onClose}>閉じる</button></div>
  </dialog>;
}
