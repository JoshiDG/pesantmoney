# UI guidelines

Decision record: `docs/adr/0010-legacy-ui-guidelines-synthesis.md`. Sourcing, direct quotes, and confidence levels for every rule below: `docs/research/legacy-ui-guidelines.md`. This document is the living, prescriptive half — it changes as the redesign proceeds; the ADR does not.

These rules apply going forward to all 11 screens (`AccountsScreen`, `BudgetScreen`, `CategoriesScreen`, `DashboardScreen`, `GoalsScreen`, `HoldingsScreen`, `ImportScreen`, `RecurringItemsScreen`, `RulesScreen`, `SettingsScreen`, `TransactionsScreen`) as they're touched, not as a one-time rewrite. The dense CSS-grid ledger layout is not superseded by this document — it's the interaction/structural layer, and what follows is mostly that layer plus keyboard architecture. The visual token layer itself (`--ink`, `--paper`, `--credit`, `--debit`, `--focus`, the serif/sans/mono font stacks), however, **is** superseded by ADR-0020's dark-only, fully-monospace, multi-accent terminal identity — see that ADR for the visual-design decision; this document stays the source for interaction/structural rules. Where a rule below does touch visual style, it's noted explicitly.

Per ADR-0020 the app is now dark-only — `prefers-color-scheme` light support is removed, not merely deprioritized. Accessibility expectations always win over anything below — none of the source systems address them, since all predate modern accessibility norms by decades.

## Confirmation and destructive actions

**Current state, and the first thing this guide changes:** every destructive action in the app (`AccountsScreen.tsx:82`, `GoalsScreen.tsx:67`, `HoldingsScreen.tsx:57`, `TransactionsScreen.tsx:110`, `RulesScreen.tsx:78`, `CategoriesScreen.tsx:55,90`, `RecurringItemsScreen.tsx:76`) uses the browser's native `window.confirm("Delete ... ? This cannot be undone.")`. This is exactly the anti-pattern the source material warns against: a generic, OS-chrome-styled, synchronous, un-themed blocking prompt with unlabeled OK/Cancel buttons.

Replace with an in-app confirmation panel, modal to the whole app window (see Modality below), following:

- **Verb-phrase button labels, not Yes/No/OK** (NeXTSTEP, `docs/research/legacy-ui-guidelines.md` System 4(b)): a delete-account confirmation should read "Delete Account" / "Cancel", not "Yes" / "No" or "OK" / "Cancel". NeXTSTEP's own guidance: *"generic labels (like Yes and No) aren't appropriate, as they tend to cause user errors. Avoid using OK unless it's the only button."*
- **Default button in the lower-right, doubly emphasized, but never the destructive choice by default** — both Apple's 1987 HIG and NeXTSTEP place the default/likely button at lower-right and bind it to Return/Enter. For a *destructive* confirmation, the safe choice (Cancel) should be the one bound to Enter, or neither button should auto-bind to Enter — don't let a startled Enter-press delete something. This is a deliberate deviation from the source material's literal "most likely action gets Enter" rule, justified by Apple's own Forgiveness principle (below).
- **Cancel is always present and always labeled "Cancel"** (Apple HIG 1987, CUA) — never omit an escape hatch from a destructive-action panel.

## Modality

Adopt NeXTSTEP's stance explicitly, since it's the most rigorous of the six sources on this point: *"applications should avoid setting up arbitrary modes... modes are used in only three situations"* (modal tool, attention panel, spring-loaded/press-and-hold). Concretely:

- A confirmation/attention panel blocks the **whole app window**, not just the screen/feature it interrupts (resolved via grilling session for #23). `AccountsScreen.tsx` is this app's sidebar (it renders both the top nav items and the account list with per-account delete buttons) and `<main className="content">` in `App.tsx` is the separate content panel — those are structurally different regions, but rather than build asymmetric scoping (sidebar-triggered confirmations blocking only the sidebar, content-triggered ones blocking only the content panel), the panel blocks the entire window in both cases. This supersedes an earlier draft of this section that called for screen-scoped modality. If a future "open account in its own OS window" (Notes-style multi-window) idea is ever pursued, it would reopen this question — NeXTSTEP's actual app-vs-system modal distinction would become meaningful again with multiple real windows — but there's only one window today.
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

### Superseded case: hero numbers (issue #43)

~~The single most important figure per screen — net worth (Dashboard), ready-to-assign (Budget), account balance (ledger/account view) — uses a shared display treatment... `--display-family` (`var(--font-serif)`)...~~ Superseded by ADR-0020: the redesign is fully monospace, no serif anywhere. Hero numbers keep a shared display treatment (`--display-weight`, `--display-tracking`, the same per-context `--display-size-1/2/3` scale) but `--display-family` now resolves to the mono stack, matching dense tabular rows — hierarchy for these figures comes from scale and weight alone, not typeface family.

## Density

Per ADR-0020, density is a fixed characteristic of the whole app, not a per-user setting: no comfortable/compact toggle. Every screen is designed dense by default — this is a deliberate scope narrowing to the power-user audience, not an oversight to revisit per-screen.

## Reserved Shortcut Set and command palette

Per ADR-0020, the app now has a defined keyboard architecture, resolving the gap this document previously flagged ("PesantMoney doesn't have a defined reserved set yet"). Issues #78 (Reserved Shortcut Set) and #77 (Command Palette) shipped the concrete bindings below, implemented in `src/ui/ReservedShortcuts.tsx` (per-screen handler registration + the global `keydown` listener) and `src/ui/CommandPalette.tsx` / `src/ui/CommandRegistry.tsx` (the palette and its action registry).

- **Command Palette** (Cmd+K, Ctrl+K fallback) is the primary keyboard interaction model — a global fuzzy search (`src/ui/fuzzy.ts`) over Nav Rail destinations and a small starter set of cross-screen actions ("New Account", "New Transaction"). Invocable from any screen; Escape closes it with no side effects; arrow keys move the active result and Enter runs it. New actions/screens register additional commands via `useCommands(sourceId, commands)` — `CommandPalette.tsx` itself never needs to change to pick them up.
- **Reserved Shortcut Set**: a closed, app-wide vocabulary of macOS-native modifier shortcuts, with Ctrl-equivalent fallbacks for Windows/Linux. No screen may repurpose one of these for a different action. Concrete bindings shipped:
  - **Cmd/Ctrl+N** — create the record appropriate to the current screen. Wired where a "create new record" action already existed: Accounts (opens Add Account), Transactions (opens a new New Transaction panel, added alongside this work since the all-Accounts Transactions view had no manual-entry affordance at all — see `AllTransactionsScreen.tsx`), Goals (opens Add goal), Categories (opens Add group — the screen's one unscoped create action, since adding a Category requires picking a group first), and Rules (opens Add rule, gated the same way its toolbar button is: a no-op with zero Categories to assign). Holdings has no toggled add-form state (its create form is always rendered inline), so Cmd+N instead moves focus into that form's Ticker field — the same "jump to the create affordance" idea Cmd+F gives search inputs. Not wired on screens with no "create new record" concept at all (Dashboard, Reports, Budget, Settings, Import) or where it's not yet been touched (Investments/Recurring/Merchants — a natural follow-up, not a gap in the reserved set itself).
  - **Cmd/Ctrl+F** — focus the current screen's search/filter input. Infrastructure (`onFocusSearch`) is built into `useReservedShortcuts`, but as of #78 no screen actually has a search/filter *text* input to focus (Accounts' Search icon is a type-filter dropdown, not a text field) — so this shortcut is currently a no-op everywhere. The first screen that adds a real search box should wire this rather than inventing a separate shortcut.
  - **Cmd/Ctrl+,** — open Settings. Global, handled once at the App level (`ReservedShortcutProvider`'s `onOpenSettings`), not per-screen.
  - **Cmd/Ctrl+W** — close the current modal/panel. Wired on Accounts (Add form / inline edit row / context menu) and Transactions (New Transaction panel / transfer-link picker).
  - **Escape** — cancel/dismiss the current modal/panel/in-progress edit. Input-aware by design: it fires even while a text input has focus (everything else in the Reserved Shortcut Set is suppressed while a text input has focus). Composes safely with `ConfirmationProvider`, `ContextMenu`, and `Dropdown`'s own independent Escape handling — each screen's registered close handler is a no-op if nothing of its own is open.
  - **Delete/Backspace** — delete the current selection, wired wherever a checkbox multi-select + bulk-delete action already exists: Goals, Holdings, Categories, and Rules all route it through their existing "Delete selected" confirm-gated bulk action, a no-op with nothing selected. The Transactions grid's checkbox multi-select is the one exception — Delete/Backspace only fires there when exactly one row is selected, since multi-select would fire the existing per-row confirm dialog once per row and stack N confirmation prompts (a redesign #78 didn't sign up for). Accounts has selection but no bulk-delete action to hang this on, so it's left unwired rather than inventing one; same for every other screen whose delete action is a per-row button click with no selection concept at all.
- **Grid-scoped single-letter shortcuts** (e.g. `j`/`k` to move rows), active only while a grid/list has keyboard focus, layer on top for in-grid editing speed (Superhuman/Bloomberg-Terminal-style). These are never global and must never intercept a focused text input — they are not part of the Reserved Shortcut Set and don't need the same collision-avoidance treatment app-wide, only within the grid that defines them.

## Explicitly not adopted

- **QNX Photon's and BeOS's architecture-level philosophy** (microkernel decomposition, resource-constrained embedded targets) — not relevant to a desktop Tauri app; only their concrete UI-widget conventions (dialog button defaults, reserved shortcuts) are drawn from.
- **BlackBerry 10's touch/gesture vocabulary, bottom Action Bar, bezel gestures, and single-screen-hierarchy navigation** — mobile/touch-specific and explicitly flagged as non-transferable in the research doc. Only its stated interaction *philosophy* (flow — don't interrupt the connection between what a user sees and does next; content-first chrome restraint) informs this redesign, not any concrete convention.
- **A single OS's native look** (Apple HIG today, GNOME HIG) — deliberately avoided per ADR-0010, since the app ships to macOS, Windows, and Linux equally.

## How this document evolves

Add sections/rules here as the redesign touches each of the 11 screens — this is meant to accumulate decisions, not be finalized once. When a rule here turns out to be wrong or gets superseded, edit it in place and note why, rather than leaving contradictory guidance for the next reader.
