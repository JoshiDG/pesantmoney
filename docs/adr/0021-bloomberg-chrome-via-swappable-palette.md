# Copy Bloomberg Terminal chrome for the Transactions screen, with all colors behind a swappable Palette

ADR-0020 established the dark, dense, keyboard-first terminal identity. This ADR records the next step: the Transactions screen copies the *layout and chrome* of an actual Bloomberg Terminal screen (the reference capture in `Reference/Bloomberg Terminal/table design to copy.png`), and — more durably — every color in the app moves behind a single swappable Palette file.

## Palette as the single source of color

All color values live in one token file (`src/ui/palette.css`, custom properties grouped by role: backgrounds, text, credit/debit, accents, and the Bloomberg function-key role colors — yellow primary, green action, red cancel, magenta secondary). The starting values are literal Bloomberg Terminal colors. The point of the file is swapability: any value can be re-tuned later by editing one file, without touching component code. There is deliberately no second (TS) mirror and no light theme — one palette, dark-only, per ADR-0020.

## Copied chrome, rejected chrome

Adopted on the Transactions screen, top to bottom: **Function Bar** (role-color-coded action chips: CANC, New, Import, Export, Columns, Filters, Show Hidden), **Context Bar** (Account context selector + live search input, focused by the already-reserved Cmd+F), **Quote Strip** (live filtered totals: count, Income, Expense, Net, plus selected Account balance), and **Status Bar** (active-filter/sort summary left, context-aware shortcut hints right). The grid gains sticky **Date Group** headers (Today / Yesterday / explicit dates) and a newest-first default.

Rejected: the left **Filter Rail** sidebar from the reference (facet groups with counts). Filtering is header-driven instead — left-click a column header to sort, right-click for that column's filter menu (distinct values with counts, computed client-side from the already-loaded dataset); non-column filters (Type, Show Hidden, Clear All) live in the Filters chip's popover. A sidebar was rejected because it permanently consumes horizontal space on a screen whose entire identity is density, and because header-driven filtering reuses the interaction the user already has their hand on. Also rejected: the tab strip (TICKERS/Filters/Advanced/Export/Settings) — its contents fold into Function Bar chips and the existing header context menu.

The red CANC chip (leftmost, mirroring Bloomberg) clears search + all filters in one action.

## Glossary consequence

Column Management's promised column *ordering* is implemented here (drag-to-reorder + Columns chip), closing the gap where the glossary described show/hide **and order** but the code only had show/hide.

## Rollout

Phase-ordered, each independently shippable, virtualization strictly last so the riskiest piece (virtualizing a CSS-grid, group-headered, keyboard-navigable ledger) lands on a final row model: (1) Palette + chrome skeleton, (2) filtering, (3) search + single-letter keyboard (j/k/x//? — the ADR-0020 set, implemented here for the first time), (4) Date Groups + newest-first, (5) column reorder, (6) virtualization. The dead per-account `TransactionsScreen` is deleted in phase 1; its only unique features (balance, CSV export) move to the Quote Strip and Export chip respectively.
