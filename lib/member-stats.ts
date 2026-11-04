import { matchResult, matchSummary } from './match-result';

export type MemberMatch = {
  id: string; date: string; category: string; event: string; discipline: string;
  opponentType: 'internal' | 'external'; sideAIds: string[]; sideBIds: string[];
  opponents: string[]; scores: number[][]; memo: string;
};

/** Orient a shared match once, from the selected player's side. */
export function memberMatchHistory<T extends MemberMatch>(matches: T[], memberId: string, category = 'all') {
  return matches
    .filter(match => (category === 'all' || match.category === category) &&
      (match.sideAIds.includes(memberId) || match.opponentType === 'internal' && match.sideBIds.includes(memberId)))
    .map(match => {
      const isA = match.sideAIds.includes(memberId);
      const scores = match.scores.map(([a, b]) => isA ? [a, b] : [b, a]);
      const result = matchResult(scores);
      return {
        match, scores, gamesWon: result.a, gamesLost: result.b,
        won: result.win, lost: result.loss, drawn: result.draw, outcome: result.outcome,
        ownIds: isA ? match.sideAIds : match.sideBIds,
        oppositeIds: match.opponentType === 'internal' ? isA ? match.sideBIds : match.sideAIds : [],
        opponents: match.opponentType === 'external' ? match.opponents : [],
      };
    })
    .sort((a, b) => b.match.date.localeCompare(a.match.date));
}

export function summarizeMemberMatches(history: { outcome: 'win' | 'loss' | 'draw' }[]) {
  return matchSummary(history);
}
