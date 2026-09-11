import { useState } from "react";
import {
  LayoutDashboard,
  Landmark,
  Receipt,
  BarChart3,
  PiggyBank,
  Target,
  TrendingUp,
  Settings,
  MoreHorizontal,
} from "lucide-react";
import { useBreakpoint } from "./BreakpointProvider";

// Pure navigation rail: icon + label only, no inline data (e.g. no Account
// list). Per issue #50 (first slice of the nav-rail IA restructuring, ADR-0017
// / #49), this slice's rail was intentionally limited to destinations that
// already had a working screen. #51 added Transactions, #54 added Reports,
// and #53 added Investments; Recurring lands as its own nav item once its
// all-Accounts view exists (#52). Categories/Rules/Merchants move under
// Settings in a later slice (#58) and are not top-level items here.
export type NavRailKey =
  | "dashboard"
  | "accounts"
  | "transactions"
  | "reports"
  | "budget"
  | "goals"
  | "investments"
  | "settings";

interface NavRailItem {
  key: NavRailKey;
  label: string;
  Icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavRailItem[] = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { key: "accounts", label: "Accounts", Icon: Landmark },
  { key: "transactions", label: "Transactions", Icon: Receipt },
  { key: "reports", label: "Reports", Icon: BarChart3 },
  { key: "budget", label: "Budget", Icon: PiggyBank },
  { key: "goals", label: "Goals", Icon: Target },
  { key: "investments", label: "Investments", Icon: TrendingUp },
  { key: "settings", label: "Settings", Icon: Settings },
];

// The Mobile-tier Bottom Tab Bar's primary destinations, per ADR-0018 / issue
// #61: Dashboard, Transactions, Budget, Accounts stay directly on the bar;
// everything else collapses under "More". This is intentionally a plain
// string set rather than tied to NavRailKey -- Transactions isn't a nav
// destination yet (lands with #52), and Reports/Recurring/Investments land
// with #52/#53. Keying the split off membership (rather than an exhaustive
// hardcoded overflow list) means any nav item added later that isn't one of
// these four primaries automatically falls into "More" with no changes here.
const PRIMARY_TAB_KEYS = new Set<string>(["dashboard", "transactions", "budget", "accounts"]);

interface NavRailProps {
  active: string;
  onOpenDashboard: () => void;
  onOpenAccounts: () => void;
  onOpenTransactions: () => void;
  onOpenReports: () => void;
  onOpenBudget: () => void;
  onOpenGoals: () => void;
  onOpenInvestments: () => void;
  onOpenSettings: () => void;
}

export function NavRail({
  active,
  onOpenDashboard,
  onOpenAccounts,
  onOpenTransactions,
  onOpenReports,
  onOpenBudget,
  onOpenGoals,
  onOpenInvestments,
  onOpenSettings,
}: NavRailProps) {
  const tier = useBreakpoint();
  const handlers: Record<NavRailKey, () => void> = {
    dashboard: onOpenDashboard,
    accounts: onOpenAccounts,
    transactions: onOpenTransactions,
    reports: onOpenReports,
    budget: onOpenBudget,
    goals: onOpenGoals,
    investments: onOpenInvestments,
    settings: onOpenSettings,
  };

  // Structural swap per ADR-0018: Expanded tier shows icon + label; Compact
  // tier (issue #60) collapses to icon-only; Mobile tier (issue #61) swaps to
  // a fixed Bottom Tab Bar with a "More" overflow entirely. The label is
  // still exposed for icon-only items via aria-label (accessible name) and
  // title (hover/focus tooltip), since there's no dedicated Tooltip component
  // in the codebase yet.
  if (tier === "mobile") {
    return <BottomTabBar active={active} handlers={handlers} />;
  }
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

function BottomTabBar({
  active,
  handlers,
}: {
  active: string;
  handlers: Record<NavRailKey, () => void>;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  const primaryItems = NAV_ITEMS.filter((item) => PRIMARY_TAB_KEYS.has(item.key));
  const overflowItems = NAV_ITEMS.filter((item) => !PRIMARY_TAB_KEYS.has(item.key));
  const overflowIsActive = overflowItems.some((item) => item.key === active);

  return (
    <nav className="bottom-tab-bar" aria-label="Main navigation">
      <ul className="bottom-tab-list">
        {primaryItems.map(({ key, label, Icon }) => {
          const isActive = active === key;
          return (
            <li key={key}>
              <button
                type="button"
                className={`bottom-tab-item${isActive ? " selected" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={handlers[key]}
              >
                <Icon size={20} aria-hidden="true" />
                <span className="bottom-tab-label">{label}</span>
              </button>
            </li>
          );
        })}
        <li className="bottom-tab-more">
          <button
            type="button"
            className={`bottom-tab-item${overflowIsActive ? " selected" : ""}`}
            aria-current={overflowIsActive ? "page" : undefined}
            aria-haspopup="true"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal size={20} aria-hidden="true" />
            <span className="bottom-tab-label">More</span>
          </button>
          {moreOpen && (
            <ul className="bottom-tab-more-sheet" role="menu" aria-label="More destinations">
              {overflowItems.map(({ key, label, Icon }) => {
                const isActive = active === key;
                return (
                  <li key={key} role="none">
                    <button
                      type="button"
                      className={`bottom-tab-more-item${isActive ? " selected" : ""}`}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => {
                        handlers[key]();
                        setMoreOpen(false);
                      }}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      </ul>
    </nav>
  );
}
