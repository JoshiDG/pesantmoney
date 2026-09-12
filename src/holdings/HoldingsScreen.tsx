import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { HoldingForm } from "./HoldingForm";
import { PriceForm } from "./PriceForm";
import { formatCents, Holding, HoldingFields, HoldingWithValue } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { isTextInputTarget, nextCellForKey } from "../ui/grid-nav";
import { useReservedShortcuts } from "../ui/ReservedShortcuts";
import { selectRowRange, toggleRowSelection } from "../ui/selection";

interface HoldingsScreenProps {
  account: Account;
}

export function HoldingsScreen({ account }: HoldingsScreenProps) {
  const [holdings, setHoldings] = useState<HoldingWithValue[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pricingTicker, setPricingTicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();

  // Row selection (ADR-0020 "Grid keyboard navigation"): mirrors
  // TransactionsGrid's model exactly -- click toggles one row, shift-click
  // extends from the last-touched row (`anchorId`) via `selectRowRange`.
  // Holdings has no per-cell edit grid (edit swaps the whole row for a
  // <HoldingForm>), so there's no bulk-category-style action to reuse; the
  // one bulk action that makes sense here is bulk delete.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);

  // Row-level keyboard focus (ADR-0020 "Grid keyboard navigation"): the
  // Ticker cell is the row's single navigable "column" -- Holdings has no
  // per-cell inline editing, so there's only ever one focusable column per
  // row, unlike TransactionsGrid's multi-column EDITABLE_COLUMNS. `colCount`
  // is fixed at 1 for `nextCellForKey` so Up/Down move between rows and
  // Left/Right are no-ops (clamped to the single column).
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const rowRefs = useRef<Record<number, HTMLSpanElement | null>>({});
  const addFormRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    try {
      const holdingList = await invoke<HoldingWithValue[]>("list_holdings_with_values", {
        account_id: account.id,
      });
      setHoldings(holdingList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    setEditingId(null);
    setPricingTicker(null);
    setSelected(new Set());
    setAnchorId(null);
    setFocusedRow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  // Move actual DOM focus to the row whose index becomes `focusedRow`,
  // mirroring TransactionsGrid's cellRefs/useEffect pattern. Guards against
  // re-focusing an already-focused element, since some DOM implementations
  // (jsdom included) re-dispatch a focus event even when the target is
  // already document.activeElement, which would otherwise loop through
  // onFocus -> setFocusedRow -> this effect.
  useEffect(() => {
    if (focusedRow == null) return;
    const el = rowRefs.current[focusedRow];
    if (el && document.activeElement !== el) {
      el.focus();
    }
  }, [focusedRow]);

  async function handleCreate(fields: HoldingFields) {
    try {
      await invoke("create_holding", { account_id: account.id, ...fields });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(id: number, fields: HoldingFields) {
    try {
      await invoke("update_holding", { id, ...fields });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(holding: Holding) {
    const confirmed = await confirm({
      title: "Delete Holding",
      message: `Delete this holding ("${holding.ticker}")? This cannot be undone.`,
      confirmLabel: "Delete Holding",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_holding", { id: holding.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleSetPrice(priceCents: number, asOfDate: string) {
    if (!pricingTicker) {
      return;
    }
    try {
      await invoke("set_security_price", {
        ticker: pricingTicker,
        price_cents: priceCents,
        as_of_date: asOfDate,
      });
      setPricingTicker(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleBulkDelete() {
    const targets = holdings.filter((h) => selected.has(h.id));
    if (targets.length === 0) return;
    const confirmed = await confirm({
      title: "Delete Holdings",
      message: `Delete ${targets.length} selected holding${targets.length === 1 ? "" : "s"}? This cannot be undone.`,
      confirmLabel: "Delete Holdings",
    });
    if (!confirmed) return;
    try {
      await Promise.all(targets.map((h) => invoke("delete_holding", { id: h.id })));
      setSelected(new Set());
      setAnchorId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Reserved Shortcut Set (#78): Holdings' create form (<HoldingForm> at the
  // bottom of the list) is always rendered, not toggled open/closed like
  // Accounts'/Goals' add forms, so there's no modal state for Cmd/Ctrl+W or
  // Escape to close here -- Cmd/Ctrl+N instead moves focus into that
  // always-present form's first field, the same "jump to create" affordance
  // Cmd/Ctrl+F gives search inputs elsewhere. Delete/Backspace runs the same
  // bulk-delete the "Delete selected" button does, only once a selection
  // exists. No search/filter input exists on this screen.
  useReservedShortcuts({
    onNew: () => {
      addFormRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    },
    onDeleteSelection: selected.size > 0 ? handleBulkDelete : undefined,
  });

  const orderedIds = holdings.map((h) => h.id);

  function toggleSelectRow(holdingId: number, shiftKey: boolean) {
    if (shiftKey && anchorId != null) {
      setSelected(selectRowRange(orderedIds, anchorId, holdingId));
      return;
    }
    setSelected((prev) => toggleRowSelection(prev, holdingId));
    setAnchorId(holdingId);
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === holdings.length ? new Set() : new Set(orderedIds)));
  }

  // Scoped bare single-letter shortcuts (ADR-0020 "Keyboard architecture"):
  // active only while a row's Ticker cell has keyboard focus, never global.
  // Guarded with `isTextInputTarget` even though the handler is attached
  // directly to the (non-input) Ticker cell -- matching grid-nav.ts's
  // documented wiring pattern so this stays robust if the handler is ever
  // hoisted to a shared container.
  //   p -- update price (the highest-frequency action on this screen: prices
  //        need refreshing far more often than a holding's quantity/ticker
  //        is edited or a holding is removed)
  //   e -- edit the holding
  //   d -- delete the holding (still gated by the existing confirm dialog)
  function handleRowKeyDown(e: KeyboardEvent<HTMLSpanElement>, row: number) {
    if (isTextInputTarget(e.target)) return;

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = nextCellForKey({ row, col: 0 }, e.key, holdings.length, 1);
      setFocusedRow(next.row);
      return;
    }

    const holding = holdings[row];
    if (!holding) return;

    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      setEditingId(holding.id);
      return;
    }
    if (e.key === "p") {
      e.preventDefault();
      setPricingTicker(holding.ticker);
      return;
    }
    if (e.key === "e") {
      e.preventDefault();
      setEditingId(holding.id);
      return;
    }
    if (e.key === "d") {
      e.preventDefault();
      handleDelete(holding);
      return;
    }
  }

  const totalValueCents = holdings.reduce((sum, h) => sum + (h.value_cents ?? 0), 0);
  const hasUnpriced = holdings.some((h) => h.value_cents == null);

  return (
    <section>
      {error && <p role="alert">{error}</p>}

      <div className="holdings-total">
        <span className="holdings-total-label">Total value</span>
        <span className="holdings-total-value">{formatCents(totalValueCents)}</span>
        {hasUnpriced && (
          <span className="holdings-unpriced-note">
            Excludes holdings with no price yet — see below
          </span>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bulk-actions-bar">
          <span>{selected.size} selected</span>
          <button type="button" onClick={handleBulkDelete}>
            Delete selected
          </button>
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

      <div className="holdings-list">
        <div className="holdings-head">
          <span>
            <input
              type="checkbox"
              aria-label="Select all holdings"
              checked={holdings.length > 0 && selected.size === holdings.length}
              onChange={toggleSelectAll}
            />
            {" "}Ticker
          </span>
          <span>Quantity</span>
          <span>Price</span>
          <span>Value</span>
          <span></span>
        </div>

        {holdings.map((holding, row) =>
          editingId === holding.id ? (
            <HoldingForm
              key={holding.id}
              initial={holding}
              onSubmit={(fields) => handleUpdate(holding.id, fields)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="holdings-row" key={holding.id}>
              <span className="cell-ticker">
                <input
                  type="checkbox"
                  aria-label={`Select ${holding.ticker}`}
                  checked={selected.has(holding.id)}
                  onClick={(e) => {
                    e.preventDefault();
                    toggleSelectRow(holding.id, e.shiftKey);
                  }}
                  onChange={() => {}}
                />{" "}
                <span
                  ref={(el) => {
                    rowRefs.current[row] = el;
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${holding.ticker} row`}
                  className={`cell-ticker-focus-target${focusedRow === row ? " row-focused" : ""}`}
                  onFocus={() => setFocusedRow(row)}
                  onKeyDown={(e) => handleRowKeyDown(e, row)}
                >
                  {holding.ticker}
                </span>
              </span>
              <span>{holding.quantity}</span>
              <span className="cell-price">
                {holding.price_cents != null ? (
                  <>
                    {formatCents(holding.price_cents)}
                    <span className="price-as-of"> as of {holding.as_of_date}</span>
                  </>
                ) : (
                  <span className="price-missing">No price yet</span>
                )}
              </span>
              <span className="amount credit">
                {holding.value_cents != null ? formatCents(holding.value_cents) : "—"}
              </span>
              <span className="row-actions">
                <button type="button" onClick={() => setPricingTicker(holding.ticker)}>
                  Update price
                </button>
                <button type="button" onClick={() => setEditingId(holding.id)}>
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(holding)}>
                  Delete
                </button>
              </span>
            </div>
          ),
        )}

        {pricingTicker && (
          <div className="price-form-row">
            <PriceForm ticker={pricingTicker} onSubmit={handleSetPrice} onCancel={() => setPricingTicker(null)} />
          </div>
        )}

        <div ref={addFormRef}>
          <HoldingForm onSubmit={handleCreate} />
        </div>
      </div>
    </section>
  );
}
