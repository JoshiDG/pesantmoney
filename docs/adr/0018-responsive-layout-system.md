# Responsive layout system: breakpoint tiers, nav rail collapse states, and mobile card views

ADR-0007 committed to matching Monarch's information architecture, not its visual design. This ADR is a separate, orthogonal axis: making that IA — including the nav rail from ADR-0017 — reflow across window/viewport sizes, down to phone width. It changes nothing about color, typography, or the paper/ledger visual identity; those stay exactly as ADR-0007 and the top-tier-consumer-ui-direction research left them.

The phone-width target is deliberate, not incidental tolerance for a dragged-narrow desktop window. PesantMoney has a real mobile ambition beyond the current Tauri desktop shell, so this system is designed as a genuine three-tier responsive layout rather than "desktop app that happens to survive being resized."

## Breakpoint tiers

Three tiers, anchored to conventional (Tailwind-style) cutoffs rather than one-off magic numbers:

- **Expanded** (`>=1280px`): nav rail shows icons + labels.
- **Compact** (`768px-1279px`): nav rail collapses to icon-only (no labels). This also subsumes the old ad hoc `900px` dashboard-grid breakpoint — the dashboard grid drops from 2 columns to 1 here.
- **Mobile** (`<768px`): nav rail becomes a fixed bottom tab bar; dense tables become stacked cards; layouts go single-column.

These three values are defined once, in a shared `breakpoints.ts`, and are the single source of truth for both CSS media queries and the JS breakpoint hook (below) — no duplicated pixel literals per component.

## Nav rail structural states

ADR-0017 defined the nav rail's *content* (Dashboard, Accounts, Transactions, Reports, Budget, Recurring, Goals, Investments, Settings) but not its responsive behavior. This ADR adds three structural states for that rail, one per breakpoint tier:

1. **Expanded rail** — icons + labels, left-docked, as a conventional desktop sidebar.
2. **Icon rail** — same rail, labels hidden, icons only (with tooltips on hover).
3. **Bottom tab bar** — the rail relocates to a fixed bottom bar with 4 primary destinations plus a "More" overflow, matching Monarch's own mobile pattern and the wider finance-app convention (Copilot, YNAB):
   - Primary: Dashboard, Transactions, Budget, Accounts
   - Under More: Reports, Recurring, Goals, Investments, Settings

The bottom bar's primary-4 selection favors screens used for a quick glance-and-act (checking a balance, categorizing a transaction) over screens suited to sit-down review (Reports, Investments).

## Structural swap vs. cosmetic reflow

Rail and bottom-bar are different components with different DOM and interaction models (hover/tooltip vs. tap target), not a CSS-only variant of the same markup. Rendering both simultaneously and toggling visibility would ship dead interactive/a11y surface. So:

- **Cosmetic reflow** (column counts, spacing, font scale, table density) stays pure CSS media queries.
- **Structural swaps** (which nav component mounts; table rows vs. cards) are driven by a `useBreakpoint()` hook returning `'expanded' | 'compact' | 'mobile'`, backed by `matchMedia`/`ResizeObserver`. This mirrors the standard pattern in production React apps for this exact problem (e.g. MUI's `useMediaQuery`, Chakra's `useBreakpointValue`) — there's no evidence either Monarch (Next.js/React) or Evernote (React/Redux) do anything unconventional here, and neither publishes breakpoint-implementation internals.

`useBreakpoint()` reads from a `BreakpointProvider` context rather than calling `matchMedia` directly, so tests can force a tier (`render(<X/>, { wrapper: withBreakpoint('mobile') })`) instead of mocking browser viewport APIs globally.

## Mobile table pattern

Below the mobile breakpoint, dense grids (Transactions, Accounts, Holdings) render as stacked cards — one card per row, showing the fields a user actually needs (merchant/amount/date/category) — rather than a horizontally-scrolling or column-truncated table. Horizontal scroll and column-hiding were rejected: scroll is unusable on touch, and hiding columns loses information (category, amount) users need at a glance. Above the mobile breakpoint, the existing dense grid is unchanged.

## Accessibility

Bottom tab bar targets are a minimum 44x44px. Safe-area-inset padding (`env(safe-area-inset-bottom)`) is reserved on the bottom bar now, even though it's a no-op in the current Tauri shell, since it's cheap to add and matters the moment a real mobile wrapper exists. The rail/bottom-bar swap preserves keyboard focus order across tiers and never traps focus.

## CSS organization

`App.css` (1724 lines, pre-existing) is split into per-screen CSS files colocated with their components (e.g. `Dashboard.css`, `Transactions.css`), since every screen is gaining tier-specific rules and a single growing file was already unwieldy before this work. Shared tokens (colors, spacing, breakpoints) remain centralized.

## Rollout

Incremental, screen by screen, in dependency order:

1. `useBreakpoint()` hook + `BreakpointProvider` + nav rail (all three states) — foundational.
2. Dashboard (smallest lift, already partially responsive, high visibility).
3. Accounts (new screen per ADR-0017; Transactions' account filter depends on it existing).
4. Transactions (all-accounts view + card pattern; highest-traffic screen).
5. Remaining screens (Budget, Recurring, Goals, Investments, Reports, Settings) in roughly usage-frequency order.

Each step ships a working app rather than landing all screens in one branch.

## Non-goals

This ADR does not reopen ADR-0007's visual identity, does not change ADR-0017's nav content/IA (only its responsive behavior), and does not commit to shipping an actual mobile app or web build — it only ensures the layout system is designed to support one later without rework.
