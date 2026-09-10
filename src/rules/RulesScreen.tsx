import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { centsToDollarInput } from "../transactions/types";
import { RuleForm } from "./RuleForm";
import { MATCH_TYPE_LABELS, Rule, RuleFields, RULE_FIELD_LABELS } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";

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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResultMessage, setRunResultMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { confirm } = useConfirmation();

  async function refresh() {
    try {
      const [ruleList, accountList, categoryList] = await Promise.all([
        invoke<Rule[]>("list_categorization_rules"),
        invoke<Account[]>("list_accounts"),
        invoke<Category[]>("list_categories"),
      ]);
      setRules(ruleList);
      setAccounts(accountList);
      setCategories(categoryList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function categoryName(categoryId: number): string {
    return categories.find((c) => c.id === categoryId)?.name ?? `Category #${categoryId}`;
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

      <ul className="rule-list">
        {rules.map((rule) =>
          editingId === rule.id ? (
            <li key={rule.id}>
              <RuleForm
                accounts={accounts}
                categories={categories}
                initial={rule}
                onSubmit={(fields) => handleUpdate(rule.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={rule.id} className="rule-row">
              <span className="rule-row-summary">
                {RULE_FIELD_LABELS[rule.field]}{" "}
                {rule.field === "description" ? MATCH_TYPE_LABELS[rule.match_type].toLowerCase() : "is"}{" "}
                &ldquo;{describeMatchValue(rule, accounts)}&rdquo; &rarr; {categoryName(rule.category_id)}
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
