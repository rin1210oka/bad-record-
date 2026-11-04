export type MatchOutcome = 'win' | 'loss' | 'draw';

/** The side with more points wins a set; a tied set awards neither side a win. */
export function matchResult(scores: number[][]) {
  let a = 0, b = 0, drawnSets = 0;
  for (const [first, second] of scores) {
    if (first > second) a++;
    else if (second > first) b++;
    else drawnSets++;
  }
  const outcome: MatchOutcome = a > b ? 'win' : b > a ? 'loss' : 'draw';
  return { a, b, drawnSets, outcome, win: outcome === 'win', loss: outcome === 'loss', draw: outcome === 'draw' };
}

/** Draws are tracked separately and excluded from the win-rate denominator. */
export function matchSummary(results: { outcome: MatchOutcome }[]) {
  const wins = results.filter(result => result.outcome === 'win').length;
  const losses = results.filter(result => result.outcome === 'loss').length;
  const draws = results.filter(result => result.outcome === 'draw').length;
  return { total: results.length, wins, losses, draws, winRate: wins + losses ? Math.round(wins / (wins + losses) * 100) : null };
}
