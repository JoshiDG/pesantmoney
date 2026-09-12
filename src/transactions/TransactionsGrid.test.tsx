import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Category, CategoryGroup } from "../categories/types";
import { withBreakpoint } from "../ui/withBreakpoint";
import type { BreakpointTier } from "../ui/breakpoints";
import { TransactionsGrid } from "./TransactionsGrid";
import { DEFAULT_COLUMN_VISIBILITY, formatCents, Transaction } from "./types";

function makeTransactions(): Transaction[] {
  return [
    {
      id: 1,
      account_id: 1,
      date: "2026-08-01",
      amount_cents: -1250,
      description: "Coffee shop",
      category_id: null,
      merchant_name: null,
      hidden: false,
    },
    {
      id: 2,
      account_id: 1,
      date: "2026-08-02",
      amount_cents: 300000,
      description: "Paycheck",
      category_id: null,
      merchant_name: null,
      hidden: false,
    },
  ];
}

const categories: Category[] = [
  { id: 10, group_id: 1, name: "Food" },
  { id: 11, group_id: 2, name: "Income" },
];

const categoryGroups: CategoryGroup[] = [
  { id: 1, name: "Everyday" },
  { id: 2, name: "Big Ticket" },
];

function renderGrid(
  overrides: Partial<Parameters<typeof TransactionsGrid>[0]> = {},
  tier: BreakpointTier = "expanded",
) {
  const props = {
    transactions: makeTransactions(),
    categories,
    categoryGroups,
    accounts: [],
    linkedTransactionIds: new Set<number>(),
    transferByTransactionId: new Map(),
    linkingId: null,
    columnVisibility: DEFAULT_COLUMN_VISIBILITY,
    onColumnVisibilityChange: vi.fn(),
    onColumnOrderChange: vi.fn(),
    onStartLink: vi.fn(),
    onCancelLink: vi.fn(),
    onLink: vi.fn(),
    onUnlink: vi.fn(),
    onUpdate: vi.fn(),
    onBulkAssignCategory: vi.fn(),
    onDelete: vi.fn(),
    onSetHidden: vi.fn(),
    tags: [],
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    onBulkAssignTags: vi.fn(),
    merchants: [],
    onSetPayee: vi.fn(),
    onCreateMerchant: vi.fn(),
    onCreateCategory: vi.fn(),
    ...overrides,
  };
  render(<TransactionsGrid {...props} />, { wrapper: withBreakpoint(tier) });
  return props;
}

function memoCell(text: string) {
  return screen.getByText(text, { selector: ".cell-memo" });
}

function payeeName(text: string) {
  return screen.getByText(text, { selector: ".passbook-payee-name" });
}

// Row-scoped, not index-based: the grid's default sort is now date-desc
// (#93), so "which row is first" is no longer a stable way to pick a
// specific transaction's Category cell -- this finds it via the row
// containing that transaction's own Memo text instead.
function categoryCell(description: string) {
  const row = memoCell(description).closest(".ledger-row") as HTMLElement;
  return within(row).getByText("Uncategorized");
}

// Same row-scoped rationale as categoryCell above.
function tagsCell(description: string) {
  const row = memoCell(description).closest(".ledger-row") as HTMLElement;
  return row.querySelector(".cell-tags") as HTMLElement;
}

describe("TransactionsGrid inline editing", () => {
  it("clicking the memo cell opens an inline text input pre-filled with the current value, no modal", () => {
    renderGrid();

    fireEvent.click(memoCell("Coffee shop"));

    const input = screen.getByLabelText("Memo for Coffee shop") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("Coffee shop");
  });

  it("committing an edit with Enter calls onUpdate with the full updated fields via the existing update path", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(memoCell("Coffee shop"));
    const input = screen.getByLabelText("Memo for Coffee shop") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Espresso bar");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onUpdate).toHaveBeenCalledWith(1, {
      date: "2026-08-01",
      amount_cents: -1250,
      description: "Espresso bar",
      category_id: null,
    });
  });

  it("Escape cancels the edit without calling onUpdate", () => {
    const props = renderGrid();

    fireEvent.click(memoCell("Coffee shop"));
    const input = screen.getByLabelText("Memo for Coffee shop") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Should not save" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(memoCell("Coffee shop")).toBeInTheDocument();
  });

  it("editing the category cell renders a SuggestionCombobox and commits a matched Category via the existing update path", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(categoryCell("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await user.type(input, "Food");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onUpdate).toHaveBeenCalledWith(1, {
      date: "2026-08-01",
      amount_cents: -1250,
      description: "Coffee shop",
      category_id: 10,
    });
  });
});

describe("TransactionsGrid keyboard navigation", () => {
  it("ArrowRight moves focus across every visible column, read-only ones included", () => {
    renderGrid();

    const dateCell = screen.getByText("2026-08-01");
    dateCell.focus();
    fireEvent.keyDown(dateCell, { key: "ArrowRight" });

    // Single-Account fixture suppresses the Account column, so the visible
    // order is date -> payee -> memo -> ...
    const payeeCell = payeeName("Coffee shop").closest('[role="gridcell"]') as HTMLElement;
    expect(payeeCell).toHaveFocus();

    fireEvent.keyDown(payeeCell, { key: "ArrowRight" });
    expect(memoCell("Coffee shop").closest('[role="gridcell"]')).toHaveFocus();
  });

  it("ArrowLeft moves focus back to the previous visible column", () => {
    renderGrid();

    const memo = memoCell("Coffee shop").closest('[role="gridcell"]') as HTMLElement;
    memo.focus();
    fireEvent.keyDown(memo, { key: "ArrowLeft" });

    expect(payeeName("Coffee shop").closest('[role="gridcell"]')).toHaveFocus();
  });

  it("ArrowDown/ArrowUp move between rows in the same column, clamped at the edges", () => {
    renderGrid();

    // Default sort is date-desc (#93): Paycheck (2026-08-02) is row 0,
    // Coffee shop (2026-08-01) is row 1.
    const dateCell = screen.getByText("2026-08-02");
    dateCell.focus();
    fireEvent.keyDown(dateCell, { key: "ArrowDown" });
    expect(screen.getByText("2026-08-01")).toHaveFocus();

    fireEvent.keyDown(screen.getByText("2026-08-01"), { key: "ArrowDown" });
    expect(screen.getByText("2026-08-01")).toHaveFocus();

    fireEvent.keyDown(screen.getByText("2026-08-01"), { key: "ArrowUp" });
    expect(screen.getByText("2026-08-02")).toHaveFocus();
  });

  it("Home/End jump to the first/last visible column of the row", () => {
    renderGrid();

    const memo = memoCell("Coffee shop").closest('[role="gridcell"]') as HTMLElement;
    const row = memo.closest(".ledger-row") as HTMLElement;
    memo.focus();
    fireEvent.keyDown(memo, { key: "Home" });
    expect(screen.getByText("2026-08-01")).toHaveFocus();

    // Scoped to Coffee shop's own row (#93: default sort is date-desc, so
    // this row is no longer necessarily the first `.cell-running-balance`
    // in DOM order).
    fireEvent.keyDown(screen.getByText("2026-08-01"), { key: "End" });
    expect(row.querySelector(".cell-running-balance")).toHaveFocus();
  });

  it("Enter on a focused read-only Payee cell opens its combobox editor", () => {
    renderGrid();

    const payeeCell = payeeName("Coffee shop").closest('[role="gridcell"]') as HTMLElement;
    payeeCell.focus();
    fireEvent.keyDown(payeeCell, { key: "Enter" });

    expect(screen.getByLabelText("Payee for Coffee shop")).toBeInTheDocument();
  });

  it("Enter on a focused (non-editing) editable cell opens it for editing", () => {
    renderGrid();

    const dateCell = screen.getByText("2026-08-01");
    dateCell.focus();
    fireEvent.keyDown(dateCell, { key: "Enter" });

    expect(screen.getByLabelText("Date for Coffee shop")).toBeInTheDocument();
  });
});

describe("TransactionsGrid multi-row selection and bulk category assignment", () => {
  it("selecting two rows via checkboxes and assigning a category calls onBulkAssignCategory with both ids", () => {
    const props = renderGrid();

    fireEvent.click(screen.getByLabelText("Select Coffee shop"));
    fireEvent.click(screen.getByLabelText("Select Paycheck"));

    expect(screen.getByText("2 selected")).toBeInTheDocument();

    const bulkSelect = screen.getByLabelText("Assign category to selection") as HTMLSelectElement;
    fireEvent.change(bulkSelect, { target: { value: "11" } });

    expect(props.onBulkAssignCategory).toHaveBeenCalledWith([1, 2], 11);
  });

  it("shift-clicking a second checkbox selects the range in between", () => {
    const transactions: Transaction[] = [
      ...makeTransactions(),
      {
        id: 3,
        account_id: 1,
        date: "2026-08-03",
        amount_cents: -500,
        description: "Groceries",
        category_id: null,
        merchant_name: null,
        hidden: false,
      },
    ];
    const props = renderGrid({ transactions });

    fireEvent.click(screen.getByLabelText("Select Coffee shop"));
    fireEvent.click(screen.getByLabelText("Select Groceries"), { shiftKey: true });

    expect(screen.getByText("3 selected")).toBeInTheDocument();

    const bulkSelect = screen.getByLabelText("Assign category to selection") as HTMLSelectElement;
    fireEvent.change(bulkSelect, { target: { value: "10" } });
    // Default sort is date-desc (#93), so the row order (and thus the
    // range-select order) runs Groceries (08-03) -> Paycheck (08-02) ->
    // Coffee shop (08-01), i.e. ids [3, 2, 1].
    expect(props.onBulkAssignCategory).toHaveBeenCalledWith([3, 2, 1], 10);
  });
});

describe("TransactionsGrid Payee/Memo split", () => {
  it("shows the identified merchant name as Payee, and the raw description as Memo", () => {
    const transactions: Transaction[] = [
      {
        id: 1,
        account_id: 1,
        date: "2026-08-01",
        amount_cents: -1250,
        description: "SQ *BLUE BOTTLE COF 04/12",
        category_id: null,
        merchant_name: "Blue Bottle Coffee",
        hidden: false,
      },
    ];
    renderGrid({ transactions });

    expect(payeeName("Blue Bottle Coffee")).toBeInTheDocument();
    expect(memoCell("SQ *BLUE BOTTLE COF 04/12")).toBeInTheDocument();
  });

  it("Payee falls back to the raw description when no merchant is identified", () => {
    renderGrid();

    expect(payeeName("Coffee shop")).toBeInTheDocument();
    expect(memoCell("Coffee shop")).toBeInTheDocument();
  });

  // Payee became editable in #72 (ADR-0019); it stays a display-derived
  // field with its own dedicated editor (SuggestionCombobox, see the
  // "TransactionsGrid Payee editing (#72)" suite below) rather than joining
  // EDITABLE_COLUMNS' col-index-based date/memo/category/amount editing --
  // it never becomes a plain text input like Memo's.
  it("Payee editing opens the SuggestionCombobox editor, not the plain-input Memo editor", () => {
    renderGrid();

    fireEvent.click(payeeName("Coffee shop"));

    expect(screen.getByLabelText("Payee for Coffee shop")).toBeInTheDocument();
  });

  it("Memo edits go through the same onUpdate path Payee never touches (merchant_name untouched)", () => {
    const transactions: Transaction[] = [
      {
        id: 1,
        account_id: 1,
        date: "2026-08-01",
        amount_cents: -1250,
        description: "SQ *BLUE BOTTLE COF 04/12",
        category_id: null,
        merchant_name: "Blue Bottle Coffee",
        hidden: false,
      },
    ];
    const props = renderGrid({ transactions });

    fireEvent.click(memoCell("SQ *BLUE BOTTLE COF 04/12"));
    const input = screen.getByLabelText(
      "Memo for SQ *BLUE BOTTLE COF 04/12",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Corrected memo" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onUpdate).toHaveBeenCalledWith(1, {
      date: "2026-08-01",
      amount_cents: -1250,
      description: "Corrected memo",
      category_id: null,
    });
  });
});

describe("TransactionsGrid Tags column", () => {
  it("renders attached tags as chips in the Tags column", () => {
    renderGrid({ tagsByTransactionId: { 1: [{ id: 5, name: "Reimbursable" }] } });

    const row = memoCell("Coffee shop").closest(".ledger-row") as HTMLElement;
    expect(within(row).getByText("Reimbursable")).toBeInTheDocument();
    expect(row.querySelector(".cell-tags")).toBeInTheDocument();
  });

  it("renders no chip for a transaction absent from the tag map", () => {
    renderGrid({ tagsByTransactionId: { 1: [{ id: 5, name: "Reimbursable" }] } });

    const paycheckRow = memoCell("Paycheck").closest(".ledger-row") as HTMLElement;
    expect(paycheckRow.querySelector(".tag-chip")).toBeNull();
  });
});

// Shallow integration checks only (#67/#71 Testing Decisions): full
// ghost-text/commit-key/chip behavior is covered in
// SuggestionCombobox.test.tsx, not duplicated here.
describe("TransactionsGrid Tags editing (#71)", () => {
  it("clicking the Tags cell renders a SuggestionCombobox seeded with the known Tags list and current chips", () => {
    renderGrid({
      tags: [
        { id: 5, name: "Reimbursable" },
        { id: 6, name: "Trip" },
      ],
      tagsByTransactionId: { 1: [{ id: 5, name: "Reimbursable" }] },
    });

    const cell = tagsCell("Coffee shop");
    fireEvent.click(cell);

    const input = screen.getByLabelText("Tags for Coffee shop");
    expect(input).toBeInTheDocument();
    expect(within(cell).getByText("Reimbursable", { selector: ".suggestion-chip" })).toBeInTheDocument();
  });

  it("committing a new tag name via the combobox calls onAddTag with the transaction id and typed name", async () => {
    const user = userEvent.setup();
    const props = renderGrid({ tags: [{ id: 6, name: "Trip" }], onAddTag: vi.fn() });

    fireEvent.click(tagsCell("Coffee shop"));
    const input = screen.getByLabelText("Tags for Coffee shop");
    await user.type(input, "Trip");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onAddTag).toHaveBeenCalledWith(1, "Trip");
  });

  it("removing a chip via the combobox calls onRemoveTag with the transaction id and tag id", async () => {
    const user = userEvent.setup();
    const props = renderGrid({
      tags: [{ id: 5, name: "Reimbursable" }],
      tagsByTransactionId: { 1: [{ id: 5, name: "Reimbursable" }] },
      onRemoveTag: vi.fn(),
    });

    fireEvent.click(tagsCell("Coffee shop"));
    await user.click(screen.getByLabelText("Remove Reimbursable"));

    expect(props.onRemoveTag).toHaveBeenCalledWith(1, 5);
  });
});

// Shallow integration checks only (#67/#72 Testing Decisions): full
// ghost-text/commit-key behavior is covered in SuggestionCombobox.test.tsx.
// This suite covers the Payee-specific wiring: seeding from the Merchant
// dictionary, and both the confirm and decline paths for an unmatched value
// (see ADR-0019).
describe("TransactionsGrid Payee editing (#72)", () => {
  it("clicking the Payee cell renders a SuggestionCombobox seeded with the known Merchant names", () => {
    renderGrid({
      merchants: [
        { id: 1, keyword: "SQ *BLUE BOTTLE COF", merchant_name: "Blue Bottle Coffee" },
        { id: 2, keyword: "WHOLEFDS", merchant_name: "Whole Foods" },
      ],
    });

    fireEvent.click(payeeName("Coffee shop"));

    const input = screen.getByLabelText("Payee for Coffee shop");
    expect(input).toBeInTheDocument();
  });

  it("committing a value matching an existing Merchant sets the Payee via onSetPayee, with no dictionary write", async () => {
    const user = userEvent.setup();
    const props = renderGrid({
      merchants: [{ id: 1, keyword: "SQ *BLUE BOTTLE COF", merchant_name: "Blue Bottle Coffee" }],
    });

    fireEvent.click(payeeName("Coffee shop"));
    const input = screen.getByLabelText("Payee for Coffee shop");
    await user.type(input, "Blue Bottle Coffee");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onSetPayee).toHaveBeenCalledWith(1, "Blue Bottle Coffee");
    expect(props.onCreateMerchant).not.toHaveBeenCalled();
  });

  it("committing an unmatched value opens a confirmation dialog instead of committing directly", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(payeeName("Coffee shop"));
    const input = screen.getByLabelText("Payee for Coffee shop");
    await user.type(input, "My Local Cafe");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      screen.getByText('Add "My Local Cafe" to your Merchant dictionary for future imports?'),
    ).toBeInTheDocument();
    expect(props.onSetPayee).not.toHaveBeenCalled();
    expect(props.onCreateMerchant).not.toHaveBeenCalled();
  });

  it("confirming the dialog calls onCreateMerchant keyed on the transaction's full raw description, and sets the Payee", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(payeeName("Coffee shop"));
    const input = screen.getByLabelText("Payee for Coffee shop");
    await user.type(input, "My Local Cafe");
    fireEvent.keyDown(input, { key: "Enter" });
    await user.click(screen.getByRole("button", { name: "Yes" }));

    expect(props.onCreateMerchant).toHaveBeenCalledWith(1, "Coffee shop", "My Local Cafe");
    expect(props.onSetPayee).not.toHaveBeenCalled();
  });

  it("declining the dialog still sets the Payee on just that transaction, with no dictionary write", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(payeeName("Coffee shop"));
    const input = screen.getByLabelText("Payee for Coffee shop");
    await user.type(input, "My Local Cafe");
    fireEvent.keyDown(input, { key: "Enter" });
    await user.click(screen.getByRole("button", { name: "No" }));

    expect(props.onSetPayee).toHaveBeenCalledWith(1, "My Local Cafe");
    expect(props.onCreateMerchant).not.toHaveBeenCalled();
  });
});

// Shallow integration checks only (#67/#73 Testing Decisions): full
// ghost-text/commit-key behavior is covered in SuggestionCombobox.test.tsx.
// This suite covers the Category-specific wiring: seeding from
// `categories`, the matched-existing-Category commit path (same
// onUpdate/category_id path as before #73), and the create-new dialog's
// Group-picker confirm/decline paths (see CONTEXT.md's Category entry --
// a Category can never exist without a Group).
describe("TransactionsGrid Category editing (#73)", () => {
  it("clicking the Category cell renders a SuggestionCombobox seeded with the known Category names", () => {
    renderGrid();

    fireEvent.click(categoryCell("Coffee shop"));

    expect(screen.getByLabelText("Category for Coffee shop")).toBeInTheDocument();
  });

  it("committing a value matching an existing Category assigns it via the existing onUpdate path, with no dialog and no creation", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(categoryCell("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await user.type(input, "Food");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onUpdate).toHaveBeenCalledWith(1, {
      date: "2026-08-01",
      amount_cents: -1250,
      description: "Coffee shop",
      category_id: 10,
    });
    expect(props.onCreateCategory).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("committing an unmatched value opens a confirmation dialog with a Group dropdown, without assigning or creating anything yet", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(categoryCell("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await user.type(input, "Subscriptions");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText('Create category "Subscriptions" in Group:')).toBeInTheDocument();
    expect(screen.getByLabelText("Group")).toBeInTheDocument();
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onCreateCategory).not.toHaveBeenCalled();
  });

  it("defaults the Group dropdown to the first available Group when nothing has been assigned yet this session", async () => {
    const user = userEvent.setup();
    renderGrid();

    fireEvent.click(categoryCell("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await user.type(input, "Subscriptions");
    fireEvent.keyDown(input, { key: "Enter" });

    expect((screen.getByLabelText("Group") as HTMLSelectElement).value).toBe("1");
  });

  it("confirming calls onCreateCategory with the chosen name and selected Group", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(categoryCell("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await user.type(input, "Subscriptions");
    fireEvent.keyDown(input, { key: "Enter" });

    await user.selectOptions(screen.getByLabelText("Group"), "2");
    await user.click(screen.getByRole("button", { name: "Yes" }));

    expect(props.onCreateCategory).toHaveBeenCalledWith(1, "Subscriptions", 2);
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("declining leaves the Category unchanged and creates nothing", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(categoryCell("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await user.type(input, "Subscriptions");
    fireEvent.keyDown(input, { key: "Enter" });

    await user.click(screen.getByRole("button", { name: "No" }));

    expect(props.onCreateCategory).not.toHaveBeenCalled();
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(categoryCell("Coffee shop")).toBeInTheDocument();
  });

  it("defaults the Group dropdown to the most-recently-assigned Category's Group within the session", async () => {
    const user = userEvent.setup();
    renderGrid();

    // Assign the Paycheck row's Category to "Income" (Group 2) first.
    fireEvent.click(categoryCell("Paycheck"));
    const paycheckInput = screen.getByLabelText("Category for Paycheck");
    await user.type(paycheckInput, "Income");
    fireEvent.keyDown(paycheckInput, { key: "Enter" });

    // Opening the create-new flow on a different row should now default to
    // Income's Group (2), not the first Group (1).
    fireEvent.click(categoryCell("Coffee shop"));
    const coffeeInput = screen.getByLabelText("Category for Coffee shop");
    await user.type(coffeeInput, "Subscriptions");
    fireEvent.keyDown(coffeeInput, { key: "Enter" });

    expect((screen.getByLabelText("Group") as HTMLSelectElement).value).toBe("2");
  });
});

describe("TransactionsGrid bulk tag assignment (#71)", () => {
  it("renders an 'Add tag to selection' control in the bulk-actions bar when rows are selected", () => {
    renderGrid({ tags: [{ id: 6, name: "Trip" }] });

    fireEvent.click(screen.getByLabelText("Select Coffee shop"));
    fireEvent.click(screen.getByLabelText("Select Paycheck"));

    expect(screen.getByLabelText("Add tag to selection")).toBeInTheDocument();
  });

  it("committing a tag in the bulk control fires onBulkAssignTags for every selected id", async () => {
    const user = userEvent.setup();
    const props = renderGrid({ tags: [{ id: 6, name: "Trip" }], onBulkAssignTags: vi.fn() });

    fireEvent.click(screen.getByLabelText("Select Coffee shop"));
    fireEvent.click(screen.getByLabelText("Select Paycheck"));

    const input = screen.getByLabelText("Add tag to selection");
    await user.type(input, "Trip");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onBulkAssignTags).toHaveBeenCalledWith([1, 2], ["Trip"]);
  });
});

describe("TransactionsGrid full Column Set rendering", () => {
  it("renders a header for every visible column in the Column Set (Account suppressed on single-Account data)", () => {
    renderGrid();

    const headers = Array.from(document.querySelectorAll(".ledger-head > span")).map(
      // Strips the column drag-reorder handle glyph (#94, ADR-0021 phase 5)
      // prepended to each header's textContent -- these assertions care
      // about the label text, not the handle.
      (el) => el.textContent?.replace("⠿", ""),
    );
    expect(headers).toEqual([
      "", // select-all checkbox column
      "Date",
      "Payee",
      "Memo",
      "Category",
      "Tags",
      "Amount",
      "Running Balance",
      "", // row-actions column
    ]);
  });

  it("respects columnVisibility by omitting hidden columns from the header row", () => {
    renderGrid({ columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY, tags: false, memo: false } });

    const headers = Array.from(document.querySelectorAll(".ledger-head > span")).map(
      (el) => el.textContent?.replace("⠿", ""),
    );
    expect(headers).not.toContain("Tags");
    expect(headers).not.toContain("Memo");
    expect(headers).toContain("Payee");
  });
});

// Column drag-to-reorder (#94, ADR-0021 phase 5): native HTML5 drag-and-drop
// on each header's drag handle. AllTransactionsScreen.test.tsx covers the
// resulting order persisting through the Tauri settings command and the
// Columns chip panel reflecting it -- these cover the grid-level interaction
// and its `onColumnOrderChange` callback contract in isolation.
describe("TransactionsGrid column drag-to-reorder", () => {
  function headerLabels() {
    return Array.from(document.querySelectorAll(".ledger-head > span")).map(
      (el) => el.textContent?.replace("⠿", ""),
    );
  }

  function dragHandle(columnLabel: string) {
    return screen.getByRole("button", { name: `Reorder ${columnLabel} column` });
  }

  function headerSpan(columnLabel: string) {
    return dragHandle(columnLabel).closest("span") as HTMLElement;
  }

  it("dragging a header's handle onto another header reorders the grid's columns immediately", () => {
    const props = renderGrid();

    fireEvent.dragStart(dragHandle("Amount"));
    const targetHeader = headerSpan("Date");
    fireEvent.dragOver(targetHeader);
    fireEvent.drop(targetHeader);

    expect(props.onColumnOrderChange).toHaveBeenCalledWith([
      "amount",
      "date",
      "account",
      "payee",
      "memo",
      "category",
      "tags",
      "running_balance",
    ]);
  });

  it("dropping a dragged column onto itself is a no-op", () => {
    const props = renderGrid();

    const handle = dragHandle("Date");
    fireEvent.dragStart(handle);
    const header = headerSpan("Date");
    fireEvent.dragOver(header);
    fireEvent.drop(header);

    expect(props.onColumnOrderChange).not.toHaveBeenCalled();
  });

  it("renders columns in the order given by columnOrder", () => {
    renderGrid({
      columnOrder: ["amount", "date", "account", "payee", "memo", "category", "tags", "running_balance"],
    });

    const headers = headerLabels();
    expect(headers.slice(1, 3)).toEqual(["Amount", "Date"]);
  });
});

describe("TransactionsGrid Account column auto-suppression", () => {
  function multiAccountTransactions(): Transaction[] {
    return [
      {
        id: 1,
        account_id: 1,
        account_name: "Checking",
        date: "2026-08-01",
        amount_cents: -1250,
        description: "Coffee shop",
        category_id: null,
        merchant_name: null,
        hidden: false,
      },
      {
        id: 2,
        account_id: 2,
        account_name: "Savings",
        date: "2026-08-02",
        amount_cents: 300000,
        description: "Paycheck",
        category_id: null,
        merchant_name: null,
        hidden: false,
      },
    ];
  }

  it("hides the Account column when every transaction belongs to the same Account, even though visibility is on", () => {
    renderGrid();

    expect(screen.queryByText("Account")).toBeNull();
  });

  it("shows the Account column, with per-row Account names, once more than one Account is represented", () => {
    renderGrid({ transactions: multiAccountTransactions() });

    expect(screen.getByText("Account")).toBeInTheDocument();
    const coffeeRow = memoCell("Coffee shop").closest(".ledger-row") as HTMLElement;
    const paycheckRow = memoCell("Paycheck").closest(".ledger-row") as HTMLElement;
    expect(within(coffeeRow).getByText("Checking")).toBeInTheDocument();
    expect(within(paycheckRow).getByText("Savings")).toBeInTheDocument();
  });

  it("keeps the Account column hidden even when the user's stored visibility choice is true, for single-Account data", () => {
    renderGrid({ columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY, account: true } });

    expect(screen.queryByText("Account")).toBeNull();
  });
});

describe("TransactionsGrid Running Balance", () => {
  it("renders a cumulative running total, in date order, when the view is scoped to a single Account", () => {
    renderGrid();

    // The running total is computed in chronological order regardless of
    // the grid's display sort (#93 defaults display to date-desc): Coffee
    // shop (2026-08-01, -$12.50) comes first date-wise, Paycheck
    // (2026-08-02, $3,000.00) second -- so their per-row cumulative totals
    // stay -$12.50 and $2,987.50 respectively, found here by row rather
    // than by DOM position.
    const coffeeBalance = memoCell("Coffee shop")
      .closest(".ledger-row")!
      .querySelector(".cell-running-balance");
    const paycheckBalance = memoCell("Paycheck")
      .closest(".ledger-row")!
      .querySelector(".cell-running-balance");
    expect(coffeeBalance).toHaveTextContent(formatCents(-1250));
    expect(paycheckBalance).toHaveTextContent(formatCents(298750));
  });

  it("renders blank for every row when the view spans more than one Account", () => {
    const transactions: Transaction[] = [
      {
        id: 1,
        account_id: 1,
        date: "2026-08-01",
        amount_cents: -1250,
        description: "Coffee shop",
        category_id: null,
        merchant_name: null,
        hidden: false,
      },
      {
        id: 2,
        account_id: 2,
        date: "2026-08-02",
        amount_cents: 300000,
        description: "Paycheck",
        category_id: null,
        merchant_name: null,
        hidden: false,
      },
    ];
    renderGrid({ transactions });

    const balances = Array.from(document.querySelectorAll(".cell-running-balance")).map(
      (el) => el.textContent,
    );
    expect(balances).toEqual(["—", "—"]);
  });
});

describe("TransactionsGrid Column Management", () => {
  it("right-clicking a column header opens a checklist reflecting current visibility", () => {
    renderGrid();

    fireEvent.contextMenu(document.querySelector(".ledger-head") as HTMLElement);

    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitemcheckbox");
    expect(items).toHaveLength(8);
    for (const item of items) {
      expect(item).toHaveAttribute("aria-checked", "true");
    }
    expect(within(menu).getByText("Running Balance")).toBeInTheDocument();
  });

  it("toggling a column checkbox calls onColumnVisibilityChange and does not close the menu", () => {
    const props = renderGrid();

    fireEvent.contextMenu(document.querySelector(".ledger-head") as HTMLElement);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Tags" }));

    expect(props.onColumnVisibilityChange).toHaveBeenCalledWith({
      ...DEFAULT_COLUMN_VISIBILITY,
      tags: false,
    });
    // Menu stays open -- multiple columns can be toggled in one interaction.
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("hiding a column via the checklist removes it from the rendered grid once the caller applies the new visibility", () => {
    function Harness() {
      const [visibility, setVisibility] = useState(DEFAULT_COLUMN_VISIBILITY);
      return (
        <TransactionsGrid
          transactions={makeTransactions()}
          categories={categories}
          accounts={[]}
          linkedTransactionIds={new Set()}
          transferByTransactionId={new Map()}
          linkingId={null}
          columnVisibility={visibility}
          onColumnVisibilityChange={setVisibility}
          onStartLink={vi.fn()}
          onCancelLink={vi.fn()}
          onLink={vi.fn()}
          onUnlink={vi.fn()}
          onUpdate={vi.fn()}
          onBulkAssignCategory={vi.fn()}
          onDelete={vi.fn()}
          onSetHidden={vi.fn()}
        />
      );
    }
    render(<Harness />, { wrapper: withBreakpoint("expanded") });

    expect(screen.getByText("Tags", { selector: ".ledger-head span" })).toBeInTheDocument();
    fireEvent.contextMenu(document.querySelector(".ledger-head") as HTMLElement);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Tags" }));

    expect(screen.queryByText("Tags", { selector: ".ledger-head span" })).toBeNull();
    // The menu is still open, now reflecting the updated visibility.
    expect(screen.getByRole("menuitemcheckbox", { name: "Tags" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("TransactionsGrid click-to-sort columns", () => {
  function sortableTransactions(): Transaction[] {
    return [
      {
        id: 1,
        account_id: 1,
        date: "2026-08-01",
        amount_cents: -1250,
        description: "Coffee shop",
        category_id: null,
        merchant_name: null,
        hidden: false,
      },
      {
        id: 2,
        account_id: 1,
        date: "2026-08-02",
        amount_cents: 300000,
        description: "Paycheck",
        category_id: null,
        merchant_name: null,
        hidden: false,
      },
      {
        id: 3,
        account_id: 1,
        date: "2026-08-03",
        amount_cents: -500,
        description: "Groceries",
        category_id: null,
        merchant_name: null,
        hidden: false,
      },
    ];
  }

  function memoOrder() {
    return Array.from(document.querySelectorAll(".cell-memo")).map((el) => el.textContent);
  }

  function payeeOrder() {
    return Array.from(document.querySelectorAll(".passbook-payee-name")).map((el) => el.textContent);
  }

  it("clicking the Amount header sorts ascending by amount", () => {
    renderGrid({ transactions: sortableTransactions() });

    fireEvent.click(screen.getByText("Amount", { selector: ".ledger-head span" }));

    expect(memoOrder()).toEqual(["Coffee shop", "Groceries", "Paycheck"]);
  });

  it("clicking the Amount header a second time reverses to descending", () => {
    renderGrid({ transactions: sortableTransactions() });

    const header = screen.getByText("Amount", { selector: ".ledger-head span" });
    fireEvent.click(header);
    fireEvent.click(header);

    expect(memoOrder()).toEqual(["Paycheck", "Groceries", "Coffee shop"]);
  });

  it("clicking the Amount header a third time clears back to the default date-desc order (#93)", () => {
    renderGrid({ transactions: sortableTransactions() });

    const header = screen.getByText("Amount", { selector: ".ledger-head span" });
    fireEvent.click(header);
    fireEvent.click(header);
    fireEvent.click(header);

    // Groceries (08-03) newest, Coffee shop (08-01) oldest.
    expect(memoOrder()).toEqual(["Groceries", "Paycheck", "Coffee shop"]);
  });

  it("clicking the Payee header sorts ascending, then descending, then clears back to the default date-desc order (#93) (text column)", () => {
    const transactions = sortableTransactions();
    renderGrid({ transactions });

    const header = screen.getByText("Payee", { selector: ".ledger-head span" });

    fireEvent.click(header);
    expect(payeeOrder()).toEqual(["Coffee shop", "Groceries", "Paycheck"]);

    fireEvent.click(header);
    expect(payeeOrder()).toEqual(["Paycheck", "Groceries", "Coffee shop"]);

    fireEvent.click(header);
    expect(payeeOrder()).toEqual(["Groceries", "Paycheck", "Coffee shop"]);
  });

  it("clicking a different header resets the cycle to ascending on the new column", () => {
    renderGrid({ transactions: sortableTransactions() });

    fireEvent.click(screen.getByText("Amount", { selector: ".ledger-head span" }));
    expect(memoOrder()).toEqual(["Coffee shop", "Groceries", "Paycheck"]);

    fireEvent.click(screen.getByText("Payee", { selector: ".ledger-head span" }));
    expect(payeeOrder()).toEqual(["Coffee shop", "Groceries", "Paycheck"]);
  });

  it("shows a visual indicator of the active sort column and direction in the header", () => {
    renderGrid({ transactions: sortableTransactions() });

    const header = screen.getByText("Amount", { selector: ".ledger-head span" });
    expect(header.className).not.toMatch(/sort-/);

    fireEvent.click(header);
    expect(header.className).toMatch(/sort-asc/);

    fireEvent.click(header);
    expect(header.className).toMatch(/sort-desc/);

    fireEvent.click(header);
    expect(header.className).not.toMatch(/sort-/);
  });

  it("sorting does not affect row selection state", () => {
    renderGrid({ transactions: sortableTransactions() });

    fireEvent.click(screen.getByLabelText("Select Coffee shop"));
    fireEvent.click(screen.getByText("Amount", { selector: ".ledger-head span" }));

    expect(screen.getByLabelText("Select Coffee shop")).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("right-click column management still works after clicking a header to sort", () => {
    renderGrid({ transactions: sortableTransactions() });

    fireEvent.click(screen.getByText("Amount", { selector: ".ledger-head span" }));
    fireEvent.contextMenu(document.querySelector(".ledger-head") as HTMLElement);

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

describe("TransactionsGrid Hidden transactions (#70)", () => {
  it("right-clicking a data row opens a context menu with a 'Hide' item for a currently-visible transaction", () => {
    renderGrid();

    fireEvent.contextMenu(memoCell("Coffee shop").closest(".ledger-row") as HTMLElement);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Hide")).toBeInTheDocument();
    expect(within(menu).queryByText("Unhide")).toBeNull();
  });

  it("selecting Hide calls onSetHidden with the transaction and true", () => {
    const props = renderGrid();

    fireEvent.contextMenu(memoCell("Coffee shop").closest(".ledger-row") as HTMLElement);
    fireEvent.click(screen.getByText("Hide"));

    expect(props.onSetHidden).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, description: "Coffee shop" }),
      true,
    );
  });

  it("right-clicking an already-hidden data row opens a context menu with an 'Unhide' item", () => {
    const transactions: Transaction[] = [
      { ...makeTransactions()[0], hidden: true },
      makeTransactions()[1],
    ];
    renderGrid({ transactions });

    fireEvent.contextMenu(memoCell("Coffee shop").closest(".ledger-row") as HTMLElement);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Unhide")).toBeInTheDocument();
    expect(within(menu).queryByText("Hide")).toBeNull();
  });

  it("selecting Unhide calls onSetHidden with the transaction and false", () => {
    const transactions: Transaction[] = [
      { ...makeTransactions()[0], hidden: true },
      makeTransactions()[1],
    ];
    const props = renderGrid({ transactions });

    fireEvent.contextMenu(memoCell("Coffee shop").closest(".ledger-row") as HTMLElement);
    fireEvent.click(screen.getByText("Unhide"));

    expect(props.onSetHidden).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, description: "Coffee shop" }),
      false,
    );
  });

  it("renders a hidden transaction's row with a dimmed style class", () => {
    const transactions: Transaction[] = [
      { ...makeTransactions()[0], hidden: true },
      makeTransactions()[1],
    ];
    renderGrid({ transactions });

    const hiddenRow = memoCell("Coffee shop").closest(".ledger-row") as HTMLElement;
    const visibleRow = memoCell("Paycheck").closest(".ledger-row") as HTMLElement;
    expect(hiddenRow.className).toMatch(/hidden-row/);
    expect(visibleRow.className).not.toMatch(/hidden-row/);
  });

  it("right-clicking a column header still opens Column Management, not the row menu", () => {
    renderGrid();

    fireEvent.contextMenu(document.querySelector(".ledger-head") as HTMLElement);

    const menu = screen.getByRole("menu");
    expect(within(menu).queryByText("Hide")).toBeNull();
    expect(within(menu).getAllByRole("menuitemcheckbox").length).toBeGreaterThan(0);
  });
});

describe("TransactionsGrid row context menu actions", () => {
  function openRowMenu() {
    fireEvent.contextMenu(memoCell("Coffee shop").closest(".ledger-row") as HTMLElement);
    return screen.getByRole("menu");
  }

  it("offers Link transfer alongside Hide for an unlinked transaction", () => {
    const props = renderGrid();

    const menu = openRowMenu();
    expect(within(menu).getByText("Link transfer")).toBeInTheDocument();
    expect(within(menu).queryByText("Unlink transfer")).toBeNull();

    fireEvent.click(within(menu).getByText("Link transfer"));
    expect(props.onStartLink).toHaveBeenCalledWith(1);
  });

  it("offers Unlink transfer for a linked transaction, calling onUnlink with its transfer", () => {
    const transfer = {
      id: 7,
      from_transaction_id: 1,
      to_transaction_id: 2,
      created_at: "2026-08-01T00:00:00Z",
    };
    const props = renderGrid({
      linkedTransactionIds: new Set([1, 2]),
      transferByTransactionId: new Map([[1, transfer], [2, transfer]]),
    });

    const menu = openRowMenu();
    expect(within(menu).getByText("Unlink transfer")).toBeInTheDocument();
    expect(within(menu).queryByText("Link transfer")).toBeNull();

    fireEvent.click(within(menu).getByText("Unlink transfer"));
    expect(props.onUnlink).toHaveBeenCalledWith(transfer);
  });

  it("offers Delete as a danger item that calls onDelete for the row's transaction", () => {
    const props = renderGrid();

    const menu = openRowMenu();
    const deleteItem = within(menu).getByText("Delete");
    expect(deleteItem.closest("button")?.className).toMatch(/context-menu-item--danger/);

    fireEvent.click(deleteItem);
    expect(props.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, description: "Coffee shop" }),
    );
  });
});

describe("TransactionsGrid layout across Breakpoint Tiers", () => {
  it("renders the grid/table row layout at Expanded tier", () => {
    renderGrid({}, "expanded");

    const row = memoCell("Coffee shop").closest(".ledger-row");
    expect(row).toBeInTheDocument();
    expect(memoCell("Coffee shop").closest(".ledger-card")).toBeNull();
  });

  it("renders the grid/table row layout at Compact tier (cosmetic reflow only)", () => {
    renderGrid({}, "compact");

    const row = memoCell("Coffee shop").closest(".ledger-row");
    expect(row).toBeInTheDocument();
    expect(memoCell("Coffee shop").closest(".ledger-card")).toBeNull();
  });

  it("renders each transaction as a stacked card at Mobile tier, showing merchant/amount/date/category", () => {
    const transactions: Transaction[] = [
      {
        id: 1,
        account_id: 1,
        date: "2026-08-01",
        amount_cents: -1250,
        description: "Coffee shop",
        category_id: 10,
        merchant_name: "Blue Bottle Coffee",
        hidden: false,
      },
    ];
    renderGrid({ transactions }, "mobile");

    const card = payeeName("Blue Bottle Coffee").closest(".ledger-card");
    expect(card).toBeInTheDocument();
    expect(screen.queryByText("Blue Bottle Coffee")?.closest(".ledger-row")).toBeNull();

    expect(within(card as HTMLElement).getByText("Blue Bottle Coffee")).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByText(formatCents(-1250), {
        selector: ".ledger-card-field-amount .amount",
      }),
    ).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("2026-08-01")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("Food")).toBeInTheDocument();
  });

  it("does not render the column header row at Mobile tier", () => {
    renderGrid({}, "mobile");

    expect(document.querySelector(".ledger-head")).toBeNull();
  });

  it("inline edit still works on a card at Mobile tier", () => {
    const props = renderGrid({}, "mobile");

    fireEvent.click(memoCell("Coffee shop"));
    const input = screen.getByLabelText("Memo for Coffee shop") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Espresso bar" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onUpdate).toHaveBeenCalledWith(1, {
      date: "2026-08-01",
      amount_cents: -1250,
      description: "Espresso bar",
      category_id: null,
    });
  });

  it("delete still works on a card at Mobile tier", () => {
    const props = renderGrid({}, "mobile");

    const card = memoCell("Coffee shop").closest(".ledger-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));

    expect(props.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, description: "Coffee shop" }),
    );
  });

  it("bulk category assignment still works at Mobile tier", () => {
    const props = renderGrid({}, "mobile");

    fireEvent.click(screen.getByLabelText("Select Coffee shop"));
    fireEvent.click(screen.getByLabelText("Select Paycheck"));

    const bulkSelect = screen.getByLabelText("Assign category to selection") as HTMLSelectElement;
    fireEvent.change(bulkSelect, { target: { value: "11" } });

    expect(props.onBulkAssignCategory).toHaveBeenCalledWith([1, 2], 11);
  });

  it("link transfer still works on a card at Mobile tier", () => {
    const props = renderGrid({}, "mobile");

    const card = memoCell("Coffee shop").closest(".ledger-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Link transfer" }));

    expect(props.onStartLink).toHaveBeenCalledWith(1);
  });
});

// Grid virtualization (#95): @tanstack/react-virtual reads its scroll
// container's offsetHeight exactly once, synchronously, while React commits
// the initial render (see observeElementRect/_willUpdate in
// @tanstack/virtual-core -- it only re-subscribes if the scroll-element
// *reference* itself changes, not on every render). That's before a test
// can get a handle on the actual DOM node to override its offsetHeight, so
// a plain per-instance `Object.defineProperty(el, ...)` after `render()`
// returns is too late to affect how many rows mount initially. This helper
// instead keys the override off a CSS selector, so it's already in effect
// before the matching element even exists -- shadowing the global 600px
// default installed in src/test/setup.ts for just the element(s) a given
// test cares about (usually the `.ledger.ledger-editable` scroll
// container).
function mockElementSize(selector: string, height: number) {
  // clientHeight/scrollHeight mocked alongside offsetHeight: jsdom hardcodes
  // both to 0 (no layout engine), but @tanstack/virtual-core's
  // `getMaxScrollOffset` (used for `scrollToIndex(..., { align: "end" })`
  // when the target is the very last item -- see `getOffsetForIndex`) reads
  // `scrollHeight - clientHeight` directly rather than its own computed
  // total-item-size, so leaving them at 0 makes every "scroll to the end"
  // request resolve to offset 0, a no-op. `scrollHeight` here is a rough
  // stand-in for "much taller than the viewport", not pixel-accurate to
  // this grid's real total row height -- fine for tests asserting *that* a
  // far-off row gets scrolled into view, not the exact resulting offset.
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
  const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!;
  const originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.matches(selector) ? height : originalOffsetHeight.get!.call(this);
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return this.matches(selector) ? height : originalClientHeight.get!.call(this);
    },
  });
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return this.matches(selector) ? height * 1000 : originalScrollHeight.get!.call(this);
    },
  });
  return () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", originalClientHeight);
    Object.defineProperty(Element.prototype, "scrollHeight", originalScrollHeight);
  };
}

// Grid virtualization (#95): jsdom implements neither `Element.scrollTo`
// nor a real layout, so @tanstack/react-virtual's `scrollToIndex` (which
// calls `scrollElement.scrollTo({ top })`, see `elementScroll` in
// @tanstack/virtual-core) is a silent no-op by default -- the virtualizer
// never learns the scroll offset changed, so it never re-renders a wider
// mounted window. This stands in for the browser's real scrolling: it
// applies the requested `scrollTop` (which jsdom *does* store as a plain
// property, just never derives from real layout) and dispatches the
// `scroll` event the virtualizer's `observeElementOffset` listens for --
// letting the same production `scrollToIndex` path this component actually
// ships drive a real, observable re-render in the test. The dispatch is
// deferred to a microtask, not fired inline: `scrollToIndex` here is called
// from this component's own focus-effect (a layout effect, mid-commit), and
// a real browser's `scroll` event similarly never fires synchronously
// within the same script that requested the scroll -- dispatching it inline
// would re-enter React's renderer mid-commit (it warns "flushSync was
// called from inside a lifecycle method" and drops the update). Callers
// must therefore `await` a tick (e.g. via `waitFor`) after the action that
// triggers the scroll.
function installScrollToPolyfill() {
  const original = (Element.prototype as unknown as { scrollTo?: (opts?: unknown) => void }).scrollTo;
  (Element.prototype as unknown as { scrollTo: (opts?: { top?: number }) => void }).scrollTo = function (
    this: HTMLElement,
    options,
  ) {
    if (options && typeof options.top === "number") {
      this.scrollTop = options.top;
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
    }
  };
  return () => {
    (Element.prototype as unknown as { scrollTo?: (opts?: unknown) => void }).scrollTo = original;
  };
}

function makeManyTransactions(count: number): Transaction[] {
  // One calendar day apart, strictly descending as `i` increases, so the
  // grid's default newest-first sort (#93) keeps nav-order `row` aligned
  // with `i` (Transaction 0 is always the newest/first row, Transaction
  // count-1 the oldest/last) -- tests below rely on that alignment to
  // reason about which rows are/aren't mounted. Distinct days also means
  // Date Groups (#93) don't collapse everything into a single header,
  // exercising the group-header items `renderItems` interleaves with rows.
  const base = new Date("2025-06-01T00:00:00Z");
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() - i);
    return {
      id: i + 1,
      account_id: 1,
      date: date.toISOString().slice(0, 10),
      amount_cents: -100 * (i + 1),
      description: `Transaction ${i}`,
      category_id: null,
      merchant_name: null,
      hidden: false,
    };
  });
}

describe("TransactionsGrid virtualization (#95)", () => {
  it("only mounts a small subset of rows near the viewport with thousands of rows", () => {
    const restore = mockElementSize(".ledger.ledger-editable", 300);
    try {
      renderGrid({ transactions: makeManyTransactions(2000) });

      const mountedRows = document.querySelectorAll(".ledger-row");
      // A 300px viewport at 32px/row plus 12-row overscan above and below
      // comfortably fits well under 100 mounted rows -- nowhere near the
      // full 2000, which is the behavior under test.
      expect(mountedRows.length).toBeGreaterThan(0);
      expect(mountedRows.length).toBeLessThan(100);
    } finally {
      restore();
    }
  });

  it("renders top/bottom padding spacers sized for the un-mounted rows above/below the window", () => {
    const restore = mockElementSize(".ledger.ledger-editable", 300);
    try {
      renderGrid({ transactions: makeManyTransactions(2000) });

      // Scrolled to the top: no un-mounted rows above yet, so no top
      // spacer, but plenty below.
      expect(screen.queryByTestId("ledger-virtual-spacer-top")).not.toBeInTheDocument();
      const bottomSpacer = screen.getByTestId("ledger-virtual-spacer-bottom");
      expect(parseInt(bottomSpacer.style.height, 10)).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("scrolling a not-yet-mounted row into focus via keyboard nav (Ctrl+End) mounts and focuses it", async () => {
    const restore = mockElementSize(".ledger.ledger-editable", 300);
    const restoreScroll = installScrollToPolyfill();
    try {
      const count = 2000;
      renderGrid({ transactions: makeManyTransactions(count) });

      // Default sort is date-desc (#93): "Transaction 0" is the newest
      // fixture date, so it's row 0 and already mounted at the top.
      const first = memoCell("Transaction 0").closest('[role="gridcell"]') as HTMLElement;
      first.focus();
      expect(screen.queryByText(`Transaction ${count - 1}`)).not.toBeInTheDocument();

      fireEvent.keyDown(first, { key: "End", ctrlKey: true });

      // The last row in nav order (oldest date) becomes mounted and
      // focused once the polyfilled `scroll` event's microtask resolves
      // (see installScrollToPolyfill), proving the not-currently-mounted-
      // row branch of the focus effect drove the virtualizer to scroll it
      // into view rather than focusing nothing.
      const lastRow = await waitFor(() => {
        const lastMemo = screen.getByText(`Transaction ${count - 1}`, { selector: ".cell-memo" });
        return lastMemo.closest(".ledger-row") as HTMLElement;
      });
      expect(document.activeElement).not.toBe(document.body);
      expect(lastRow.contains(document.activeElement)).toBe(true);
    } finally {
      restoreScroll();
      restore();
    }
  });

  it("inline cell editing on a mounted row is unaffected by virtualization", () => {
    const restore = mockElementSize(".ledger.ledger-editable", 300);
    try {
      const props = renderGrid({ transactions: makeManyTransactions(50) });

      fireEvent.click(memoCell("Transaction 0"));
      const input = screen.getByLabelText("Memo for Transaction 0") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Edited" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(props.onUpdate).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ description: "Edited" }),
      );
    } finally {
      restore();
    }
  });

  it("row selection on a mounted row is unaffected by virtualization", () => {
    const restore = mockElementSize(".ledger.ledger-editable", 300);
    try {
      const props = renderGrid({ transactions: makeManyTransactions(50) });

      fireEvent.click(screen.getByLabelText("Select Transaction 0"));
      fireEvent.click(screen.getByLabelText("Select Transaction 1"));

      // Assert via the bulk-actions bar / bulk callback rather than the
      // checkbox's own `checked` DOM property: a lone `fireEvent.click` on a
      // controlled checkbox whose onClick calls `e.preventDefault()` (this
      // grid's pattern, needed so the checkbox's own native toggle never
      // fights the `selected` state driving it) races jsdom's post-dispatch
      // "canceled activation steps", which revert `checked` back to its
      // pre-click value *after* React's own commit already set it --
      // clobbering the visual state on the very next microtask. This is a
      // jsdom/synthetic-event artifact, not a real bug (existing pre-#95
      // tests already dodge it by pairing every selection click with a
      // second, unrelated one before asserting `toBeChecked()`) -- the
      // bulk-actions bar's `selected.size` text and the bulk-assign
      // callback are driven by the same `selected` state and don't race
      // this revert, so they're the reliable signal here.
      expect(screen.getByText("2 selected")).toBeInTheDocument();

      const bulkSelect = screen.getByLabelText("Assign category to selection") as HTMLSelectElement;
      fireEvent.change(bulkSelect, { target: { value: "11" } });
      expect(props.onBulkAssignCategory).toHaveBeenCalledWith([1, 2], 11);
    } finally {
      restore();
    }
  });
});
