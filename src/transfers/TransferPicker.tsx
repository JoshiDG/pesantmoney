import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { formatCents, Transaction } from "../transactions/types";

interface TransferPickerProps {
  transaction: Transaction;
  accounts: Account[];
  linkedTransactionIds: Set<number>;
  onLink: (toTransactionId: number) => void;
  onCancel: () => void;
}

/**
 * Lets the user pick a second Transaction to pair with `transaction` into a
 * Transfer. Loads heuristic suggestions first (same/opposite amount, date
 * within a few days, from `suggest_transfer_matches`) so likely matches sort
 * to the top, but also offers every other unlinked Transaction on a
 * different Account as a manual fallback, since the heuristic won't catch
 * every real transfer.
 */
export function TransferPicker({
  transaction,
  accounts,
  linkedTransactionIds,
  onLink,
  onCancel,
}: TransferPickerProps) {
  const [suggested, setSuggested] = useState<Transaction[]>([]);
  const [others, setOthers] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const pairs = await invoke<[Transaction, Transaction][]>("suggest_transfer_matches", {
          account_id: transaction.account_id,
        });
        const suggestedPartners = pairs
          .filter(([a]) => a.id === transaction.id)
          .map(([, b]) => b);
        const suggestedIds = new Set(suggestedPartners.map((t) => t.id));

        const otherAccounts = accounts.filter((account) => account.id !== transaction.account_id);
        const otherTransactionLists = await Promise.all(
          otherAccounts.map((account) =>
            invoke<Transaction[]>("list_transactions", { account_id: account.id }),
          ),
        );
        const fallback = otherTransactionLists
          .flat()
          .filter((t) => !linkedTransactionIds.has(t.id) && !suggestedIds.has(t.id));

        if (!cancelled) {
          setSuggested(suggestedPartners);
          setOthers(fallback);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction.id]);

  function candidateRow(candidate: Transaction, kind: "suggested" | "other") {
    return (
      <button
        type="button"
        key={candidate.id}
        className={`transfer-candidate transfer-candidate-${kind}`}
        onClick={() => onLink(candidate.id)}
      >
        <span className="transfer-candidate-account">{accountNameById.get(candidate.account_id)}</span>
        <span className="transfer-candidate-date">{candidate.date}</span>
        <span className="transfer-candidate-description">{candidate.description}</span>
        <span className={`amount ${candidate.amount_cents < 0 ? "debit" : "credit"}`}>
          {formatCents(candidate.amount_cents)}
        </span>
      </button>
    );
  }

  return (
    <div className="transfer-picker">
      <div className="transfer-picker-header">
        <span>Link &ldquo;{transaction.description}&rdquo; to a transaction on another account</span>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {error && <p role="alert">{error}</p>}

      {suggested.length > 0 && (
        <div className="transfer-candidate-group">
          <div className="transfer-candidate-group-label">Suggested matches</div>
          {suggested.map((candidate) => candidateRow(candidate, "suggested"))}
        </div>
      )}

      <div className="transfer-candidate-group">
        <div className="transfer-candidate-group-label">All other accounts</div>
        {others.length > 0 ? (
          others.map((candidate) => candidateRow(candidate, "other"))
        ) : (
          <p className="empty-state">No other unlinked transactions.</p>
        )}
      </div>
    </div>
  );
}
