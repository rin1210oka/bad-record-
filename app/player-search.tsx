import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { normalizeMemberName } from '../lib/member-name';
import { affiliationLabel, memberClassification, memberStage, sortMembers } from '../lib/member-cohort';
import type { CohortFields } from '../lib/member-cohort';

type Player = { id: string; name: string; group: string; status: 'active' | 'inactive'; deletedAt?: string | null } & CohortFields;
type Props = {
  label: string;
  members: Player[];
  value: string;
  onChange: (id: string) => void;
  excludedIds?: string[];
  required?: boolean;
};

const searchKey = (value: string) => normalizeMemberName(value).toLocaleLowerCase('ja-JP');
const playerDescription = (member: Player) => {
  const stage = memberStage(member);
  return [member.group || '所属先の登録なし', memberClassification(member), ...(member.affiliation === 'internal' && stage.grade !== null ? [stage.label] : [])].join('・');
};

export default function PlayerSearch({ label, members, value, onChange, excludedIds = [], required = false }: Props) {
  const id = useId(), listId = `${id}-list`, hintId = `${id}-hint`;
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const composing = useRef(false), preserveDraft = useRef(false);
  const selected = members.find(member => member.id === value);
  const [query, setQuery] = useState(selected?.name || '');
  const [open, setOpen] = useState(false), [active, setActive] = useState(0), [invalid, setInvalid] = useState(false);
  const selectedName = selected?.name;

  // A refreshed member list can rename a selection, but must not discard a search draft.
  useEffect(() => {
    if (value) setQuery(selectedName || '');
    else if (!preserveDraft.current) setQuery('');
    preserveDraft.current = false;
  }, [value, selectedName]);

  const candidates = useMemo(() => {
    const key = searchKey(query);
    return sortMembers(members
      .filter(member => (member.id === value || !excludedIds.includes(member.id)) &&
        (!key || searchKey(member.name).includes(key) || searchKey([playerDescription(member), affiliationLabel(member.affiliation)].join(' ')).includes(key))));
  }, [members, excludedIds, value, query]);

  const validSelection = Boolean(selected && query === selected.name);
  const error = !validSelection && (required || query.trim()) ? '候補から登録済みの選手を選択してください。' : '';
  useEffect(() => { input.current?.setCustomValidity(error); }, [error]);
  useEffect(() => { setActive(index => Math.max(0, Math.min(index, candidates.length - 1))); }, [candidates.length]);
  useEffect(() => {
    if (open && candidates[active]) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id, candidates.length]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, []);

  function choose(member: Player) {
    preserveDraft.current = false;
    setQuery(member.name); onChange(member.id); setInvalid(false);
    input.current?.setCustomValidity('');
    input.current?.focus();
    setOpen(false);
  }

  return <div className="player-search" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <label className="player-search-label" htmlFor={id}>{label}</label>
    <div className="player-search-input-wrap">
      <input ref={input} id={id} className="player-search-input" role="combobox" aria-autocomplete="list"
        aria-expanded={open} aria-controls={listId} aria-activedescendant={open && candidates[active] ? `${id}-option-${active}` : undefined}
        aria-describedby={hintId} aria-invalid={invalid && Boolean(error) || undefined}
        required={required} autoComplete="off" autoCapitalize="off" spellCheck={false}
        placeholder="名前を入力して検索" value={query}
        onFocus={event => { setOpen(true); setActive(0); if (validSelection) event.currentTarget.select(); }}
        onChange={event => {
          setQuery(event.target.value); setOpen(true); setActive(0); setInvalid(false);
          if (value) { preserveDraft.current = true; onChange(''); }
        }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; setOpen(true); setActive(0); }}
        onInvalid={() => setInvalid(true)}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setActive(index => !open ? direction > 0 ? 0 : Math.max(0, candidates.length - 1) : candidates.length ? (index + direction + candidates.length) % candidates.length : 0);
            setOpen(true);
          } else if (event.key === 'Enter' && (open || !validSelection)) {
            event.preventDefault(); event.stopPropagation();
            if (candidates[active]) choose(candidates[active]);
            else setInvalid(true);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false);
          } else if (event.key === 'Tab') setOpen(false);
        }}
      />
      {query && <button className="player-search-clear" type="button" aria-label={`${label}の選択をクリア`}
        onClick={() => { preserveDraft.current = false; setQuery(''); onChange(''); setOpen(true); setActive(0); setInvalid(false); input.current?.focus(); }}>×</button>}
    </div>
    <p className={`player-search-hint ${invalid && error ? 'is-error' : ''}`} id={hintId}>
      {invalid && error ? error : validSelection && selected ? `${playerDescription(selected)}${selected.deletedAt ? '・削除済み' : selected.status === 'inactive' ? '・候補から非表示' : ''}` : '名前・所属・学年から検索できます'}
    </p>
    {open && <div className="player-search-results">
      <div className="player-search-count" role="status">{candidates.length ? `${candidates.length}人の候補` : '該当する選手がいません'}</div>
      <ul className="player-search-list" id={listId} role="listbox" aria-label={`${label}の候補`}>
        {candidates.map((member, index) => <li key={member.id} role="presentation">
          <button type="button" role="option" id={`${id}-option-${index}`} tabIndex={-1} aria-selected={value === member.id}
            className={`player-search-option ${active === index ? 'is-active' : ''}`}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(member)}>
            <span className="player-search-option-name">{member.name}{value === member.id && <span aria-hidden="true"> ✓</span>}</span>
            <span className="player-search-option-group">{playerDescription(member)}{member.deletedAt ? <small>削除済み</small> : member.status === 'inactive' && <small>候補から非表示</small>}</span>
          </button>
        </li>)}
      </ul>
      {!candidates.length && <p className="player-search-empty">名前を変えて検索するか、メンバー管理で登録してください。</p>}
    </div>}
  </div>;
}
