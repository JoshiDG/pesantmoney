import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { formatCents, Transaction } from "../transactions/types";

const VISIBLE_COUNT = 5;
const ALL_ACCOUNTS = "all";

function sortByDateDescending(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? 1 : -1;
    }
    return b.id - a.id;
  });
}

export function RecentTransactionsWidget() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactionsByAccount, setTransactionsByAccount] = useState<Map<number, Transaction[]>>(
    new Map(),
  );
  const [categoryNameById, setCategoryNameById] = useState<Map<number, string>>(new Map());
  const [accountFilter, setAccountFilter] = useState<string>(ALL_ACCOUNTS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [fetchedAccounts, categories] = await Promise.all([
          invoke<Account[]>("list_accounts"),
          invoke<Category[]>("list_categories"),
        ]);

        const perAccountTransactions = await Promise.all(
          fetchedAccounts.map((account) =>
            invoke<Transaction[]>("list_transactions", { account_id: account.id }),
          ),
        );

        if (cancelled) return;

        setAccounts(fetchedAccounts);
        setCategoryNameById(new Map(categories.map((c) => [c.id, c.name])));
        setTransactionsByAccount(
          new Map(fetchedAccounts.map((account, i) => [account.id, perAccountTransactions[i]])),
        );
        setError(null);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  const allTransactions =
    accountFilter === ALL_ACCOUNTS
      ? Array.from(transactionsByAccount.values()).flat()
      : transactionsByAccount.get(Number(accountFilter)) ?? [];

  const recent = sortByDateDescending(allTransactions.filter((t) => !t.hidden)).slice(
    0,
    VISIBLE_COUNT,
  );

  return (
    <div className="dashboard-widget">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">Recent Transactions</h3>
        <select
          className="dashboard-widget-period"
          aria-label="Recent transactions account filter"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value={ALL_ACCOUNTS}>All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert">{error}</p>}

      {recent.map((transaction) => (
        <div key={transaction.id} className="dashboard-list-row">
          <div>
            <div className="dashboard-list-row-name">
              {transaction.merchant_name ?? transaction.description}
            </div>
            <div className="dashboard-list-row-meta">
              {accountNameById.get(transaction.account_id) ?? "Unknown account"} ·{" "}
              {transaction.category_id != null
                ? categoryNameById.get(transaction.category_id) ?? "Uncategorized"
                : "Uncategorized"}{" "}
              · {transaction.date}
            </div>
          </div>
          <span className={`amount ${transaction.amount_cents < 0 ? "debit" : "credit"}`}>
            {formatCents(transaction.amount_cents)}
          </span>
        </div>
      ))}
      {recent.length === 0 && <p className="empty-state">No transactions yet.</p>}
    </div>
  );
}
