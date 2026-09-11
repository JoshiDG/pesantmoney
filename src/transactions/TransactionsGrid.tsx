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
import { Category } from "../categories/types";
import { Tag } from "../tags/types";
import { TransferPicker } from "../transfers/TransferPicker";
import { Transfer } from "../transfers/types";
import { CellPos, ColumnKey, EDITABLE_COLUMNS, nextCellForKey } from "./grid-nav";
import { selectRowRange, toggleRowSelection } from "./selection";
import {
  centsToDollarInput,
  dollarInputToCents,
  formatCents,
  Transaction,
  TransactionFields,
} from "./types";

const UNCATEGORIZED = "";
const BULK_PLACEHOLDER = "__bulk_placeholder__";

interface TransactionsGridProps {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  tagsByTransactionId?: Record<number, Tag[]>;
  linkedTransactionIds: Set<number>;
  transferByTransactionId: Map<number, Transfer>;
  linkingId: number | null;
  onStartLink: (transactionId: number) => void;
  onCancelLink: () => void;
  onLink: (fromTransactionId: number, toTransactionId: number) => void;
  onUnlink: (transfer: Transfer) => void;
  onUpdate: (id: number, fields: TransactionFields) => void;
  onBulkAssignCategory: (ids: number[], categoryId: number | null) => void;
  onDelete: (transaction: Transaction) => void;
}

function cellValue(transaction: Transaction, column: ColumnKey): string {
  switch (column) {
    case "date":
      return transaction.date;
    case "description":
      return transaction.description;
    case "category":
      return transaction.category_id != null ? String(transaction.category_id) : UNCATEGORIZED;
    case "amount":
      return centsToDollarInput(transaction.amount_cents);
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
  onStartLink,
  onCancelLink,
  onLink,
  onUnlink,
  onUpdate,
  onBulkAssignCategory,
  onDelete,
}: TransactionsGridProps) {
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const orderedIds = useMemo(() => transactions.map((t) => t.id), [transactions]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [focusedCell, setFocusedCell] = useState<CellPos | null>(null);
  const [editingCell, setEditingCell] = useState<CellPos | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState(BULK_PLACEHOLDER);
  const [flashCell, setFlashCell] = useState<CellPos | null>(null);

  const editingRef = useRef<CellPos | null>(null);
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const flashFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (flashFrameRef.current != null) cancelAnimationFrame(flashFrameRef.current);
    };
  }, []);

  const rowCount = transactions.length;
  const colCount = EDITABLE_COLUMNS.length;

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
    const transaction = transactions[row];
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
    const transaction = transactions[row];
    editingRef.current = null;
    setEditingCell(null);
    if (!transaction) return;

    const column = EDITABLE_COLUMNS[col];
    if ((column === "date" || column === "description") && value.trim() === "") {
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
      case "description":
        fields.description = value;
        break;
      case "category":
        fields.category_id = value === UNCATEGORIZED ? null : Number(value);
        break;
      case "amount":
        fields.amount_cents = dollarInputToCents(value || "0");
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

  function handleCategoryChange(e: ChangeEvent<HTMLSelectElement>, row: number, col: number) {
    commitEdit(row, col, e.currentTarget.value);
    setFocusedCell({ row, col });
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
        return <div {...commonProps}>{transaction.date}</div>;
      case "description":
        return (
          <div
            {...commonProps}
            className={`${commonProps.className} cell-description`}
            title={transaction.merchant_name ? `Original: ${transaction.description}` : undefined}
          >
            {linkedTransactionIds.has(transaction.id) && (
              <span className="transfer-badge" title="Part of a transfer">
                ⇄
              </span>
            )}
            {transaction.account_name && (
              <span className="account-badge">{transaction.account_name}</span>
            )}
            {transaction.merchant_name ?? transaction.description}
            {(tagsByTransactionId[transaction.id] ?? []).map((tag) => (
              <span key={tag.id} className="tag-chip">
                {tag.name}
              </span>
            ))}
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
      case "description":
        return (
          <input
            aria-label={`Description for ${transaction.description}`}
            autoFocus
            value={draftValue}
            onChange={(e) => setDraftValue(e.currentTarget.value)}
            onBlur={(e) => handleBlur(row, col, e.currentTarget.value)}
            onKeyDown={(e) => handleEditKeyDown(e, row, col)}
          />
        );
      case "category":
        return (
          <select
            aria-label={`Category for ${transaction.description}`}
            autoFocus
            value={draftValue}
            onChange={(e) => handleCategoryChange(e, row, col)}
            onBlur={(e) => handleBlur(row, col, e.currentTarget.value)}
            onKeyDown={(e) => handleEditKeyDown(e, row, col)}
          >
            <option value={UNCATEGORIZED}>Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
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
    }
  }

  return (
    <div className="ledger ledger-editable">
      <div className="ledger-head">
        <span className="cell-select">
          <input
            type="checkbox"
            aria-label="Select all transactions"
            checked={transactions.length > 0 && selected.size === transactions.length}
            onChange={toggleSelectAll}
          />
        </span>
        <span>Date</span>
        <span>Description</span>
        <span>Category</span>
        <span>Amount</span>
        <span></span>
      </div>

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

      {transactions.map((transaction, row) => (
        <Fragment key={transaction.id}>
          <div className={`ledger-row${linkedTransactionIds.has(transaction.id) ? " is-transfer" : ""}`}>
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
            {EDITABLE_COLUMNS.map((column, col) =>
              editingCell?.row === row && editingCell?.col === col ? (
                <Fragment key={column}>{renderEditingCell(transaction, row, col, column)}</Fragment>
              ) : (
                <Fragment key={column}>{renderDisplayCell(transaction, row, col, column)}</Fragment>
              ),
            )}
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
      ))}
    </div>
  );
}
