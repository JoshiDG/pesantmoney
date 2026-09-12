import { KeyboardEvent, useEffect, useRef, useState } from "react";
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
import { CellPos, isTextInputTarget, nextCellForKey } from "../ui/grid-nav";
import { selectRowRange, toggleRowSelection } from "../ui/selection";
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

  // Grid keyboard navigation + row selection (ADR-0020's "Grid keyboard
  // navigation" section, #79): reuses the same `grid-nav.ts`/`selection.ts`
  // primitives TransactionsGrid consumes. Accounts has no per-cell inline
  // editing (see AccountForm, rendered as a whole-row swap), so this is
  // treated as a single-column grid (`colCount` = 1) -- arrow-key movement
  // is purely row-to-row, and `focusedCell.col` is always 0.
  const [focusedCell, setFocusedCell] = useState<CellPos | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const rowRefs = useRef<Record<number, HTMLLIElement | null>>({});

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

  const orderedIds = sortedAccounts.map((account) => account.id);
  const rowCount = sortedAccounts.length;

  // Move real DOM focus to whichever row `focusedCell` points at -- mirrors
  // TransactionsGrid's identical effect for `cellRefs`/`focusedCell`. The
  // `document.activeElement` guard avoids a focus/onFocus/setFocusedCell
  // loop some DOM implementations (jsdom included) would otherwise cause.
  useEffect(() => {
    if (focusedCell) {
      const el = rowRefs.current[focusedCell.row];
      if (el && document.activeElement !== el) {
        el.focus();
      }
    }
  }, [focusedCell]);

  function focusRow(row: number) {
    setFocusedCell((prev) => (prev && prev.row === row && prev.col === 0 ? prev : { row, col: 0 }));
  }

  function toggleSelectRow(accountId: number, shiftKey: boolean) {
    if (shiftKey && anchorId != null) {
      setSelected(selectRowRange(orderedIds, anchorId, accountId));
      return;
    }
    setSelected((prev) => toggleRowSelection(prev, accountId));
    setAnchorId(accountId);
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === sortedAccounts.length ? new Set() : new Set(orderedIds)));
  }

  function clearSelection() {
    setSelected(new Set());
    setAnchorId(null);
  }

  // Scoped bare single-letter shortcuts (ADR-0020's "Grid keyboard
  // navigation"/"Keyboard architecture" sections): active only while a row
  // has keyboard focus (this handler is attached per-row, never globally),
  // and guarded by `isTextInputTarget` so a focused text input (e.g. the
  // inline AccountForm's "Account name" field) never has its keystrokes
  // hijacked.
  //   e -- jump to Edit Account (the screen's highest-frequency action
  //        besides simply opening the account)
  //   t -- jump to the account's Transactions view (mirrors the existing
  //        row-click behavior, exposed as a keyboard shortcut)
  //   x -- toggle this row's selection (Shift+x extends the selection range
  //        from the last-toggled row, matching TransactionsGrid's
  //        checkbox shift-click range-select)
  function handleRowKeyDown(e: KeyboardEvent<HTMLLIElement>, row: number, account: Account) {
    if (isTextInputTarget(e.target)) return;

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      setFocusedCell(nextCellForKey({ row, col: 0 }, e.key, rowCount, 1, e.shiftKey));
      return;
    }

    switch (e.key) {
      case "Enter":
        e.preventDefault();
        onSelectAccount(account);
        break;
      case "e":
        e.preventDefault();
        setEditingId(account.id);
        break;
      case "t":
        e.preventDefault();
        onSelectAccount(account);
        break;
      case "x":
        e.preventDefault();
        toggleSelectRow(account.id, e.shiftKey);
        break;
      default:
        break;
    }
  }

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
          <div className="col-select">
            <input
              type="checkbox"
              aria-label="Select all accounts"
              checked={sortedAccounts.length > 0 && selected.size === sortedAccounts.length}
              onChange={toggleSelectAll}
            />
          </div>
          <div className="col-account">Account &amp; Institution</div>
          <div className="col-type">Type</div>
          <div className="col-balance">Balance</div>
          <div className="col-actions"></div>
        </div>
      )}

      {!isMobile && selected.size > 0 && (
        <div className="accounts-selection-bar">
          <span>{selected.size} selected</span>
          <button type="button" onClick={clearSelection}>
            Clear selection
          </button>
        </div>
      )}

      <ul className={isMobile ? "account-list account-list--cards" : "account-list"}>
        {sortedAccounts.map((account, row) => {
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
              ref={(el) => {
                if (!isMobile) rowRefs.current[row] = el;
              }}
              className={`${isMobile ? "account-card" : "account-row"}${
                !isMobile && focusedCell?.row === row ? " account-row-focused" : ""
              }${!isMobile && selected.has(account.id) ? " account-row-selected" : ""}`}
              tabIndex={isMobile ? undefined : 0}
              aria-selected={isMobile ? undefined : selected.has(account.id)}
              onClick={() => onSelectAccount(account)}
              onContextMenu={(e) => handleContextMenu(e, account)}
              onFocus={isMobile ? undefined : () => focusRow(row)}
              onKeyDown={isMobile ? undefined : (e) => handleRowKeyDown(e, row, account)}
            >
              {!isMobile && (
                <span className="account-row-select">
                  <input
                    type="checkbox"
                    aria-label={`Select ${account.name}`}
                    checked={selected.has(account.id)}
                    onClick={(e) => {
                      // No `preventDefault()` here (unlike some other
                      // checkbox handlers in this codebase): calling it
                      // caused jsdom's canceled-activation-behavior to
                      // revert the native `checked` property after commit,
                      // leaving it out of sync with `selected` state (see
                      // #79). `stopPropagation` alone is sufficient to keep
                      // this click from also bubbling to the row's
                      // navigate-to-Transactions handler; the actual
                      // selection toggle always derives from `selected`,
                      // never from the native checkbox's own state.
                      e.stopPropagation();
                      toggleSelectRow(account.id, e.shiftKey);
                    }}
                    onChange={() => {}}
                  />
                </span>
              )}

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
