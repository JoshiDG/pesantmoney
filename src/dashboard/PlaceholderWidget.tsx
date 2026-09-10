/** A permanent explanatory stand-in for functionality this offline-only,
 * non-AI app deliberately doesn't have (Investments live pricing per
 * ADR-0003, Credit Score, Advice) -- not a "coming soon" placeholder for
 * something being built later. No data fetching, no interactive controls. */
export function PlaceholderWidget({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="dashboard-widget">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">{title}</h3>
      </div>
      <p className="dashboard-widget-placeholder-copy">{copy}</p>
    </div>
  );
}
