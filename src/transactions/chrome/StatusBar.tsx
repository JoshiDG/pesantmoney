// The bottom line of the Transactions screen (see CONTEXT.md's "Status Bar"
// glossary entry): filter/search state summary and current sort on the
// left, context-aware shortcut hints on the right. Phase 1 (#90) ships the
// shell -- a "visible of total" count plus a static hint string -- since
// there is no filter/search/sort state to summarize yet (#91/#92/#94).
export interface StatusBarProps {
  visibleCount: number;
  totalCount: number;
  summary?: string;
  hints?: string;
}

export function StatusBar({
  visibleCount,
  totalCount,
  summary,
  hints = "Cmd+N New · Cmd+F Search · ? Shortcuts",
}: StatusBarProps) {
  return (
    <div className="status-bar">
      <div className="status-bar-summary">
        <span className="status-bar-count">
          {visibleCount} of {totalCount}
        </span>
        {summary && <span className="status-bar-filters">{summary}</span>}
      </div>
      <div className="status-bar-hints">{hints}</div>
    </div>
  );
}
