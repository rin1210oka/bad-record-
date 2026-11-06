import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeMemberName, memberNameError } from '../lib/member-name';
import MemberDetail from './member-detail';
import {useAccess} from './access-context';
import {clientRequest} from '../lib/client-backend';
import LinkApprovals from './link-approvals';
import {FeedbackJournal,MatchFeedbackModal} from './match-feedback';
import { matchResult, matchSummary } from '../lib/match-result';
import { memberMatchHistory, summarizeMemberMatches } from '../lib/member-stats';
import PlayerSearch from './player-search';
import { affiliationLabel, highSchoolEntryYear, japanDate, memberClassification, memberStage, schoolYear, sortMembers, teamHistoryChoice } from '../lib/member-cohort';
import type { CohortFields, GradeOverride, MemberSnapshot, StageMode } from '../lib/member-cohort';

type Member = { id: string; name: string; group: string; status: "active" | "inactive"; version: number; deletedAt?: string | null } & CohortFields;
type Match = { id: string; date: string; category: string; event: string; discipline: string; format?: number; opponentType: "internal" | "external"; sideAIds: string[]; sideBIds: string[]; opponents: string[]; scores: number[][]; memo: string; createdByName: string; version: number; memberSnapshots?: Record<string, MemberSnapshot> };
type Team = { members: Member[]; matches: Match[]; viewer: { name: string }; updatedAt: string; today?: string; currentSchoolYear?: number };
const categories = ["公式戦", "練習試合", "ゲーム練"];
const today = () => japanDate();
const result = (m: Match) => matchResult(m.scores);
const dateLabel = (date: string) => date.replaceAll("-", ".");

const api=clientRequest;

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>, arrow: <path d="M5 19 19 5M5 5h14v14"/>,
    list: <><path d="M8 5h13M8 12h13M8 19h13"/><circle cx="3" cy="5" r=".5"/><circle cx="3" cy="12" r=".5"/><circle cx="3" cy="19" r=".5"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>, close: <path d="m6 6 12 12M6 18 18 6"/>, check: <path d="m5 12 4 4L19 6"/>, refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></>, trophy: <><path d="M7 3h10v7a5 5 0 0 1-10 0ZM12 15v6M8 21h8M7 5H3v3a4 4 0 0 0 4 4M17 5h4v3a4 4 0 0 1-4 4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.list}</svg>;
}

function Modal({ title, eyebrow, children, close }: { title: string; eyebrow: string; children: React.ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="modal" ref={ref} onCancel={e => { e.preventDefault(); close(); }} aria-labelledby="dialog-title"><div className="modal-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id="dialog-title">{title}</h2></div><button type="button" className="icon-button" onClick={close} aria-label="閉じる"><Icon name="close" /></button></div>{children}</dialog>;
}

function MatchForm({ members, match, onSaved, onClose }: { members: Member[]; match: Match | null; onSaved: () => void; onClose: () => void }) {
  const [date, setDate] = useState(match?.date || today());
  const [category, setCategory] = useState(match?.category || "ゲーム練");
  const [discipline, setDiscipline] = useState(match?.discipline || "シングルス");
  const [opponentType, setOpponentType] = useState<"internal" | "external">(match?.opponentType || "internal");
  const [sideA, setSideA] = useState(match?.sideAIds || [""]);
  const [sideB, setSideB] = useState(match?.sideBIds || [""]);
  const [opponents, setOpponents] = useState(match?.opponents || [""]);
  const [scores, setScores] = useState<string[][]>(() => match?.scores.length ? match.scores.map(pair => pair.map(String)) : [["", ""]]);
  const [event, setEvent] = useState(match?.event || "");
  const [memo, setMemo] = useState(match?.memo || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [duplicate, setDuplicate] = useState(false);
  const [submissionId] = useState(() => match?.id || crypto.randomUUID());
  const count = discipline === "ダブルス" ? 2 : 1;
  const choose = (values: string[], setter: (value: string[]) => void, index: number, value: string) => setter(Array.from({ length: 2 }, (_, i) => i === index ? value : values[i] || ""));
  const availableMembers = members.filter(member => (!member.deletedAt && member.status === "active") || match?.sideAIds.includes(member.id) || match?.sideBIds.includes(member.id));
  const completeScores = scores.filter(pair => pair.every(value => value !== "")).map(pair => pair.map(Number));
  const preview = completeScores.length && completeScores.every(pair => pair.every(value => Number.isSafeInteger(value) && value >= 0)) ? matchResult(completeScores) : null;

  async function submit(e: { preventDefault: () => void }, allowDuplicate = false) {
    e.preventDefault(); setError(""); setDuplicate(false);
    const allIds = [...Array.from({length:count},(_,i)=>sideA[i]||''), ...(opponentType === "internal" ? Array.from({length:count},(_,i)=>sideB[i]||'') : [])];
    if (allIds.some(id => !id) || new Set(allIds).size !== allIds.length) return setError("出場選手を重複しないように選択してください。");
    if (opponentType === "external" && Array.from({ length: count }, (_, i) => opponents[i]?.trim()).some(value => !value)) return setError("対戦相手の名前を入力してください。");
    const parsed: number[][] = [];
    for (const pair of scores) {
      if (pair.every(value => value === "")) continue;
      if (pair.some(value => value === "")) return setError("入力するセットは、両側の得点を入力してください。空欄のセットは記録されません。");
      const values = pair.map(Number);
      if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) return setError("得点は0以上の整数で入力してください。");
      parsed.push(values);
    }
    if (!parsed.length) return setError("少なくとも1セットの得点を入力してください。");
    setBusy(true);
    try {
      await api(match ? "/api/matches/" + match.id : "/api/matches", match ? "PATCH" : "POST", {
        id: submissionId, date, category, discipline, opponentType,
        sideAIds: sideA.slice(0, count), sideBIds: opponentType === "internal" ? sideB.slice(0, count) : [],
        opponents: opponentType === "external" ? opponents.slice(0, count).map(name => name.trim()) : [],
        scores: parsed, event: event.trim(), memo: memo.trim(),
        ...(allowDuplicate ? { allowDuplicate: true } : {}), ...(match ? { version: match.version } : {}),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setDuplicate((e as Error & { code?: string }).code === "duplicate_match");
    } finally { setBusy(false); }
  }
  const playerFields = (label: string, values: string[], setter: (value: string[]) => void) => <fieldset className="player-fields">
    <legend>{label}</legend>{Array.from({ length: count }, (_, index) => <PlayerSearch key={index}
      required label={label + " " + (index + 1)} members={availableMembers} value={values[index] || ""}
      onChange={id => choose(values, setter, index, id)}
      excludedIds={[...sideA.slice(0,count),...(opponentType==='internal'?sideB.slice(0,count):[])].filter(Boolean)}
    />)}
  </fieldset>;
  const leftLabel = opponentType === "internal" ? "サイドA" : "チーム";
  const rightLabel = opponentType === "internal" ? "サイドB" : "対戦相手";
  return <Modal title={match ? "試合を編集する" : "試合を記録する"} eyebrow={match ? "EDIT MATCH" : "NEW MATCH"} close={() => !busy && onClose()}>
    <form onSubmit={submit}><fieldset disabled={busy} className="form-body">
      <div className="form-grid">
        <label>試合日<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>試合の区分<select value={category} onChange={e => { setCategory(e.target.value); if (!match) setOpponentType(e.target.value === "ゲーム練" ? "internal" : "external"); }}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>種目<select value={discipline} onChange={e => setDiscipline(e.target.value)}><option>シングルス</option><option>ダブルス</option></select></label>
      </div>
      <div className="form-section"><div className="small-section-title"><span>出場選手</span><div className="segmented">
        <button type="button" className={opponentType === "internal" ? "selected" : ""} onClick={() => setOpponentType("internal")}>部内の対戦</button>
        <button type="button" className={opponentType === "external" ? "selected" : ""} onClick={() => setOpponentType("external")}>外部との対戦</button>
      </div></div><div className="sides-grid">{playerFields(opponentType === "internal" ? "サイドA" : "チームの出場選手", sideA, setSideA)}<span className="versus">VS</span>
        {opponentType === "internal" ? playerFields("サイドB", sideB, setSideB) : <fieldset className="player-fields"><legend>対戦相手</legend>{Array.from({ length: count }, (_, index) => <label className="sr-label" key={index}><span>対戦相手 {index + 1}</span><input aria-label={"対戦相手 " + (index + 1)} required maxLength={60} value={opponents[index] || ""} placeholder={"相手の名前" + (count === 2 ? " " + (index + 1) : "")} onChange={e => choose(opponents, setOpponents, index, e.target.value)} /></label>)}</fieldset>}
      </div><p className="form-hint">登録選手は名前の一部を入力して、候補から選んでください。ひらがな・半角カナでも検索できます。</p>{opponentType === "internal" && <p className="form-hint">この1件で、両側のメンバーの試合数・勝敗に反映されます。</p>}</div>
      <div className="form-section"><div className="small-section-title"><span>セットごとの得点</span><small>左：{leftLabel} ／ 右：{rightLabel}</small></div>
        {scores.map((pair, index) => <div className="score-row flexible-score-row" key={index}>
          <span>セット {index + 1}</span>
          <input aria-label={"第" + (index + 1) + "セット " + leftLabel + "の得点"} type="number" min="0" step="1" value={pair[0]} placeholder="—" onChange={e => setScores(scores.map((value, i) => i === index ? [e.target.value, value[1]] : value))} />
          <span className="score-separator">−</span>
          <input aria-label={"第" + (index + 1) + "セット " + rightLabel + "の得点"} type="number" min="0" step="1" value={pair[1]} placeholder="—" onChange={e => setScores(scores.map((value, i) => i === index ? [value[0], e.target.value] : value))} />
          <button className="remove-set" type="button" disabled={scores.length === 1} aria-label={"第" + (index + 1) + "セットを削除"} onClick={() => setScores(scores.filter((_, i) => i !== index))}>×</button>
        </div>)}
        <button className="secondary add-set" type="button" onClick={() => setScores([...scores, ["", ""]])}><Icon name="plus" size={14}/>セットを追加</button>
        <p className="form-hint">セット数・終了点数は自由です。得点が多い側がそのセットを獲得し、獲得セット数で試合結果を決めます。同点のセットはどちらにも加算しません。</p>
        {preview && <div className="score-preview" role="status"><span>入力済みの獲得セット</span><strong>{preview.a} − {preview.b}</strong><span className={"result-tag " + preview.outcome}>{preview.draw ? "引き分け" : preview.win ? leftLabel + "の勝ち" : rightLabel + "の勝ち"}</span></div>}
      </div>
      <label>大会名・対戦校など <small>任意</small><input maxLength={100} value={event} onChange={e => setEvent(e.target.value)} placeholder="例：秋季市民大会 / ○○高校との練習試合" /></label>
      <label className="memo-label">チーム共有メモ <small>任意・チーム全員に表示</small><textarea rows={3} maxLength={1000} value={memo} onChange={e => setMemo(e.target.value)} placeholder="チームに共有したい連絡や、試合の補足など" /></label><p className="form-hint">個人の振り返りは、保存後の「自分の振り返り」に書けます。</p>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}{duplicate && <button className="secondary duplicate-button" type="button" disabled={busy} onClick={e => void submit(e, true)}>別の試合として保存</button>}
      <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>キャンセル</button><button className="primary" type="submit" disabled={busy}>{busy ? "保存中…" : "記録を保存"}</button></div>
    </form>
  </Modal>;
}
export function MemberForm({ member, onSaved, onClose, externalOnly = false }: { member: Member | null; onSaved: () => void; onClose: () => void; externalOnly?: boolean }) {
  const [name, setName] = useState(member?.name || ""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const year = schoolYear(), currentDate = japanDate();
  const [hasTeamHistory, setHasTeamHistory] = useState<boolean | null>(member ? teamHistoryChoice(member) : externalOnly ? false : null);
  const [generation, setGeneration] = useState(member?.generation == null ? '' : String(member.generation));
  const [stageMode, setStageMode] = useState<StageMode>(member?.stageMode || (member ? 'unspecified' : 'cohort'));
  const [cohortYear, setCohortYear] = useState(member?.cohortYear == null ? '' : String(member.cohortYear));
  const [birthDate, setBirthDate] = useState('');
  const [gradeOverride, setGradeOverride] = useState(String(member?.gradeOverrides?.[String(year)] ?? 'auto'));
  const composing = useRef(false);
  const keepsExistingMembership = Boolean(member) && hasTeamHistory === null;
  const isInternal = hasTeamHistory === null ? member?.affiliation === 'internal' : hasTeamHistory;
  const overrides: Record<string, GradeOverride> = { ...(member?.gradeOverrides || {}) };
  if (gradeOverride === 'auto') delete overrides[String(year)];
  else overrides[String(year)] = gradeOverride === 'general' ? 'general' : Number(gradeOverride) as 1 | 2 | 3;
  const baseFields = { stageMode, cohortYear: stageMode === 'cohort' && cohortYear ? Number(cohortYear) : null, gradeOverrides: overrides };
  const generationNumber = /^\d+$/.test(generation) && Number.isSafeInteger(Number(generation)) && Number(generation) >= 1 && Number(generation) <= 9999 ? Number(generation) : null;
  const previewFields: CohortFields | null = hasTeamHistory === null ? member ? { ...baseFields, affiliation: member.affiliation, internalHistory: member.internalHistory, generation: generationNumber } : null : { ...baseFields, affiliation: hasTeamHistory ? 'internal' : 'external', internalHistory: hasTeamHistory, generation: generationNumber };
  const preview = previewFields ? memberStage(previewFields) : null;
  const previousStage = member ? memberStage(member) : null;
  const appliedCorrectionYear = Object.keys(overrides).map(Number).filter(value => value <= year).sort((a, b) => b - a)[0];
  const retainedBasis = member?.stageMode === 'cohort' && String(member.cohortYear) === cohortYear;
  const updateBirthDate = (value: string) => {
    setBirthDate(value);
    const calculated = highSchoolEntryYear(value);
    if (calculated !== null && value <= currentDate) { setCohortYear(String(calculated)); setStageMode('cohort'); }
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (composing.current) return;
    const normalized = normalizeMemberName(name), nameError = memberNameError(normalized);
    setName(normalized); if (nameError) return setError(nameError);
    if (hasTeamHistory === null && !member) return setError('この部への所属経験を「はい」「いいえ」から選んでください。');
    if (isInternal && generation !== '' && generationNumber === null) return setError('何期生かは、1〜9999の整数で入力してください。');
    if (birthDate && (highSchoolEntryYear(birthDate) === null || birthDate > currentDate)) return setError('生年月日を確認してください。');
    if (stageMode === 'cohort' && (!/^\d{4}$/.test(cohortYear) || Number(cohortYear) < 1900 || Number(cohortYear) > year + 20)) return setError(member ? '高校入学の基準年度を確認してください。わからない場合は「学年未設定」を選べます。' : '生年月日を入力してください。わからない場合は、下の詳細から基準年度を指定するか「学年未設定」を選べます。');
    setBusy(true); setError("");
    try {
      await api(member ? `/api/members/${member.id}` : "/api/members", member ? "PATCH" : "POST", {
        name: normalized, group: member?.group ?? "", status: member?.status ?? "active", stageMode,
        ...(hasTeamHistory === null ? {} : { hasTeamHistory }),
        cohortYear: baseFields.cohortYear, gradeOverride,
        ...(isInternal ? { generation: generationNumber } : {}),
        ...(member ? { version: member.version } : {}),
      });
      onSaved();
    }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const stageControls = <>
    <label>学年の指定方法<select value={stageMode} onChange={e => { setStageMode(e.target.value as StageMode); setBirthDate(''); }}><option value="cohort">基準年度から自動計算</option><option value="general">高校卒業後（一般・OB・OG）</option><option value="unspecified">学年未設定</option></select></label>
    {stageMode === 'cohort' && <label>高校入学の基準年度<input type="number" min="1900" max={year + 20} step="1" value={cohortYear} onChange={e => { setCohortYear(e.target.value); setBirthDate(''); }} placeholder="例：2026" /></label>}
  </>;
  const birthdayControl = <>
    <label>{member ? '再計算に使う生年月日' : '生年月日'} <small>{member ? '変更するときだけ・保存しません' : '保存しません'}</small><input type="date" value={birthDate} max={currentDate} onChange={e => updateBirthDate(e.target.value)} autoComplete="off" /></label>
    <p className="form-hint">{member ? '生年月日は保存していないため空欄です。入力しなくても登録済みの学年設定で保存できます。入力すると基準年度を再計算します。' : '生年月日は計算だけに使い、基準年度を保存します。学年は毎年4月に自動で進みます。'}</p>
  </>;
  return <Modal title={member ? "メンバーを編集" : externalOnly ? "外部選手を登録" : "自分の選手情報を登録"} eyebrow="TEAM MEMBERS" close={() => !busy && onClose()}>
    <form onSubmit={submit}><fieldset disabled={busy} className="member-form form-body">
      {member && <section className="member-saved-info" aria-label="登録済みの情報"><span>登録済みの情報</span><strong>{memberClassification(member)}</strong><small>{year}年度・学年：{previousStage?.label === '未設定' ? '学年未設定' : previousStage?.label}</small></section>}
      <label>選手名<input autoComplete="off" required maxLength={120} value={name} onChange={e => setName(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={e => { composing.current = false; setName(normalizeMemberName(e.currentTarget.value)); }} onBlur={e => { if (!composing.current) setName(normalizeMemberName(e.currentTarget.value)); }} aria-describedby="member-name-hint" placeholder="例：ヤマダタロウ" /></label>
      <p className="form-hint name-rule-hint" id="member-name-hint">全角カタカナ・空白なしで登録します。ひらがな・半角カナ・空白は自動で整えます。</p>
      {member && memberNameError(member.name) && <p className="legacy-name-note">登録名の読みをカタカナで入力して保存してください。過去の試合記録は引き継がれます。</p>}
      {!externalOnly && <fieldset className="membership-question" aria-describedby="membership-branch-hint">
        <legend><span className="member-step">1</span>この部に所属している、または所属していたことがありますか？</legend>
        {member && teamHistoryChoice(member) === null && <p className="membership-existing-note">登録済みの所属・在籍歴を入れたまま編集できます。所属経験を変更するときだけ「はい」「いいえ」を選んでください。</p>}
        <div className="membership-choices">
          {member && teamHistoryChoice(member) === null && <label className={`membership-choice membership-keep-existing ${keepsExistingMembership ? 'is-selected' : ''}`}><input type="radio" name="member-team-history" checked={keepsExistingMembership} onChange={() => setHasTeamHistory(null)} /><span><strong>現在の登録を維持</strong><small>{affiliationLabel(member.affiliation)}・{previousStage?.label}</small></span></label>}
          <label className={`membership-choice ${hasTeamHistory === true ? 'is-selected' : ''}`}><input type="radio" name="member-team-history" required={!member} checked={hasTeamHistory === true} onChange={() => setHasTeamHistory(true)} /><span><strong>はい</strong><small>この部の現役・出身者</small></span></label>
          <label className={`membership-choice ${hasTeamHistory === false ? 'is-selected' : ''}`}><input type="radio" name="member-team-history" required={!member} checked={hasTeamHistory === false} onChange={() => setHasTeamHistory(false)} /><span><strong>いいえ</strong><small>他校・部外の参加者</small></span></label>
        </div>
        <p className="form-hint" id="membership-branch-hint">「はい」は内部、卒業相当の年度以降はOB・OG。「いいえ」は外部、卒業後は一般と表示します。</p>
      </fieldset>}
      {externalOnly && <p className="form-hint">アプリを利用しない外部の選手を登録します。部の参加者はログイン時に自分で登録してください。</p>}
      {(hasTeamHistory !== null || member) && <>
        {isInternal && <label className="generation-field">何期生 <small>任意</small><span className="generation-input"><input type="number" inputMode="numeric" min="1" max="9999" step="1" value={generation} onChange={e => setGeneration(e.target.value)} aria-label="何期生" aria-describedby="member-generation-hint" placeholder="例：34" /><span aria-hidden="true">期生</span></span><span className="form-hint" id="member-generation-hint">生年月日とは別に指定します。わからない場合は空欄で登録でき、「期生未設定」と表示します。</span></label>}
        <section className="cohort-calculator membership-birthday" aria-labelledby="member-birthday-title">
          <h3 id="member-birthday-title"><span className="member-step">2</span>{member ? '学年・区分' : '生年月日から学年を確認'}</h3>
          {member ? stageControls : birthdayControl}
          {stageMode === 'cohort' && cohortYear && <p className="membership-basis-note">{birthDate ? '計算した基準年度' : retainedBasis ? '登録済みの基準年度' : '指定した基準年度'}：{cohortYear}年度{!birthDate && retainedBasis ? '（生年月日の再入力は不要です）' : ''}</p>}
          {stageMode === 'general' && <p className="membership-basis-note">現在の指定：高校卒業後。生年月日を入力すると、年度からの自動計算に切り替わります。</p>}
          {stageMode === 'unspecified' && <p className="membership-basis-note">現在は学年未設定です。生年月日を入力すると、学年を計算できます。</p>}
          {stageMode === 'cohort' && appliedCorrectionYear !== undefined && <p className="form-hint">{appliedCorrectionYear}年度からの学年補正を適用しています。下の詳細から確認できます。</p>}
        </section>
        {preview && previewFields && <div className="cohort-preview" role="status"><span>{year}年度の表示</span><strong>{memberClassification(previewFields)}</strong>{isInternal && preview.grade !== null && <small>学年：{preview.label}</small>}</div>}
        <details className="grade-correction membership-advanced"><summary>{member ? '生年月日で再計算・学年の補正（必要な場合）' : '生年月日がわからない場合・学年の補正'}</summary>
          {member ? birthdayControl : <><p className="form-hint">基準年度を直接入力することもできます。生年月日がわからなくても登録できます。</p>{stageControls}</>}
          {stageMode === 'cohort' && <>
            <label>{year}年度からの学年<select value={gradeOverride} onChange={e => setGradeOverride(e.target.value)}><option value="auto">今年度の補正なし（過去の補正は継続）</option><option value="1">高1</option><option value="2">高2</option><option value="3">高3</option><option value="general">高校生以外</option></select></label>
            <p className="form-hint">補正した年度から、翌年度以降も進級を計算します。過去の試合に保存済みの学年は変わりません。</p>
          </>}
        </details>
      </>}



    </fieldset>{error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>キャンセル</button><button className="primary" type="submit" disabled={busy}>{busy ? "保存中…" : member ? "変更を保存" : externalOnly ? "外部選手を登録" : "自分を登録"}</button></div>
    </form>
  </Modal>;
}

export default function TeamApp() {
  const {viewer,controls}=useAccess();
  const [feedbackMatchId,setFeedbackMatchId]=useState<string|null>(null),[feedbackJournalOpen,setFeedbackJournalOpen]=useState(false);
  const [team, setTeam] = useState<Team | null>(null), [error, setError] = useState(""), [tab, setTab] = useState<"matches" | "members">("matches"), [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""), [category, setCategory] = useState("all"), [memberId, setMemberId] = useState("all"), [memberQuery, setMemberQuery] = useState("");
  const [matchModal, setMatchModal] = useState<{ match: Match | null } | null>(null), [memberModal, setMemberModal] = useState<{ member: Member | null } | null>(null), [notice, setNotice] = useState(""), [deleting, setDeleting] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberOperation, setMemberOperation] = useState<{ id: string; action: 'delete' | 'restore' } | null>(null);
  const memberOperationPending = useRef(false);
  const [memberActionError, setMemberActionError] = useState<{ action: 'delete' | 'restore'; message: string } | null>(null);
  const [memberAffiliation, setMemberAffiliation] = useState('all'), [memberGrade, setMemberGrade] = useState('all');
  const [memberYearChoice, setMemberYearChoice] = useState('current');
  const requestSequence = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => { setNotice(message); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNotice(""), 5000); }, []);
  const load = useCallback(async () => { const sequence = ++requestSequence.current; try { const data = await api<Team>("/api/team"); if (sequence === requestSequence.current) { setTeam(data); setError(""); } } catch (e) { if (sequence === requestSequence.current) setError((e as Error).message); } finally { if (sequence === requestSequence.current) setLoading(false); } }, []);
  useEffect(() => { void load(); const interval = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000); const refresh = () => { if (document.visibilityState === "visible") void load(); }; window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh); return () => { clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); if (timer.current) clearTimeout(timer.current); }; }, [load]);
  const allMembers = team?.members || [], matches = team?.matches || [];
  const members = sortMembers(allMembers.filter(member => !member.deletedAt));
  const deletedMembers = sortMembers(allMembers.filter(member => member.deletedAt));
  const currentSchoolYear = team?.currentSchoolYear ?? schoolYear();
  const memberYear = memberYearChoice === 'current' ? currentSchoolYear : Number(memberYearChoice);
  const selectedMember = allMembers.find(member => member.id === selectedMemberId);
  const nameOf = (id: string) => allMembers.find(m => m.id === id)?.name || "登録済みの選手";
  const playerLinks = (ids: string[]) => <span className="match-player-names">{ids.map(id => <span className="player-link-part" key={id}><button className="player-name-link" type="button" onClick={() => setSelectedMemberId(id)} aria-label={`${nameOf(id)}の選手情報を見る`}>{nameOf(id)}</button></span>)}</span>;
  const playerNames = (names: string[]) => <span className="match-player-names">{names.map((name, index) => <span className="match-player-name" key={index}>{name}</span>)}</span>;
  const searchText = (value: string) => normalizeMemberName(value).toLowerCase();
  const sideNames = (m: Match, side: "a" | "b") => side === "a" ? m.sideAIds.map(nameOf).join("・") : m.opponentType === "internal" ? m.sideBIds.map(nameOf).join("・") : m.opponents.join("・");
  const external = matches.filter(m => m.opponentType === "external"), externalStats = matchSummary(external.map(result));
  const filtered = useMemo(() => matches.filter(m => (category === "all" || m.category === category) && (memberId === "all" || m.sideAIds.includes(memberId) || m.sideBIds.includes(memberId)) && searchText([m.event, m.memo, ...m.sideAIds.map(id => allMembers.find(p => p.id === id)?.name), ...m.sideBIds.map(id => allMembers.find(p => p.id === id)?.name), ...m.opponents].join(" ")).includes(searchText(query))).sort((a, b) => b.date.localeCompare(a.date)), [team, query, category, memberId]);
  const memberYearDate = String(memberYear) + '-04-01';
  const listedMembers = sortMembers(members.filter(m => {
    const stage = memberStage(m, memberYearDate);
    return (memberAffiliation === 'all' || (m.affiliation || 'unspecified') === memberAffiliation) &&
      (memberGrade === 'all' || stage.label === memberGrade) &&
      searchText([m.name, m.group, affiliationLabel(m.affiliation), stage.label, memberClassification(m, memberYearDate)].join(' ')).includes(searchText(memberQuery));
  }), memberYearDate);
  const oldestYear = Math.min(currentSchoolYear - 5, ...members.flatMap(m => m.cohortYear ? [m.cohortYear] : []), ...matches.map(m => schoolYear(m.date)));
  const memberYears = Array.from({length: currentSchoolYear - oldestYear + 4}, (_,i) => currentSchoolYear + 3 - i);
  const historicLabels = (match: Match, ids: string[]) => ids.map(id => {
    const snapshot = match.memberSnapshots?.[id];
    return nameOf(id) + '：' + (snapshot ? affiliationLabel(snapshot.affiliation) + '・' + snapshot.gradeLabel : '未記録');
  }).join(' / ');
  const openNewMatch = () => { if (!members.some(m => m.status === "active")) { setTab("members"); notify("最初に、出場するメンバーを登録してください。"); setMemberModal({ member: null }); } else setMatchModal({ match: null }); };
  const saved = (kind: "member" | "match") => { setMemberModal(null); setMatchModal(null); notify(kind === "member" ? "メンバーを保存しました。" : "試合記録を保存しました。"); void load(); };
  async function deleteMember(member: Member) {
    if (memberOperationPending.current || !confirm(`${member.name}を削除しますか？\n\n登録メンバーの一覧と試合入力の検索候補から非表示になります。過去の試合・成績は残り、「削除済みの選手」から復元できます。`)) return;
    memberOperationPending.current = true;
    setMemberOperation({ id: member.id, action: 'delete' }); setMemberActionError(null);
    try {
      await api(`/api/members/${member.id}`, 'DELETE', { version: member.version });
      setMemberModal(current => current?.member?.id === member.id ? null : current);
      setSelectedMemberId(current => current === member.id ? null : current);
      if (memberId === member.id) setMemberId('all');
      notify(`${member.name}を削除しました。「削除済みの選手」から復元できます。`);
      await load();
    } catch (e) { setMemberActionError({ action: 'delete', message: (e as Error).message }); }
    finally { memberOperationPending.current = false; setMemberOperation(null); }
  }
  async function restoreMember(member: Member) {
    if (memberOperationPending.current) return;
    memberOperationPending.current = true;
    setMemberOperation({ id: member.id, action: 'restore' }); setMemberActionError(null);
    try {
      await api(`/api/members/${member.id}/restore`, 'POST', { version: member.version });
      notify(`${member.name}を復元しました。`);
      await load();
    } catch (e) { setMemberActionError({ action: 'restore', message: (e as Error).message }); }
    finally { memberOperationPending.current = false; setMemberOperation(null); }
  }
  async function deleteMatch(m: Match) { if (!confirm(`${m.date} の試合記録を削除しますか？`)) return; setDeleting(m.id); try { await api(`/api/matches/${m.id}`, "DELETE", { version: m.version }); notify("試合記録を削除しました。"); void load(); } catch (e) { notify((e as Error).message); } finally { setDeleting(null); } }
  function exportCSV() { const cell = (v: unknown) => `"${String(v ?? "").replace(/^\s*[=+@-]/, "'$&").replaceAll('"', '""')}"`; const rows = [["日付", "区分", "種目", "対戦種別", "サイドA", "サイドB", "サイドAの結果", "獲得セット数", "セットスコア", "大会名・対戦校", "メモ", "入力者", "サイドAの試合日の学年・記録時の所属", "サイドBの試合日の学年・記録時の所属"], ...filtered.map(m => [m.date, m.category, m.discipline, m.opponentType === "internal" ? "部内" : "外部", sideNames(m, "a"), sideNames(m, "b"), result(m).draw ? "引き分け" : result(m).win ? "勝ち" : "負け", result(m).a + "-" + result(m).b, m.scores.map(s => s.join("-")).join(" / "), m.event, m.memo, m.createdByName, historicLabels(m, m.sideAIds), m.opponentType === "internal" ? historicLabels(m, m.sideBIds) : "未登録の相手"])]; const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = `shuttle-note-team-${today()}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const memberStats = (id: string) => summarizeMemberMatches(memberMatchHistory(matches.filter(m => schoolYear(m.date) === memberYear), id));
  const deletedMemberSection = <details className="deleted-members">
    <summary>削除済みの選手 ({deletedMembers.length})</summary>
    <div className="deleted-members-content">
      <p className="deleted-members-hint">一覧と新しい試合の検索候補から非表示にした選手です。過去の試合・成績は残っています。</p>
      {memberActionError?.action === 'restore' && <div className="error-banner" role="alert"><span>{memberActionError.message}</span><button type="button" onClick={() => setMemberActionError(null)}>閉じる</button></div>}
      {deletedMembers.length ? <ul className="deleted-member-list">{deletedMembers.map(member => <li className="deleted-member-row" key={member.id} aria-busy={memberOperation?.id === member.id || undefined}>
        <div><button className="player-name-link" type="button" onClick={() => setSelectedMemberId(member.id)} aria-label={`${member.name}の選手情報を見る`}>{member.name}</button><p>{member.group || '所属先の登録なし'}<span>・{memberClassification(member)}</span></p></div>
        <button className="secondary" type="button" disabled={Boolean(memberOperation)} onClick={() => void restoreMember(member)} aria-label={`${member.name}を復元`}>{memberOperation?.id === member.id && memberOperation.action === 'restore' ? '復元中…' : '復元'}</button>
      </li>)}</ul> : <p className="deleted-members-empty">削除済みの選手はいません。</p>}
    </div>
  </details>;
  return <div className="app-shell"><aside className="sidebar"><a href="/" className="brand"><span className="brand-symbol"><Icon name="arrow" size={24}/></span><span>Shuttle Note<small>TEAM MATCH JOURNAL</small></span></a><div className="team-badge"><span className="team-mark">T</span><div><strong>チームの記録</strong><span>ONE TEAM, EVERY MATCH.</span></div></div><span className="nav-caption">TEAM WORKSPACE</span><nav aria-label="メインメニュー"><button aria-label="試合一覧" className={`nav-item ${tab === "matches" ? "active" : ""}`} onClick={() => setTab("matches")}><Icon name="list"/><span>試合一覧</span><small>{matches.length}</small></button><button aria-label="メンバー管理" className={`nav-item ${tab === "members" ? "active" : ""}`} onClick={() => setTab("members")}><Icon name="people"/><span>メンバー管理</span><small>{members.length}</small></button><button aria-label="試合を記録" className="nav-item" onClick={openNewMatch}><Icon name="plus"/><span>試合を記録</span></button></nav><div className="sidebar-note"><span className="status-dot"/>チーム共通の記録に保存<p>一人ひとりの試合を、<br/>チームの経験に。</p></div></aside><main><header className="topbar"><div className="breadcrumb">TEAM WORKSPACE <span>/</span><strong>{tab === "members" ? "メンバー管理" : "試合一覧"}</strong></div><div className="viewer"><span className="sync-status"><span className="status-dot"/>{loading ? "読み込み中" : error ? "接続を確認" : "共通データに接続"}</span>{controls}</div></header><section className="page-heading"><div><div className="eyebrow">{tab === "members" ? "THE PEOPLE BEHIND EVERY RALLY" : "ONE TEAM. EVERY MATCH."}</div><h1>{tab === "members" ? "チームのメンバー" : "一試合ずつ、チームの力に。"}</h1><p>{tab === "members" ? "選手を登録して、試合と成績をつなげよう。" : "公式戦も、練習の一戦も。みんなの記録をここに。"}</p></div><button className="primary" disabled={loading || !team} onClick={tab === "members" ? () => setMemberModal({ member: null }) : openNewMatch}><Icon name="plus" size={17}/>{tab === "members" ? "外部選手を登録" : "試合を記録"}</button></section>{error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void load()}>再読み込み</button></div>}{loading && !team ? <div className="loading-panel"><div className="loader"/><p>チームの記録を読み込んでいます…</p></div> : team ? <><LinkApprovals/><div className="feedback-toolbar"><span>振り返りは本人だけに表示</span><button className="secondary" type="button" onClick={()=>setFeedbackJournalOpen(true)}>フィードバックを書く・見る</button></div>{tab === "matches" ? <><section className="stats-grid" aria-label="チームの成績"><article><span>記録した試合</span><div className="stat-icon"><Icon name="list"/></div><strong>{matches.length}<small>試合</small></strong><p>公式戦・練習試合・ゲーム練</p></article><article><span>外部対戦の勝率</span><div className="stat-icon"><Icon name="trophy"/></div><strong>{externalStats.winRate ?? "—"}<small>%</small></strong><p>{externalStats.wins}勝 {externalStats.losses}敗 {externalStats.draws}分 <span>部内戦を除く・勝率は引き分けを除く</span></p></article><article><span>入力候補の選手</span><div className="stat-icon"><Icon name="people"/></div><strong>{members.filter(m => m.status === "active").length}<small>人</small></strong><p>みんなで記録を積み重ねよう</p></article></section><div className="content-grid"><section className="panel records-panel"><div className="section-heading"><div><h2>試合の記録</h2><p>チーム全体の試合を、ひとつの一覧に。</p></div><button className="text-button export-button" onClick={exportCSV} disabled={!filtered.length}><Icon name="download" size={14}/> CSV出力</button></div><div className="filter-row"><label className="search-field"><Icon name="search" size={16}/><input aria-label="選手・対戦相手・大会名で検索" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="選手・対戦相手・大会名で検索"/></label><select aria-label="区分で絞り込み" value={category} onChange={e => setCategory(e.target.value)}><option value="all">すべての区分</option>{categories.map(c => <option key={c}>{c}</option>)}</select><select aria-label="メンバーで絞り込み" value={memberId} onChange={e => setMemberId(e.target.value)}><option value="all">すべての選手</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>{!matches.length ? <div className="empty-state"><span className="empty-icon"><Icon name="list" size={30}/></span><h3>最初の一試合を残そう。</h3><p>メンバーを選んで、得点を入力するだけ。<br/>記録はチームで共有できます。</p><button className="primary" onClick={openNewMatch}><Icon name="plus" size={16}/>試合を記録</button></div> : !filtered.length ? <div className="empty-state"><Icon name="search" size={28}/><h3>該当する試合がありません</h3><p>検索条件を変えてみてください。</p><button className="text-button" onClick={() => { setQuery(""); setCategory("all"); setMemberId("all"); }}>絞り込みを解除</button></div> : <div className="match-list">{filtered.map(m => { const r = result(m); return <article className="match-card" key={m.id}><div className="match-meta"><time>{dateLabel(m.date)}</time><span className={`category-badge ${m.category === "公式戦" ? "official" : ""}`}>{m.category}</span><span className="discipline">{m.discipline}</span><span className="match-event">{m.event}</span></div><div className="match-teams"><div className="match-side"><span className="side-label">{m.opponentType === "internal" ? "SIDE A" : "TEAM"}</span><strong>{playerLinks(m.sideAIds)}</strong></div><div className="match-score"><strong className={r.win ? "winner-score" : ""}>{r.a}</strong><span>−</span><strong className={r.loss ? "winner-score" : ""}>{r.b}</strong></div><div className="match-side side-right"><span className="side-label">{m.opponentType === "internal" ? "SIDE B" : "OPPONENT"}</span><strong>{m.opponentType === "internal" ? playerLinks(m.sideBIds) : playerNames(m.opponents)}</strong></div></div><div className="score-detail">{(m.opponentType === "external" || r.draw) && <span className={"result-tag " + r.outcome}>{r.draw ? "引き分け" : r.win ? "WIN" : "LOSE"}</span>}{m.opponentType === "internal" && <span className="internal-tag">部内</span>}{m.scores.map((s, i) => <span key={i}><small>セット{i + 1}</small> {s[0]}–{s[1]}</span>)}</div><p className="match-cohort-line">試合日の学年・記録時の所属：{historicLabels(m, [...m.sideAIds, ...(m.opponentType === "internal" ? m.sideBIds : [])])}</p>{m.memo && <p className="match-memo">{m.memo}</p>}<div className="match-footer"><span>入力：{m.createdByName || "チームメンバー"}</span><div>{viewer.memberId&&[...m.sideAIds,...m.sideBIds].includes(viewer.memberId)&&<button type="button" className="feedback-open-button" onClick={()=>setFeedbackMatchId(m.id)}>フィードバックを書く</button>}<button onClick={() => setMatchModal({ match: m })}>編集</button><button disabled={deleting === m.id} onClick={() => void deleteMatch(m)}>{deleting === m.id ? "削除中…" : "削除"}</button></div></div></article>; })}</div>}<div className="list-footer"><span>{filtered.length} / {matches.length} 試合</span><button className="text-button" onClick={() => void load()}><Icon name="refresh" size={13}/>最新の記録に更新</button></div></section><aside className="right-column"><article className="team-card"><div className="eyebrow">BUILD OUR TEAM</div><h2>ひとつの記録から、<br/>チームがつながる。</h2><p>部内の対戦は、どちらか一人の入力でOK。両方の選手の成績に反映されます。</p><div className="court-art" aria-hidden="true"><div className="court-inner"/><div className="court-net"/><span className="court-dot dot-one"/><span className="court-dot dot-two"/></div><span className="court-caption">EVERY MATCH IS OURS.</span></article><article className="quick-guide"><span className="eyebrow">GET STARTED</span><h3>記録までの、かんたん2ステップ</h3><div><span>01</span><p>外部選手を登録する<small>出場する選手を一覧に追加</small></p></div><div><span>02</span><p>試合を記録する<small>区分・選手・スコアを入力</small></p></div><button className="text-button" onClick={() => setTab("members")}>メンバー管理へ <Icon name="arrow" size={13}/></button></article><p className="sharing-note">このサイトにアクセスできるメンバーで、同じ記録を閲覧・更新できます。</p></aside></div></> : <><section className="member-summary"><div><Icon name="people" size={21}/><strong>{members.filter(m => m.status === "active").length}</strong><span>人を候補表示</span></div><p>所属は現在の設定。学年・出場数・勝敗は{memberYear}年度で表示します。</p></section><section className="panel members-panel"><div className="section-heading"><div><h2>登録メンバー <span className="count-pill">{members.length}</span></h2><p>内部は現役・OB/OGと期生、外部は学年・一般を表示します。卒業しても試合を記録できます。</p></div><label className="search-field member-search"><Icon name="search" size={16}/><input type="search" aria-label="メンバーを検索" placeholder="名前・所属・期生で検索" value={memberQuery} onChange={e => setMemberQuery(e.target.value)}/></label></div><div className="member-cohort-filters">
  <label>表示年度<select aria-label="メンバーの表示年度" value={memberYearChoice} onChange={e => setMemberYearChoice(e.target.value)}><option value="current">{currentSchoolYear}年度（現在・自動更新）</option>{memberYears.map(y => <option key={y} value={y}>{y}年度</option>)}</select></label>
  <label>所属<select aria-label="所属ラベルで絞り込み" value={memberAffiliation} onChange={e => setMemberAffiliation(e.target.value)}><option value="all">すべての所属</option><option value="internal">内部</option><option value="external">外部</option><option value="unspecified">未設定</option></select></label>
  <label>学年・区分<select aria-label="学年・区分で絞り込み" value={memberGrade} onChange={e => setMemberGrade(e.target.value)}><option value="all">すべての区分</option>{['高1','高2','高3','OB・OG','一般','高校入学前','未設定'].map(g => <option key={g}>{g}</option>)}</select></label>
  {(memberAffiliation !== 'all' || memberGrade !== 'all' || memberQuery) && <button className="text-button" onClick={() => {setMemberAffiliation('all');setMemberGrade('all');setMemberQuery('');}}>絞り込みを解除</button>}
  </div>{memberActionError?.action === 'delete' && <div className="error-banner member-action-error" role="alert"><span>{memberActionError.message}</span><button type="button" onClick={() => setMemberActionError(null)}>閉じる</button></div>}{!members.length ? <div className="empty-state"><span className="empty-icon"><Icon name="people" size={32}/></span><h3>まずは、メンバーを登録しよう。</h3><p>名前を登録すると、試合入力で選べるようになります。</p><button className="primary" onClick={() => setMemberModal({ member: null })}><Icon name="plus" size={16}/>メンバーを登録</button></div> : !listedMembers.length ? <div className="empty-state"><p>該当するメンバーがいません。</p></div> : <div className="members-table-wrap"><table className="members-table"><thead><tr><th>選手名</th><th>区分・期生</th><th>候補</th><th>出場</th><th>勝敗</th><th><span className="visually-hidden">操作</span></th></tr></thead><tbody>{listedMembers.map(m => { const stats = memberStats(m.id); return <tr key={m.id}><td><button type="button" className="member-profile-link" aria-label={`${m.name}の選手情報を見る`} onClick={() => setSelectedMemberId(m.id)}><span className="member-avatar" aria-hidden="true">{m.name.slice(0, 1)}</span><strong>{m.name}</strong><span className="profile-open-arrow" aria-hidden="true">↗</span></button></td><td><span className={"classification-badge " + (m.affiliation || "unspecified")}>{memberClassification(m, memberYearDate)}</span></td><td><span className={`member-status ${m.status}`}>{m.status === "active" ? "表示" : "非表示"}</span></td><td>{stats.total}<small> 試合</small></td><td>{stats.wins}<small> 勝 </small>{stats.losses}<small> 敗 </small>{stats.draws}<small> 分</small></td><td><div className="member-row-actions"><button className="text-button" type="button" disabled={Boolean(memberOperation)} aria-label={`${m.name}を編集`} onClick={() => setMemberModal({ member: m })}>編集</button><button className="text-button member-delete-button" type="button" disabled={Boolean(memberOperation)} aria-label={`${m.name}を削除`} onClick={() => void deleteMember(m)}>{memberOperation?.id === m.id && memberOperation.action === 'delete' ? '削除中…' : '削除'}</button></div></td></tr>; })}</tbody></table></div>}<div className="list-footer"><span>{listedMembers.length} 人を表示</span><span>学年は年度に合わせて自動表示</span></div></section>{deletedMemberSection}</>}</> : null}<footer className="site-footer"><span>SHUTTLE NOTE</span><span>チームの経験を、次のラリーへ。</span><span>TEAM EDITION / 02</span></footer></main>{feedbackMatchId&&<MatchFeedbackModal key={feedbackMatchId} matchId={feedbackMatchId} onClose={()=>setFeedbackMatchId(null)} onSaved={message=>{setFeedbackMatchId(null);notify(message);}}/>}{feedbackJournalOpen&&<FeedbackJournal availableMatches={memberMatchHistory(matches, viewer.memberId || '').map(({match})=>({matchId:match.id,context:{date:match.date,category:match.category,event:match.event,discipline:match.discipline,sideA:match.sideAIds.map(nameOf),sideB:match.opponentType==='internal'?match.sideBIds.map(nameOf):match.opponents,scores:match.scores}}))} viewerName={team?.viewer.name || viewer.name} onClose={()=>setFeedbackJournalOpen(false)} onSelect={id=>{setFeedbackJournalOpen(false);setFeedbackMatchId(id);}}/>}{matchModal && <MatchForm members={allMembers} match={matchModal.match} onSaved={() => saved("match")} onClose={() => setMatchModal(null)}/ >}{memberModal && <MemberForm key={memberModal.member?.id ?? "new"} member={memberModal.member} externalOnly={!memberModal.member} onSaved={() => saved("member")} onClose={() => setMemberModal(null)}/ >}{selectedMember && <MemberDetail key={selectedMember.id} member={selectedMember} members={allMembers} matches={matches} onClose={() => setSelectedMemberId(null)} onEdit={() => { if (selectedMember.deletedAt) return; setSelectedMemberId(null); setMemberModal({ member: selectedMember }); }}/ >}{notice && <div className="toast" role="status"><Icon name="check" size={16}/>{notice}</div>}</div>;
}

