import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { dollarInputToCents, formatCents } from "../transactions/types";
import { GoalForm } from "./GoalForm";
import { GoalPaceBadge } from "./GoalPaceBadge";
import { GoalFields, GoalWithProgress, PayoffProjection, progressFraction } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { isTextInputTarget, nextCellForKey } from "../ui/grid-nav";
import { selectRowRange, toggleRowSelection } from "../ui/selection";

const DEBT_ACCOUNT_TYPES = new Set(["credit_card", "loan"]);

interface DebtPayoffCalculatorProps {
  account: Account | undefined;
  onAprChange: (accountId: number, aprBps: number | null) => void;
}

/** Inline "what-if" calculator for a debt-linked Goal's linked Account: lets
 * the user enter/edit the Account's APR and a hypothetical monthly payment,
 * then shows the projected debt-free date. Neither input is a Goal field --
 * APR lives on the Account, and the hypothetical payment is never persisted
 * (recomputed on demand each time "Project payoff" is pressed). See the
 * "Payoff Projection" term in CONTEXT.md. */
function DebtPayoffCalculator({ account, onAprChange }: DebtPayoffCalculatorProps) {
  const [aprInput, setAprInput] = useState(
    account?.apr_bps != null ? (account.apr_bps / 100).toString() : "",
  );
  const [paymentInput, setPaymentInput] = useState("");
  const [projection, setProjection] = useState<PayoffProjection | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!account) {
    return null;
  }

  async function handleAprSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = aprInput.trim();
    const aprBps = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
    try {
      await invoke("set_account_apr", { id: account!.id, apr_bps: aprBps });
      onAprChange(account!.id, aprBps);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleProject(e: FormEvent) {
    e.preventDefault();
    setProjection(null);
    try {
      const result = await invoke<PayoffProjection>("project_debt_payoff", {
        account_id: account!.id,
        monthly_payment_cents: dollarInputToCents(paymentInput),
      });
      setProjection(result);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="goal-payoff-calculator">
      <div className="goal-payoff-calculator-title">Payoff projection</div>
      {error && <p role="alert">{error}</p>}
      <form className="goal-payoff-apr-form" onSubmit={handleAprSubmit}>
        <label>
          APR (%)
          <input
            aria-label="APR percent"
            type="number"
            step="0.01"
            min="0"
            placeholder="e.g. 19.99"
            value={aprInput}
            onChange={(e) => setAprInput(e.currentTarget.value)}
          />
        </label>
        <button type="submit">Save APR</button>
      </form>

      <form className="goal-payoff-project-form" onSubmit={handleProject}>
        <label>
          Hypothetical monthly payment
          <input
            aria-label="Hypothetical monthly payment"
            type="number"
            step="0.01"
            min="0"
            placeholder="Monthly payment"
            value={paymentInput}
            onChange={(e) => setPaymentInput(e.currentTarget.value)}
            required
          />
        </label>
        <button type="submit">Project payoff</button>
      </form>

      {projection &&
        (projection.status === "payoff" ? (
          <p className="goal-payoff-result">
            Projected debt-free: {projection.payoff_date} ({projection.months} month
            {projection.months === 1 ? "" : "s"} of payments)
          </p>
        ) : (
          <p className="goal-payoff-result goal-payoff-result-negative">
            This payment won&apos;t pay off this balance.
          </p>
        ))}
    </div>
  );
}

export function GoalsScreen() {
  const [goals, setGoals] = useState<GoalWithProgress[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();

  // Keyboard grid navigation + row selection (ADR-0020, issue #81): Goals is
  // a single-column list of cards rather than a multi-column grid, so it
  // reuses the shared nextCellForKey/selection primitives (see
  // TransactionsGrid.tsx) with colCount pinned to 1 -- ArrowUp/ArrowDown move
  // `focusedRow` between goal cards, and the shared toggleRowSelection/
  // selectRowRange helpers back a checkbox + shift-click range-select model
  // identical to Transactions'. `focusedRow` starts `null` (not 0) so
  // mounting the screen never steals focus -- it's only set once a card
  // actually receives DOM focus (click or Tab), same as TransactionsGrid's
  // `focusedCell`.
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const rowRefs = useRef<Record<number, HTMLLIElement | null>>({});

  const debtAccounts = accounts.filter((account) => DEBT_ACCOUNT_TYPES.has(account.account_type));

  async function refresh() {
    try {
      const [goalList, categoryList, accountList] = await Promise.all([
        invoke<GoalWithProgress[]>("list_goals_with_progress"),
        invoke<Category[]>("list_categories"),
        invoke<Account[]>("list_accounts"),
      ]);
      setGoals(goalList);
      setCategories(categoryList);
      setAccounts(accountList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Keep the DOM focus in sync with `focusedRow` after arrow-key navigation,
  // mirroring TransactionsGrid's `focusedCell` effect -- guarded against
  // re-focusing an already-focused element since some DOM implementations
  // (jsdom included) re-dispatch focus events even when the target is
  // already `document.activeElement`.
  useEffect(() => {
    if (focusedRow == null) return;
    const el = rowRefs.current[focusedRow];
    if (el && document.activeElement !== el) {
      el.focus();
    }
  }, [focusedRow]);

  // Clamp `focusedRow`/selection to the current goal list whenever it
  // shrinks (e.g. after a delete) so a stale row index doesn't linger.
  useEffect(() => {
    if (focusedRow != null && focusedRow > goals.length - 1) {
      setFocusedRow(goals.length > 0 ? goals.length - 1 : null);
    }
  }, [goals.length, focusedRow]);

  function toggleSelectRow(goalId: number, shiftKey: boolean) {
    const orderedIds = goals.map((g) => g.id);
    if (shiftKey && anchorId != null) {
      setSelected(selectRowRange(orderedIds, anchorId, goalId));
      return;
    }
    setSelected((prev) => toggleRowSelection(prev, goalId));
    setAnchorId(goalId);
  }

  // Scoped bare single-letter shortcuts (ADR-0020's "Keyboard architecture"):
  // active only while a goal card has keyboard focus (bound on the card's
  // own onKeyDown, never document-global), and never fire while a nested
  // text input has focus -- guards against the Payoff Calculator's APR/
  // payment number inputs, whose keydown events bubble up from inside the
  // same card.
  //   e -- edit the focused goal (highest-frequency action: Goals are
  //        revisited to adjust target/date far more often than deleted).
  //   d -- delete the focused goal (routes through the same confirm() gate
  //        as the Delete button, so it's never a bare destructive action).
  //   x -- toggle selection of the focused goal, keyboard equivalent of the
  //        row checkbox (Shift+x extends the selection range, same as
  //        shift-click).
  function handleRowKeyDown(e: KeyboardEvent<HTMLLIElement>, row: number, goal: GoalWithProgress) {
    if (isTextInputTarget(e.target)) return;

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = nextCellForKey({ row, col: 0 }, e.key, goals.length, 1, e.shiftKey);
      setFocusedRow(next.row);
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "e") {
      e.preventDefault();
      setEditingId(goal.id);
    } else if (e.key === "d") {
      e.preventDefault();
      handleDelete(goal);
    } else if (e.key === "x") {
      e.preventDefault();
      toggleSelectRow(goal.id, e.shiftKey);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    const confirmed = await confirm({
      title: "Delete Goals",
      message: `Delete ${ids.length} goal${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      confirmLabel: `Delete ${ids.length} Goal${ids.length === 1 ? "" : "s"}`,
    });
    if (!confirmed) {
      return;
    }
    try {
      await Promise.all(ids.map((id) => invoke("delete_goal", { id })));
      setSelected(new Set());
      setAnchorId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreate(fields: GoalFields) {
    try {
      await invoke("create_goal", { ...fields });
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(id: number, fields: GoalFields) {
    try {
      await invoke("update_goal", {
        id,
        name: fields.name,
        target_cents: fields.target_cents,
        target_date: fields.target_date,
      });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(goal: GoalWithProgress) {
    const confirmed = await confirm({
      title: "Delete Goal",
      message: `Delete the goal "${goal.name}"? This cannot be undone.`,
      confirmLabel: "Delete Goal",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_goal", { id: goal.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  function handleAprChange(accountId: number, aprBps: number | null) {
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, apr_bps: aprBps } : a)));
  }

  function linkDescription(goal: GoalWithProgress): string {
    if (goal.linked_category_id != null) {
      const category = categories.find((c) => c.id === goal.linked_category_id);
      return `Savings: ${category?.name ?? "Unknown category"}`;
    }
    const account = accounts.find((a) => a.id === goal.linked_account_id);
    return `Debt paydown: ${account?.name ?? "Unknown account"}`;
  }

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Goals</h2>
          <div className="account-title-meta">
            Track progress toward a savings target or paying down a debt
          </div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      {selected.size > 0 && (
        <div className="bulk-actions-bar goal-bulk-actions-bar">
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

      <ul className="goal-list">
        {goals.map((goal, row) =>
          editingId === goal.id ? (
            <li key={goal.id} className="goal-card">
              <GoalForm
                categories={categories}
                debtAccounts={debtAccounts}
                initial={goal}
                onSubmit={(fields) => handleUpdate(goal.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li
              key={goal.id}
              ref={(el) => {
                rowRefs.current[row] = el;
              }}
              className={`goal-card${focusedRow === row ? " goal-card-focused" : ""}`}
              tabIndex={0}
              role="gridcell"
              onFocus={() => setFocusedRow(row)}
              onKeyDown={(e) => handleRowKeyDown(e, row, goal)}
            >
              <div className="goal-card-header">
                <span className="cell-select">
                  <input
                    type="checkbox"
                    aria-label={`Select ${goal.name}`}
                    checked={selected.has(goal.id)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSelectRow(goal.id, e.shiftKey);
                    }}
                    onChange={() => {}}
                  />
                </span>
                <div>
                  <div className="goal-card-name">{goal.name}</div>
                  <div className="goal-card-meta">
                    {linkDescription(goal)} · Target {formatCents(goal.target_cents)} by {goal.target_date}
                  </div>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => setEditingId(goal.id)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleDelete(goal)}>
                    Delete
                  </button>
                </div>
              </div>

              <div className="goal-progress-bar">
                <div
                  className={`goal-progress-fill${goal.progress_cents < 0 ? " negative" : ""}`}
                  style={{ width: `${progressFraction(goal) * 100}%` }}
                />
              </div>
              <div className="goal-progress-label">
                {formatCents(goal.progress_cents)} of {formatCents(goal.target_cents)}
                {" "}
                ({Math.round(progressFraction(goal) * 100)}%)
                {goal.progress_cents < 0 && " — behind starting point"}
                {" "}
                <GoalPaceBadge goal={goal} />
              </div>

              {goal.linked_account_id != null && (
                <DebtPayoffCalculator
                  account={accounts.find((a) => a.id === goal.linked_account_id)}
                  onAprChange={handleAprChange}
                />
              )}
            </li>
          ),
        )}
      </ul>

      {adding ? (
        <GoalForm
          categories={categories}
          debtAccounts={debtAccounts}
          onSubmit={handleCreate}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Add goal
        </button>
      )}
    </section>
  );
}
