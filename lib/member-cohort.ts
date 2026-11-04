export type Affiliation = 'internal' | 'external' | 'unspecified';
export type StageMode = 'cohort' | 'general' | 'unspecified';
export type GradeOverride = 1 | 2 | 3 | 'general';
export type CohortFields = {
  affiliation?: Affiliation;
  cohortYear?: number | null;
  stageMode?: StageMode;
  internalHistory?: boolean;
  generation?: number | null;
  gradeOverrides?: Record<string, GradeOverride>;
};
export type MemberSnapshot = { affiliation: Affiliation; gradeLabel: string; schoolYear: number; cohortYear: number | null };

export function japanDate(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function schoolYear(date = japanDate()): number {
  if (!validDate(date)) throw new Error('正しい日付を指定してください。');
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  return year - (month < 4 ? 1 : 0);
}

/** Standard progression only. The birth date is used locally and is not persisted. */
export function highSchoolEntryYear(birthDate: string): number | null {
  if (!validDate(birthDate)) return null;
  const year = Number(birthDate.slice(0, 4)), monthDay = birthDate.slice(5);
  return year + 16 - (monthDay <= '04-01' ? 1 : 0);
}

export function affiliationLabel(value?: Affiliation): string {
  return value === 'internal' ? '内部' : value === 'external' ? '外部' : '所属未設定';
}

/** Only preselect a branch when both legacy fields agree; otherwise ask the user. */
export function teamHistoryChoice(member: CohortFields): boolean | null {
  if (member.affiliation === 'internal' && member.internalHistory === true) return true;
  if (member.affiliation === 'external' && member.internalHistory === false) return false;
  return null;
}

/** Grade corrections apply from their year onwards, without rewriting earlier years. */
export function memberStage(member: CohortFields, date = japanDate()) {
  const year = schoolYear(date);
  const correctionYear = Object.keys(member.gradeOverrides || {}).map(Number).filter(value => Number.isInteger(value) && value <= year).sort((a, b) => b - a)[0];
  const correction = correctionYear === undefined ? undefined : member.gradeOverrides?.[String(correctionYear)];
  const cohortYear = correction && correction !== 'general' ? correctionYear - correction + 1 : member.cohortYear ?? null;
  let label = '未設定', grade: number | null = null;
  if (member.stageMode === 'general' || member.stageMode === 'cohort' && correction === 'general') {
    label = member.internalHistory ? 'OB・OG' : '一般';
  } else if (member.stageMode === 'cohort' && cohortYear !== null) {
    const calculated = year - cohortYear + 1;
    if (calculated >= 1 && calculated <= 3) { grade = calculated; label = `高${calculated}`; }
    else if (calculated > 3) label = member.internalHistory ? 'OB・OG' : '一般';
    else label = '高校入学前';
  }
  return { label, grade, schoolYear: year, cohortYear, affiliationLabel: affiliationLabel(member.affiliation) };
}

/** Current membership presentation; generation is entered, never inferred from age. */
export function memberClassification(member: CohortFields, date = japanDate()): string {
  const stage = memberStage(member, date);
  const stageLabel = stage.label === '未設定' ? '学年未設定' : stage.label;
  if (member.affiliation === 'external') return `外部・${stage.grade !== null ? stage.label : stage.label === 'OB・OG' ? '一般' : stageLabel}`;
  if (member.affiliation !== 'internal') return `所属未設定・${stageLabel}`;
  const generation = Number.isSafeInteger(member.generation) && member.generation! >= 1 && member.generation! <= 9999 ? `${member.generation}期生` : '期生未設定';
  if (stage.grade !== null) return `現役・${generation}`;
  if (stage.label === 'OB・OG') return `OB/OG・${generation}`;
  return `内部・${stageLabel}・${generation}`;
}

export type OrderedMember = CohortFields & { name: string; group?: string; id?: string };
const memberNameOrder = new Intl.Collator('ja', { usage: 'sort', sensitivity: 'accent' });
const memberNameDetailOrder = new Intl.Collator('ja', { usage: 'sort', sensitivity: 'variant' });

function memberOrderKey(member: OrderedMember, date: string): [number, number] {
  const stage = memberStage(member, date);
  const gradeOrder = stage.grade !== null ? 3 - stage.grade : stage.label === '高校入学前' ? 3 : stage.label === '一般' || stage.label === 'OB・OG' ? 4 : 5;
  if (member.affiliation === 'internal' && stage.label === 'OB・OG') {
    const generation = member.generation;
    return [1, Number.isSafeInteger(generation) && generation! >= 1 && generation! <= 9999 ? generation! : Number.MAX_SAFE_INTEGER];
  }
  return [member.affiliation === 'internal' ? 0 : member.affiliation === 'external' ? 2 : 3, gradeOrder];
}

/** Internal students, alumni, then external players; senior grades and older cohorts first. */
export function compareMembers(a: OrderedMember, b: OrderedMember, date = japanDate()): number {
  const [aGroup, aOrder] = memberOrderKey(a, date), [bGroup, bOrder] = memberOrderKey(b, date);
  if (aGroup !== bGroup) return aGroup - bGroup;
  if (aOrder !== bOrder) return aOrder - bOrder;
  const aName = a.name.normalize('NFKC'), bName = b.name.normalize('NFKC');
  return memberNameOrder.compare(aName, bName) ||
    memberNameDetailOrder.compare((a.group || '').normalize('NFKC'), (b.group || '').normalize('NFKC')) ||
    (a.id || '').localeCompare(b.id || '', 'en');
}

/** Keep API/state arrays and saved participant order untouched. */
export function sortMembers<T extends OrderedMember>(members: readonly T[], date = japanDate()): T[] {
  return [...members].sort((a, b) => compareMembers(a, b, date));
}

export function memberSnapshot(member: CohortFields, date: string): MemberSnapshot {
  const stage = memberStage(member, date);
  return { affiliation: member.affiliation || 'unspecified', gradeLabel: stage.label, schoolYear: stage.schoolYear, cohortYear: stage.cohortYear };
}
