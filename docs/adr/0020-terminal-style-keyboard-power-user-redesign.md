# Redesign the UI around a dark, monospace, keyboard-first "terminal" identity for power users

ADR-0007 committed to an original visual design (not cloning Monarch's) and ADR-0010 deliberately synthesized interaction conventions from platform-neutral legacy HIGs rather than any single OS's native look, since the app ships to macOS/Windows/Linux equally. This ADR reopens both: PesantMoney's target user is now explicitly a keyboard-driven power user, and the visual identity moves from the paper/ledger serif aesthetic to a dense, dark, monospace, Bloomberg-Terminal-influenced look. This is a deliberate identity change, not an incremental style tweak, so it's recorded here rather than folded silently into `docs/ui-guidelines.md`.

## Platform scope

macOS-first, not macOS-only. The Tauri cross-platform build is retained — Windows and Linux keep working — but macOS gets first-class treatment: native modifier-key shortcuts (Cmd, not Ctrl, as the primary chord) and interaction details tuned for it. Other platforms get functional fallbacks (Ctrl-equivalents) without dedicated design attention. This narrows ADR-0010's platform-neutral stance specifically for keyboard shortcuts; ADR-0010's broader point (don't clone a single OS's widget chrome/visual style) still holds — this is about shortcut conventions, not adopting native macOS controls.

## Framework and backend

React, Tauri, and the Rust/SQLite backend are unchanged. The overhaul is a styling and component-architecture change (design tokens, a generalized keyboard-navigable grid primitive, a command palette), not a rendering-framework swap. A framework change was considered and rejected: the existing business logic (grid nav, selection, breakpoints, 11 screens' worth of tests) has no dependency on React specifically, and a rewrite in another framework (or a native toolkit like SwiftUI) would either be pure risk with no capability gain, or — in SwiftUI's case — would force macOS-only, contradicting the platform-scope decision above.

## Visual identity

- **Dark-only.** No light theme. The terminal aesthetic is defined by its black background; a light variant would fight the identity at every step for a mode this redesign doesn't prioritize.
- **Fully monospace.** The serif display treatment for hero numbers (net worth, ready-to-assign, balance — see the "Resolved case: hero numbers" section of `docs/ui-guidelines.md`) is removed. Hierarchy for large numbers comes from scale and weight, not typeface family.
- **Multi-accent coded palette**, not monochrome retro-green. Green/red stay for credit/debit (an existing, finance-wide convention, not a terminal-specific one). A small number of additional accent colors (e.g. a label/metadata color, a warning/highlight color) are added on the black base to preserve scannability on dense screens — a real, modern multi-color Bloomberg Terminal screen, not a 1980s single-phosphor look.
- **Fixed dense layout, no comfortable-mode toggle.** Density is a characteristic of the whole app, not a per-user setting — maintaining two visual states per screen indefinitely isn't worth it for an audience this redesign has already decided not to serve.

## Keyboard architecture

A global Cmd+K command palette (fuzzy-searching actions, navigation, and records) is the primary keyboard interaction model, chosen over relying solely on fixed per-screen shortcuts because it scales as actions/screens are added without exhausting the finite Cmd+key space, and doubles as a jump-to-record tool. It's layered with:

- **Fixed macOS-native modifier shortcuts** (Cmd+N, Cmd+F, Cmd+,, etc.) for the highest-frequency, app-level actions.
- **Scoped bare single-letter shortcuts** inside a focused grid/list (in the style of Superhuman and Bloomberg Terminal itself — e.g. `j`/`k` to move rows), active only while that grid/list has keyboard focus, never global, and never intercepting a focused text input.

This is the first time PesantMoney defines a reserved shortcut set (`docs/ui-guidelines.md` previously flagged this as undefined follow-on work).

## Mobile (ADR-0018)

ADR-0018's responsive infrastructure (breakpoint tiers, `useBreakpoint()`, stacked-card mobile tables) is retained, not removed — but deprioritized. Terminal-style density is fundamentally a large-viewport concept and actively conflicts with mobile card-stacking, so the `Mobile` tier keeps its existing simpler behavior as-is rather than receiving terminal-aesthetic treatment. The `Expanded`/`Compact` tiers become the design's actual home. Mobile is "still works, not a design priority."

## Grid keyboard navigation

The keyboard-nav/selection primitives currently built only for `TransactionsGrid`/`BudgetScreen` (`grid-nav.ts`, `selection.ts`) are generalized into a shared primitive and extended to the remaining tabular screens (Accounts, Holdings, Categories, Rules, Recurring Items, Goals). A keyboard-fluent Transactions screen next to mouse-only Accounts/Categories screens would undercut the power-user premise.

## Rollout

Screen-by-screen, foundation first — the same incremental pattern ADR-0018 used, not a single big-bang redesign branch, despite "full UI overhaul" describing the end state:

1. Design tokens + base terminal shell (nav rail, typography, color, dark-only theme).
2. Command palette, as an app-wide primitive.
3. Generalized grid-nav primitive.
4. Remaining screens, in usage-frequency order (Transactions/Dashboard first, Settings/Rules last).

Each step ships a working app rather than landing all screens in one branch.
