import { ReactNode, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { formatCents } from "../transactions/types";
import { RecurringItemForm } from "./RecurringItemForm";
import { FREQUENCY_LABELS, RecurringItem, RecurringItemFields } from "./types";

interface RecurringItemsScreenProps {
  account: Account;
  categories: Category[];
}

export function RecurringItemsScreen({ account, categories }: RecurringItemsScreenProps) {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const confirmed = window.confirm(
      `Delete this recurring item ("${item.description}")? This cannot be undone.`,
    );
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

  function renderRow(item: RecurringItem, actions: ReactNode) {
    return (
      <div className="recurring-row" key={item.id}>
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
    <section>
      {error && <p role="alert">{error}</p>}

      <h3 className="recurring-section-title">Detected</h3>
      {detected.length === 0 ? (
        <p className="empty-state">No newly-detected recurring patterns.</p>
      ) : (
        <div className="recurring-list">
          <div className="recurring-head">
            <span>Description</span>
            <span>Amount</span>
            <span>Frequency</span>
            <span>Next expected</span>
            <span>Category</span>
            <span></span>
          </div>
          {detected.map((item) =>
            renderRow(
              item,
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
          <span>Description</span>
          <span>Amount</span>
          <span>Frequency</span>
          <span>Next expected</span>
          <span>Category</span>
          <span></span>
        </div>
        {confirmed.map((item) =>
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
