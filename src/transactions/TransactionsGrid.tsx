import {
  ChangeEvent,
  Fragment,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Account } from "../accounts/types";
import { Category, CategoryGroup } from "../categories/types";
import { Merchant } from "../merchants/types";
import { Tag } from "../tags/types";
import { useBreakpoint } from "../ui/BreakpointProvider";
import { ConfirmCreateDialog } from "../ui/ConfirmCreateDialog";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { TransferPicker } from "../transfers/TransferPicker";
import { Transfer } from "../transfers/types";
import { CellPos, nextCellForKey } from "../ui/grid-nav";
import { selectRowRange, toggleRowSelection } from "../ui/selection";
import { COLUMN_SET, ColumnKey, EDITABLE_COLUMNS } from "./grid-nav";
import { SuggestionCombobox } from "../ui/SuggestionCombobox";
import {
  ColumnVisibility,
  centsToDollarInput,
  dollarInputToCents,
  formatCents,
  Transaction,
  TransactionFields,
} from "./types";

const UNCATEGORIZED = "";
const BULK_PLACEHOLDER = "__bulk_placeholder__";
const NO_BALANCE = "—";

type SortDirection = "asc" | "desc";

// Client-side, single-column, three-state sort (see #67's "Sorting"
// Implementation Decision and issue #69): a header click cycles
// asc -> desc -> cleared (null, back to the default date-desc order the
// screen already loaded `transactions` in). Only one column is ever
// sorted at a time -- clicking a different header resets the cycle.
interface SortState {
  column: ColumnKey;
  direction: SortDirection;
}

// Field labels for the Column Management checklist and the Mobile-tier
// stacked-card layout (ADR-0018) -- the grid's column headers don't apply
// to cards, so each field is labeled inline instead.
const COLUMN_LABELS: Record<ColumnKey, string> = {
  date: "Date",
  account: "Account",
  payee: "Payee",
  memo: "Memo",
  category: "Category",
  tags: "Tags",
  amount: "Amount",
  running_balance: "Running Balance",
};

// Column widths for the grid's CSS Grid layout (see `.ledger`/`.ledger-editable`
// in App.css). Computed here rather than in CSS because the set of visible
// columns is dynamic (Column Management show/hide, Account auto-suppression).
const COLUMN_WIDTHS: Record<ColumnKey, string> = {
  date: "112px",
  account: "120px",
  payee: "1fr",
  memo: "1fr",
  category: "150px",
  tags: "140px",
  amount: "130px",
  running_balance: "130px",
};

interface TransactionsGridProps {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  tagsByTransactionId?: Record<number, Tag[]>;
  linkedTransactionIds: Set<number>;
  transferByTransactionId: Map<number, Transfer>;
  linkingId: number | null;
  columnVisibility: ColumnVisibility;
  onColumnVisibilityChange: (next: ColumnVisibility) => void;
  onStartLink: (transactionId: number) => void;
  onCancelLink: () => void;
  onLink: (fromTransactionId: number, toTransactionId: number) => void;
  onUnlink: (transfer: Transfer) => void;
  onUpdate: (id: number, fields: TransactionFields) => void;
  onBulkAssignCategory: (ids: number[], categoryId: number | null) => void;
  onDelete: (transaction: Transaction) => void;
  // Hidden-transaction support (#70): a row-level right-click context menu
  // offers Hide/Unhide, toggling the already-existing backend `hidden`
  // field. Callers (TransactionsScreen/AllTransactionsScreen) call
  // `set_transaction_hidden` and refresh -- the grid itself is unaware of
  // the persistence mechanism, same as onDelete/onUpdate.
  onSetHidden: (transaction: Transaction, hidden: boolean) => void;
  // Tag editing (#71): `tags` is the full known-Tag-names list (from
  // `list_tags`), seeding the SuggestionCombobox's `knownValues` for both
  // the per-row Tags cell editor and the bulk-actions "Add tag to
  // selection" control. `onAddTag`/`onRemoveTag`/`onBulkAssignTags` are
  // caller-supplied, same as onUpdate/onSetHidden -- the grid never calls
  // `invoke` itself. Whether the tag name already exists or needs
  // `create_tag`-ing first is entirely the screen layer's call: the grid
  // fires the same callback for both a matched known Tag and a brand-new
  // one, since Tags are ungated (immediate create, no confirmation dialog
  // -- see #67's Implementation Decisions).
  tags?: Tag[];
  onAddTag?: (transactionId: number, tagName: string) => void;
  onRemoveTag?: (transactionId: number, tagId: number) => void;
  onBulkAssignTags?: (ids: number[], tagNames: string[]) => void;
  // Payee editing (#72, ADR-0019): `merchants` is the full Merchant
  // dictionary (from `list_merchants`), seeding the SuggestionCombobox's
  // `knownValues` the same way `tags` seeds the Tags editor. Committing a
  // value matching a known Merchant name fires `onSetPayee` directly; an
  // unmatched value opens a confirm dialog (owned by this component, not the
  // screen) before firing either `onCreateMerchant` (Yes: dictionary entry +
  // Payee set) or `onSetPayee` (No: Payee set only) -- see #67's "Create-new
  // flow" Implementation Decision. The grid never calls `invoke` itself;
  // screens own the persistence, same as onAddTag/onSetHidden.
  merchants?: Merchant[];
  onSetPayee?: (transactionId: number, payeeName: string) => void;
  onCreateMerchant?: (transactionId: number, description: string, payeeName: string) => void;
  // Category combobox editing + inline creation (#73): `categoryGroups` is
  // the full list of Category Groups (from `list_category_groups`), seeding
  // the create-new confirmation dialog's Group dropdown (a Category can
  // never exist without a Group -- see CONTEXT.md's Category entry).
  // Committing a value matching a known Category name fires `onUpdate`
  // directly via the same category_id path plain Category edits have always
  // used (see `commitEdit`'s "category" case, unchanged since before #73);
  // an unmatched value opens a confirm dialog (owned by this component, same
  // pattern as Payee's `payeeConfirm`) collecting the Group before calling
  // `onCreateCategory`, which the caller wires to `create_category` followed
  // by the same category-assignment path. The grid never calls `invoke`
  // itself, same as onSetPayee/onAddTag/onSetHidden.
  categoryGroups?: CategoryGroup[];
  onCreateCategory?: (transactionId: number, name: string, groupId: number) => void;
}

// Only these four columns are backed by EDITABLE_COLUMNS (see grid-nav.ts);
// everything else in cellValue/commitEdit's switches is unreachable but
// exhaustively handled to keep TypeScript honest about ColumnKey.
function cellValue(transaction: Transaction, column: ColumnKey): string {
  switch (column) {
    case "date":
      return transaction.date;
    case "memo":
      return transaction.description;
    case "category":
      return transaction.category_id != null ? String(transaction.category_id) : UNCATEGORIZED;
    case "amount":
      return centsToDollarInput(transaction.amount_cents);
    default:
      return "";
  }
}

export function TransactionsGrid({
  transactions,
  categories,
  accounts,
  tagsByTransactionId = {},
  linkedTransactionIds,
  transferByTransactionId,
  linkingId,
  columnVisibility,
  onColumnVisibilityChange,
  onStartLink,
  onCancelLink,
  onLink,
  onUnlink,
  onUpdate,
  onBulkAssignCategory,
  onDelete,
  onSetHidden,
  tags = [],
  onAddTag,
  onRemoveTag,
  onBulkAssignTags,
  merchants = [],
  onSetPayee,
  onCreateMerchant,
  categoryGroups = [],
  onCreateCategory,
}: TransactionsGridProps) {
  const knownTagNames = useMemo(() => tags.map((tag) => tag.name), [tags]);
  const knownMerchantNames = useMemo(
    () => merchants.map((merchant) => merchant.merchant_name),
    [merchants],
  );
  const knownCategoryNames = useMemo(() => categories.map((category) => category.name), [categories]);
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );
  const tier = useBreakpoint();
  const isMobile = tier === "mobile";

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [focusedCell, setFocusedCell] = useState<CellPos | null>(null);
  const [editingCell, setEditingCell] = useState<CellPos | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState(BULK_PLACEHOLDER);
  const [flashCell, setFlashCell] = useState<CellPos | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ x: number; y: number } | null>(null);
  const [sortState, setSortState] = useState<SortState | null>(null);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; transaction: Transaction } | null>(
    null,
  );
  // Tags cell editing (#71): a NEW interaction, deliberately kept outside
  // the col-index-based focus/edit scheme in grid-nav.ts (EDITABLE_COLUMNS
  // stays exactly ["date","memo","category","amount"] -- adding a fifth
  // entry there would shift every existing keyboard-nav test's col index).
  // Tracked by transaction id since Tags editing isn't part of a
  // fixed-column-index row.
  const [editingTagsId, setEditingTagsId] = useState<number | null>(null);
  // Payee cell editing (#72): same "outside the fixed-column-index scheme"
  // approach as editingTagsId above -- tracked by transaction id, not a
  // EDITABLE_COLUMNS col index. `payeeConfirm` holds the pending unmatched
  // value while the create-new confirmation dialog (ADR-0019) is open; it's
  // cleared as soon as the user answers Yes or No.
  const [editingPayeeId, setEditingPayeeId] = useState<number | null>(null);
  const [payeeConfirm, setPayeeConfirm] = useState<{
    transactionId: number;
    description: string;
    name: string;
  } | null>(null);
  // Category create-new confirmation (#73): mirrors `payeeConfirm` above,
  // plus a Group id since a Category can never exist without one.
  // `lastUsedCategoryGroupId` tracks the Group of the most-recently-assigned
  // Category *this session* (updated on every successful Category
  // assignment made through this grid, matched or newly-created) -- #73
  // leaves exact recency scope (session vs. overall) as a developer call;
  // this is the simplest defensible choice. Falls back to the first
  // available Group when nothing has been assigned yet this session.
  const [categoryConfirm, setCategoryConfirm] = useState<{
    transactionId: number;
    name: string;
    groupId: number;
  } | null>(null);
  const [lastUsedCategoryGroupId, setLastUsedCategoryGroupId] = useState<number | null>(null);

  const editingRef = useRef<CellPos | null>(null);
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const flashFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (flashFrameRef.current != null) cancelAnimationFrame(flashFrameRef.current);
    };
  }, []);

  // The Account column is force-hidden whenever the current view resolves
  // to a single distinct Account, regardless of the user's stored
  // visibility choice (generalizes the logic `AllTransactionsScreen`'s
  // `showAccountBadge` used to implement locally). Running Balance uses the
  // same single-Account signal, but doesn't hide -- it stays in the Column
  // Set and renders blank per-row instead (see `runningBalanceByTransactionId`).
  const distinctAccountCount = useMemo(
    () => new Set(transactions.map((t) => t.account_id)).size,
    [transactions],
  );
  const isSingleAccount = distinctAccountCount <= 1;

  const visibleColumns = useMemo(
    () =>
      COLUMN_SET.filter((column) =>
        column === "account" ? columnVisibility.account && !isSingleAccount : columnVisibility[column],
      ),
    [columnVisibility, isSingleAccount],
  );

  const runningBalanceByTransactionId = useMemo(() => {
    const map = new Map<number, number>();
    if (!isSingleAccount) return map;
    const dateOrdered = [...transactions].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id - b.id,
    );
    let running = 0;
    for (const transaction of dateOrdered) {
      running += transaction.amount_cents;
      map.set(transaction.id, running);
    }
    return map;
  }, [transactions, isSingleAccount]);

  const gridTemplateColumns = useMemo(
    () => ["28px", ...visibleColumns.map((column) => COLUMN_WIDTHS[column]), "112px"].join(" "),
    [visibleColumns],
  );

  // Sort-key extraction per column, shared by the comparator below. Text
  // columns are lower-cased for a case-insensitive sort; Amount and Running
  // Balance sort numerically on their underlying cents value.
  function sortValue(transaction: Transaction, column: ColumnKey): string | number {
    switch (column) {
      case "date":
        return transaction.date;
      case "account":
        return (
          transaction.account_name ?? accountNameById.get(transaction.account_id) ?? ""
        ).toLowerCase();
      case "payee":
        return (transaction.merchant_name || transaction.description).toLowerCase();
      case "memo":
        return transaction.description.toLowerCase();
      case "category": {
        const name =
          transaction.category_id != null
            ? categoryNameById.get(transaction.category_id) ?? "Uncategorized"
            : "Uncategorized";
        return name.toLowerCase();
      }
      case "tags":
        return (tagsByTransactionId[transaction.id] ?? [])
          .map((tag) => tag.name)
          .join(",")
          .toLowerCase();
      case "amount":
        return transaction.amount_cents;
      case "running_balance":
        return runningBalanceByTransactionId.get(transaction.id) ?? 0;
      default:
        return "";
    }
  }

  // The sorted copy rendered by the grid. `transactions` (the prop) is never
  // mutated -- when `sortState` is null this is just the original,
  // already-date-desc-loaded order the screen passed in.
  const sortedTransactions = useMemo(() => {
    if (!sortState) return transactions;
    const { column, direction } = sortState;
    const factor = direction === "asc" ? 1 : -1;
    return [...transactions].sort((a, b) => {
      const av = sortValue(a, column);
      const bv = sortValue(b, column);
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * factor;
      }
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [
    transactions,
    sortState,
    categoryNameById,
    accountNameById,
    tagsByTransactionId,
    runningBalanceByTransactionId,
  ]);

  const orderedIds = useMemo(
    () => sortedTransactions.map((t) => t.id),
    [sortedTransactions],
  );

  const rowCount = sortedTransactions.length;
  const colCount = EDITABLE_COLUMNS.length;

  function handleHeaderClick(column: ColumnKey) {
    setSortState((prev) => {
      if (!prev || prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  }

  useEffect(() => {
    if (focusedCell && !editingCell) {
      const el = cellRefs.current[`${focusedCell.row}-${focusedCell.col}`];
      // Guard against re-focusing an already-focused element: some DOM
      // implementations (jsdom included) re-dispatch a focus event even
      // when the target is already the activeElement, which would
      // otherwise loop through onFocus -> setFocusedCell -> this effect.
      if (el && document.activeElement !== el) {
        el.focus();
      }
    }
  }, [focusedCell, editingCell]);

  function focusCell(row: number, col: number) {
    setFocusedCell((prev) => (prev && prev.row === row && prev.col === col ? prev : { row, col }));
  }

  function startEdit(row: number, col: number) {
    const transaction = sortedTransactions[row];
    if (!transaction) return;
    editingRef.current = { row, col };
    setFocusedCell({ row, col });
    setEditingCell({ row, col });
    setDraftValue(cellValue(transaction, EDITABLE_COLUMNS[col]));
  }

  function cancelEdit() {
    editingRef.current = null;
    setEditingCell(null);
  }

  function commitEdit(row: number, col: number, value: string) {
    const transaction = sortedTransactions[row];
    editingRef.current = null;
    setEditingCell(null);
    if (!transaction) return;

    const column = EDITABLE_COLUMNS[col];
    if ((column === "date" || column === "memo") && value.trim() === "") {
      // Required fields: silently revert rather than saving an empty value.
      return;
    }

    const fields: TransactionFields = {
      date: transaction.date,
      amount_cents: transaction.amount_cents,
      description: transaction.description,
      category_id: transaction.category_id,
    };
    switch (column) {
      case "date":
        fields.date = value;
        break;
      case "memo":
        fields.description = value;
        break;
      case "category":
        fields.category_id = value === UNCATEGORIZED ? null : Number(value);
        break;
      case "amount":
        fields.amount_cents = dollarInputToCents(value || "0");
        break;
      default:
        break;
    }
    onUpdate(transaction.id, fields);

    // Flash the cell to confirm the commit, then let it fade back to its
    // resting state (see .grid-cell-flash / .ledger-editable .grid-cell in
    // App.css). Setting the class and clearing it on the next frame forces
    // the browser to paint the flashed state before the CSS transition
    // starts fading it out.
    if (flashFrameRef.current != null) cancelAnimationFrame(flashFrameRef.current);
    setFlashCell({ row, col });
    flashFrameRef.current = requestAnimationFrame(() => {
      flashFrameRef.current = requestAnimationFrame(() => {
        setFlashCell(null);
      });
    });
  }

  function handleBlur(row: number, col: number, value: string) {
    if (editingRef.current && editingRef.current.row === row && editingRef.current.col === col) {
      commitEdit(row, col, value);
    }
  }

  function handleCellKeyDown(e: KeyboardEvent<HTMLDivElement>, row: number, col: number) {
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(row, col);
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.key)) {
      e.preventDefault();
      setFocusedCell(nextCellForKey({ row, col }, e.key, rowCount, colCount, e.shiftKey));
    }
  }

  function handleEditKeyDown(
    e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    row: number,
    col: number,
  ) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const value = e.currentTarget.value;
      const next = nextCellForKey({ row, col }, e.key, rowCount, colCount, e.shiftKey);
      commitEdit(row, col, value);
      setFocusedCell(next);
    }
  }

  function toggleSelectRow(transactionId: number, shiftKey: boolean) {
    if (shiftKey && anchorId != null) {
      setSelected(selectRowRange(orderedIds, anchorId, transactionId));
      return;
    }
    setSelected((prev) => toggleRowSelection(prev, transactionId));
    setAnchorId(transactionId);
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === transactions.length ? new Set() : new Set(orderedIds)));
  }

  function handleBulkCategoryChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.currentTarget.value;
    setBulkCategoryId(value);
    onBulkAssignCategory(Array.from(selected), value === UNCATEGORIZED ? null : Number(value));
    setSelected(new Set());
    setAnchorId(null);
    setBulkCategoryId(BULK_PLACEHOLDER);
  }

  function handleHeaderContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setColumnMenu({ x: e.clientX, y: e.clientY });
  }

  // Row-level right-click context menu (#70): a single Hide/Unhide action
  // reflecting the Transaction's current `hidden` state. Distinct from the
  // header's Column Management menu above -- this is scoped to a data row,
  // not the header row.
  function handleRowContextMenu(e: React.MouseEvent, transaction: Transaction) {
    e.preventDefault();
    e.stopPropagation();
    setRowMenu({ x: e.clientX, y: e.clientY, transaction });
  }

  function rowMenuItems(transaction: Transaction): ContextMenuItem[] {
    return [
      {
        label: transaction.hidden ? "Unhide" : "Hide",
        onClick: () => onSetHidden(transaction, !transaction.hidden),
      },
    ];
  }

  function columnMenuItems(): ContextMenuItem[] {
    return COLUMN_SET.map((column) => ({
      label: COLUMN_LABELS[column],
      checked: columnVisibility[column],
      // Multiple columns can be toggled in one right-click interaction --
      // the menu only closes via Escape or an outside click.
      closeOnClick: false,
      onClick: () =>
        onColumnVisibilityChange({ ...columnVisibility, [column]: !columnVisibility[column] }),
    }));
  }

  // Read-only columns (Account, Payee, Tags, Running Balance) render as
  // plain display cells -- they take no part in the focus/edit keyboard
  // grid navigation, which is scoped to EDITABLE_COLUMNS only (see
  // grid-nav.ts).
  function renderReadOnlyCell(transaction: Transaction, column: ColumnKey) {
    switch (column) {
      case "account": {
        const name = transaction.account_name ?? accountNameById.get(transaction.account_id) ?? "";
        return <div className="grid-cell cell-account">{name}</div>;
      }
      case "payee": {
        const payee = transaction.merchant_name || transaction.description;
        if (editingPayeeId === transaction.id) {
          return (
            <div
              className="grid-cell cell-payee cell-payee-editing"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setEditingPayeeId(null);
                }
              }}
            >
              <SuggestionCombobox
                mode="single"
                knownValues={knownMerchantNames}
                values={transaction.merchant_name ? [transaction.merchant_name] : []}
                ariaLabel={`Payee for ${transaction.description}`}
                onCommit={(name) => {
                  onSetPayee?.(transaction.id, name);
                  setEditingPayeeId(null);
                }}
                onCreateNew={(name) => {
                  setPayeeConfirm({
                    transactionId: transaction.id,
                    description: transaction.description,
                    name,
                  });
                  setEditingPayeeId(null);
                }}
                onCancel={() => setEditingPayeeId(null)}
                onAdvance={() => setEditingPayeeId(null)}
                autoFocus
              />
            </div>
          );
        }
        return (
          <div
            className="grid-cell cell-payee"
            tabIndex={0}
            role="button"
            onClick={() => setEditingPayeeId(transaction.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "F2") {
                e.preventDefault();
                setEditingPayeeId(transaction.id);
              }
            }}
          >
            {linkedTransactionIds.has(transaction.id) && (
              <span className="transfer-badge" title="Part of a transfer">
                ⇄
              </span>
            )}
            <span className="passbook-payee-name">{payee}</span>
          </div>
        );
      }
      case "tags": {
        const attachedTags = tagsByTransactionId[transaction.id] ?? [];
        if (editingTagsId === transaction.id) {
          return (
            <div
              className="grid-cell cell-tags cell-tags-editing"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setEditingTagsId(null);
                }
              }}
            >
              <SuggestionCombobox
                mode="multi"
                knownValues={knownTagNames}
                values={attachedTags.map((tag) => tag.name)}
                ariaLabel={`Tags for ${transaction.description}`}
                onCommit={(name) => onAddTag?.(transaction.id, name)}
                onCreateNew={(name) => onAddTag?.(transaction.id, name)}
                onRemove={(name) => {
                  const tag = attachedTags.find((t) => t.name === name);
                  if (tag) onRemoveTag?.(transaction.id, tag.id);
                }}
                onCancel={() => setEditingTagsId(null)}
                autoFocus
              />
            </div>
          );
        }
        return (
          <div
            className="grid-cell cell-tags"
            tabIndex={0}
            role="button"
            onClick={() => setEditingTagsId(transaction.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "F2") {
                e.preventDefault();
                setEditingTagsId(transaction.id);
              }
            }}
          >
            {attachedTags.map((tag) => (
              <span key={tag.id} className="tag-chip">
                {tag.name}
              </span>
            ))}
          </div>
        );
      }
      case "running_balance": {
        const balance = runningBalanceByTransactionId.get(transaction.id);
        return (
          <div className="grid-cell amount cell-running-balance">
            {balance != null ? formatCents(balance) : NO_BALANCE}
          </div>
        );
      }
      default:
        return null;
    }
  }

  function renderDisplayCell(transaction: Transaction, row: number, col: number, column: ColumnKey) {
    const isFocused = focusedCell?.row === row && focusedCell?.col === col;
    const isFlashed = flashCell?.row === row && flashCell?.col === col;
    const commonProps = {
      ref: (el: HTMLDivElement | null) => {
        cellRefs.current[`${row}-${col}`] = el;
      },
      tabIndex: 0,
      role: "gridcell",
      className: `grid-cell${isFocused ? " grid-cell-focused" : ""}${isFlashed ? " grid-cell-flash" : ""}`,
      onClick: () => startEdit(row, col),
      onFocus: () => focusCell(row, col),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleCellKeyDown(e, row, col),
    };

    switch (column) {
      case "date":
        return <div {...commonProps} className={`${commonProps.className} cell-date`}>{transaction.date}</div>;
      case "memo":
        return (
          <div {...commonProps} className={`${commonProps.className} cell-memo`}>
            {transaction.description}
          </div>
        );
      case "category":
        return (
          <div {...commonProps} className={`${commonProps.className} cell-category`}>
            {transaction.category_id != null
              ? categoryNameById.get(transaction.category_id) ?? "Uncategorized"
              : "Uncategorized"}
          </div>
        );
      case "amount":
        return (
          <div
            {...commonProps}
            className={`${commonProps.className} amount ${transaction.amount_cents < 0 ? "debit" : "credit"}`}
          >
            {formatCents(transaction.amount_cents)}
          </div>
        );
      default:
        return null;
    }
  }

  function renderEditingCell(transaction: Transaction, row: number, col: number, column: ColumnKey) {
    switch (column) {
      case "date":
        return (
          <input
            aria-label={`Date for ${transaction.description}`}
            type="date"
            autoFocus
            value={draftValue}
            onChange={(e) => setDraftValue(e.currentTarget.value)}
            onBlur={(e) => handleBlur(row, col, e.currentTarget.value)}
            onKeyDown={(e) => handleEditKeyDown(e, row, col)}
          />
        );
      case "memo":
        return (
          <input
            aria-label={`Memo for ${transaction.description}`}
            autoFocus
            value={draftValue}
            onChange={(e) => setDraftValue(e.currentTarget.value)}
            onBlur={(e) => handleBlur(row, col, e.currentTarget.value)}
            onKeyDown={(e) => handleEditKeyDown(e, row, col)}
          />
        );
      case "category":
        return (
          <SuggestionCombobox
            mode="single"
            knownValues={knownCategoryNames}
            values={
              transaction.category_id != null
                ? [categoryNameById.get(transaction.category_id) ?? ""]
                : []
            }
            ariaLabel={`Category for ${transaction.description}`}
            onCommit={(name) => {
              const category = categories.find((c) => c.name === name);
              if (!category) return;
              commitEdit(row, col, String(category.id));
              setLastUsedCategoryGroupId(category.group_id);
            }}
            onCreateNew={(name) => {
              cancelEdit();
              setCategoryConfirm({
                transactionId: transaction.id,
                name,
                groupId: lastUsedCategoryGroupId ?? categoryGroups[0]?.id ?? 0,
              });
            }}
            onCancel={cancelEdit}
            onAdvance={() =>
              setFocusedCell(nextCellForKey({ row, col }, "Enter", rowCount, colCount, false))
            }
            autoFocus
          />
        );
      case "amount":
        return (
          <input
            aria-label={`Amount for ${transaction.description}`}
            type="number"
            step="0.01"
            autoFocus
            value={draftValue}
            onChange={(e) => setDraftValue(e.currentTarget.value)}
            onBlur={(e) => handleBlur(row, col, e.currentTarget.value)}
            onKeyDown={(e) => handleEditKeyDown(e, row, col)}
          />
        );
      default:
        return null;
    }
  }

  function renderColumn(transaction: Transaction, row: number, column: ColumnKey) {
    if (EDITABLE_COLUMNS.includes(column)) {
      const col = EDITABLE_COLUMNS.indexOf(column);
      return editingCell?.row === row && editingCell?.col === col ? (
        <Fragment key={column}>{renderEditingCell(transaction, row, col, column)}</Fragment>
      ) : (
        <Fragment key={column}>{renderDisplayCell(transaction, row, col, column)}</Fragment>
      );
    }
    return <Fragment key={column}>{renderReadOnlyCell(transaction, column)}</Fragment>;
  }

  // Mobile tier (<768px, ADR-0018): one card per Transaction instead of a
  // grid row -- column headers don't apply to cards, so each field carries
  // its own label. Reuses renderDisplayCell/renderReadOnlyCell/renderEditingCell
  // so inline edit, categorize, and every other per-Transaction interaction
  // stay identical to the grid layout; only the surrounding markup differs.
  function renderCard(transaction: Transaction, row: number) {
    const isLinked = linkedTransactionIds.has(transaction.id);
    return (
      <Fragment key={transaction.id}>
        <div
          className={`ledger-card${isLinked ? " is-transfer" : ""}${transaction.hidden ? " hidden-row" : ""}`}
          onContextMenu={(e) => handleRowContextMenu(e, transaction)}
        >
          <div className="ledger-card-select">
            <input
              type="checkbox"
              aria-label={`Select ${transaction.description}`}
              checked={selected.has(transaction.id)}
              onClick={(e) => {
                e.preventDefault();
                toggleSelectRow(transaction.id, e.shiftKey);
              }}
              onChange={() => {}}
            />
          </div>
          {visibleColumns.map((column) => (
            <div className={`ledger-card-field ledger-card-field-${column}`} key={column}>
              <span className="ledger-card-label">{COLUMN_LABELS[column]}</span>
              {renderColumn(transaction, row, column)}
            </div>
          ))}
          <div className="ledger-card-actions">
            {isLinked ? (
              <button
                type="button"
                onClick={() => {
                  const transfer = transferByTransactionId.get(transaction.id);
                  if (transfer) {
                    onUnlink(transfer);
                  }
                }}
              >
                Unlink
              </button>
            ) : (
              <button type="button" onClick={() => onStartLink(transaction.id)}>
                Link transfer
              </button>
            )}
            <button type="button" onClick={() => onDelete(transaction)}>
              Delete
            </button>
          </div>
        </div>

        {linkingId === transaction.id && (
          <div className="transfer-picker-row">
            <TransferPicker
              transaction={transaction}
              accounts={accounts}
              linkedTransactionIds={linkedTransactionIds}
              onLink={(toTransactionId) => onLink(transaction.id, toTransactionId)}
              onCancel={onCancelLink}
            />
          </div>
        )}
      </Fragment>
    );
  }

  function renderRow(transaction: Transaction, row: number) {
    return (
      <Fragment key={transaction.id}>
        <div
          className={`ledger-row${linkedTransactionIds.has(transaction.id) ? " is-transfer" : ""}${transaction.hidden ? " hidden-row" : ""}`}
          onContextMenu={(e) => handleRowContextMenu(e, transaction)}
        >
          <span className="cell-select">
            <input
              type="checkbox"
              aria-label={`Select ${transaction.description}`}
              checked={selected.has(transaction.id)}
              onClick={(e) => {
                e.preventDefault();
                toggleSelectRow(transaction.id, e.shiftKey);
              }}
              onChange={() => {}}
            />
          </span>
          {visibleColumns.map((column) => renderColumn(transaction, row, column))}
          <span className="row-actions">
            {linkedTransactionIds.has(transaction.id) ? (
              <button
                type="button"
                onClick={() => {
                  const transfer = transferByTransactionId.get(transaction.id);
                  if (transfer) {
                    onUnlink(transfer);
                  }
                }}
              >
                Unlink
              </button>
            ) : (
              <button type="button" onClick={() => onStartLink(transaction.id)}>
                Link transfer
              </button>
            )}
            <button type="button" onClick={() => onDelete(transaction)}>
              Delete
            </button>
          </span>
        </div>

        {linkingId === transaction.id && (
          <div className="transfer-picker-row">
            <TransferPicker
              transaction={transaction}
              accounts={accounts}
              linkedTransactionIds={linkedTransactionIds}
              onLink={(toTransactionId) => onLink(transaction.id, toTransactionId)}
              onCancel={onCancelLink}
            />
          </div>
        )}
      </Fragment>
    );
  }

  return (
    <div
      className={`ledger ledger-editable${isMobile ? " ledger-cards" : ""}`}
      style={{ gridTemplateColumns }}
    >
      {!isMobile && (
        <div className="ledger-head" onContextMenu={handleHeaderContextMenu}>
          <span className="cell-select">
            <input
              type="checkbox"
              aria-label="Select all transactions"
              checked={transactions.length > 0 && selected.size === transactions.length}
              onChange={toggleSelectAll}
            />
          </span>
          {visibleColumns.map((column) => (
            <span
              key={column}
              className={
                sortState?.column === column ? `sort-${sortState.direction}` : undefined
              }
              onClick={() => handleHeaderClick(column)}
            >
              {COLUMN_LABELS[column]}
              {sortState?.column === column && (
                <span className="sort-arrow" aria-hidden="true">
                  {sortState.direction === "asc" ? " ▲" : " ▼"}
                </span>
              )}
            </span>
          ))}
          <span></span>
        </div>
      )}

      {columnMenu && (
        <ContextMenu
          x={columnMenu.x}
          y={columnMenu.y}
          items={columnMenuItems()}
          onClose={() => setColumnMenu(null)}
        />
      )}

      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={rowMenuItems(rowMenu.transaction)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {payeeConfirm && (
        <ConfirmCreateDialog
          title="Add to Merchant dictionary?"
          message={`Add "${payeeConfirm.name}" to your Merchant dictionary for future imports?`}
          onConfirm={() => {
            onCreateMerchant?.(payeeConfirm.transactionId, payeeConfirm.description, payeeConfirm.name);
            setPayeeConfirm(null);
          }}
          onCancel={() => {
            onSetPayee?.(payeeConfirm.transactionId, payeeConfirm.name);
            setPayeeConfirm(null);
          }}
        />
      )}

      {categoryConfirm && (
        <ConfirmCreateDialog
          title="Create category?"
          message={`Create category "${categoryConfirm.name}" in Group:`}
          extraField={{
            label: "Group",
            value: String(categoryConfirm.groupId),
            options: categoryGroups.map((group) => ({ value: String(group.id), label: group.name })),
            onChange: (value) =>
              setCategoryConfirm((prev) => (prev ? { ...prev, groupId: Number(value) } : prev)),
          }}
          onConfirm={() => {
            onCreateCategory?.(categoryConfirm.transactionId, categoryConfirm.name, categoryConfirm.groupId);
            setLastUsedCategoryGroupId(categoryConfirm.groupId);
            setCategoryConfirm(null);
          }}
          onCancel={() => setCategoryConfirm(null)}
        />
      )}

      {selected.size > 0 && (
        <div className="bulk-actions-bar">
          <span>{selected.size} selected</span>
          <select aria-label="Assign category to selection" value={bulkCategoryId} onChange={handleBulkCategoryChange}>
            <option value={BULK_PLACEHOLDER} disabled>
              Assign category&hellip;
            </option>
            <option value={UNCATEGORIZED}>Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <div className="bulk-tag-assign">
            <SuggestionCombobox
              mode="multi"
              knownValues={knownTagNames}
              values={[]}
              ariaLabel="Add tag to selection"
              placeholder="Add tag to selection…"
              autoFocus={false}
              onCommit={(name) => onBulkAssignTags?.(Array.from(selected), [name])}
              onCreateNew={(name) => onBulkAssignTags?.(Array.from(selected), [name])}
              onCancel={() => {}}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set());
              setAnchorId(null);
            }}
          >
            Clear selection
          </button>
        </div>
      )}

      {sortedTransactions.map((transaction, row) =>
        isMobile ? renderCard(transaction, row) : renderRow(transaction, row),
      )}
    </div>
  );
}
