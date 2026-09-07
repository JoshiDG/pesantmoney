import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Category } from "../categories/types";
import { TransactionsGrid } from "./TransactionsGrid";
import { Transaction } from "./types";

function makeTransactions(): Transaction[] {
  return [
    { id: 1, account_id: 1, date: "2026-08-01", amount_cents: -1250, description: "Coffee shop", category_id: null },
    { id: 2, account_id: 1, date: "2026-08-02", amount_cents: 300000, description: "Paycheck", category_id: null },
  ];
}

const categories: Category[] = [
  { id: 10, group_id: 1, name: "Food" },
  { id: 11, group_id: 1, name: "Income" },
];

function renderGrid(overrides: Partial<Parameters<typeof TransactionsGrid>[0]> = {}) {
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
  render(<TransactionsGrid {...props} />);
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
      { id: 3, account_id: 1, date: "2026-08-03", amount_cents: -500, description: "Groceries", category_id: null },
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
