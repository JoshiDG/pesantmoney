# Feature-parity gap analysis: PesantMoney vs. Monarch Money

**Purpose:** ground-truth comparison of what PesantMoney actually implements today (verified against the codebase, not just docs) against what Monarch Money offers (verified against Monarch's own site/help center, not training-data assumptions), so contributors and users know which gaps are temporary roadmap items and which are permanent, deliberate product divergences.

**Method:** PesantMoney claims are cited to source files (`path:line`) or ADRs (`docs/adr/000X-slug.md`). Monarch claims are cited to the specific help-center article or marketing page fetched. Where a Monarch page had moved (`monarchmoney.com` → `monarch.com` domain migration, observed live during this research on 2026-09-10), the citation uses the resolved URL.

**Convention note:** follows the citation/confidence style established in `docs/research/legacy-ui-guidelines.md` — direct quotes where load-bearing, explicit flagging when a claim is inferred rather than directly sourced.

---

## Summary table

| Feature area | Monarch Money | PesantMoney | Gap type |
|---|---|---|---|
| Bank/institution account aggregation | Live sync via Plaid, Mastercard Data Connect (Finicity), or MX; auto-refresh every 24–48h | Manual accounts populated via file import or manual entry only | **Permanent, by design** — ADR-0002, ADR-0005 |
| Net worth tracking | Automatic net worth from synced balances, dashboard widget, trend chart | Implemented: `get_net_worth`, `get_net_worth_by_account`, dashboard hero + breakdown | **At parity** |
| Budgeting model | Flexible per-category "Flex" targets + optional rollover, need not sum to income | Zero-based (YNAB-style): all income must be Assigned before spending | **Permanent, by design** — ADR-0004 |
| Investment tracking — holdings | Holdings pulled live from connected brokerage, or manual holdings | Holdings entered manually or via import; no brokerage connection | Partial parity (manual-holdings path exists on both sides) |
| Investment tracking — pricing | Daily live price updates from Financial Modeling Prep | No live price feed; price set via manual entry or "price file" import, with as-of date shown | **Permanent, by design** — ADR-0003 |
| Transaction categorization — auto | Auto-categorizes on sync using Monarch's own merchant/category model | No automatic ML/merchant-based categorization; assignment is manual or rule-based on Import | Partial gap (rules exist; auto-suggest/ML does not) |
| Transaction categorization — rules | Rules match on original statement, merchant name, amount, category, owner; can rename merchant, recategorize, tag, hide | Rules match on field/match-type/value, assign one category, with priority ordering | Partial (narrower rule surface, no merchant-rename/tag/hide actions) |
| Merchant enrichment | Normalizes raw statement text into a clean merchant name/logo | Not implemented — description stored as imported | **Roadmap gap** (not addressed by any ADR) |
| Recurring items / bills | Auto-detects on every sync; separate "Bill Sync" auto-tracks credit-card/loan bills; manual add for others | Detected heuristically from imported history by day-gap windows, or added manually; no live bill-account sync | Partial — detection exists, "Bill Sync"-style live tracking is **permanent gap** per ADR-0002/0005 |
| Transfers | Linked/categorized as internal, excluded from cash flow | Linked heuristically or manually via `suggest_transfer_matches`/`link_transfer`, excluded from income/expense per domain glossary | **At parity** |
| Goals — savings | "Save Up Goals": target amount/date, on-track calculation | Goal linked to a savings Category; progress derived from cumulative Assigned amounts | Partial (no on-track/pace projection) |
| Goals — debt payoff | "Pay Down Goals": APR, payoff scenarios, avalanche/snowball, projected debt-free date | Goal linked to a debt Account; progress derived from balance paydown only | Partial (no interest/scenario modeling) |
| Cash flow reports | Dedicated Reports section: Cash Flow/Spending/Income tabs, chart types, filters, saved reports, summary cards | Dashboard shows this-month income/expense/net plus a 6-month bar trend; no filters, chart-type choice, or saved reports | Partial gap (basic version exists; no dedicated Reports module) |
| Household sharing / collaboration | Multi-user households, roles (Admin/Member/Advisor), Shared Views (mine/theirs/ours) | Single local SQLite file, single user/device, no accounts or roles | **Permanent, by design** — ADR-0005 |
| Mobile apps | Native iOS and Android apps, 4.9★ / 4.7★ | Desktop-only (Tauri: macOS/Windows/Linux) | **Permanent, by design** — ADR-0001 (desktop framework choice) |
| Multi-device sync | Cloud-backed, automatic across all devices | None; single local DB file; cross-machine copying is unsupported, at user's own risk | **Permanent, by design** — ADR-0005 |
| Credit score tracking | Monthly VantageScore 3.0 via Spinwheel/Equifax, trend graph, change alerts | Not implemented; no credit bureau integration of any kind | **Permanent, by design** — implied by ADR-0005/ADR-0003's no-network-financial-data stance (no ADR explicitly names credit scores, but a bureau pull is architecturally the same class of live external data call those ADRs reject) |
| Notifications / alerts | Overspend alerts, new-transaction alerts, recurring/bill alerts, in-app notification center | Local OS notifications for upcoming bills and category overspend, deduped via `notification_log` | Partial parity (narrower alert set, no in-app notification center, no new-transaction push since there's no live sync to push from) |
| Data encryption at rest | Cloud-hosted, provider-managed encryption | No app-level encryption; relies on OS disk encryption | **Permanent, by design** — ADR-0006 |
| App updates | N/A (SaaS, always current) | Tauri updater polling GitHub Releases, the one permitted network call outside financial data | Architectural note, not a feature gap — ADR-0009 |
| CSV/OFX/QFX import & dedup | N/A (data arrives via live sync, not file import) | Implemented: CSV + OFX parsers, fingerprint-based dedup with near-match review | PesantMoney-specific feature Monarch doesn't need |
| Data export | Manual export tools vary by plan | CSV export of all transactions (`export_transactions_csv`) plus full DB-file backup/export | **At parity or ahead** for local data portability |

---

## Detailed findings

### 1. Bank/institution account aggregation

**Monarch:** Connects institutions via three data providers — "Monarch uses three main data providers to securely connect financial institutions to your account: Plaid, Mastercard Data Connect (Formerly Finicity), and MX." Users add accounts through Profile > Settings > Institutions > Add account, then "Allow 24–48 hours for transactions to appear." (help.monarch.com, "Guide to Connecting Your Accounts" / "Understanding Data Providers and Connections", fetched via search 2026-09-10.)

**PesantMoney:** No aggregation exists at all. Accounts are created manually (`src/accounts/AccountForm.tsx`) and populated by importing user-supplied CSV/OFX/QFX files (`src-tauri/src/import/mod.rs`, `csv_parser.rs`, `ofx_parser.rs`) or by manual transaction entry (`src/transactions/TransactionForm.tsx`). CONTEXT.md's glossary states Import "Never automated or credential-based" and explicitly instructs avoiding "sync, connect, link" language.

**Gap type:** Permanent, deliberate. `docs/adr/0002-import-dedup-by-fingerprint.md` establishes file-based import as the only ingestion path; `docs/adr/0005-single-device-v1-no-sync-awareness.md` confirms no cloud backend exists to aggregate against.

### 2. Net worth tracking

**Monarch:** Dashboard widgets including net worth; "you can explore reports to see spending, income, cash flow, and net worth trends over time." (search results citing help.monarch.com Reports & Cash Flow section, 2026-09-10.)

**PesantMoney:** `src-tauri/src/commands.rs` exposes `get_net_worth` and `get_net_worth_by_account`; `src/dashboard/DashboardScreen.tsx:37-57` calls both and renders a "Net worth" hero figure plus a per-account breakdown sorted by `sortForBreakdown` (`src/dashboard/types.ts`).

**Gap type:** At parity for the core capability (current net worth + per-account view); Monarch's version also benefits from live-synced balances, which is the underlying data-source gap already captured under aggregation, not a distinct net-worth-feature gap.

### 3. Budgeting model

**Monarch:** Flex budgeting is described as the default: "you'll focus on tracking your flexible spending — a high-level bucket that contains all the categories containing expenses that tend to vary more." Rollover: "Rollovers let you carry any leftover amount in an expense budget category into the next month." Categories are organized into "Fixed, Non-monthly, and Flex buckets," and targets are independent per category (help.monarch.com, "Using Flex Budgeting" and "Rollover Budgets", fetched via search 2026-09-10).

**PesantMoney:** Zero-based budgeting — `src-tauri/src/services/budgets.rs` (567 lines) implements `assign_budget` and `get_ready_to_assign`; the domain glossary defines "Ready to Assign" as "Income not yet Assigned to any Category. Must reach zero for the Budget to be fully planned." `src/budget/BudgetScreen.tsx` is the assignment UI.

**Gap type:** Permanent, deliberate. `docs/adr/0004-zero-based-budgeting-not-monarch-style.md`: "This is an intentional product decision, not an oversight — someone porting Monarch's budget screens directly should stop and check this ADR first." No rollover concept exists in PesantMoney's budget schema (`src-tauri/migrations/0007_budgets.sql`).

### 4. Investment tracking — holdings and pricing

**Monarch:** "When you connect an investment account... Monarch pulls in your holdings from your financial institution. Prices and historical data come from Financial Modeling Prep (FMP)... Prices update daily if FMP supports the security." Manual holdings are also supported as a fallback for unsupported accounts/securities (help.monarch.com, "Investments in Monarch" / "Manual Investment Holdings", fetched via search 2026-09-10).

**PesantMoney:** `src-tauri/src/services/holdings.rs` (424 lines) implements `create_holding`, `set_security_price`, `get_latest_price`, `list_holdings_with_values`. Prices are per-ticker rows keyed by `(ticker, as_of_date)` (holdings.rs:132-145), set via manual entry or a price file, never a live API call. The `as_of_date` field is always surfaced (holdings.rs:18,33) so a stale valuation is visible — this directly implements the mitigation named in the ADR.

**Gap type:** Permanent, deliberate. `docs/adr/0003-investment-accounts-no-live-pricing.md`: "We rejected this: it breaks the project's core positioning (fully offline, no network calls at all)... The UI always shows the as-of date for the last price update so a stale valuation is visible, not silent" — matches the implementation exactly.

### 5. Transaction categorization: auto-categorization, rules, merchant enrichment

**Monarch:** "Monarch automatically applies categories to transactions as they arrive" (ML/merchant-model based, since it has no explicit rule until one is defined), and "you can further personalize your transaction categories using rules... match transactions using: Original statement... Merchant name... Amount... Categories... Owners" and rules can "automatically rename the merchant, update the category, add tags, set the owner, or even hide the transaction altogether." Duplicate merchant name variants can be merged in Merchant settings. (help.monarch.com, "Transaction Rules", fetched via search 2026-09-10.)

**PesantMoney:** No auto-categorization model exists — there is no merchant-lookup or ML classification service anywhere in `src-tauri/src/services/`. Categorization is purely rule-based: `src-tauri/src/services/categorization_rules.rs` defines `RuleField` and `MatchType` enums (lines 13, 40) and a rule maps one `field`/`match_type`/`match_value` to one `category_id` with a `priority` (line 94-102), applied via `apply_categorization_rules` on import. There is no rename-merchant, tag, hide-transaction, or owner-scoping action — the rule's only effect is assigning a category. `src/rules/RuleForm.tsx` and `src/rules/RulesScreen.tsx` are the corresponding UI.

**Gap type:** Mixed. The complete absence of ML/merchant-driven auto-categorization is a permanent architectural consequence of "no cloud merchant lookup" (CONTEXT.md, Categorization Rule entry: "Entirely local; no cloud merchant lookup"). The narrower rule *action* surface (no rename/tag/hide, no owner-scoping since there's no household model) is partly a roadmap gap (rename/tag/hide could be added without violating any ADR) and partly permanent (owner-scoping requires multi-user, which ADR-0005 rules out).

### 6. Recurring items / bill tracking

**Monarch:** "Any time your account syncs new transactions, Monarch will scan them and attempt to detect any new recurring items." A separate "Bill Sync" feature "offers automated tracking of credit card bills and loans," while "other types of bills, like utility payments and subscriptions, cannot be synced automatically" and must be tracked via the general recurring-detection path (help.monarch.com, "Tracking Recurring Expenses and Bills" / "Getting Started with Bill Sync", fetched via search 2026-09-10).

**PesantMoney:** `src-tauri/src/services/recurring_items.rs` (755 lines) implements heuristic detection: a `Frequency` enum (Weekly/Biweekly/Monthly/Yearly) with per-frequency day-gap windows used to classify consecutive occurrences as recurring (lines 10-58), exposed via `detect_recurring_items`, plus manual creation (`create_recurring_item`), confirmation of detected candidates (`confirm_recurring_item`), and forward projection (`upcoming_recurring_items`). This only runs against already-imported/manually-entered transaction history — there is no live-sync trigger and no analog to Monarch's "Bill Sync" (which depends on a live credit-card/loan account connection).

**Gap type:** Partial parity on detection logic (both products bucket transactions into recurring series by interval pattern); "Bill Sync"-style live tracking is a permanent gap flowing from the same no-live-connection constraint as aggregation (ADR-0002, ADR-0005) — detection can only run on data the user has already imported, never proactively.

### 7. Transfers

**Monarch:** Internal transfers are recognized/categorized and excluded from cash-flow/spending totals (implicit in Monarch's category system; not separately documented in a dedicated help article found during this research — flagged as **thin sourcing** on the Monarch side).

**PesantMoney:** `src-tauri/src/services/transfers.rs` (398 lines) implements `suggest_transfer_matches` (heuristic candidate matching) and `link_transfer`/`unlink_transfer`/`list_transfers`. CONTEXT.md: a Transfer is "Linked (heuristically or manually) and excluded from income/expense reporting, since no money entered or left the household." `src/transfers/TransferPicker.tsx` is the UI.

**Gap type:** At parity in outcome (transfers excluded from income/expense reporting on both sides); PesantMoney's matching is necessarily heuristic/post-hoc since there's no live multi-account sync to correlate transfers in real time, but this doesn't functionally under-serve the single-device use case.

### 8. Goals

**Monarch:** Split into two mechanisms as of "Goals 3.0": "Save Up Goals" ("When you add a target amount, target date, and monthly contribution to a savings goal, Monarch can now calculate whether you're on track, ahead, or at risk") and "Pay Down Goals" ("bringing together your loans, credit cards, and other debt accounts into a clear, visual payoff plan... add APR/interest rates... payoff projection... avalanche or snowball methods") (help.monarch.com, "Introducing Goals 3.0" / "Using Pay Down Goals" / "Using Save Up Goals", fetched via search 2026-09-10).

**PesantMoney:** `src-tauri/src/services/goals.rs` (511 lines): a Goal links to "either a savings Category (progress accrues from cumulative Assigned) or a debt Account (progress accrues from balance paydown)... Exactly one of" (goals.rs:10-11), exposed via `list_goals_with_progress` (goals.rs:30-36, progress_cents at line 36). Progress is "not clamped, so the UI can show 'over target' / negative progress distinctly from 'no progress yet'" (goals.rs:218-221). No APR/interest modeling, no on-track/pace projection, no scenario simulation exists anywhere in the file.

**Gap type:** Roadmap gap, not ADR-blocked. The domain glossary explicitly frames this as intentional simplicity ("Progress is derived from existing Transaction/Budget/Account data, not a separate input"), but no ADR forecloses adding interest-rate/projection math later — this is scaffolded but not built out to Monarch's depth.

### 9. Cash flow / reports

**Monarch:** "Reports has three tabs — Cash Flow, Spending, and Income — and each one lets you pick a chart type, apply filters, click into any part of the chart to see the transactions behind it, and save the whole setup as a saved report," plus a summary card with "Total income, Total spending, Net cash flow, and Savings rate" (help.monarch.com, "Using Reports" / "Cash Flow", fetched via search 2026-09-10).

**PesantMoney:** `src-tauri/src/commands.rs` exposes `get_cash_flow_for_range` and `income_expense_totals`. `src/dashboard/DashboardScreen.tsx:121-164` renders "This month" income/expense/net stats and a hand-rolled 6-month bar chart (`trend-chart` CSS classes, no charting library — `package.json` has no chart dependency at all, confirming this is custom-built, not wired to a library). There is no dedicated Reports screen, no chart-type selection, no filters, no drill-into-transactions-from-chart, and no saved-report concept anywhere in `src/`.

**Gap type:** Roadmap gap. Nothing in the ADRs forecloses a richer Reports module; the current dashboard trend chart is a minimal placeholder for the underlying data (which the backend already computes via `get_cash_flow_for_range`).

### 10. Household sharing / collaboration

**Monarch:** "Monarch Money households include three types of collaborators: Admin (Owner)... Member... and Professional (Advisor/Planner)." "Shared Views allows you to assign ownership to accounts and transactions... mark accounts and transactions as mine, theirs, or ours (shared)." "Unlimited collaboration at no additional cost" (help.monarch.com, "Monarch for Couples and Households" / "Shared Views in Monarch", fetched via search 2026-09-10).

**PesantMoney:** No user/account/role model exists anywhere in the schema (`src-tauri/migrations/`) or services. `src-tauri/src/lib.rs` opens exactly one SQLite connection per app instance with no auth layer.

**Gap type:** Permanent, deliberate. `docs/adr/0005-single-device-v1-no-sync-awareness.md`: "v1 stores one local database file with no built-in sync, conflict detection, or multi-writer support... Multi-device support, if pursued, is a deliberate later phase requiring its own design (likely a merge/CRDT strategy), not an incremental add-on to v1's storage engine."

### 11. Mobile apps and multi-device sync

**Monarch:** "Monarch Money is available for iPhone via the App Store and for Android devices via the Google Play Store," 4.9★ App Store / 4.7★ Play Store (search results citing apps.apple.com and monarch.com/download, 2026-09-10).

**PesantMoney:** Desktop-only. `docs/adr/0001-tauri-desktop-framework.md` frames the entire project as "a cross-platform desktop app"; `src-tauri/tauri.conf.json` and the icon set (`src-tauri/icons/`) target macOS/Windows/Linux only, no mobile bundle targets configured.

**Gap type:** Permanent, deliberate (current scope). ADR-0001 doesn't foreclose mobile forever, but the app's entire architecture (local SQLite file, no sync layer per ADR-0005) is incompatible with a useful mobile companion app without first solving multi-device sync — so this is coupled to, not independent of, gap #10.

### 12. Credit score tracking

**Monarch:** "Monarch Money now offers credit score tracking... monthly credit score updates, including trend graphs, notifications of significant changes to your score... powered by Spinwheel and uses the VantageScore 3.0 model, with data provided by Equifax" (search results citing help.monarch.com "Viewing Your Credit Score" and monarch.com/blog/credit-score-tracking, 2026-09-10).

**PesantMoney:** No credit bureau integration exists anywhere in the codebase — no service file, migration, or command references credit scores, VantageScore, or any bureau.

**Gap type:** Permanent by strong implication, not by an ADR that names it directly. A credit-score feature requires an internet-connected, credentialed pull from a third-party bureau — architecturally the same category of live external financial data call that ADR-0002 (import is never credential-based), ADR-0003 (no live market data calls), and ADR-0005 (no cloud backend) collectively rule out. No ADR discusses credit scores by name, so this is flagged as inferred-permanent rather than explicitly documented — a gap in the ADR set itself, worth a follow-up ADR if this is ever debated.

### 13. Notifications / alerts

**Monarch:** "Monarch Money offers overspending alerts and notifications for new transactions... you have the option to include recurring transaction alerts in your notification center" (search results citing help.monarch.com, 2026-09-10).

**PesantMoney:** `src-tauri/src/services/notifications.rs` defines `NotificationCandidate` with exactly two kinds: `UpcomingBill` (from a recurring item's `next_expected_date`) and `CategoryOverspend` (`overspent_cents` when `-(assigned_cents + activity_cents)` is positive) (notifications.rs:9-26), deduped via a `notification_log` table (migration `0012_notification_log.sql`) and surfaced as native OS notifications via `run_notification_check`. `src/settings/SettingsScreen.tsx` exposes toggles for `bill_notifications_enabled` and `overspend_notifications_enabled`.

**Gap type:** Partial parity. Both products alert on overspend and upcoming bills; Monarch additionally alerts on "new transactions," which is meaningless for PesantMoney absent live sync (there's no external event to be "new" relative to — import is the only ingestion event, and the user is present for it). No permanent-gap ADR is needed here; the difference is a natural consequence of the import-vs-sync architecture already covered above, not an independent feature omission.

### 14. Data encryption at rest

**Monarch:** Cloud SaaS; encryption is provider-managed infrastructure, not a user-facing feature Monarch documents in comparable terms to a local-encryption toggle.

**PesantMoney:** No app-level encryption. `docs/adr/0006-no-app-level-encryption.md`: "Chose plaintext: it keeps the database directly inspectable for debugging, support, and third-party tooling... This assumes users protect the machine itself; it is not a defense against a lost/stolen unlocked laptop or another OS user account." Explicitly reversible only with real migration cost: "Revisit if the community wants an opt-in encrypted mode later — retrofitting is a real migration for anyone with an existing plaintext database."

**Gap type:** Not a like-for-like comparison (different security models entirely — server-side encryption vs. local file), but worth naming since it's a real security-posture difference a user should understand. Permanent, deliberate per ADR-0006, revisitable.

### 15. Import/export capabilities unique to PesantMoney

**PesantMoney:** CSV parser (`src-tauri/src/import/csv_parser.rs`, 192 lines) and OFX parser (`src-tauri/src/import/ofx_parser.rs`, 143 lines), fingerprint-based dedup (`src-tauri/src/import/fingerprint.rs`, keyed on account/date/amount/normalized description per ADR-0002), CSV export of all transactions (`src-tauri/src/services/csv_export.rs`) plus a full local DB-file backup/export (`src-tauri/src/services/backup.rs`, 270 lines, including an automatic once-per-launch rolling snapshot per `src-tauri/src/lib.rs:39-44`).

**Monarch:** No file-import path is needed since data arrives via live sync; export options are typically narrower on consumer SaaS budgeting tools generally (not verified against a specific Monarch export-feature page in this research — flagged as **not directly sourced**, included here only as the asymmetric counterpart to PesantMoney's import machinery, not as a claim about Monarch's export limitations).

**Gap type:** Not a gap against Monarch — this is necessary infrastructure PesantMoney needs precisely because it lacks live sync, and it appears fully built out (parser + dedup + review-for-near-matches per ADR-0002, plus both human-readable CSV and raw DB export).

---

## Known gaps in this research

- Several Monarch claims (transfers handling, export limits) come from general search-result synthesis rather than a directly fetched and quoted help-center article; these are flagged inline as "not directly sourced" or "thin sourcing" rather than presented with false confidence.
- `monarchmoney.com` now 301-redirects to `monarch.com` — citations use the resolved domain; older help-center URLs under `help.monarchmoney.com` (e.g. "Creating Transaction Rules") appear to run in parallel with `help.monarch.com` — both are treated as authoritative Monarch sources.
- Pricing/tiering (which Monarch features require which subscription tier) was out of scope for this feature-parity pass and is not covered.
