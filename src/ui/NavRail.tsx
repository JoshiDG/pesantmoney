import { LayoutDashboard, Landmark, PiggyBank, Target, Settings, BarChart3 } from "lucide-react";

// Pure navigation rail: icon + label only, no inline data (e.g. no Account
// list). Per issue #50 (first slice of the nav-rail IA restructuring, ADR-0017
// / #49), this slice's rail is intentionally limited to destinations that
// already have a working screen. Reports was added in #54 once its screen
// existed; Transactions, Recurring, and Investments still land as their own
// nav items in later slices once their all-Accounts views exist.
// Categories/Rules/Merchants move under Settings in a later slice (#58) and
// are not top-level items here.
export type NavRailKey = "dashboard" | "accounts" | "reports" | "budget" | "goals" | "settings";

interface NavRailItem {
  key: NavRailKey;
  label: string;
  Icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavRailItem[] = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { key: "accounts", label: "Accounts", Icon: Landmark },
  { key: "reports", label: "Reports", Icon: BarChart3 },
  { key: "budget", label: "Budget", Icon: PiggyBank },
  { key: "goals", label: "Goals", Icon: Target },
  { key: "settings", label: "Settings", Icon: Settings },
];

interface NavRailProps {
  active: string;
  onOpenDashboard: () => void;
  onOpenAccounts: () => void;
  onOpenReports: () => void;
  onOpenBudget: () => void;
  onOpenGoals: () => void;
  onOpenSettings: () => void;
}

export function NavRail({
  active,
  onOpenDashboard,
  onOpenAccounts,
  onOpenReports,
  onOpenBudget,
  onOpenGoals,
  onOpenSettings,
}: NavRailProps) {
  const handlers: Record<NavRailKey, () => void> = {
    dashboard: onOpenDashboard,
    accounts: onOpenAccounts,
    reports: onOpenReports,
    budget: onOpenBudget,
    goals: onOpenGoals,
    settings: onOpenSettings,
  };

  return (
    <nav className="sidebar nav-rail" aria-label="Main navigation">
      <div className="sidebar-brand">PesantMoney</div>
      <ul className="nav-list">
        {NAV_ITEMS.map(({ key, label, Icon }) => {
          const isActive = active === key;
          return (
            <li key={key}>
              <button
                type="button"
                className={`nav-rail-item${isActive ? " selected" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={handlers[key]}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="nav-rail-label">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
