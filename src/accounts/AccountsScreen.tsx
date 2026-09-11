import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  ArrowUpDown,
  RotateCw,
  Plus,
  MoreHorizontal,
  BarChart2,
  FileSpreadsheet,
  Pencil,
  Trash2,
} from "lucide-react";
import { AccountForm } from "./AccountForm";
import { ACCOUNT_TYPE_LABELS, Account, AccountFields, AccountType } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { useBreakpoint } from "../ui/BreakpointProvider";
import { ContextMenu } from "../ui/ContextMenu";
import { Dropdown, DropdownOption } from "../ui/Dropdown";
import { formatCents } from "../transactions/types";

interface AccountsScreenProps {
  onSelectAccount: (account: Account) => void;
  onImportAccount: (account: Account) => void;
  onAccountUpdated: (account: Account) => void;
  onAccountDeleted: (id: number) => void;
}

type SortOption = "name-asc" | "name-desc" | "balance-desc" | "balance-asc" | "type";

const FILTER_OPTIONS: DropdownOption<AccountType | "all">[] = [
  { value: "all", label: "All Account Types" },
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit Card" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan" },
  { value: "cash", label: "Cash" },
];

const SORT_OPTIONS: DropdownOption<SortOption>[] = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "balance-desc", label: "Balance (High to Low)" },
  { value: "balance-asc", label: "Balance (Low to High)" },
  { value: "type", label: "Type" },
];

export function AccountsScreen({
  onSelectAccount,
  onImportAccount,
  onAccountUpdated,
  onAccountDeleted,
}: AccountsScreenProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [typeFilter, setTypeFilter] = useState<AccountType | "all">("all");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    account: Account;
  } | null>(null);

  const { confirm } = useConfirmation();
  const tier = useBreakpoint();
  const isMobile = tier === "mobile";

  async function refresh() {
    try {
      const [accList, netWorthBalances] = await Promise.all([
        invoke<Account[]>("list_accounts"),
        invoke<[Account, number][]>("get_net_worth_by_account").catch(() => []),
      ]);
      setAccounts(accList);

      const balMap: Record<number, number> = {};
      if (Array.isArray(netWorthBalances)) {
        for (const item of netWorthBalances) {
          if (Array.isArray(item) && item.length === 2 && item[0]?.id) {
            balMap[item[0].id] = item[1];
          }
        }
      }
      for (const acc of accList) {
        if (balMap[acc.id] === undefined) {
          try {
            const bal = await invoke<number>("account_balance_cents", { account_id: acc.id });
            balMap[acc.id] = bal;
          } catch {
            balMap[acc.id] = 0;
          }
        }
      }
      setBalances(balMap);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleManualRefresh() {
    setIsRefreshing(true);
    await refresh();
    setTimeout(() => setIsRefreshing(false), 400);
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

  function handleContextMenu(e: React.MouseEvent, account: Account) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      account,
    });
  }

  const filteredAccounts = accounts.filter((acc) => {
    if (typeFilter === "all") return true;
    return acc.account_type === typeFilter;
  });

  const sortedAccounts = [...filteredAccounts].sort((a, b) => {
    const balA = balances[a.id] ?? 0;
    const balB = balances[b.id] ?? 0;
    switch (sortBy) {
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "name-desc":
        return b.name.localeCompare(a.name);
      case "balance-desc":
        return balB - balA;
      case "balance-asc":
        return balA - balB;
      case "type":
        return a.account_type.localeCompare(b.account_type);
      default:
        return 0;
    }
  });

  return (
    <section className="accounts-section">
      {/* Sticky non-scrolling top header bar with title and Monarch Money style Lucide icon tools */}
      <div className="accounts-sticky-header">
        <div className="accounts-header-row">
          <h2 className="account-title">Accounts</h2>

          <div className="accounts-toolbar">
            <div className="accounts-toolbar-tools">
              <Dropdown
                trigger={<Search size={16} aria-hidden="true" />}
                options={FILTER_OPTIONS}
                value={typeFilter}
                onChange={setTypeFilter}
                ariaLabel="Filter accounts by type"
                isActive={typeFilter !== "all"}
              />

              <Dropdown
                trigger={<ArrowUpDown size={16} aria-hidden="true" />}
                options={SORT_OPTIONS}
                value={sortBy}
                onChange={setSortBy}
                ariaLabel="Sort accounts"
                isActive={sortBy !== "name-asc"}
              />

              <button
                type="button"
                className="toolbar-icon-btn"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                aria-label="Refresh accounts"
                title="Refresh accounts"
              >
                <RotateCw className={`refresh-icon ${isRefreshing ? "spinning" : ""}`} size={16} aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              className="toolbar-btn toolbar-btn--primary"
              onClick={() => setAdding(true)}
            >
              <Plus size={16} aria-hidden="true" />
              <span>Add account</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="sidebar-error" role="alert">
          {error}
        </p>
      )}

      {!isMobile && (
        <div className="account-table-header">
          <div className="col-account">Account &amp; Institution</div>
          <div className="col-type">Type</div>
          <div className="col-balance">Balance</div>
          <div className="col-actions"></div>
        </div>
      )}

      <ul className={isMobile ? "account-list account-list--cards" : "account-list"}>
        {sortedAccounts.map((account) => {
          const balanceCents = balances[account.id] ?? 0;
          return editingId === account.id ? (
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
              onContextMenu={(e) => handleContextMenu(e, account)}
            >
              <div className="account-row-info">
                <div className={isMobile ? "account-card-name" : "account-row-name"}>
                  {account.name}
                </div>
                {account.institution_name && (
                  <div className="account-row-institution">{account.institution_name}</div>
                )}
              </div>

              <div className="account-row-type">
                <span className={`account-type-badge account-type-badge--${account.account_type}`}>
                  {ACCOUNT_TYPE_LABELS[account.account_type]}
                </span>
              </div>

              <div className={`account-row-balance ${balanceCents < 0 ? "debit" : ""}`}>
                {formatCents(balanceCents)}
              </div>

              <div className="account-actions">
                <button
                  type="button"
                  className="account-menu-trigger"
                  aria-label={`Actions for ${account.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setContextMenu({
                      x: rect.left,
                      y: rect.bottom + 4,
                      account,
                    });
                  }}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "View Transactions",
              icon: <BarChart2 size={15} />,
              onClick: () => onSelectAccount(contextMenu.account),
            },
            {
              label: "Import CSV",
              icon: <FileSpreadsheet size={15} />,
              onClick: () => onImportAccount(contextMenu.account),
            },
            {
              label: "Edit Account",
              icon: <Pencil size={15} />,
              onClick: () => setEditingId(contextMenu.account.id),
            },
            {
              label: "Delete Account",
              icon: <Trash2 size={15} />,
              danger: true,
              onClick: () => handleDelete(contextMenu.account),
            },
          ]}
        />
      )}

      {adding && <AccountForm onSubmit={handleCreate} onCancel={() => setAdding(false)} />}
    </section>
  );
}
