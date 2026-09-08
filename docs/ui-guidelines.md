# UI guidelines

Decision record: `docs/adr/0010-legacy-ui-guidelines-synthesis.md`. Sourcing, direct quotes, and confidence levels for every rule below: `docs/research/legacy-ui-guidelines.md`. This document is the living, prescriptive half — it changes as the redesign proceeds; the ADR does not.

These rules apply going forward to all 11 screens (`AccountsScreen`, `BudgetScreen`, `CategoriesScreen`, `DashboardScreen`, `GoalsScreen`, `HoldingsScreen`, `ImportScreen`, `RecurringItemsScreen`, `RulesScreen`, `SettingsScreen`, `TransactionsScreen`) as they're touched, not as a one-time rewrite. Existing App.css tokens (`--ink`, `--paper`, `--credit`, `--debit`, `--focus`, the serif/sans/mono font stacks) and the dense CSS-grid ledger layout are not superseded by this document — they're the visual layer; what follows is mostly the *interaction and structural* layer that was previously undocumented. Where a rule below does touch visual style, it's noted explicitly.

Modern dark-mode support (App.css already does this via `prefers-color-scheme`) and accessibility expectations always win over anything below — none of the source systems address either, since all predate them by decades.

## Confirmation and destructive actions

**Current state, and the first thing this guide changes:** every destructive action in the app (`AccountsScreen.tsx:82`, `GoalsScreen.tsx:67`, `HoldingsScreen.tsx:57`, `TransactionsScreen.tsx:110`, `RulesScreen.tsx:78`, `CategoriesScreen.tsx:55,90`, `RecurringItemsScreen.tsx:76`) uses the browser's native `window.confirm("Delete ... ? This cannot be undone.")`. This is exactly the anti-pattern the source material warns against: a generic, OS-chrome-styled, synchronous, un-themed blocking prompt with unlabeled OK/Cancel buttons.

Replace with an in-app confirmation panel, modal to the current screen only (not the whole app — see Modality below), following:

- **Verb-phrase button labels, not Yes/No/OK** (NeXTSTEP, `docs/research/legacy-ui-guidelines.md` System 4(b)): a delete-account confirmation should read "Delete Account" / "Cancel", not "Yes" / "No" or "OK" / "Cancel". NeXTSTEP's own guidance: *"generic labels (like Yes and No) aren't appropriate, as they tend to cause user errors. Avoid using OK unless it's the only button."*
- **Default button in the lower-right, doubly emphasized, but never the destructive choice by default** — both Apple's 1987 HIG and NeXTSTEP place the default/likely button at lower-right and bind it to Return/Enter. For a *destructive* confirmation, the safe choice (Cancel) should be the one bound to Enter, or neither button should auto-bind to Enter — don't let a startled Enter-press delete something. This is a deliberate deviation from the source material's literal "most likely action gets Enter" rule, justified by Apple's own Forgiveness principle (below).
- **Cancel is always present and always labeled "Cancel"** (Apple HIG 1987, CUA) — never omit an escape hatch from a destructive-action panel.

## Modality

Adopt NeXTSTEP's stance explicitly, since it's the most rigorous of the six sources on this point: *"applications should avoid setting up arbitrary modes... modes are used in only three situations"* (modal tool, attention panel, spring-loaded/press-and-hold). Concretely:

- A confirmation/attention panel should be modal to the **screen/feature it interrupts**, not to the whole application — the user should still be able to switch to a different sidebar item while, say, a delete confirmation is theoretically open elsewhere (in practice, since confirmations resolve immediately, this mostly matters for any future longer-running panel, e.g. import preview).
- Don't introduce a new mode (a distinct UI state that changes what clicks/keys do) without being able to name which of the three justified categories it falls into.

## Keyboard conventions

- **Reserve a closed set of shortcuts app-wide and never let a screen repurpose one** — CUA, Apple HIG, and BeOS/Haiku all independently converge on this rule; BeOS states it most bluntly: *"Do not use one of the system combinations for a task different from the list… Doing so will only confuse and frustrate users."* PesantMoney doesn't have a defined reserved set yet — establishing one (e.g. save/commit, cancel/escape, delete, find) is follow-on work, not decided by this document.
- **Mnemonic letters, if added to buttons/menu-like controls, should be the first letter of the label where possible, and never reused inconsistently for the same recurring action** (CUA §2.7.4: *"Choices that appear many times in an application should always be assigned the same mnemonic"*).
- The app currently has no global keyboard-shortcut layer (only in-widget nav in `TransactionsGrid.tsx` and `BudgetScreen.tsx`) — this guide doesn't mandate adding one, only that if one is added, it follows the above.

## Action / menu structure

PesantMoney has no native menu bar and no plan to add one (everything is in-DOM, sidebar-navigated) — so CUA's and Apple's literal "File first, Help last" menu-bar rules don't apply directly. The *ordering principle* behind them still transfers to any list of actions presented together (a header's action buttons, a per-row action list, a settings page's grouped actions):

- **Put the most drastic/final action last, not first or scattered** — CUA's Exit-last-in-File and Apple's Quit-in-File-menu both encode "the way out is at the end, not buried mid-list, and not first where an accidental click does the worst damage."
- **Group by function, name the group, and don't mix unrelated actions in one group** — Haiku's HIG states this explicitly (*"a File menu should not have Copy and Paste items in it"*) and it's a reasonable transferable rule for e.g. TransactionsScreen's header actions (Import / Export are one group; anything acting on the current selection is a different group).

## Dialog and panel layout

- **Important information top-left, decreasing in importance toward bottom-right, default button at lower-right** (Apple HIG 1987, directly: *"the most important information and controls at the top left, working down to the less important information, ending with the default button... at the lower right"*) — this is a visual-layout rule and does apply to any new panel/dialog content built for this redesign.
- **Buttons live at the bottom of the panel** (CUA, NeXTSTEP, Apple HIG all agree) — not floating, not at the top.

## Feedback, forgiveness, and consistency

Three of Apple's ten 1987 principles are worth stating as ongoing house rules, since they're general enough to apply everywhere and specific enough to check a design against:

- **Feedback**: every action that takes more than an instant, or that isn't obviously visible in its own result, needs an explicit acknowledgment (a status message, not silence). This generalizes the decision already made for the CSV export button (#21): inline success/error message near the action, not a silent no-op.
- **Forgiveness**: prefer reversible actions and clearly flag the irreversible ones — this is the actual justification for the Modality/Confirmation rules above, not just a restatement of them.
- **Consistency**: the same action should look and behave the same wherever it appears. Concretely, once the confirmation-panel pattern above is built once, every one of the 7 `window.confirm` call sites listed should be migrated to it — not just new ones written against it.

## Typography and spacing

None of the six source systems yields a portable, prescriptive spacing grid or typography rule strict enough to import wholesale (see `docs/research/legacy-ui-guidelines.md` — this absence is confirmed, not an unresearched gap, for CUA's graphical rendering, QNX Photon, NeXTSTEP, and BeOS alike; only BB10's 0.69mm "design unit" is genuinely that precise, and it's a touch-density unit that doesn't transfer to a desktop pointer app). **Conclusion: don't manufacture a grid rule from these sources.** Keep evaluating spacing/typography changes case-by-case against the existing App.css token system and against Apple's Aesthetic Integrity / Perceived Stability principles (don't change spacing/type "randomly" between screens) rather than against an imported numeric rule.

## Explicitly not adopted

- **QNX Photon's and BeOS's architecture-level philosophy** (microkernel decomposition, resource-constrained embedded targets) — not relevant to a desktop Tauri app; only their concrete UI-widget conventions (dialog button defaults, reserved shortcuts) are drawn from.
- **BlackBerry 10's touch/gesture vocabulary, bottom Action Bar, bezel gestures, and single-screen-hierarchy navigation** — mobile/touch-specific and explicitly flagged as non-transferable in the research doc. Only its stated interaction *philosophy* (flow — don't interrupt the connection between what a user sees and does next; content-first chrome restraint) informs this redesign, not any concrete convention.
- **A single OS's native look** (Apple HIG today, GNOME HIG) — deliberately avoided per ADR-0010, since the app ships to macOS, Windows, and Linux equally.

## How this document evolves

Add sections/rules here as the redesign touches each of the 11 screens — this is meant to accumulate decisions, not be finalized once. When a rule here turns out to be wrong or gets superseded, edit it in place and note why, rather than leaving contradictory guidance for the next reader.
