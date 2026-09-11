import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { AccountsScreen } from "./accounts/AccountsScreen";
import { Account } from "./accounts/types";
import { BudgetScreen } from "./budget/BudgetScreen";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { GoalsScreen } from "./goals/GoalsScreen";
import { ImportScreen } from "./import/ImportScreen";
import { NavRail } from "./ui/NavRail";
import { ReportsScreen } from "./reports/ReportsScreen";
import { SettingsScreen } from "./settings/SettingsScreen";
import { TransactionsScreen } from "./transactions/TransactionsScreen";
import { ConfirmationProvider } from "./ui/ConfirmationProvider";

// How often to re-check the upcoming-bill / budget-overspend notification
// conditions while the app is open (see `run_notification_check` and
// `services::notifications` on the Rust side). Notifications only fire while
// PesantMoney is running -- there is no background daemon -- so this also
// runs once immediately on launch rather than waiting a full interval.
const NOTIFICATION_CHECK_INTERVAL_MS = 60_000;

// Categories/Rules/Merchants are no longer distinct App-level view states --
// per issue #58, they're reachable only as tabs inside Settings' own tab
// state now.
type ContentView =
  | { type: "dashboard" }
  | { type: "accounts" }
  | { type: "reports" }
  | { type: "budget" }
  | { type: "goals" }
  | { type: "settings" }
  | { type: "account"; account: Account }
  | { type: "import"; account: Account }
  | { type: "none" };

function App() {
  const [view, setView] = useState<ContentView>({ type: "dashboard" });

  useEffect(() => {
    function checkNotifications() {
      // Errors here (e.g. OS notification permission not yet granted) should
      // never surface as an app-level error -- notifications are a
      // best-effort nicety, not core functionality.
      invoke("run_notification_check").catch(() => {});
    }

    checkNotifications();
    const intervalId = window.setInterval(checkNotifications, NOTIFICATION_CHECK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <ConfirmationProvider>
      <div className="app-shell">
        <NavRail
          active={view.type}
          onOpenDashboard={() => setView({ type: "dashboard" })}
          onOpenAccounts={() => setView({ type: "accounts" })}
          onOpenReports={() => setView({ type: "reports" })}
          onOpenBudget={() => setView({ type: "budget" })}
          onOpenGoals={() => setView({ type: "goals" })}
          onOpenSettings={() => setView({ type: "settings" })}
        />
        <main className="content">
          {view.type === "dashboard" && <DashboardScreen />}
          {view.type === "accounts" && (
            <AccountsScreen
              onSelectAccount={(account) => setView({ type: "account", account })}
              onImportAccount={(account) => setView({ type: "import", account })}
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
          )}
          {view.type === "reports" && <ReportsScreen />}
          {view.type === "budget" && <BudgetScreen />}
          {view.type === "goals" && <GoalsScreen />}
          {view.type === "settings" && <SettingsScreen />}
          {view.type === "account" && (
            <TransactionsScreen
              account={view.account}
              onBack={() => setView({ type: "accounts" })}
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
    </ConfirmationProvider>
  );
}

export default App;
