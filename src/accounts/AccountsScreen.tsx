import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AccountForm } from "./AccountForm";
import { ACCOUNT_TYPE_LABELS, Account, AccountFields } from "./types";

interface AccountsScreenProps {
  selectedAccountId: number | null;
  isCategoriesActive: boolean;
  onSelectAccount: (account: Account) => void;
  onOpenCategories: () => void;
  onAccountUpdated: (account: Account) => void;
  onAccountDeleted: (id: number) => void;
}

export function AccountsScreen({
  selectedAccountId,
  isCategoriesActive,
  onSelectAccount,
  onOpenCategories,
  onAccountUpdated,
  onAccountDeleted,
}: AccountsScreenProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setAccounts(await invoke<Account[]>("list_accounts"));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(fields: AccountFields) {
    try {
      await invoke("create_account", { ...fields });
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(account: Account, fields: AccountFields) {
    try {
      await invoke("update_account", { id: account.id, ...fields });
      setEditingId(null);
      onAccountUpdated({ ...account, ...fields });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(account: Account) {
    const confirmed = window.confirm(`Delete the account "${account.name}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_account", { id: account.id });
      onAccountDeleted(account.id);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">PesantMoney</div>

      <ul className="account-list nav-list">
        <li
          className={`account-row${isCategoriesActive ? " selected" : ""}`}
          onClick={onOpenCategories}
        >
          <div className="account-row-name">Categories</div>
        </li>
      </ul>

      <ul className="account-list">
        {accounts.map((account) =>
          editingId === account.id ? (
            <li key={account.id}>
              <AccountForm
                initial={account}
                onSubmit={(fields) => handleUpdate(account, fields)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li
              key={account.id}
              className={`account-row${account.id === selectedAccountId ? " selected" : ""}`}
              onClick={() => onSelectAccount(account)}
            >
              <div>
                <div className="account-row-name">{account.name}</div>
                <div className="account-row-meta">
                  {ACCOUNT_TYPE_LABELS[account.account_type]}
                  {account.institution_name ? ` · ${account.institution_name}` : ""}
                </div>
              </div>
              <div className="account-actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(account.id);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(account);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      <div className="sidebar-footer">
        {adding ? (
          <AccountForm onSubmit={handleCreate} onCancel={() => setAdding(false)} />
        ) : (
          <button type="button" onClick={() => setAdding(true)}>
            Add account
          </button>
        )}
        {error && <p className="sidebar-error" role="alert">{error}</p>}
      </div>
    </nav>
  );
}
