import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { centsToDollarInput, dollarInputToCents, formatCents } from "../transactions/types";
import { addMonths, CategoryBudgetLine, currentMonth, formatMonth } from "./types";

export function BudgetScreen() {
  const [month, setMonth] = useState(currentMonth());
  const [lines, setLines] = useState<CategoryBudgetLine[]>([]);
  const [readyToAssignCents, setReadyToAssignCents] = useState(0);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [draftAmount, setDraftAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [budgetLines, readyToAssign] = await Promise.all([
        invoke<CategoryBudgetLine[]>("get_budget_for_month", { month }),
        invoke<number>("get_ready_to_assign", { month }),
      ]);
      setLines(budgetLines);
      setReadyToAssignCents(readyToAssign);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function startEditing(line: CategoryBudgetLine) {
    setEditingCategoryId(line.category_id);
    setDraftAmount(centsToDollarInput(line.assigned_cents));
  }

  async function commitEdit(categoryId: number) {
    try {
      await invoke("assign_budget", {
        category_id: categoryId,
        month,
        assigned_cents: dollarInputToCents(draftAmount || "0"),
      });
      setEditingCategoryId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  const groupedLines = new Map<number, { groupName: string; lines: CategoryBudgetLine[] }>();
  for (const line of lines) {
    const group = groupedLines.get(line.group_id);
    if (group) {
      group.lines.push(line);
    } else {
      groupedLines.set(line.group_id, { groupName: line.group_name, lines: [line] });
    }
  }

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Budget</h2>
          <div className="account-title-meta">Assign every dollar of income to a Category</div>
        </div>
        <div className="month-picker">
          <button type="button" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">
            &larr;
          </button>
          <span className="month-picker-label">{formatMonth(month)}</span>
          <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">
            &rarr;
          </button>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="ready-to-assign">
        <span className="balance-label">Ready to Assign</span>
        <span className={`ready-to-assign-amount ${readyToAssignCents < 0 ? "debit" : "credit"}`}>
          {formatCents(readyToAssignCents)}
        </span>
      </div>

      <div className="budget-table">
        <div className="budget-head">
          <span>Category</span>
          <span>Assigned</span>
          <span>Activity</span>
          <span>Available</span>
        </div>

        {[...groupedLines.entries()].map(([groupId, group]) => (
          <div className="budget-group" key={groupId}>
            <div className="budget-group-header">{group.groupName}</div>
            {group.lines.map((line) => (
              <div className="budget-row" key={line.category_id}>
                <span className="cell-category">{line.category_name}</span>
                <span className="cell-assigned">
                  {editingCategoryId === line.category_id ? (
                    <input
                      type="number"
                      step="0.01"
                      autoFocus
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(e.target.value)}
                      onBlur={() => commitEdit(line.category_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitEdit(line.category_id);
                        } else if (e.key === "Escape") {
                          setEditingCategoryId(null);
                        }
                      }}
                    />
                  ) : (
                    <button type="button" className="assigned-cell-button" onClick={() => startEditing(line)}>
                      {formatCents(line.assigned_cents)}
                    </button>
                  )}
                </span>
                <span className="amount">{formatCents(line.activity_cents)}</span>
                <span className={`amount ${line.available_cents < 0 ? "debit" : "credit"}`}>
                  {formatCents(line.available_cents)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
