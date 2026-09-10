import { BudgetWidget } from "./BudgetWidget";
import { GoalsWidget } from "./GoalsWidget";
import { NetWorthWidget } from "./NetWorthWidget";
import { PlaceholderWidget } from "./PlaceholderWidget";
import { RecentTransactionsWidget } from "./RecentTransactionsWidget";
import { RecurringWidget } from "./RecurringWidget";
import { SpendingWidget } from "./SpendingWidget";

export function DashboardScreen() {
  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Dashboard</h2>
          <div className="account-title-meta">Net worth and cash flow across every account</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-column">
          <BudgetWidget />
          <SpendingWidget />
          <NetWorthWidget />
          <GoalsWidget />
        </div>
        <div className="dashboard-column">
          <RecentTransactionsWidget />
          <RecurringWidget />
          <PlaceholderWidget
            title="Investments"
            copy="Live investment sync isn't supported in this offline-only app -- holdings are entered and priced manually, with no automatic pricing."
          />
          <PlaceholderWidget
            title="Credit Score"
            copy="Credit score data isn't available -- PesantMoney is an offline app and doesn't connect to a credit bureau."
          />
          <PlaceholderWidget
            title="Advice"
            copy="There's no AI-driven advice engine here -- just your own numbers, laid out for you to interpret."
          />
        </div>
      </div>
    </section>
  );
}
