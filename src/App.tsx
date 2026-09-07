import { useState } from "react";
import "./App.css";
import { AccountsScreen } from "./accounts/AccountsScreen";
import { Account } from "./accounts/types";
import { CategoriesScreen } from "./categories/CategoriesScreen";
import { TransactionsScreen } from "./transactions/TransactionsScreen";

type ContentView = { type: "categories" } | { type: "account"; account: Account } | { type: "none" };

function App() {
  const [view, setView] = useState<ContentView>({ type: "none" });

  const selectedAccount = view.type === "account" ? view.account : null;

  return (
    <div className="app-shell">
      <AccountsScreen
        selectedAccountId={selectedAccount?.id ?? null}
        isCategoriesActive={view.type === "categories"}
        onSelectAccount={(account) => setView({ type: "account", account })}
        onOpenCategories={() => setView({ type: "categories" })}
        onAccountUpdated={(account) =>
          setView((current) =>
            current.type === "account" && current.account.id === account.id
              ? { type: "account", account }
              : current,
          )
        }
        onAccountDeleted={(id) =>
          setView((current) =>
            current.type === "account" && current.account.id === id ? { type: "none" } : current,
          )
        }
      />
      <main className="content">
        {view.type === "categories" && <CategoriesScreen />}
        {view.type === "account" && (
          <TransactionsScreen account={view.account} onBack={() => setView({ type: "none" })} />
        )}
        {view.type === "none" && (
          <p className="empty-state">Select an account to see its transactions.</p>
        )}
      </main>
    </div>
  );
}

export default App;
