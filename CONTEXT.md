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
A single dated money movement posted to an Account, arriving either via Import or manual entry.
_Avoid_: Purchase, entry

**Import**:
The act of loading a batch of Transactions into an Account from a user-supplied file (CSV/OFX/QFX). Never automated or credential-based.
_Avoid_: Sync, connect, link (these imply live bank connectivity, which this project deliberately excludes)

**Import Profile**:
A saved column mapping (date, amount, description, sign convention, etc.) for a specific Institution's CSV export shape, reused across repeated Imports from that source. OFX/QFX files don't need one since the format is self-describing.
_Avoid_: Template, format (too generic)

**Category**:
A user-facing label for what a Transaction was for (e.g. Groceries, Rent), assigned manually or by a Categorization Rule. Belongs to a Category Group.

**Categorization Rule**:
A user-defined condition (matching on description, amount, or Account) that assigns a Category to matching Transactions automatically on Import. Entirely local; no cloud merchant lookup. Description matching prefers a Transaction's Merchant name when one was identified, falling back to the raw imported description otherwise.
_Avoid_: Auto-categorization (describes the behavior, not the entity)

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
