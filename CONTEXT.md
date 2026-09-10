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
