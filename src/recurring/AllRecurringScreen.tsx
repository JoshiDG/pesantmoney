import { ReactNode, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { formatCents } from "../transactions/types";
import { RecurringItemForm } from "./RecurringItemForm";
import { FREQUENCY_LABELS, RecurringItemFields, RecurringItemWithAccount } from "./types";
import { useBreakpoint } from "../ui/BreakpointProvider";
import { useConfirmation } from "../ui/ConfirmationProvider";

// The all-Accounts Recurring screen (#52): every Recurring Item across every
// Account in one list, each row carrying its Account's name. Carries over all
// existing per-Account capability (detect/confirm/edit/delete, plus manual
// create) from `RecurringItemsScreen`, which remains the per-Account
// implementation this replaces as the app's only Recurring destination (the
// per-Account ledger's embedded Recurring tab is removed alongside this
// screen landing -- see #49/#52).
export function AllRecurringScreen() {
  const [items, setItems] = useState<RecurringItemWithAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [addAccountId, setAddAccountId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();
  const tier = useBreakpoint();
  const isMobile = tier === "mobile";

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  async function refresh() {
    try {
      const [itemList, categoryList] = await Promise.all([
        invoke<RecurringItemWithAccount[]>("list_all_recurring_items"),
        invoke<Category[]>("list_categories"),
      ]);
      setItems(itemList);
      setCategories(categoryList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function detectThenRefresh() {
    try {
      // Detection is still a per-Account operation (it mines one Account's
      // Transaction history), so this screen runs it for every known Account
      // before rendering the aggregated list -- matching what the per-Account
      // screen did automatically for its one Account.
      const accountList = await invoke<Account[]>("list_accounts");
      setAccounts(accountList);
      setAddAccountId((current) => current ?? accountList[0]?.id ?? null);
      await Promise.all(
        accountList.map((account) => invoke("detect_recurring_items", { account_id: account.id })),
      );
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    detectThenRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm(item: RecurringItemWithAccount) {
    try {
      await invoke("confirm_recurring_item", { id: item.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreate(fields: RecurringItemFields) {
    if (addAccountId == null) {
      return;
    }
    try {
      await invoke("create_recurring_item", { account_id: addAccountId, ...fields });
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

  async function handleDelete(item: RecurringItemWithAccount) {
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

  function renderRow(item: RecurringItemWithAccount, actions: ReactNode) {
    return (
      <div className="recurring-row" key={item.id}>
        <span className="cell-account">{item.account_name}</span>
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

  // Mobile tier (<768px, ADR-0018, issue #65): one card per Recurring Item
  // instead of a grid row -- column headers don't apply to cards, so each
  // field carries its own label. Same detect/confirm/edit/delete actions as
  // the grid row, just arranged as a card.
  function renderCard(item: RecurringItemWithAccount, actions: ReactNode) {
    return (
      <div className="recurring-card" key={item.id}>
        <div className="recurring-card-field">
          <span className="recurring-card-label">Account</span>
          <span className="cell-account">{item.account_name}</span>
        </div>
        <div className="recurring-card-field">
          <span className="recurring-card-label">Description</span>
          <span className="cell-description">{item.description}</span>
        </div>
        <div className="recurring-card-field">
          <span className="recurring-card-label">Amount</span>
          <span className={`amount ${item.amount_cents < 0 ? "debit" : "credit"}`}>
            {formatCents(item.amount_cents)}
          </span>
        </div>
        <div className="recurring-card-field">
          <span className="recurring-card-label">Frequency</span>
          <span>{FREQUENCY_LABELS[item.frequency]}</span>
        </div>
        <div className="recurring-card-field">
          <span className="recurring-card-label">Next expected</span>
          <span>{item.next_expected_date}</span>
        </div>
        <div className="recurring-card-field">
          <span className="recurring-card-label">Category</span>
          <span className="cell-category">
            {item.category_id != null ? categoryNameById.get(item.category_id) ?? "Uncategorized" : "Uncategorized"}
          </span>
        </div>
        <div className="recurring-card-actions">{actions}</div>
      </div>
    );
  }

  function renderItem(item: RecurringItemWithAccount, actions: ReactNode) {
    return isMobile ? renderCard(item, actions) : renderRow(item, actions);
  }

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Recurring</h2>
          <div className="account-title-meta">Every recurring item across every account</div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <h3 className="recurring-section-title">Detected</h3>
      {detected.length === 0 ? (
        <p className="empty-state">No newly-detected recurring patterns.</p>
      ) : (
        <div className={isMobile ? "recurring-list recurring-list--cards" : "recurring-list"}>
          {!isMobile && (
            <div className="recurring-head">
              <span>Account</span>
              <span>Description</span>
              <span>Amount</span>
              <span>Frequency</span>
              <span>Next expected</span>
              <span>Category</span>
              <span></span>
            </div>
          )}
          {detected.map((item) =>
            renderItem(
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
      <div className={isMobile ? "recurring-list recurring-list--cards" : "recurring-list"}>
        {!isMobile && (
          <div className="recurring-head">
            <span>Account</span>
            <span>Description</span>
            <span>Amount</span>
            <span>Frequency</span>
            <span>Next expected</span>
            <span>Category</span>
            <span></span>
          </div>
        )}
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
            renderItem(
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
          <div className="recurring-row">
            <label>
              Account{" "}
              <select
                aria-label="Account"
                value={addAccountId ?? ""}
                onChange={(e) => setAddAccountId(Number(e.currentTarget.value))}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <RecurringItemForm
              categories={categories}
              onSubmit={handleCreate}
              onCancel={() => setAddingManual(false)}
            />
          </div>
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
