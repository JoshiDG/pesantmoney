import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Category } from "../categories/types";
import { withBreakpoint } from "../ui/withBreakpoint";
import type { BreakpointTier } from "../ui/breakpoints";
import { TransactionsGrid } from "./TransactionsGrid";
import { formatCents, Transaction } from "./types";

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
    onStartLink: vi.fn(),
    onCancelLink: vi.fn(),
    onLink: vi.fn(),
    onUnlink: vi.fn(),
    onUpdate: vi.fn(),
    onBulkAssignCategory: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<TransactionsGrid {...props} />, { wrapper: withBreakpoint(tier) });
  return props;
}

describe("TransactionsGrid inline editing", () => {
  it("clicking the description cell opens an inline text input pre-filled with the current value, no modal", () => {
    renderGrid();

    fireEvent.click(screen.getByText("Coffee shop"));

    const input = screen.getByLabelText("Description for Coffee shop") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("Coffee shop");
  });

  it("committing an edit with Enter calls onUpdate with the full updated fields via the existing update path", async () => {
    const user = userEvent.setup();
    const props = renderGrid();

    fireEvent.click(screen.getByText("Coffee shop"));
    const input = screen.getByLabelText("Description for Coffee shop") as HTMLInputElement;
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

    fireEvent.click(screen.getByText("Coffee shop"));
    const input = screen.getByLabelText("Description for Coffee shop") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Should not save" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Coffee shop")).toBeInTheDocument();
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
  it("ArrowRight moves focus from the date cell to the description cell", () => {
    renderGrid();

    const dateCell = screen.getByText("2026-08-01");
    dateCell.focus();
    fireEvent.keyDown(dateCell, { key: "ArrowRight" });

    expect(screen.getByText("Coffee shop")).toHaveFocus();
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

describe("TransactionsGrid merchant name display", () => {
  it("shows the identified merchant name in place of the raw description when present", () => {
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

    expect(screen.getByText("Blue Bottle Coffee")).toBeInTheDocument();
    expect(screen.queryByText("SQ *BLUE BOTTLE COF 04/12")).not.toBeInTheDocument();
  });

  it("falls back to the raw description when no merchant is identified", () => {
    renderGrid();

    expect(screen.getByText("Coffee shop")).toBeInTheDocument();
  });
});

describe("TransactionsGrid tag chips", () => {
  it("renders attached tags as chips next to the description", () => {
    renderGrid({ tagsByTransactionId: { 1: [{ id: 5, name: "Reimbursable" }] } });

    expect(screen.getByText("Reimbursable")).toBeInTheDocument();
  });

  it("renders no chip for a transaction absent from the tag map", () => {
    renderGrid({ tagsByTransactionId: { 1: [{ id: 5, name: "Reimbursable" }] } });

    const paycheckCell = screen.getByText("Paycheck").closest(".cell-description");
    expect(paycheckCell?.querySelector(".tag-chip")).toBeNull();
  });
});

describe("TransactionsGrid layout across Breakpoint Tiers", () => {
  it("renders the grid/table row layout at Expanded tier", () => {
    renderGrid({}, "expanded");

    const row = screen.getByText("Coffee shop").closest(".ledger-row");
    expect(row).toBeInTheDocument();
    expect(screen.getByText("Coffee shop").closest(".ledger-card")).toBeNull();
  });

  it("renders the grid/table row layout at Compact tier (cosmetic reflow only)", () => {
    renderGrid({}, "compact");

    const row = screen.getByText("Coffee shop").closest(".ledger-row");
    expect(row).toBeInTheDocument();
    expect(screen.getByText("Coffee shop").closest(".ledger-card")).toBeNull();
  });

  it("renders each transaction as a stacked card at Mobile tier, showing merchant/amount/date/category/account", () => {
    const transactions: Transaction[] = [
      {
        id: 1,
        account_id: 1,
        account_name: "Checking",
        date: "2026-08-01",
        amount_cents: -1250,
        description: "Coffee shop",
        category_id: 10,
        merchant_name: "Blue Bottle Coffee",
        hidden: false,
      },
    ];
    renderGrid({ transactions }, "mobile");

    const card = screen.getByText("Blue Bottle Coffee").closest(".ledger-card");
    expect(card).toBeInTheDocument();
    expect(screen.queryByText("Blue Bottle Coffee")?.closest(".ledger-row")).toBeNull();

    expect(within(card as HTMLElement).getByText("Blue Bottle Coffee")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText(formatCents(-1250))).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("2026-08-01")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("Food")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("Checking")).toBeInTheDocument();
  });

  it("does not render the column header row at Mobile tier", () => {
    renderGrid({}, "mobile");

    expect(document.querySelector(".ledger-head")).toBeNull();
  });

  it("inline edit still works on a card at Mobile tier", () => {
    const props = renderGrid({}, "mobile");

    fireEvent.click(screen.getByText("Coffee shop"));
    const input = screen.getByLabelText("Description for Coffee shop") as HTMLInputElement;
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

    const card = screen.getByText("Coffee shop").closest(".ledger-card") as HTMLElement;
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

    const card = screen.getByText("Coffee shop").closest(".ledger-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Link transfer" }));

    expect(props.onStartLink).toHaveBeenCalledWith(1);
  });
});
