import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { formatCents } from "../transactions/types";
import { GoalForm } from "./GoalForm";
import { GoalFields, GoalWithProgress, progressFraction } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";

const DEBT_ACCOUNT_TYPES = new Set(["credit_card", "loan"]);

export function GoalsScreen() {
  const [goals, setGoals] = useState<GoalWithProgress[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();

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

      <ul className="goal-list">
        {goals.map((goal) =>
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
            <li key={goal.id} className="goal-card">
              <div className="goal-card-header">
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
              </div>
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
