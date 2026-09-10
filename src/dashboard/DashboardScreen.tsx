import { NetWorthWidget } from "./NetWorthWidget";

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
          <NetWorthWidget />
        </div>
        <div className="dashboard-column" />
      </div>
    </section>
  );
}
