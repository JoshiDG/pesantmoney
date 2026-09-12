# PesantMoney

An open-source, offline-only personal finance desktop app in the spirit of Monarch Money: full budgeting/net-worth/investment feature set, no live bank sync, all data local.

## Language

**Account**:
A financial holding the user tracks — checking, savings, credit card, investment, loan, or cash. Created manually and populated via Import or manual Transactions.
_Avoid_: Institution (a bank/brokerage is the institution; the Account is the holding at it)

**Institution**:
The bank, brokerage, or lender an Account is held at. Metadata only (name, logo) — never a source of live data.
_Avoid_: Bank, provider

**Transaction**:
A single dated money movement posted to an Account, arriving either via Import or manual entry. May be marked Hidden.
_Avoid_: Purchase, entry

**Hidden** (Transaction):
A per-Transaction flag, set by a Categorization Rule's hide action or manually, and independently reversible. Excludes the Transaction from the default Transactions list view (revealed by a "show hidden" toggle) and from income/expense/budget/report totals. A stronger, single-Transaction exclusion than Transfer-linking — see ADR-0014.
_Avoid_: Excluded, archived (Excluded is used loosely for Transfers, which use a different mechanism; Hidden is its own flag)

**Import**:
The act of loading a batch of Transactions into an Account from a user-supplied file (CSV/OFX/QFX). Never automated or credential-based.
_Avoid_: Sync, connect, link (these imply live bank connectivity, which this project deliberately excludes)

**Import Profile**:
A saved column mapping (date, amount, description, sign convention, etc.) for a specific Institution's CSV export shape, reused across repeated Imports from that source. OFX/QFX files don't need one since the format is self-describing.
_Avoid_: Template, format (too generic)

**Category**:
A user-facing label for what a Transaction was for (e.g. Groceries, Rent), assigned manually or by a Categorization Rule. Belongs to a Category Group.

**Categorization Rule**:
A user-defined condition (matching on description, amount, or Account) that, on matching Transactions automatically on Import, assigns a Category, renames the merchant (see ADR-0012; shares the same `merchant_name` field as any Merchant-dictionary match, taking precedence over it), adds a Tag, or marks the Transaction Hidden (see ADR-0014). Entirely local; no cloud merchant lookup. Description matching prefers a Transaction's Merchant name when one was identified, falling back to the raw imported description otherwise.
_Avoid_: Auto-categorization (describes the behavior, not the entity)

**Tag**:
A user-defined, freeform label a Transaction can carry zero or more of, independent of its Category — many-to-many, unlike Category's one-per-Transaction model. Created ad hoc wherever assigned (manually or by a Categorization Rule action); no dedicated management screen in v1. See ADR-0013.
_Avoid_: Label (too generic), Category (a Transaction has exactly one Category but any number of Tags)

**Merchant**:
A user-maintained keyword-to-name mapping (e.g. `"SQ *BLUE BOTTLE"` → "Blue Bottle Coffee") used to identify a clean, human-readable name from a Transaction's raw imported description. Matched by substring at Import time only; seeded with a small local dictionary and freely editable/extendable by the user. Never a cloud lookup or ML model — see ADR-0011.
_Avoid_: Merchant enrichment (describes the behavior, not the entity)

**Payee**:
The name shown for a Transaction — `merchant_name` when identified, falling back to the raw `description` otherwise. Directly editable per-Transaction from the Transactions grid, in addition to the existing Merchant-dictionary-match and Categorization-Rule-rename writers to the same `merchant_name` field (see ADR-0012, ADR-0019); an inline edit optionally adds the Transaction's raw `description` as a new Merchant dictionary keyword, gated on user confirmation, and never retroactively renames other Transactions.
_Avoid_: Merchant name (the field; Payee is the user-facing concept of "the name I see for this transaction")

**Suggestion Combobox**:
A reusable autocomplete input: type-ahead ghost-text completion against a list of known values (Merchant names, Tags, or Categories), commit via Tab/Enter, or fall through to a "create new" flow (itself reusable, optionally gated by a confirmation step — e.g. Category's required Group) when nothing matches. Backs Payee (single-select, confirm-gated create), Tags (multi-select chips, ungated create), and Category (single-select, Group-picker-gated create) editing in the Transactions grid.
_Avoid_: Autocomplete, typeahead (generic terms for the browser/HTML behavior; Suggestion Combobox is this app's specific reusable component with its ghost-text-commit and create-new semantics)

**Budget**:
A zero-based monthly plan: all available income must be Assigned to Categories before it can be spent. Distinct from Monarch's model of independent per-category targets that need not sum to income — see ADR-0004.
_Avoid_: Target, spending limit (implies Monarch's model, not this one)

**Assigned**:
The amount of money moved from Ready to Assign into a specific Category for the current Budget month.
_Avoid_: Budgeted, allocated

**Ready to Assign**:
Income not yet Assigned to any Category. Must reach zero for the Budget to be fully planned.
_Avoid_: Unallocated, available balance

**Recurring Item**:
A predicted repeating payment or deposit (e.g. a subscription, a paycheck), either detected heuristically from an Account's imported Transaction history or defined manually, used to forecast upcoming cash flow.
_Avoid_: Subscription (too narrow — covers bills, income, transfers too)

**Transfer**:
A pair of opposite-sign Transactions across two of the user's own Accounts representing one movement of money between them (e.g. a credit card payment). Linked (heuristically or manually) and excluded from income/expense reporting, since no money entered or left the household.
_Avoid_: Payment (a Transfer is a specific kind of movement, not any payment)

**Goal**:
A target dollar amount by a target date, linked to either a savings Category (progress accrues from Assigned amounts) or a debt Account (progress accrues from balance paydown). Progress is derived from existing Transaction/Budget/Account data, not a separate input.
_Avoid_: Target (already used for Monarch's rejected budget model — see Budget)

**Goal Pace**:
A Goal's on-track/ahead/behind classification: the trailing 3-month average of realized monthly progress compared against the pace required to reach the target amount by the target date. Derived entirely from existing progress data — never a separate user-entered contribution amount (unlike Monarch) — see ADR-0015. Goals with fewer than 3 months of history report "insufficient data" rather than a projection.
_Avoid_: On-track score, projection input (implies a user-supplied contribution figure)

**Payoff Projection**:
A hypothetical debt-free date computed for a single debt Account from its current balance, a manually-entered APR, and a manually-entered hypothetical monthly payment, using standard amortization math. Entirely local and recomputed on demand — never persisted as Transaction data, and never affects Goal progress, which stays derived solely from balance paydown per **Goal**. If the entered payment doesn't cover accruing interest, no finite payoff date exists and the app says so explicitly rather than showing a misleading number. See ADR-0016; multi-Account avalanche/snowball prioritization across debts is a separate, larger concept deferred to a follow-up.
_Avoid_: Payoff Goal (a Payoff Projection is a what-if calculator, not a persisted Goal)

**Breakpoint Tier**:
One of three named viewport-width bands — Expanded (>=1280px), Compact (768-1279px), Mobile (<768px) — that drive both cosmetic CSS reflow and structural component swaps (see Nav Rail). Read via the `useBreakpoint()` hook, not ad hoc media query literals. See ADR-0018.
_Avoid_: Breakpoint (ambiguous between the pixel value and the named tier — Breakpoint Tier is the tier, breakpoint is the cutoff number)

**Nav Rail**:
The app's primary navigation surface (Dashboard, Accounts, Transactions, Reports, Budget, Recurring, Goals, Investments, Settings — see ADR-0017), rendered as one of three structural states depending on Breakpoint Tier: an expanded rail (icons + labels), an icon rail (icons only), or a Bottom Tab Bar. See ADR-0018.
_Avoid_: Sidebar (describes the Expanded/Icon states only, not the Bottom Tab Bar state the same navigation becomes at Mobile tier)

**Bottom Tab Bar**:
The Mobile-tier form of the Nav Rail: a fixed bottom bar showing Dashboard, Transactions, Budget, and Accounts, plus a "More" destination for the remaining Nav Rail items. See ADR-0018.
_Avoid_: Tab bar (too generic — this is specifically the Nav Rail's Mobile-tier state, not an unrelated tabbed-content pattern)

**Column Set** (Transactions grid):
The full list of columns the Transactions grid can display for a Transaction (e.g. Date, Account, Payee, Memo, Category, Tags, Amount, Running Balance). Distinct from which of those columns are currently visible — see **Column Management**.
_Avoid_: Columns (ambiguous between the full available set and what's currently shown)

**Column Management**:
User control over which columns from the Column Set are visible and in what order (drag-to-reorder), for the Transactions grid. Lets a power-user configure a dense, Bloomberg-terminal-style view rather than being locked to a fixed column list.
_Avoid_: Column customization (vaguer — Column Management is the specific show/hide/reorder affordance, not styling)

**Command Palette**:
A global, keyboard-invoked (Cmd+K) fuzzy search over actions, navigation destinations, and records (e.g. jump straight to an Account or Category by name). The primary keyboard interaction model for the app — see ADR-0020 — layered with fixed macOS-native modifier shortcuts and, within a focused grid, bare single-letter shortcuts.
_Avoid_: Quick switcher, spotlight (describes the pattern generically; Command Palette is this app's specific instance)

**Reserved Shortcut Set**:
The closed, app-wide vocabulary of macOS-native modifier-key shortcuts (e.g. Cmd+N, Cmd+F, Cmd+,) that a screen may never repurpose for a different action. See ADR-0020; distinct from the bare single-letter shortcuts scoped to a focused grid/list, which aren't app-wide and don't need reservation.
_Avoid_: Global shortcuts (ambiguous — could be read to include the grid-scoped single-letter shortcuts, which are deliberately not app-wide)

**Palette**:
The single source of truth for all color values in the app — a dedicated token file listing every color by role (backgrounds, text, credit/debit, function-key roles, accents). Current values are Bloomberg Terminal-inspired; the point of the file is that any value can be swapped later without touching component code.
_Avoid_: Theme (implies multiple switchable themes; there is one palette, just extractable)

**Function Bar**:
The Bloomberg-style row of color-coded action chips at the top of the Transactions screen (New, Import, Export, Columns, Show Hidden), each chip colored by role. Screen-level actions only — row-level actions stay on the row context menu.
_Avoid_: Toolbar, action bar (generic; the color-coded role system is the defining trait)

**Context Bar**:
The Bloomberg command-line-style bar below the Function Bar on the Transactions screen: the Account context selector plus the live search input (focused by Cmd+F). Carries *where* the grid is looking, not actions.
_Avoid_: Breadcrumbs, command bar (breadcrumbs imply a path; command bar implies palette-style commands — this holds context + record search)

**Quote Strip**:
The live totals strip above the Transactions grid: filtered row count, Income, Expense, Net (green/red signed), plus the selected Account's balance. Updates with every filter/search change.
_Avoid_: Summary header, KPI strip (generic)

**Status Bar**:
The bottom line of the Transactions screen: filter/search state summary and current sort on the left, context-aware shortcut hints on the right.
_Avoid_: Footer (too generic — this is an information-bearing terminal element, not a page footer)

**Date Group**:
A sticky section header in the Transactions grid grouping rows by calendar date (Today / Yesterday / explicit dates).
