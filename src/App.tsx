import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { AccountsScreen } from "./accounts/AccountsScreen";
import { Account } from "./accounts/types";
import { BudgetScreen } from "./budget/BudgetScreen";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { GoalsScreen } from "./goals/GoalsScreen";
import { ImportScreen } from "./import/ImportScreen";
import { InvestmentsScreen } from "./investments/InvestmentsScreen";
import { NavRail, NavRailKey } from "./ui/NavRail";
import { AllRecurringScreen } from "./recurring/AllRecurringScreen";
import { ReportsScreen } from "./reports/ReportsScreen";
import { SettingsScreen } from "./settings/SettingsScreen";
import { AllTransactionsScreen } from "./transactions/AllTransactionsScreen";
import { ConfirmationProvider } from "./ui/ConfirmationProvider";
import { ReservedShortcutProvider } from "./ui/ReservedShortcuts";
import { CommandRegistryProvider, useCommands } from "./ui/CommandRegistry";
import { CommandPalette } from "./ui/CommandPalette";

// How often to re-check the upcoming-bill / budget-overspend notification
// conditions while the app is open (see `run_notification_check` and
// `services::notifications` on the Rust side). Notifications only fire while
// PesantMoney is running -- there is no background daemon -- so this also
// runs once immediately on launch rather than waiting a full interval.
const NOTIFICATION_CHECK_INTERVAL_MS = 60_000;

// Categories/Rules/Merchants are no longer distinct App-level view states --
// per issue #58, they're reachable only as tabs inside Settings' own tab
// state now.
//
// "transactions" is the all-Accounts Transactions view (#51): `accountId`
// is `null` when opened from the nav rail (shows every Account) or an
// Account's id when opened from an Account row click on the Accounts screen
// (pre-filtered to that Account). This replaces the old per-Account
// "account" ledger view state entirely for that entry point.
type ContentView =
  | { type: "dashboard" }
  | { type: "accounts" }
  | { type: "transactions"; accountId: number | null }
  | { type: "reports" }
  | { type: "budget" }
  | { type: "recurring" }
  | { type: "goals" }
  | { type: "investments" }
  | { type: "settings" }
  | { type: "import"; account: Account };

// Cross-screen actions the Command Palette (#77) can invoke from anywhere,
// even when the target screen isn't currently mounted: selecting one
// navigates to the owning screen and asks it (via the `autoOpen*` props
// below) to open its existing "create new record" form on arrival, the same
// form Cmd+N opens once already there. This is the bridge between a global
// action registered once at the App level and a screen-local piece of
// state (e.g. AccountsScreen's `adding`) that only exists while that screen
// is mounted.
type PendingAction = "new-account" | "new-transaction" | null;

function App() {
  return (
    <ConfirmationProvider>
      <CommandRegistryProvider>
        <AppShell />
      </CommandRegistryProvider>
    </ConfirmationProvider>
  );
}

function AppShell() {
  const [view, setView] = useState<ContentView>({ type: "dashboard" });
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

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

  useEffect(() => {
    function handleGlobalContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => window.removeEventListener("contextmenu", handleGlobalContextMenu);
  }, []);

  const openDashboard = () => setView({ type: "dashboard" });
  const openAccounts = () => setView({ type: "accounts" });
  const openTransactions = () => setView({ type: "transactions", accountId: null });
  const openReports = () => setView({ type: "reports" });
  const openBudget = () => setView({ type: "budget" });
  const openRecurring = () => setView({ type: "recurring" });
  const openGoals = () => setView({ type: "goals" });
  const openInvestments = () => setView({ type: "investments" });
  const openSettings = () => setView({ type: "settings" });

  const navHandlers: Record<NavRailKey, () => void> = {
    dashboard: openDashboard,
    accounts: openAccounts,
    transactions: openTransactions,
    reports: openReports,
    budget: openBudget,
    recurring: openRecurring,
    goals: openGoals,
    investments: openInvestments,
    settings: openSettings,
  };
  const navLabels: Record<NavRailKey, string> = {
    dashboard: "Dashboard",
    accounts: "Accounts",
    transactions: "Transactions",
    reports: "Reports",
    budget: "Budget",
    recurring: "Recurring",
    goals: "Goals",
    investments: "Investments",
    settings: "Settings",
  };

  // Command Palette (#77) core commands: every Nav Rail destination, plus a
  // small starter set of high-value cross-screen actions ("New Transaction"
  // and "New Account" per #77's acceptance criteria). Registered once here
  // under fixed source ids -- future screens register their own commands
  // via the same `useCommands` hook from wherever they're mounted, without
  // touching this list or CommandPalette.tsx.
  useCommands(
    "core-nav",
    (Object.keys(navHandlers) as NavRailKey[]).map((key) => ({
      id: `nav-${key}`,
      label: navLabels[key],
      section: "Navigate",
      run: navHandlers[key],
    })),
  );
  useCommands("core-actions", [
    {
      id: "new-account",
      label: "New Account",
      section: "New",
      run: () => {
        setPendingAction("new-account");
        openAccounts();
      },
    },
    {
      id: "new-transaction",
      label: "New Transaction",
      section: "New",
      run: () => {
        setPendingAction("new-transaction");
        openTransactions();
      },
    },
  ]);

  return (
    <ReservedShortcutProvider onOpenSettings={openSettings}>
      <div className="app-shell">
        <NavRail
          active={view.type}
          onOpenDashboard={openDashboard}
          onOpenAccounts={openAccounts}
          onOpenTransactions={openTransactions}
          onOpenReports={openReports}
          onOpenBudget={openBudget}
          onOpenRecurring={openRecurring}
          onOpenGoals={openGoals}
          onOpenInvestments={openInvestments}
          onOpenSettings={openSettings}
        />
        <main className="content">
          {view.type === "dashboard" && <DashboardScreen />}
          {view.type === "accounts" && (
            <AccountsScreen
              onSelectAccount={(account) => setView({ type: "transactions", accountId: account.id })}
              onImportAccount={(account) => setView({ type: "import", account })}
              onAccountUpdated={() => {}}
              onAccountDeleted={(id) =>
                setView((current) =>
                  current.type === "transactions" && current.accountId === id
                    ? { type: "transactions", accountId: null }
                    : current,
                )
              }
              autoOpenAdd={pendingAction === "new-account"}
              onAutoOpenAddHandled={() => setPendingAction(null)}
            />
          )}
          {view.type === "transactions" && (
            <AllTransactionsScreen
              initialAccountId={view.accountId}
              autoOpenNew={pendingAction === "new-transaction"}
              onAutoOpenNewHandled={() => setPendingAction(null)}
              onImportAccount={(account) => setView({ type: "import", account })}
            />
          )}
          {view.type === "reports" && <ReportsScreen />}
          {view.type === "budget" && <BudgetScreen />}
          {view.type === "recurring" && <AllRecurringScreen />}
          {view.type === "goals" && <GoalsScreen />}
          {view.type === "investments" && <InvestmentsScreen />}
          {view.type === "settings" && <SettingsScreen />}
          {view.type === "import" && (
            <ImportScreen account={view.account} onBack={() => setView({ type: "accounts" })} />
          )}
        </main>
        <CommandPalette />
      </div>
    </ReservedShortcutProvider>
  );
}

export default App;
