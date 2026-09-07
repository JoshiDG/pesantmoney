import { useState } from "react";
import "./App.css";
import { AccountsScreen } from "./accounts/AccountsScreen";
import { Account } from "./accounts/types";
import { BudgetScreen } from "./budget/BudgetScreen";
import { CategoriesScreen } from "./categories/CategoriesScreen";
import { ImportScreen } from "./import/ImportScreen";
import { TransactionsScreen } from "./transactions/TransactionsScreen";

type ContentView =
  | { type: "categories" }
  | { type: "budget" }
  | { type: "account"; account: Account }
  | { type: "import"; account: Account }
  | { type: "none" };

function App() {
  const [view, setView] = useState<ContentView>({ type: "none" });

  const selectedAccount = view.type === "account" || view.type === "import" ? view.account : null;

  return (
    <div className="app-shell">
      <AccountsScreen
        selectedAccountId={selectedAccount?.id ?? null}
        isCategoriesActive={view.type === "categories"}
        isBudgetActive={view.type === "budget"}
        onSelectAccount={(account) => setView({ type: "account", account })}
        onOpenCategories={() => setView({ type: "categories" })}
        onOpenBudget={() => setView({ type: "budget" })}
        onAccountUpdated={(account) =>
          setView((current) =>
            (current.type === "account" || current.type === "import") && current.account.id === account.id
              ? { type: current.type, account }
              : current,
          )
        }
        onAccountDeleted={(id) =>
          setView((current) =>
            (current.type === "account" || current.type === "import") && current.account.id === id
              ? { type: "none" }
              : current,
          )
        }
      />
      <main className="content">
        {view.type === "categories" && <CategoriesScreen />}
        {view.type === "budget" && <BudgetScreen />}
        {view.type === "account" && (
          <TransactionsScreen
            account={view.account}
            onBack={() => setView({ type: "none" })}
            onImport={() => setView({ type: "import", account: view.account })}
          />
        )}
        {view.type === "import" && (
          <ImportScreen account={view.account} onBack={() => setView({ type: "account", account: view.account })} />
        )}
        {view.type === "none" && (
          <p className="empty-state">Select an account to see its transactions.</p>
        )}
      </main>
    </div>
  );
}

export default App;
