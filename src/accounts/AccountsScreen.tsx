import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AccountForm } from "./AccountForm";
import { ACCOUNT_TYPE_LABELS, Account, AccountFields } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { useBreakpoint } from "../ui/BreakpointProvider";

interface AccountsScreenProps {
  // Opens the account's existing per-Account ledger screen (unchanged from
  // today). Per issue #50, this stays pointed at the per-Account ledger for
  // now -- it will be repointed to the new all-Accounts Transactions view,
  // pre-filtered to this Account, once that view lands in #51.
  onSelectAccount: (account: Account) => void;
  // Import always targets exactly one Account, so its entry point lives here
  // as a per-Account row action (per #49/#50).
  onImportAccount: (account: Account) => void;
  onAccountUpdated: (account: Account) => void;
  onAccountDeleted: (id: number) => void;
}

export function AccountsScreen({
  onSelectAccount,
  onImportAccount,
  onAccountUpdated,
  onAccountDeleted,
}: AccountsScreenProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();
  const tier = useBreakpoint();
  const isMobile = tier === "mobile";

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
    const confirmed = await confirm({
      title: "Delete Account",
      message: `Delete the account "${account.name}"? This cannot be undone.`,
      confirmLabel: "Delete Account",
    });
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
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Accounts</h2>
          <div className="account-title-meta">
            Every account you&rsquo;ve added -- select one to see its transactions
          </div>
        </div>
      </div>

      {error && (
        <p className="sidebar-error" role="alert">
          {error}
        </p>
      )}

      <ul className={isMobile ? "account-list account-list--cards" : "account-list"}>
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
              className={isMobile ? "account-card" : "account-row"}
              onClick={() => onSelectAccount(account)}
            >
              <div>
                <div className={isMobile ? "account-card-name" : "account-row-name"}>
                  {account.name}
                </div>
                <div className={isMobile ? "account-card-meta" : "account-row-meta"}>
                  {ACCOUNT_TYPE_LABELS[account.account_type]}
                  {account.institution_name ? ` · ${account.institution_name}` : ""}
                </div>
              </div>
              <div className="account-actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onImportAccount(account);
                  }}
                >
                  Import
                </button>
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

      {adding ? (
        <AccountForm onSubmit={handleCreate} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Add account
        </button>
      )}
    </section>
  );
}
