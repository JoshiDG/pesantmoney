// Pure row-selection helpers for any list/grid-shaped view's multi-row
// selection (e.g. for bulk actions). Kept free of React so the selection
// math is unit testable on its own and reusable across screens (see
// ADR-0020's "Grid keyboard navigation" section) -- currently consumed by
// TransactionsGrid, and intended for future Accounts/Recurring/Goals/
// Holdings/Categories/Rules grids.

/** Toggles membership of `id` in `selected`, returning a new Set. */
export function toggleRowSelection(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * Selects every id between `fromId` and `toId` (inclusive) as they appear
 * in `orderedIds`, for shift-click range selection. If `fromId` isn't
 * found in `orderedIds` (e.g. no prior anchor row), falls back to
 * selecting just `toId`.
 */
export function selectRowRange(orderedIds: number[], fromId: number, toId: number): Set<number> {
  const fromIndex = orderedIds.indexOf(fromId);
  const toIndex = orderedIds.indexOf(toId);
  if (fromIndex === -1 || toIndex === -1) {
    return new Set([toId]);
  }
  const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
  return new Set(orderedIds.slice(start, end + 1));
}
