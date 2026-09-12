import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { Tag } from "../tags/types";
import { centsToDollarInput } from "../transactions/types";
import { RuleForm } from "./RuleForm";
import { MATCH_TYPE_LABELS, Rule, RuleFields, RULE_FIELD_LABELS } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { isTextInputTarget, nextCellForKey } from "../ui/grid-nav";
import { useReservedShortcuts } from "../ui/ReservedShortcuts";
import { selectRowRange, toggleRowSelection } from "../ui/selection";

function describeMatchValue(rule: Rule, accounts: Account[]): string {
  switch (rule.field) {
    case "amount":
      return centsToDollarInput(Number(rule.match_value));
    case "account": {
      const account = accounts.find((a) => a.id === Number(rule.match_value));
      return account ? account.name : `Account #${rule.match_value}`;
    }
    case "description":
    default:
      return rule.match_value;
  }
}

export function RulesScreen() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResultMessage, setRunResultMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Row selection (ADR-0020's generalized grid primitive, #76) -- same
  // semantics as CategoriesScreen/TransactionsGrid: a Set of selected Rule
  // ids plus a shift-click range anchor, feeding the "Delete selected" bulk
  // action below.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  // Keyboard row cursor (#76): ArrowUp/ArrowDown move DOM focus between rule
  // rows via `nextCellForKey` (colCount fixed at 1 -- flat list, no column
  // structure).
  const rowRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const { confirm } = useConfirmation();

  const orderedRuleIds = useMemo(() => rules.map((rule) => rule.id), [rules]);

  async function refresh() {
    try {
      const [ruleList, accountList, categoryList, tagList] = await Promise.all([
        invoke<Rule[]>("list_categorization_rules"),
        invoke<Account[]>("list_accounts"),
        invoke<Category[]>("list_categories"),
        invoke<Tag[]>("list_tags"),
      ]);
      setRules(ruleList);
      setAccounts(accountList);
      setCategories(categoryList);
      setAllTags(tagList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function categoryName(categoryId: number | null): string {
    if (categoryId === null) return "no category";
    return categories.find((c) => c.id === categoryId)?.name ?? `Category #${categoryId}`;
  }

  function describeActions(rule: Rule): string {
    const parts: string[] = [];
    if (rule.rename_value) parts.push(`rename to "${rule.rename_value}"`);
    if (rule.hide) parts.push("hide");
    if (rule.tag_ids.length > 0) {
      const names = rule.tag_ids
        .map((id) => allTags.find((t) => t.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      if (names.length > 0) parts.push(`tag: ${names.join(", ")}`);
    }
    return parts.join(", ");
  }

  async function handleCreate(fields: RuleFields) {
    try {
      await invoke("create_categorization_rule", { ...fields });
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(id: number, fields: RuleFields) {
    try {
      await invoke("update_categorization_rule", { id, ...fields });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(rule: Rule) {
    const confirmed = await confirm({
      title: "Delete Rule",
      message: "Delete this rule? This cannot be undone.",
      confirmLabel: "Delete Rule",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_categorization_rule", { id: rule.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Reserved Shortcut Set (#78): Cmd/Ctrl+N opens the same "Add rule" form
  // the toolbar button does -- gated the same way the button is (a rule
  // needs at least one Category to assign, so it's a no-op with none yet).
  // Cmd/Ctrl+W and Escape close whichever of the add/edit forms is open.
  // Delete/Backspace runs the same bulk-delete "Delete selected" does, only
  // once a selection exists. No search/filter input exists on this screen.
  useReservedShortcuts({
    onNew: categories.length > 0 ? () => setAdding(true) : undefined,
    onCloseModal: () => {
      if (adding) {
        setAdding(false);
        return true;
      }
      if (editingId != null) {
        setEditingId(null);
        return true;
      }
      return false;
    },
    onDeleteSelection: selected.size > 0 ? handleDeleteSelected : undefined,
  });

  function toggleSelectRule(ruleId: number, shiftKey: boolean) {
    if (shiftKey && anchorId != null) {
      setSelected(selectRowRange(orderedRuleIds, anchorId, ruleId));
      return;
    }
    setSelected((prev) => toggleRowSelection(prev, ruleId));
    setAnchorId(ruleId);
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const confirmed = await confirm({
      title: "Delete Rules",
      message: `Delete ${ids.length} selected ${ids.length === 1 ? "rule" : "rules"}? This cannot be undone.`,
      confirmLabel: "Delete Rules",
    });
    if (!confirmed) {
      return;
    }
    try {
      for (const id of ids) {
        await invoke("delete_categorization_rule", { id });
      }
      setSelected(new Set());
      setAnchorId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Scoped bare single-letter shortcut (ADR-0020): active only while a rule
  // row has keyboard focus, never global, never firing while a text input is
  // focused (`isTextInputTarget` guards that, matching CategoriesScreen).
  // `e` opens the focused row for editing -- the highest-frequency in-grid
  // action here (tuning a rule's match/actions is far more common than
  // deleting it).
  function handleRowKeyDown(e: KeyboardEvent<HTMLLIElement>, rule: Rule) {
    if (isTextInputTarget(e.target)) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const currentIndex = orderedRuleIds.indexOf(rule.id);
      const next = nextCellForKey({ row: currentIndex, col: 0 }, e.key, orderedRuleIds.length, 1);
      const nextId = orderedRuleIds[next.row];
      rowRefs.current[nextId]?.focus();
      return;
    }
    if (e.key === "e") {
      e.preventDefault();
      setEditingId(rule.id);
    }
  }

  async function handleRunRules() {
    setRunning(true);
    setRunResultMessage(null);
    try {
      const updatedCount = await invoke<number>("apply_categorization_rules", { account_id: null });
      setRunResultMessage(
        updatedCount === 1
          ? "Updated 1 transaction."
          : `Updated ${updatedCount} transactions.`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Rules</h2>
          <div className="account-title-meta">
            Automatically assign a Category to matching Transactions on Import
          </div>
        </div>
        <div className="content-header-actions">
          <button type="button" onClick={handleRunRules} disabled={running}>
            {running ? "Running…" : "Run rules on existing uncategorized transactions"}
          </button>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}
      {runResultMessage && <p className="rule-run-result">{runResultMessage}</p>}

      {selected.size > 0 && (
        <div className="bulk-actions-bar">
          <span>{selected.size} selected</span>
          <button type="button" onClick={handleDeleteSelected}>
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

      <ul className="rule-list">
        {rules.map((rule) =>
          editingId === rule.id ? (
            <li key={rule.id}>
              <RuleForm
                accounts={accounts}
                categories={categories}
                allTags={allTags}
                initial={rule}
                onSubmit={(fields) => handleUpdate(rule.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li
              key={rule.id}
              className={`rule-row${selected.has(rule.id) ? " rule-row-selected" : ""}`}
              tabIndex={0}
              ref={(el) => {
                rowRefs.current[rule.id] = el;
              }}
              onKeyDown={(e) => handleRowKeyDown(e, rule)}
            >
              <input
                type="checkbox"
                className="row-select-checkbox"
                aria-label={`Select rule for ${describeMatchValue(rule, accounts)}`}
                checked={selected.has(rule.id)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleSelectRule(rule.id, e.shiftKey);
                }}
                onChange={() => {}}
              />
              <span className="rule-row-summary">
                {RULE_FIELD_LABELS[rule.field]}{" "}
                {rule.field === "description" ? MATCH_TYPE_LABELS[rule.match_type].toLowerCase() : "is"}{" "}
                &ldquo;{describeMatchValue(rule, accounts)}&rdquo; &rarr; {categoryName(rule.category_id)}
                {describeActions(rule) && ` (${describeActions(rule)})`}
              </span>
              <span className="rule-row-priority">Priority {rule.priority}</span>
              <div className="row-actions">
                <button type="button" onClick={() => setEditingId(rule.id)}>
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(rule)}>
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {adding ? (
        <RuleForm
          accounts={accounts}
          categories={categories}
          allTags={allTags}
          onSubmit={handleCreate}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} disabled={categories.length === 0}>
          Add rule
        </button>
      )}
    </section>
  );
}
