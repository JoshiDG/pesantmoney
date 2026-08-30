import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AccountForm } from "./AccountForm";
import { ACCOUNT_TYPE_LABELS, Account, AccountFields } from "./types";

export function AccountsScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
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
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(id: number, fields: AccountFields) {
    try {
      await invoke("update_account", { id, ...fields });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(account: Account) {
    const confirmed = window.confirm(`Delete the Account "${account.name}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_account", { id: account.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section>
      <h2>Accounts</h2>
      {error && <p role="alert">{error}</p>}

      <AccountForm onSubmit={handleCreate} />

      <ul>
        {accounts.map((account) =>
          editingId === account.id ? (
            <li key={account.id}>
              <AccountForm
                initial={account}
                onSubmit={(fields) => handleUpdate(account.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={account.id}>
              <span>
                {account.name} — {ACCOUNT_TYPE_LABELS[account.account_type]}
                {account.institution_name ? ` — ${account.institution_name}` : ""}
              </span>
              <button type="button" onClick={() => setEditingId(account.id)}>
                Edit
              </button>
              <button type="button" onClick={() => handleDelete(account)}>
                Delete
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
