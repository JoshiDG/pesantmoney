import { ReactNode, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { formatCents } from "../transactions/types";
import { RecurringItemForm } from "./RecurringItemForm";
import { FREQUENCY_LABELS, RecurringItem, RecurringItemFields } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { RecurringSectionNav, useRecurringSectionNav } from "./useRecurringSectionNav";

interface RecurringItemsScreenProps {
  account: Account;
  categories: Category[];
}

export function RecurringItemsScreen({ account, categories }: RecurringItemsScreenProps) {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  async function refresh() {
    try {
      const itemList = await invoke<RecurringItem[]>("list_recurring_items", { account_id: account.id });
      setItems(itemList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function detectThenRefresh() {
    try {
      await invoke("detect_recurring_items", { account_id: account.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    detectThenRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  async function handleConfirm(item: RecurringItem) {
    try {
      await invoke("confirm_recurring_item", { id: item.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreate(fields: RecurringItemFields) {
    try {
      await invoke("create_recurring_item", { account_id: account.id, ...fields });
      setAddingManual(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(id: number, fields: RecurringItemFields) {
    try {
      await invoke("update_recurring_item", { id, ...fields });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(item: RecurringItem) {
    const confirmed = item.is_confirmed
      ? await confirm({
          title: "Delete Recurring Item",
          message: `Delete this recurring item ("${item.description}")? This cannot be undone.`,
          confirmLabel: "Delete Recurring Item",
        })
      : await confirm({
          title: "Dismiss Recurring Item",
          message: `Dismiss the detected recurring pattern "${item.description}"? It won't be suggested again.`,
          confirmLabel: "Dismiss",
        });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_recurring_item", { id: item.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  const detected = items.filter((item) => !item.is_confirmed);
  const confirmed = items.filter((item) => item.is_confirmed);

  // One keyboard-nav/selection instance per section (#80, ADR-0020's "Grid
  // keyboard navigation"): Detected and Confirmed have different available
  // actions (Confirm/Dismiss vs. Edit/Delete), so focus and selection never
  // span both -- see useRecurringSectionNav's module doc.
  const detectedNav = useRecurringSectionNav(detected.map((item) => item.id));
  const confirmedNav = useRecurringSectionNav(confirmed.map((item) => item.id));

  function renderRow(
    item: RecurringItem,
    index: number,
    nav: RecurringSectionNav,
    shortcuts: Record<string, () => void>,
    actions: ReactNode,
  ) {
    const isFocused = nav.isFocused(index);
    const isSelected = nav.isSelected(item.id);
    return (
      <div
        className={`recurring-row${isFocused ? " row-focused" : ""}${isSelected ? " row-selected" : ""}`}
        key={item.id}
        ref={nav.rowRef(index)}
        tabIndex={0}
        role="row"
        onFocus={() => nav.handleRowFocus(index)}
        onKeyDown={(e) => nav.handleRowKeyDown(e, index, shortcuts)}
      >
        <span className="cell-select">
          <input
            type="checkbox"
            aria-label={`Select ${item.description}`}
            checked={isSelected}
            onClick={(e) => {
              e.preventDefault();
              nav.toggleSelectRow(item.id, e.shiftKey);
            }}
            onChange={() => {}}
          />
        </span>
        <span className="cell-description">{item.description}</span>
        <span className={`amount ${item.amount_cents < 0 ? "debit" : "credit"}`}>
          {formatCents(item.amount_cents)}
        </span>
        <span>{FREQUENCY_LABELS[item.frequency]}</span>
        <span>{item.next_expected_date}</span>
        <span className="cell-category">
          {item.category_id != null ? categoryNameById.get(item.category_id) ?? "Uncategorized" : "Uncategorized"}
        </span>
        <span className="row-actions">{actions}</span>
      </div>
    );
  }

  return (
    <section className="ledger-container">
      {error && <p role="alert">{error}</p>}

      <h3 className="recurring-section-title">Detected</h3>
      {detected.length === 0 ? (
        <p className="empty-state">No newly-detected recurring patterns.</p>
      ) : (
        <div className="recurring-list">
          <div className="recurring-head">
            <span className="cell-select">
              <input
                type="checkbox"
                aria-label="Select all detected items"
                checked={detected.length > 0 && detectedNav.selectedCount === detected.length}
                onChange={detectedNav.toggleSelectAll}
              />
            </span>
            <span>Description</span>
            <span>Amount</span>
            <span>Frequency</span>
            <span>Next expected</span>
            <span>Category</span>
            <span></span>
          </div>
          {detected.map((item, index) =>
            renderRow(
              item,
              index,
              detectedNav,
              // Scoped bare single-letter shortcuts (#80, ADR-0020): active
              // only while a Detected row has keyboard focus, mirroring the
              // Confirm/Dismiss buttons already rendered for this row.
              { c: () => handleConfirm(item), d: () => handleDelete(item) },
              <>
                <button type="button" onClick={() => handleConfirm(item)}>
                  Confirm
                </button>
                <button type="button" onClick={() => handleDelete(item)}>
                  Dismiss
                </button>
              </>,
            ),
          )}
        </div>
      )}

      <h3 className="recurring-section-title">Confirmed</h3>
      <div className="recurring-list">
        <div className="recurring-head">
          <span className="cell-select">
            <input
              type="checkbox"
              aria-label="Select all confirmed items"
              checked={confirmed.length > 0 && confirmedNav.selectedCount === confirmed.length}
              onChange={confirmedNav.toggleSelectAll}
            />
          </span>
          <span>Description</span>
          <span>Amount</span>
          <span>Frequency</span>
          <span>Next expected</span>
          <span>Category</span>
          <span></span>
        </div>
        {confirmed.map((item, index) =>
          editingId === item.id ? (
            <RecurringItemForm
              key={item.id}
              categories={categories}
              initial={item}
              onSubmit={(fields) => handleUpdate(item.id, fields)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            renderRow(
              item,
              index,
              confirmedNav,
              { e: () => setEditingId(item.id), d: () => handleDelete(item) },
              <>
                <button type="button" onClick={() => setEditingId(item.id)}>
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(item)}>
                  Delete
                </button>
              </>,
            )
          ),
        )}
        {addingManual ? (
          <RecurringItemForm
            categories={categories}
            onSubmit={handleCreate}
            onCancel={() => setAddingManual(false)}
          />
        ) : null}
      </div>

      {!addingManual && (
        <button type="button" onClick={() => setAddingManual(true)}>
          Add recurring item
        </button>
      )}
    </section>
  );
}
