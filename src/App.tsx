import { useState } from "react";
import "./App.css";
import { AccountsScreen } from "./accounts/AccountsScreen";
import { Account } from "./accounts/types";
import { BudgetScreen } from "./budget/BudgetScreen";
import { CategoriesScreen } from "./categories/CategoriesScreen";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { GoalsScreen } from "./goals/GoalsScreen";
import { ImportScreen } from "./import/ImportScreen";
import { TransactionsScreen } from "./transactions/TransactionsScreen";

type ContentView =
  | { type: "dashboard" }
  | { type: "categories" }
  | { type: "budget" }
  | { type: "goals" }
  | { type: "account"; account: Account }
  | { type: "import"; account: Account }
  | { type: "none" };

function App() {
  const [view, setView] = useState<ContentView>({ type: "dashboard" });

  const selectedAccount = view.type === "account" || view.type === "import" ? view.account : null;

  return (
    <div className="app-shell">
      <AccountsScreen
        selectedAccountId={selectedAccount?.id ?? null}
        isDashboardActive={view.type === "dashboard"}
        isCategoriesActive={view.type === "categories"}
        isBudgetActive={view.type === "budget"}
        isGoalsActive={view.type === "goals"}
        onSelectAccount={(account) => setView({ type: "account", account })}
        onOpenDashboard={() => setView({ type: "dashboard" })}
        onOpenCategories={() => setView({ type: "categories" })}
        onOpenBudget={() => setView({ type: "budget" })}
        onOpenGoals={() => setView({ type: "goals" })}
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
        {view.type === "dashboard" && <DashboardScreen />}
        {view.type === "categories" && <CategoriesScreen />}
        {view.type === "budget" && <BudgetScreen />}
        {view.type === "goals" && <GoalsScreen />}
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
