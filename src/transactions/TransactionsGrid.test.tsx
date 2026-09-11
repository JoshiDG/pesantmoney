import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Category } from "../categories/types";
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
  { id: 11, group_id: 1, name: "Income" },
];

function renderGrid(
  overrides: Partial<Parameters<typeof TransactionsGrid>[0]> = {},
  tier: BreakpointTier = "expanded",
) {
  const props = {
    transactions: makeTransactions(),
    categories,
    accounts: [],
    linkedTransactionIds: new Set<number>(),
    transferByTransactionId: new Map(),
    linkingId: null,
    columnVisibility: DEFAULT_COLUMN_VISIBILITY,
    onColumnVisibilityChange: vi.fn(),
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

  it("editing the category cell shows a select of categories and commits on change", () => {
    const props = renderGrid();

    fireEvent.click(screen.getAllByText("Uncategorized")[0]);
    const select = screen.getByLabelText("Category for Coffee shop") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "10" } });

    expect(props.onUpdate).toHaveBeenCalledWith(1, {
      date: "2026-08-01",
      amount_cents: -1250,
      description: "Coffee shop",
      category_id: 10,
    });
  });
});

describe("TransactionsGrid keyboard navigation", () => {
  it("ArrowRight moves focus from the date cell to the memo cell", () => {
    renderGrid();

    const dateCell = screen.getByText("2026-08-01");
    dateCell.focus();
    fireEvent.keyDown(dateCell, { key: "ArrowRight" });

    expect(memoCell("Coffee shop").closest('[role="gridcell"]')).toHaveFocus();
  });

  it("Enter on a focused (non-editing) cell opens it for editing", () => {
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
    expect(props.onBulkAssignCategory).toHaveBeenCalledWith([1, 2, 3], 10);
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

    const cell = document.querySelector(".cell-tags") as HTMLElement;
    fireEvent.click(cell);

    const input = screen.getByLabelText("Tags for Coffee shop");
    expect(input).toBeInTheDocument();
    expect(within(cell).getByText("Reimbursable", { selector: ".suggestion-chip" })).toBeInTheDocument();
  });

  it("committing a new tag name via the combobox calls onAddTag with the transaction id and typed name", async () => {
    const user = userEvent.setup();
    const props = renderGrid({ tags: [{ id: 6, name: "Trip" }], onAddTag: vi.fn() });

    fireEvent.click(document.querySelector(".cell-tags") as HTMLElement);
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

    fireEvent.click(document.querySelector(".cell-tags") as HTMLElement);
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
      (el) => el.textContent,
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
      (el) => el.textContent,
    );
    expect(headers).not.toContain("Tags");
    expect(headers).not.toContain("Memo");
    expect(headers).toContain("Payee");
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

    const balances = Array.from(document.querySelectorAll(".cell-running-balance")).map(
      (el) => el.textContent,
    );
    expect(balances).toEqual([formatCents(-1250), formatCents(298750)]);
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

  it("clicking the Amount header a third time clears back to the default order", () => {
    const transactions = sortableTransactions();
    renderGrid({ transactions });

    const header = screen.getByText("Amount", { selector: ".ledger-head span" });
    fireEvent.click(header);
    fireEvent.click(header);
    fireEvent.click(header);

    expect(memoOrder()).toEqual(transactions.map((t) => t.description));
  });

  it("clicking the Payee header sorts ascending, then descending, then clears (text column)", () => {
    const transactions = sortableTransactions();
    renderGrid({ transactions });

    const header = screen.getByText("Payee", { selector: ".ledger-head span" });

    fireEvent.click(header);
    expect(payeeOrder()).toEqual(["Coffee shop", "Groceries", "Paycheck"]);

    fireEvent.click(header);
    expect(payeeOrder()).toEqual(["Paycheck", "Groceries", "Coffee shop"]);

    fireEvent.click(header);
    expect(payeeOrder()).toEqual(transactions.map((t) => t.description));
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
