// Minimal subsequence-based fuzzy matcher for the Command Palette (#77) --
// no external dependency, since matching against a couple dozen command
// labels doesn't need a general-purpose search library.
//
// A query matches a target when every query character appears in the target
// in order (not necessarily contiguous), case-insensitively -- e.g. "trns"
// matches "Transactions". Score rewards contiguous runs and an early match
// start, so "acc" ranks "Accounts" above a coincidental subsequence match
// buried deep in a longer label.

export function fuzzyMatch(query: string, target: string): boolean {
  return fuzzyScore(query, target) !== null;
}

/**
 * Returns a score (higher is a better match) or null if `query` isn't a
 * subsequence of `target`. An empty query matches everything with the
 * lowest score, so an empty palette input shows the full, unranked list.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();

  if (q.length === 0) {
    return 0;
  }

  let score = 0;
  let targetIndex = 0;
  let consecutiveRun = 0;

  for (let queryIndex = 0; queryIndex < q.length; queryIndex++) {
    const char = q[queryIndex];
    const foundAt = t.indexOf(char, targetIndex);
    if (foundAt === -1) {
      return null;
    }

    if (foundAt === targetIndex) {
      // Contiguous with the previous match -- reward runs of matched
      // characters more than scattered ones.
      consecutiveRun += 1;
      score += 2 * consecutiveRun;
    } else {
      consecutiveRun = 0;
      score += 1;
    }

    if (foundAt === 0) {
      // Small bonus for matching right at the start of the target.
      score += 1;
    }

    targetIndex = foundAt + 1;
  }

  // Shorter targets rank slightly higher for an equally-good match (a query
  // that matches "Budget" tightly should outrank the same query loosely
  // matching a much longer label).
  score += 1 / t.length;

  return score;
}

export interface FuzzyMatchable {
  label: string;
  keywords?: string[];
}

/**
 * Filters and ranks `items` by fuzzy match against `query`, checking each
 * item's label and any extra `keywords` (aliases that aren't shown but
 * still match), taking the best score across both. Returns items in
 * descending score order; an empty query returns `items` unchanged (palette
 * default view), stable in their original order.
 */
export function fuzzyFilter<T extends FuzzyMatchable>(query: string, items: T[]): T[] {
  if (query.trim().length === 0) {
    return items;
  }

  const scored = items
    .map((item) => {
      const candidates = [item.label, ...(item.keywords ?? [])];
      const best = candidates.reduce<number | null>((acc, candidate) => {
        const s = fuzzyScore(query, candidate);
        if (s === null) return acc;
        return acc === null ? s : Math.max(acc, s);
      }, null);
      return { item, score: best };
    })
    .filter((entry): entry is { item: T; score: number } => entry.score !== null);

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
}
