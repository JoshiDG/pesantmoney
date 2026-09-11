import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { withBreakpoint } from "../ui/withBreakpoint";
import type { BreakpointTier } from "../ui/breakpoints";
import { AllTransactionsScreen } from "./AllTransactionsScreen";
import { Account } from "../accounts/types";
import { DEFAULT_COLUMN_VISIBILITY } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const checking: Account = { id: 1, name: "Checking", account_type: "checking", institution_name: null, apr_bps: null };
const savings: Account = { id: 2, name: "Savings", account_type: "savings", institution_name: null, apr_bps: null };

const allTransactions = [
  {
    id: 1,
    account_id: 1,
    account_name: "Checking",
    date: "2026-09-01",
    amount_cents: -1250,
    description: "Coffee shop",
    category_id: null,
    hidden: false,
    merchant_name: null,
  },
  {
    id: 2,
    account_id: 2,
    account_name: "Savings",
    date: "2026-09-02",
    amount_cents: 5000,
    description: "Interest",
    category_id: null,
    hidden: false,
    merchant_name: null,
  },
];

const allTransactionsWithHidden = [
  ...allTransactions,
  {
    id: 3,
    account_id: 1,
    account_name: "Checking",
    date: "2026-09-03",
    amount_cents: -400,
    description: "Old subscription",
    category_id: null,
    hidden: true,
    merchant_name: null,
  },
];

function renderScreen(initialAccountId: number | null = null, tier: BreakpointTier = "expanded") {
  render(
    <ConfirmationProvider>
      <AllTransactionsScreen initialAccountId={initialAccountId} />
    </ConfirmationProvider>,
    { wrapper: withBreakpoint(tier) },
  );
}

function mockInvokeDefaults() {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "list_all_transactions":
        return allTransactions;
      case "list_categories":
        return [];
      case "list_accounts":
        return [checking, savings];
      case "list_transfers":
        return [];
      case "list_tags_for_account":
        return {};
      case "get_settings":
        return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
      case "update_transaction_column_visibility":
        return null;
      case "delete_transaction":
        return null;
      case "update_transaction":
        return null;
      case "set_transaction_hidden":
        return null;
      default:
        return null;
    }
  });
}

function memoCell(text: string) {
  return screen.getByText(text, { selector: ".cell-memo" });
}

function findMemoCell(text: string) {
  return screen.findByText(text, { selector: ".cell-memo" });
}

describe("AllTransactionsScreen", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockInvokeDefaults();
  });

  it("defaults to showing every Account's transactions", async () => {
    renderScreen();

    await findMemoCell("Coffee shop");
    expect(memoCell("Interest")).toBeInTheDocument();
  });

  it("shows an Account column for each row when more than one Account is represented", async () => {
    renderScreen();

    await findMemoCell("Coffee shop");

    expect(screen.getByText("Account", { selector: ".ledger-head span" })).toBeInTheDocument();
    const coffeeRow = memoCell("Coffee shop").closest(".ledger-row") as HTMLElement;
    const interestRow = memoCell("Interest").closest(".ledger-row") as HTMLElement;
    expect(within(coffeeRow).getByText("Checking")).toBeInTheDocument();
    expect(within(interestRow).getByText("Savings")).toBeInTheDocument();
  });

  it("narrows to a single Account via the filter, hiding the Account column once only one Account remains", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.selectOptions(screen.getByLabelText("Filter by account"), "1");

    await waitFor(() => expect(screen.queryByText("Interest")).not.toBeInTheDocument());
    expect(memoCell("Coffee shop")).toBeInTheDocument();
    // Only one Account remains in view, so the column is no longer needed.
    expect(screen.queryByText("Account", { selector: ".ledger-head span" })).toBeNull();
  });

  it("pre-filters to the given Account when opened from the Accounts screen", async () => {
    renderScreen(2);
    await findMemoCell("Interest");

    expect(screen.queryByText("Coffee shop")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter by account")).toHaveValue("2");
  });

  it("can switch back to all Accounts after narrowing", async () => {
    renderScreen(2);
    await findMemoCell("Interest");

    await userEvent.selectOptions(screen.getByLabelText("Filter by account"), "all");

    await waitFor(() => expect(memoCell("Coffee shop")).toBeInTheDocument());
    expect(memoCell("Interest")).toBeInTheDocument();
  });

  it("still supports deleting a transaction (existing per-Transaction interaction) in all-Accounts mode", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    const row = memoCell("Coffee shop").closest(".ledger-row") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Transaction" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_transaction", { id: 1 }));
  });

  it("still supports bulk category assignment across a multi-row selection", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_all_transactions":
          return allTransactions;
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Food" }];
        case "list_accounts":
          return [checking, savings];
        case "list_transfers":
          return [];
        case "list_tags_for_account":
          return {};
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "update_transaction_column_visibility":
          return null;
        case "update_transaction":
          return null;
        default:
          return null;
      }
    });
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("checkbox", { name: "Select all transactions" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Assign category to selection" }), "10");

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_transaction",
        expect.objectContaining({ id: 1, category_id: 10 }),
      ),
    );
    expect(mockedInvoke).toHaveBeenCalledWith(
      "update_transaction",
      expect.objectContaining({ id: 2, category_id: 10 }),
    );
  });

  it("renders the grid/table row layout at Expanded tier", async () => {
    renderScreen(null, "expanded");
    await findMemoCell("Coffee shop");

    expect(memoCell("Coffee shop").closest(".ledger-row")).toBeInTheDocument();
    expect(memoCell("Coffee shop").closest(".ledger-card")).toBeNull();
  });

  it("renders each Transaction as a stacked card at Mobile tier, with the Account filter still working", async () => {
    renderScreen(null, "mobile");
    await findMemoCell("Coffee shop");

    const card = memoCell("Coffee shop").closest(".ledger-card");
    expect(card).toBeInTheDocument();
    expect(memoCell("Coffee shop").closest(".ledger-row")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Filter by account"), "1");

    await waitFor(() => expect(screen.queryByText("Interest")).not.toBeInTheDocument());
    expect(memoCell("Coffee shop")).toBeInTheDocument();
  });

  it("still supports deleting a transaction in card view at Mobile tier", async () => {
    renderScreen(null, "mobile");
    await findMemoCell("Coffee shop");

    const card = memoCell("Coffee shop").closest(".ledger-card") as HTMLElement;
    await userEvent.click(within(card).getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Transaction" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_transaction", { id: 1 }));
  });
});

describe("AllTransactionsScreen Show hidden toggle (#70)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_all_transactions":
          return allTransactionsWithHidden;
        case "list_categories":
          return [];
        case "list_accounts":
          return [checking, savings];
        case "list_transfers":
          return [];
        case "list_tags_for_account":
          return {};
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "update_transaction_column_visibility":
          return null;
        case "set_transaction_hidden":
          return null;
        default:
          return null;
      }
    });
  });

  it("defaults to off: excludes hidden transactions from the grid", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    expect(screen.queryByText("Old subscription")).not.toBeInTheDocument();
  });

  it("checking Show hidden reveals the hidden transaction, rendered dimmed", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByLabelText("Show hidden"));

    const hiddenRow = await findMemoCell("Old subscription");
    expect(hiddenRow.closest(".ledger-row")?.className).toMatch(/hidden-row/);
  });

  it("right-click Hide on a row calls set_transaction_hidden and refreshes", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(memoCell("Coffee shop").closest(".ledger-row") as HTMLElement);
    await userEvent.click(screen.getByText("Hide"));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("set_transaction_hidden", { id: 1, hidden: true }),
    );
  });
});
