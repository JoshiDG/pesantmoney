import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category, CategoryGroup } from "../categories/types";
import { Merchant } from "../merchants/types";
import { Tag } from "../tags/types";
import { Transfer } from "../transfers/types";
import { TransactionsGrid } from "./TransactionsGrid";
import { TransactionForm } from "./TransactionForm";
import { ContextBar } from "./chrome/ContextBar";
import { FunctionBar } from "./chrome/FunctionBar";
import { FiltersPopover } from "./chrome/FiltersPopover";
import { QuoteStrip } from "./chrome/QuoteStrip";
import { StatusBar } from "./chrome/StatusBar";
import { COLUMN_LABELS, COLUMN_SET, ColumnKey } from "./grid-nav";
import {
  ChecklistColumn,
  CHECKLIST_COLUMNS,
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  FilterState,
  FilterableColumn,
  FilterableRow,
  applyFilters,
  clearColumnFilter,
  distinctValueCounts,
  emptyFilterState,
  filterSummary,
  hasActiveFilters,
  activeFilterCount,
  isFilterableColumn,
  setDatePreset,
  setShowHidden,
  toggleColumnValue,
  toggleTypeFacet,
} from "./filters";
import {
  ColumnVisibility,
  DEFAULT_COLUMN_VISIBILITY,
  Transaction,
  TransactionFields,
  TransactionWithAccount,
} from "./types";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { CustomSelect } from "../ui/Dropdown";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { useCsvExport } from "../ui/useCsvExport";
import { useReservedShortcuts } from "../ui/ReservedShortcuts";

interface AllTransactionsScreenProps {
  // Pre-selects the Account filter, e.g. when opened from an Account row
  // click on the Accounts screen (#50/#51). `null` shows every Account.
  initialAccountId: number | null;
  // Set by the Command Palette's "New Transaction" action (#77) when it
  // navigates here from another screen -- opens the New Transaction panel
  // on arrival, same as pressing Cmd/Ctrl+N once already here.
  // `onAutoOpenNewHandled` clears the flag so it doesn't reopen on every
  // re-render.
  autoOpenNew?: boolean;
  onAutoOpenNewHandled?: () => void;
  // The Function Bar's Import chip (#90): the actual Import flow is a
  // full-screen, App-level view keyed to one Account (`ImportScreen`,
  // unchanged from before this screen absorbed the header that used to
  // reach it only from AccountsScreen) -- this screen can't render it
  // itself, so it asks App.tsx to switch views once the user has picked
  // which Account to import into.
  onImportAccount?: (account: Account) => void;
}

// The all-Accounts Transactions view (#51): defaults to every Transaction
// across every Account, with a filter to narrow to a single Account. All
// existing per-Transaction interactions (inline edit, categorize, Tag,
// link/unlink Transfer, mark Hidden, delete, bulk category assignment) are
// reused unchanged via TransactionsGrid -- this screen only adds the
// cross-Account data-fetch and the Account filter/badge on top of it.
export function AllTransactionsScreen({
  initialAccountId,
  autoOpenNew,
  onAutoOpenNewHandled,
  onImportAccount,
}: AllTransactionsScreenProps) {
  const [transactions, setTransactions] = useState<TransactionWithAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [tagsByTransactionId, setTagsByTransactionId] = useState<Record<number, Tag[]>>({});
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [allMerchants, setAllMerchants] = useState<Merchant[]>([]);
  const [accountFilter, setAccountFilter] = useState<number | null>(initialAccountId);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  // New Transaction panel (#77/#78): this screen previously had no manual
  // "create a Transaction" entry point at all (only Import produced
  // Transactions here -- see the per-Account TransactionsScreen.tsx, no
  // longer reachable from the Nav Rail, for the form/backend call this
  // reuses). Cmd/Ctrl+N and the Command Palette's "New Transaction" action
  // both need something to open, so this adds the minimal version: the
  // existing TransactionForm plus an Account picker (this view spans every
  // Account, unlike the per-Account screen TransactionForm was built for).
  const [creatingTransaction, setCreatingTransaction] = useState(false);
  const [newTransactionAccountId, setNewTransactionAccountId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  // Hidden transactions (#70): off by default. `list_all_transactions`
  // has no `include_hidden` param (unlike the per-Account
  // `list_visible_transactions`) -- see the "Hidden transactions" section
  // of #67's Implementation Decisions, which scopes `list_all_with_accounts`
  // to intentionally not filter hidden rows (that's a Reports-specific
  // exclusion, not a Transactions-view one). So this screen filters
  // client-side over the already-fetched, already-`hidden`-carrying rows,
  // same as its existing Account-filter logic below.
  // Filter model (#91, ADR-0021): Show Hidden moves into `FilterState` so
  // it's a single source of truth shared by the Function Bar's standalone
  // Show Hidden chip (unchanged since #90) and the Filters popover's own
  // Show Hidden checkbox -- both read/write the same `filters.showHidden`.
  const [filters, setFilters] = useState<FilterState>(emptyFilterState());
  const [filtersMenuPos, setFiltersMenuPos] = useState<{ x: number; y: number } | null>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  // Per-column right-click filter menu (#91): which column's menu is open,
  // and at what position. Built from `filterableRows` below via
  // `columnFilterMenuItems`.
  const [columnFilterMenu, setColumnFilterMenu] = useState<{
    x: number;
    y: number;
    column: FilterableColumn;
  } | null>(null);
  const { confirm } = useConfirmation();
  // Export chip (#90): the deleted per-Account TransactionsScreen's CSV
  // export moves here unchanged -- `useCsvExport` was already a
  // global/unfiltered export shared via a hook, not per-Account state, so
  // there is nothing else to migrate.
  const { exportCsv, exporting: exportingCsv, result: csvExportResult, error: csvExportError } = useCsvExport();
  // Import chip (#90): Import is a full-screen, App-level view keyed to a
  // single Account (see `onImportAccount`), so clicking the chip first asks
  // which Account to import into via this small inline picker -- the same
  // pattern the New Transaction panel below already uses for its own
  // Account picker.
  const [importPicking, setImportPicking] = useState(false);
  const [importAccountId, setImportAccountId] = useState<number | null>(null);
  // Columns chip (#90): reuses the grid's own Column Management model
  // (`columnVisibility`/`handleColumnVisibilityChange` below) through the
  // same `ContextMenu` checklist TransactionsGrid's header right-click
  // already renders, just opened from a button instead of a right-click.
  const [columnsMenuPos, setColumnsMenuPos] = useState<{ x: number; y: number } | null>(null);
  const columnsButtonRef = useRef<HTMLButtonElement>(null);
  // Quote Strip's selected-Account balance (#90): the other unique feature
  // the deleted per-Account TransactionsScreen had. `null` when "All
  // accounts" is selected -- there is no single balance to show.
  const [accountBalanceCents, setAccountBalanceCents] = useState<number | null>(null);

  // Keeps the filter in sync with the Account the caller pre-selected, even
  // if this screen is already mounted showing a different filter (e.g. the
  // user clicks a different Account row on the Accounts screen without
  // first navigating away from Transactions).
  useEffect(() => {
    setAccountFilter(initialAccountId);
  }, [initialAccountId]);

  async function refresh() {
    try {
      const [transactionList, categoryList, categoryGroupList, accountList, transferList] = await Promise.all([
        invoke<TransactionWithAccount[]>("list_all_transactions"),
        invoke<Category[]>("list_categories"),
        invoke<CategoryGroup[]>("list_category_groups"),
        invoke<Account[]>("list_accounts"),
        invoke<Transfer[]>("list_transfers"),
      ]);
      setTransactions(transactionList);
      setCategories(categoryList);
      setCategoryGroups(categoryGroupList ?? []);
      setAccounts(accountList);
      setTransfers(transferList);

      // Tags are only queryable per-Account today (#38); merge each
      // Account's map into one so the grid can look Tags up by Transaction
      // id regardless of which Account a row belongs to.
      const tagMaps = await Promise.all(
        accountList.map((account) =>
          invoke<Record<number, Tag[]>>("list_tags_for_account", { account_id: account.id }),
        ),
      );
      setTagsByTransactionId(Object.assign({}, ...tagMaps));

      const tagList = await invoke<Tag[]>("list_tags");
      setAllTags(tagList ?? []);

      const merchantList = await invoke<Merchant[]>("list_merchants");
      setAllMerchants(merchantList ?? []);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Column Management (#68): one global config for the whole app, so it's
  // loaded once on mount, independent of the Account filter.
  useEffect(() => {
    invoke<{ transaction_column_visibility: ColumnVisibility }>("get_settings")
      .then((settings) => setColumnVisibility(settings.transaction_column_visibility))
      .catch((err) => setError(String(err)));
  }, []);

  async function handleColumnVisibilityChange(next: ColumnVisibility) {
    setColumnVisibility(next);
    try {
      await invoke("update_transaction_column_visibility", {
        transaction_column_visibility: next,
      });
    } catch (err) {
      setError(String(err));
    }
  }

  function columnMenuItems(): ContextMenuItem[] {
    return COLUMN_SET.map((column) => ({
      label: COLUMN_LABELS[column],
      checked: columnVisibility[column],
      closeOnClick: false,
      onClick: () =>
        handleColumnVisibilityChange({ ...columnVisibility, [column]: !columnVisibility[column] }),
    }));
  }

  function openColumnsMenu() {
    const rect = columnsButtonRef.current?.getBoundingClientRect();
    setColumnsMenuPos({ x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 });
  }

  // Quote Strip's selected-Account balance (#90): fetched whenever the
  // Account filter changes, and re-fetched after every `refresh()` (i.e.
  // whenever `transactions` gets a new value) so an edit that changes a
  // Transaction's amount is reflected immediately, same as the deleted
  // per-Account screen's balance did.
  useEffect(() => {
    if (accountFilter == null) {
      setAccountBalanceCents(null);
      return;
    }
    invoke<number>("account_balance_cents", { account_id: accountFilter })
      .then(setAccountBalanceCents)
      .catch((err) => setError(String(err)));
  }, [accountFilter, transactions]);

  // CANC (#90/#91): clears search + all filters in one action (ADR-0021).
  // Search lands in #92 -- until then this resets every filter facet
  // (column filters, Date preset, Type, Show Hidden) back to the empty
  // state.
  function handleCancel() {
    setFilters(emptyFilterState());
  }

  // Filters chip (#91): toggles the Filters popover (Type, Show Hidden,
  // Clear All), anchored under the chip via `filtersButtonRef`.
  function openFiltersMenu() {
    setFiltersMenuPos((prev) => {
      if (prev) return null;
      const rect = filtersButtonRef.current?.getBoundingClientRect();
      return { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 };
    });
  }

  function openImportPicker() {
    if (accounts.length === 0) return;
    setImportAccountId(accountFilter ?? accounts[0].id);
    setImportPicking(true);
  }

  function handleStartImport() {
    const account = accounts.find((a) => a.id === importAccountId);
    if (account) {
      onImportAccount?.(account);
    }
    setImportPicking(false);
  }

  function openCreateTransaction() {
    if (accounts.length === 0) return;
    setNewTransactionAccountId(accountFilter ?? accounts[0].id);
    setCreatingTransaction(true);
  }

  async function handleCreateTransaction(fields: TransactionFields) {
    if (newTransactionAccountId == null) return;
    try {
      await invoke("create_transaction", { account_id: newTransactionAccountId, ...fields });
      setCreatingTransaction(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Bridges the Command Palette's "New Transaction" action (#77): when it
  // navigates here from a different screen, `autoOpenNew` arrives true on
  // mount and this opens the panel once, then tells the caller (App.tsx) to
  // clear the pending flag so it doesn't reopen on a later re-render.
  useEffect(() => {
    if (autoOpenNew) {
      openCreateTransaction();
      onAutoOpenNewHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenNew, accounts]);

  // Reserved Shortcut Set (#78): Cmd/Ctrl+N opens the New Transaction panel
  // above; Cmd/Ctrl+W and Escape close whichever of this screen's own
  // panels is open (the New Transaction panel, the transfer-link picker, or
  // -- as of #90 -- the Import chip's Account picker); Delete/Backspace
  // deletes the grid's current checkbox selection -- but only when exactly
  // one row is selected, since `onDelete` shows its own confirmation per
  // Transaction and firing it once per row for a large multi-select would
  // stack that many confirmation dialogs. This screen has no search input
  // yet (#92), so `onFocusSearch` is omitted.
  useReservedShortcuts({
    onNew: accounts.length > 0 ? openCreateTransaction : undefined,
    onCloseModal: () => {
      if (creatingTransaction) {
        setCreatingTransaction(false);
        return true;
      }
      if (linkingId != null) {
        setLinkingId(null);
        return true;
      }
      if (importPicking) {
        setImportPicking(false);
        return true;
      }
      return false;
    },
    onDeleteSelection:
      selectedIds.length === 1
        ? () => {
            const transaction = transactions.find((t) => t.id === selectedIds[0]);
            if (transaction) {
              handleDelete(transaction);
            }
          }
        : undefined,
  });

  async function handleUpdate(id: number, fields: TransactionFields) {
    try {
      await invoke("update_transaction", { id, ...fields });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Bulk Category assignment for the grid's multi-row selection -- same
  // approach as the per-Account screen: reuse `update_transaction` per
  // selected row rather than introducing a new backend command.
  async function handleBulkAssignCategory(ids: number[], categoryId: number | null) {
    try {
      await Promise.all(
        ids.map((id) => {
          const transaction = transactions.find((t) => t.id === id);
          if (!transaction) return Promise.resolve();
          return invoke("update_transaction", {
            id,
            date: transaction.date,
            amount_cents: transaction.amount_cents,
            description: transaction.description,
            category_id: categoryId,
          });
        }),
      );
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(transaction: Transaction) {
    const confirmed = await confirm({
      title: "Delete Transaction",
      message: `Delete this transaction ("${transaction.description}")? This cannot be undone.`,
      confirmLabel: "Delete Transaction",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_transaction", { id: transaction.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleLink(fromTransactionId: number, toTransactionId: number) {
    try {
      await invoke("link_transfer", {
        from_transaction_id: fromTransactionId,
        to_transaction_id: toTransactionId,
      });
      setLinkingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUnlink(transfer: Transfer) {
    try {
      await invoke("unlink_transfer", { id: transfer.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Hidden transactions (#70): same pattern as onUpdate/onDelete above --
  // call the already-existing `set_transaction_hidden` command, then
  // refresh.
  async function handleSetHidden(transaction: Transaction, hidden: boolean) {
    try {
      await invoke("set_transaction_hidden", { id: transaction.id, hidden });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Tag editing (#71) -- same create-if-needed-then-attach approach as
  // TransactionsScreen, since Tags aren't scoped to a single Account.
  async function resolveOrCreateTag(name: string): Promise<{ id: number }> {
    const existing = allTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    return invoke<Tag>("create_tag", { name });
  }

  async function handleAddTag(transactionId: number, tagName: string) {
    try {
      const tag = await resolveOrCreateTag(tagName);
      await invoke("attach_tag_to_transaction", { transaction_id: transactionId, tag_id: tag.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRemoveTag(transactionId: number, tagId: number) {
    try {
      await invoke("detach_tag_from_transaction", { transaction_id: transactionId, tag_id: tagId });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleBulkAssignTags(ids: number[], tagNames: string[]) {
    try {
      for (const tagName of tagNames) {
        const tag = await resolveOrCreateTag(tagName);
        await Promise.all(
          ids.map((id) => invoke("attach_tag_to_transaction", { transaction_id: id, tag_id: tag.id })),
        );
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Payee editing (#72, ADR-0019): same approach as TransactionsScreen --
  // `set_transaction_merchant_name` for a single-Transaction Payee set, plus
  // `create_merchant` (keyed on the transaction's full raw description
  // verbatim) on confirmed dictionary-add, before the same Payee set. Not
  // scoped to a single Account, so it needs no account_id.
  async function handleSetPayee(transactionId: number, payeeName: string) {
    try {
      await invoke("set_transaction_merchant_name", { id: transactionId, merchant_name: payeeName });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreateMerchant(transactionId: number, description: string, payeeName: string) {
    try {
      await invoke("create_merchant", { keyword: description, merchant_name: payeeName });
    } catch (err) {
      setError(String(err));
    }
    await handleSetPayee(transactionId, payeeName);
  }

  // Category combobox creation (#73) -- same approach as TransactionsScreen:
  // `create_category` (a Category can never exist without a Group), then
  // assign it via the same `update_transaction` path plain Category edits
  // and bulk assignment already use above. Not scoped to a single Account,
  // so it needs no account_id.
  async function handleCreateCategory(transactionId: number, name: string, groupId: number) {
    try {
      const category = await invoke<Category>("create_category", { group_id: groupId, name });
      const transaction = transactions.find((t) => t.id === transactionId);
      if (transaction) {
        await invoke("update_transaction", {
          id: transactionId,
          date: transaction.date,
          amount_cents: transaction.amount_cents,
          description: transaction.description,
          category_id: category.id,
        });
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  const linkedTransactionIds = new Set(
    transfers.flatMap((transfer) => [transfer.from_transaction_id, transfer.to_transaction_id]),
  );
  const transferByTransactionId = new Map<number, Transfer>();
  for (const transfer of transfers) {
    transferByTransactionId.set(transfer.from_transaction_id, transfer);
    transferByTransactionId.set(transfer.to_transaction_id, transfer);
  }

  // Filter model (#91): every Transaction enriched with the display fields
  // the filter module facets/matches against -- the same values the grid
  // itself renders (Account name, Payee, Category name, Tag names,
  // Transfer-linked) -- so a right-click filter menu's distinct values and
  // the AND/OR composition below both operate on exactly what's on screen.
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const filterableRows: FilterableRow[] = useMemo(
    () =>
      transactions.map((t) => ({
        transaction: t,
        accountName: t.account_name ?? "",
        payeeName: t.merchant_name || t.description,
        categoryName: t.category_id != null ? categoryNameById.get(t.category_id) ?? "Uncategorized" : "Uncategorized",
        tagNames: (tagsByTransactionId[t.id] ?? []).map((tag) => tag.name),
        isTransfer: linkedTransactionIds.has(t.id),
      })),
    [transactions, categoryNameById, tagsByTransactionId, linkedTransactionIds],
  );

  // Account filter (pre-existing, #51) narrows first; the filter model's
  // own facets (column filters, Date preset, Type, Show Hidden) then apply
  // on top, all AND'd together (ADR-0021).
  const accountFilteredRows = filterableRows.filter(
    (row) => accountFilter == null || row.transaction.account_id === accountFilter,
  );
  const visibleRows = applyFilters(accountFilteredRows, filters);
  const filteredTransactions: Transaction[] = visibleRows.map((row) => row.transaction);

  // TransactionsGrid now owns Account-column suppression itself (#68):
  // it force-hides the Account column whenever the transactions it's given
  // resolve to a single distinct Account, generalizing what this screen
  // used to compute locally as `showAccountBadge`.

  // Quote Strip totals (#90/#91): derived from the same filtered array the
  // grid renders, so they always match what's on screen -- recomputes on
  // every filter change per ADR-0021.
  const incomeCents = filteredTransactions
    .filter((t) => t.amount_cents > 0)
    .reduce((sum, t) => sum + t.amount_cents, 0);
  const expenseCents = filteredTransactions
    .filter((t) => t.amount_cents < 0)
    .reduce((sum, t) => sum + -t.amount_cents, 0);
  const netCents = incomeCents - expenseCents;
  const selectedAccountName = accountFilter != null ? accounts.find((a) => a.id === accountFilter)?.name ?? null : null;

  // Per-column right-click filter menu items (#91). For the Date column,
  // it's a single-select preset list; for every other filterable column,
  // it's a distinct-values checklist whose counts reflect every *other*
  // active facet (all columns except this one, plus Type/Show Hidden/
  // Account) -- Excel/Bloomberg-style faceting, so picking a value tells
  // you how many rows you'd be left with.
  function columnFilterMenuItems(column: FilterableColumn): ContextMenuItem[] {
    if (column === "date") {
      // Presets are single-select (exclusive), not a multi-select
      // checklist -- plain menu items, marked in the label when active,
      // rather than ContextMenuItem's checkbox rendering (which implies
      // OR-combinable multi-select, like the other columns below).
      return DATE_PRESETS.map((preset) => ({
        label: filters.datePreset === preset ? `${DATE_PRESET_LABELS[preset]} ✓` : DATE_PRESET_LABELS[preset],
        onClick: () => setFilters((prev) => setDatePreset(prev, preset)),
      }));
    }
    const checklistColumn = column as ChecklistColumn;
    const otherFilters: FilterState = {
      ...filters,
      columns: { ...filters.columns, [checklistColumn]: undefined },
    };
    const candidateRows = applyFilters(accountFilteredRows, otherFilters);
    const counts = distinctValueCounts(candidateRows, checklistColumn);
    const selected = filters.columns[checklistColumn] ?? new Set<string>();
    const items: ContextMenuItem[] = counts.map(({ value, count }) => ({
      label: `${value} (${count})`,
      checked: selected.has(value),
      closeOnClick: false,
      onClick: () => setFilters((prev) => toggleColumnValue(prev, checklistColumn, value)),
    }));
    if (selected.size > 0) {
      items.unshift({
        label: "Clear filter",
        onClick: () => setFilters((prev) => clearColumnFilter(prev, checklistColumn)),
      });
    }
    return items;
  }

  const activeFilterColumns = useMemo(() => {
    const active = new Set<ColumnKey>();
    if (filters.datePreset !== "all") active.add("date");
    for (const column of CHECKLIST_COLUMNS) {
      const selected = filters.columns[column];
      if (selected && selected.size > 0) active.add(column);
    }
    return active;
  }, [filters]);

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Transactions</h2>
          <div className="account-title-meta">Every transaction across every account</div>
        </div>
      </div>

      <FunctionBar
        onCancel={handleCancel}
        onNew={openCreateTransaction}
        newDisabled={accounts.length === 0}
        onImport={openImportPicker}
        importDisabled={accounts.length === 0}
        onExport={exportCsv}
        exportLabel={exportingCsv ? "Exporting…" : "Export"}
        exportDisabled={exportingCsv}
        onColumns={openColumnsMenu}
        columnsButtonRef={columnsButtonRef}
        onFilters={openFiltersMenu}
        filtersButtonRef={filtersButtonRef}
        filtersActive={hasActiveFilters(filters)}
        filtersActiveCount={activeFilterCount(filters)}
        showHidden={filters.showHidden}
        onToggleShowHidden={() => setFilters((prev) => setShowHidden(prev, !prev.showHidden))}
      />

      <ContextBar accounts={accounts} accountFilter={accountFilter} onAccountFilterChange={setAccountFilter} />

      <QuoteStrip
        rowCount={filteredTransactions.length}
        incomeCents={incomeCents}
        expenseCents={expenseCents}
        netCents={netCents}
        accountBalanceCents={accountBalanceCents}
        accountName={selectedAccountName}
      />

      {columnsMenuPos && (
        <ContextMenu
          x={columnsMenuPos.x}
          y={columnsMenuPos.y}
          items={columnMenuItems()}
          onClose={() => setColumnsMenuPos(null)}
        />
      )}

      {filtersMenuPos && (
        <FiltersPopover
          x={filtersMenuPos.x}
          y={filtersMenuPos.y}
          types={filters.types}
          showHidden={filters.showHidden}
          onToggleType={(type) => setFilters((prev) => toggleTypeFacet(prev, type))}
          onToggleShowHidden={() => setFilters((prev) => setShowHidden(prev, !prev.showHidden))}
          onClearAll={() => {
            setFilters(emptyFilterState());
            setFiltersMenuPos(null);
          }}
          onClose={() => setFiltersMenuPos(null)}
        />
      )}

      {columnFilterMenu && (
        <ContextMenu
          x={columnFilterMenu.x}
          y={columnFilterMenu.y}
          items={columnFilterMenuItems(columnFilterMenu.column)}
          onClose={() => setColumnFilterMenu(null)}
        />
      )}

      {error && <p role="alert">{error}</p>}
      {csvExportResult && <p className="csv-export-status">{csvExportResult}</p>}
      {csvExportError && (
        <p className="csv-export-status" role="alert">
          {csvExportError}
        </p>
      )}

      {creatingTransaction && (
        <div className="ledger new-transaction-row">
          <label>
            Account{" "}
            <CustomSelect
              ariaLabel="New transaction account"
              options={accounts.map((account) => ({ value: String(account.id), label: account.name }))}
              value={newTransactionAccountId != null ? String(newTransactionAccountId) : ""}
              onChange={(val) => setNewTransactionAccountId(Number(val))}
            />
          </label>
          <TransactionForm
            categories={categories}
            onSubmit={handleCreateTransaction}
            onCancel={() => setCreatingTransaction(false)}
          />
        </div>
      )}

      {importPicking && (
        <div className="ledger new-transaction-row">
          <label>
            Account{" "}
            <CustomSelect
              ariaLabel="Import account"
              options={accounts.map((account) => ({ value: String(account.id), label: account.name }))}
              value={importAccountId != null ? String(importAccountId) : ""}
              onChange={(val) => setImportAccountId(Number(val))}
            />
          </label>
          <button type="button" className="toolbar-btn toolbar-btn--primary" onClick={handleStartImport}>
            Continue
          </button>
          <button type="button" onClick={() => setImportPicking(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="ledger-container">
        <TransactionsGrid
          transactions={filteredTransactions}
          categories={categories}
          accounts={accounts}
          tagsByTransactionId={tagsByTransactionId}
          linkedTransactionIds={linkedTransactionIds}
          transferByTransactionId={transferByTransactionId}
          linkingId={linkingId}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={handleColumnVisibilityChange}
          onStartLink={setLinkingId}
          onCancelLink={() => setLinkingId(null)}
          onLink={handleLink}
          onUnlink={handleUnlink}
          onUpdate={handleUpdate}
          onBulkAssignCategory={handleBulkAssignCategory}
          onDelete={handleDelete}
          onSelectionChange={setSelectedIds}
          onSetHidden={handleSetHidden}
          tags={allTags}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onBulkAssignTags={handleBulkAssignTags}
          merchants={allMerchants}
          onSetPayee={handleSetPayee}
          onCreateMerchant={handleCreateMerchant}
          categoryGroups={categoryGroups}
          onCreateCategory={handleCreateCategory}
          onColumnFilterRequest={(column, x, y) => {
            if (isFilterableColumn(column)) {
              setColumnFilterMenu({ column, x, y });
            }
          }}
          activeFilterColumns={activeFilterColumns}
        />
      </div>

      <StatusBar
        visibleCount={filteredTransactions.length}
        totalCount={transactions.length}
        summary={filterSummary(filters) ?? undefined}
      />
    </section>
  );
}
