import { formatCents } from "../types";

// The live totals strip above the Transactions grid (see CONTEXT.md's
// "Quote Strip" glossary entry): filtered row count, Income, Expense, Net
// (green/red signed), plus the selected Account's balance -- the only
// unique feature the deleted per-Account TransactionsScreen had that this
// chrome needed to absorb (#90). Full "recomputes on every filter/search
// change" wiring lands once filtering/search exist (#91/#92); today it
// recomputes on the one dimension already wired here, the Account filter
// and Show Hidden toggle.
export interface QuoteStripProps {
  rowCount: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  // Null when "All accounts" is selected -- there is no single balance to
  // show, matching the old per-Account screen only ever showing a balance
  // once scoped to one Account.
  accountBalanceCents: number | null;
  accountName: string | null;
}

export function QuoteStrip({
  rowCount,
  incomeCents,
  expenseCents,
  netCents,
  accountBalanceCents,
  accountName,
}: QuoteStripProps) {
  return (
    <div className="quote-strip" role="status" aria-label="Transactions summary">
      <div className="quote-strip-item">
        <span className="quote-strip-label">Transactions</span>
        <span className="quote-strip-value">{rowCount}</span>
      </div>
      <div className="quote-strip-item">
        <span className="quote-strip-label">Income</span>
        <span className="quote-strip-value quote-strip-value--credit">{formatCents(incomeCents)}</span>
      </div>
      <div className="quote-strip-item">
        <span className="quote-strip-label">Expense</span>
        <span className="quote-strip-value quote-strip-value--debit">{formatCents(expenseCents)}</span>
      </div>
      <div className="quote-strip-item">
        <span className="quote-strip-label">Net</span>
        <span className={`quote-strip-value ${netCents >= 0 ? "quote-strip-value--credit" : "quote-strip-value--debit"}`}>
          {formatCents(netCents)}
        </span>
      </div>
      {accountBalanceCents != null && (
        <div className="quote-strip-item quote-strip-item--balance">
          <span className="quote-strip-label">{accountName ? `${accountName} balance` : "Balance"}</span>
          <span className="quote-strip-value">{formatCents(accountBalanceCents)}</span>
        </div>
      )}
    </div>
  );
}
