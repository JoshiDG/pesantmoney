import { LayoutDashboard, Landmark, PiggyBank, Target, Settings } from "lucide-react";
import { useBreakpoint } from "./BreakpointProvider";

// Pure navigation rail: icon + label only, no inline data (e.g. no Account
// list). Per issue #50 (first slice of the nav-rail IA restructuring, ADR-0017
// / #49), this slice's rail is intentionally limited to destinations that
// already have a working screen -- Transactions, Reports, Recurring, and
// Investments land as their own nav items in later slices once their
// all-Accounts views exist. Categories/Rules/Merchants move under Settings in
// a later slice (#58) and are not top-level items here.
export type NavRailKey = "dashboard" | "accounts" | "budget" | "goals" | "settings";

interface NavRailItem {
  key: NavRailKey;
  label: string;
  Icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavRailItem[] = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { key: "accounts", label: "Accounts", Icon: Landmark },
  { key: "budget", label: "Budget", Icon: PiggyBank },
  { key: "goals", label: "Goals", Icon: Target },
  { key: "settings", label: "Settings", Icon: Settings },
];

interface NavRailProps {
  active: string;
  onOpenDashboard: () => void;
  onOpenAccounts: () => void;
  onOpenBudget: () => void;
  onOpenGoals: () => void;
  onOpenSettings: () => void;
}

export function NavRail({
  active,
  onOpenDashboard,
  onOpenAccounts,
  onOpenBudget,
  onOpenGoals,
  onOpenSettings,
}: NavRailProps) {
  const handlers: Record<NavRailKey, () => void> = {
    dashboard: onOpenDashboard,
    accounts: onOpenAccounts,
    budget: onOpenBudget,
    goals: onOpenGoals,
    settings: onOpenSettings,
  };

  // Structural swap per ADR-0018 / issue #60: Expanded tier shows icon +
  // label; Compact (and, until the bottom-tab-bar of #61 lands, Mobile) tier
  // collapses to icon-only. The label is still exposed for icon-only items
  // via aria-label (accessible name) and title (hover/focus tooltip), since
  // there's no dedicated Tooltip component in the codebase yet.
  const tier = useBreakpoint();
  const isIconOnly = tier !== "expanded";

  return (
    <nav
      className={`sidebar nav-rail${isIconOnly ? " nav-rail-icon-only" : ""}`}
      aria-label="Main navigation"
    >
      <div className="sidebar-brand">{isIconOnly ? "PM" : "PesantMoney"}</div>
      <ul className="nav-list">
        {NAV_ITEMS.map(({ key, label, Icon }) => {
          const isActive = active === key;
          return (
            <li key={key}>
              <button
                type="button"
                className={`nav-rail-item${isActive ? " selected" : ""}`}
                aria-current={isActive ? "page" : undefined}
                aria-label={isIconOnly ? label : undefined}
                title={isIconOnly ? label : undefined}
                onClick={handlers[key]}
              >
                <Icon size={18} aria-hidden="true" />
                {!isIconOnly && <span className="nav-rail-label">{label}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
