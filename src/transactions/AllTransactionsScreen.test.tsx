import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { ReservedShortcutProvider } from "../ui/ReservedShortcuts";
import { withBreakpoint } from "../ui/withBreakpoint";
import type { BreakpointTier } from "../ui/breakpoints";
import { AllTransactionsScreen } from "./AllTransactionsScreen";
import { Account } from "../accounts/types";
import { DEFAULT_COLUMN_VISIBILITY } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);

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
      case "list_tags":
        return [{ id: 5, name: "Reimbursable" }];
      case "list_merchants":
        return [];
      case "get_settings":
        return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
      case "update_transaction_column_visibility":
        return null;
      case "delete_transaction":
        return null;
      case "create_transaction":
        return { id: 99 };
      case "update_transaction":
        return null;
      case "set_transaction_hidden":
        return null;
      case "set_transaction_merchant_name":
        return null;
      case "create_merchant":
        return { id: 9, keyword: "Coffee shop", merchant_name: "New Merchant" };
      case "create_tag":
        return { id: 9, name: "NewTag" };
      case "attach_tag_to_transaction":
        return null;
      case "detach_tag_from_transaction":
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

// Row-scoped, not index/DOM-position-based: the grid's default sort is now
// date-desc (#93), so "the first .cell-tags/.cell-payee/Uncategorized in the
// document" no longer reliably means Coffee shop's row -- these find the
// cell via the row containing that transaction's own Memo text instead.
function tagsCellFor(description: string) {
  const row = memoCell(description).closest(".ledger-row") as HTMLElement;
  return row.querySelector(".cell-tags") as HTMLElement;
}

function payeeCellFor(description: string) {
  const row = memoCell(description).closest(".ledger-row") as HTMLElement;
  return row.querySelector(".cell-payee") as HTMLElement;
}

function categoryCellFor(description: string) {
  const row = memoCell(description).closest(".ledger-row") as HTMLElement;
  return within(row).getByText("Uncategorized");
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

describe("AllTransactionsScreen Tag editing wiring (#71)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockInvokeDefaults();
  });

  it("fetches list_tags and seeds the grid's Tags editor with it", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_tags"));

    fireEvent.click(tagsCellFor("Coffee shop"));
    expect(screen.getByLabelText("Tags for Coffee shop")).toBeInTheDocument();
  });

  it("adding an existing Tag name attaches it without creating a duplicate", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_tags"));

    fireEvent.click(tagsCellFor("Coffee shop"));
    const input = screen.getByLabelText("Tags for Coffee shop");
    await userEvent.type(input, "Reimbursable");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("attach_tag_to_transaction", {
        transaction_id: 1,
        tag_id: 5,
      }),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith("create_tag", expect.anything());
  });

  it("adding a brand-new Tag name calls create_tag then attaches it, ungated", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_tags"));

    fireEvent.click(tagsCellFor("Coffee shop"));
    const input = screen.getByLabelText("Tags for Coffee shop");
    await userEvent.type(input, "Brand New Tag");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("create_tag", { name: "Brand New Tag" }),
    );
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("attach_tag_to_transaction", {
        transaction_id: 1,
        tag_id: 9,
      }),
    );
  });

  it("removing a chip calls detach_tag_from_transaction", async () => {
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
          return { 1: [{ id: 5, name: "Reimbursable" }] };
        case "list_tags":
          return [{ id: 5, name: "Reimbursable" }];
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "detach_tag_from_transaction":
          return null;
        default:
          return null;
      }
    });
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.click(tagsCellFor("Coffee shop"));
    await userEvent.click(screen.getByLabelText("Remove Reimbursable"));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("detach_tag_from_transaction", {
        transaction_id: 1,
        tag_id: 5,
      }),
    );
  });

  it("the bulk 'Add tag to selection' control attaches the tag to every selected transaction", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_tags"));

    fireEvent.click(screen.getByLabelText("Select Coffee shop"));
    fireEvent.click(screen.getByLabelText("Select Interest"));

    const bulkInput = screen.getByLabelText("Add tag to selection");
    await userEvent.type(bulkInput, "Reimbursable");
    fireEvent.keyDown(bulkInput, { key: "Enter" });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("attach_tag_to_transaction", {
        transaction_id: 1,
        tag_id: 5,
      }),
    );
    expect(mockedInvoke).toHaveBeenCalledWith("attach_tag_to_transaction", {
      transaction_id: 2,
      tag_id: 5,
    });
  });
});

describe("AllTransactionsScreen Category combobox editing + inline creation (#73)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_all_transactions":
          return allTransactions;
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Food" }];
        case "list_category_groups":
          return [
            { id: 1, name: "Everyday" },
            { id: 2, name: "Big Ticket" },
          ];
        case "list_accounts":
          return [checking, savings];
        case "list_transfers":
          return [];
        case "list_tags_for_account":
          return {};
        case "list_tags":
          return [];
        case "list_merchants":
          return [];
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "update_transaction_column_visibility":
          return null;
        case "update_transaction":
          return null;
        case "create_category":
          return { id: 20, group_id: 2, name: "Subscriptions" };
        default:
          return null;
      }
    });
  });

  it("fetches list_category_groups and seeds the create-new dialog's Group dropdown", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_category_groups"));

    fireEvent.click(categoryCellFor("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await userEvent.type(input, "Subscriptions");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByLabelText("Group")).toBeInTheDocument();
  });

  it("committing a value matching an existing Category calls update_transaction with the matched category_id, no create_category", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_categories"));

    fireEvent.click(categoryCellFor("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await userEvent.type(input, "Food");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_transaction",
        expect.objectContaining({ id: 1, category_id: 10 }),
      ),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith("create_category", expect.anything());
  });

  it("confirming an unmatched value calls create_category with the chosen Group, then assigns it via update_transaction", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_category_groups"));

    fireEvent.click(categoryCellFor("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await userEvent.type(input, "Subscriptions");
    fireEvent.keyDown(input, { key: "Enter" });

    await userEvent.selectOptions(screen.getByLabelText("Group"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("create_category", { group_id: 2, name: "Subscriptions" }),
    );
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_transaction",
        expect.objectContaining({ id: 1, category_id: 20 }),
      ),
    );
  });

  it("declining leaves the Category unchanged, calling neither create_category nor update_transaction", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_category_groups"));

    fireEvent.click(categoryCellFor("Coffee shop"));
    const input = screen.getByLabelText("Category for Coffee shop");
    await userEvent.type(input, "Subscriptions");
    fireEvent.keyDown(input, { key: "Enter" });

    await userEvent.click(screen.getByRole("button", { name: "No" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("create_category", expect.anything());
    expect(mockedInvoke).not.toHaveBeenCalledWith("update_transaction", expect.anything());
  });
});

describe("AllTransactionsScreen Payee editing wiring (#72)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
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
        case "list_tags":
          return [];
        case "list_merchants":
          return [{ id: 3, keyword: "Interest", merchant_name: "Bank Interest" }];
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "update_transaction_column_visibility":
          return null;
        case "set_transaction_merchant_name":
          return null;
        case "create_merchant":
          return { id: 9, keyword: "Coffee shop", merchant_name: "Neighborhood Cafe" };
        default:
          return null;
      }
    });
  });

  it("fetches list_merchants and seeds the grid's Payee editor with it", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_merchants"));

    fireEvent.click(payeeCellFor("Coffee shop"));
    expect(screen.getByLabelText("Payee for Coffee shop")).toBeInTheDocument();
  });

  it("committing a value matching a known Merchant calls set_transaction_merchant_name only", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_merchants"));

    fireEvent.click(payeeCellFor("Coffee shop"));
    const input = screen.getByLabelText("Payee for Coffee shop");
    await userEvent.type(input, "Bank Interest");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("set_transaction_merchant_name", {
        id: 1,
        merchant_name: "Bank Interest",
      }),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith("create_merchant", expect.anything());
  });

  it("confirming an unmatched value calls create_merchant keyed on the full raw description, then sets the Payee", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_merchants"));

    fireEvent.click(payeeCellFor("Coffee shop"));
    const input = screen.getByLabelText("Payee for Coffee shop");
    await userEvent.type(input, "Neighborhood Cafe");
    fireEvent.keyDown(input, { key: "Enter" });

    await userEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("create_merchant", {
        keyword: "Coffee shop",
        merchant_name: "Neighborhood Cafe",
      }),
    );
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("set_transaction_merchant_name", {
        id: 1,
        merchant_name: "Neighborhood Cafe",
      }),
    );
  });

  it("declining an unmatched value sets the Payee without calling create_merchant", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_merchants"));

    fireEvent.click(payeeCellFor("Coffee shop"));
    const input = screen.getByLabelText("Payee for Coffee shop");
    await userEvent.type(input, "Neighborhood Cafe");
    fireEvent.keyDown(input, { key: "Enter" });

    await userEvent.click(screen.getByRole("button", { name: "No" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("set_transaction_merchant_name", {
        id: 1,
        merchant_name: "Neighborhood Cafe",
      }),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith("create_merchant", expect.anything());
  });
});

describe("AllTransactionsScreen New Transaction panel + Reserved Shortcut Set wiring (#77/#78)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockInvokeDefaults();
  });

  function renderWithShortcuts(props: Partial<Parameters<typeof AllTransactionsScreen>[0]> = {}) {
    render(
      <ConfirmationProvider>
        <ReservedShortcutProvider onOpenSettings={vi.fn()}>
          <AllTransactionsScreen initialAccountId={null} {...props} />
        </ReservedShortcutProvider>
      </ConfirmationProvider>,
      { wrapper: withBreakpoint("expanded") },
    );
  }

  it("the New Transaction button opens a panel with an Account picker and the Transaction form", async () => {
    renderWithShortcuts();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "New Transaction" }));

    expect(screen.getByLabelText("New transaction account")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("submitting the New Transaction form creates a Transaction on the selected Account", async () => {
    renderWithShortcuts();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "New Transaction" }));
    await userEvent.selectOptions(screen.getByLabelText("New transaction account"), "2");
    await userEvent.type(screen.getByLabelText("Description"), "Paycheck");
    await userEvent.type(screen.getByLabelText("Amount"), "100");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "create_transaction",
        expect.objectContaining({ account_id: 2, description: "Paycheck" }),
      ),
    );
  });

  it("Cmd+N opens the New Transaction panel", async () => {
    renderWithShortcuts();
    await findMemoCell("Coffee shop");

    expect(screen.queryByLabelText("New transaction account")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(await screen.findByLabelText("New transaction account")).toBeInTheDocument();
  });

  it("Escape closes the New Transaction panel", async () => {
    renderWithShortcuts();
    await findMemoCell("Coffee shop");

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await screen.findByLabelText("New transaction account");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("New transaction account")).not.toBeInTheDocument();
  });

  it("autoOpenNew opens the panel on mount and reports back that it handled it (Command Palette bridge, #77)", async () => {
    const onAutoOpenNewHandled = vi.fn();
    renderWithShortcuts({ autoOpenNew: true, onAutoOpenNewHandled });
    await findMemoCell("Coffee shop");

    expect(await screen.findByLabelText("New transaction account")).toBeInTheDocument();
    expect(onAutoOpenNewHandled).toHaveBeenCalled();
  });

  it("Delete deletes the single checkbox-selected Transaction (via the existing per-row delete action)", async () => {
    renderWithShortcuts();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByLabelText("Select Coffee shop"));
    fireEvent.keyDown(window, { key: "Delete" });

    await userEvent.click(await screen.findByRole("button", { name: "Delete Transaction" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_transaction", { id: 1 }));
  });

  it("Delete does nothing when more than one row is selected (avoids stacking confirmation dialogs)", async () => {
    renderWithShortcuts();
    await findMemoCell("Coffee shop");
    await findMemoCell("Interest");

    await userEvent.click(screen.getByLabelText("Select Coffee shop"));
    await userEvent.click(screen.getByLabelText("Select Interest"));
    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.queryByRole("button", { name: "Delete Transaction" })).not.toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_transaction", expect.anything());
  });
});

// Bloomberg Terminal chrome skeleton (#90, ADR-0021): the Function Bar,
// Context Bar, Quote Strip, and Status Bar replace this screen's old
// header (Account dropdown, Show-hidden checkbox, New Transaction button).
describe("AllTransactionsScreen Bloomberg chrome (#90)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedSave.mockReset();
    mockInvokeDefaults();
  });

  it("renders the Function Bar with every required chip", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    const functionBar = screen.getByRole("toolbar", { name: "Transactions actions" });
    expect(within(functionBar).getByText("CANC")).toBeInTheDocument();
    expect(within(functionBar).getByRole("button", { name: "New Transaction" })).toBeInTheDocument();
    expect(within(functionBar).getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(within(functionBar).getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(within(functionBar).getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(within(functionBar).getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(within(functionBar).getByLabelText("Show hidden")).toBeInTheDocument();
  });

  it("renders the Context Bar with the Account selector", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    expect(screen.getByLabelText("Filter by account")).toBeInTheDocument();
  });

  it("renders the Quote Strip with row count, Income, Expense, and Net", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    const quoteStrip = screen.getByRole("status", { name: "Transactions summary" });
    // Coffee shop is -$12.50, Interest is +$50.00.
    expect(within(quoteStrip).getByText("2")).toBeInTheDocument();
    expect(within(quoteStrip).getByText("$50.00")).toBeInTheDocument();
    expect(within(quoteStrip).getByText("$12.50")).toBeInTheDocument();
    expect(within(quoteStrip).getByText("$37.50")).toBeInTheDocument();
  });

  it("shows the selected Account's balance in the Quote Strip once narrowed, and hides it for All accounts", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "account_balance_cents" && (args as { account_id?: number } | undefined)?.account_id === 1) {
        return -1250;
      }
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
        case "list_tags":
          return [];
        case "list_merchants":
          return [];
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        default:
          return null;
      }
    });
    renderScreen();
    await findMemoCell("Coffee shop");

    expect(
      screen.queryByRole("status", { name: "Transactions summary" }),
    ).not.toHaveTextContent("balance");

    await userEvent.selectOptions(screen.getByLabelText("Filter by account"), "1");

    const quoteStrip = await screen.findByRole("status", { name: "Transactions summary" });
    await waitFor(() => expect(within(quoteStrip).getByText("$12.50")).toBeInTheDocument());
    expect(within(quoteStrip).getByText(/balance/i)).toBeInTheDocument();
  });

  it("renders the Status Bar with a visible-of-total count", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("CANC resets Show Hidden back off (no-op safe -- search/filters aren't wired yet)", async () => {
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
        default:
          return null;
      }
    });
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByLabelText("Show hidden"));
    await findMemoCell("Old subscription");

    await userEvent.click(screen.getByText("CANC"));

    await waitFor(() => expect(screen.queryByText("Old subscription")).not.toBeInTheDocument());
  });

  it("the New chip opens the New Transaction panel (same as the old button)", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "New Transaction" }));

    expect(screen.getByLabelText("New transaction account")).toBeInTheDocument();
  });

  it("the Import chip prompts for an Account, then hands it to onImportAccount", async () => {
    const onImportAccount = vi.fn();
    render(
      <ConfirmationProvider>
        <AllTransactionsScreen initialAccountId={null} onImportAccount={onImportAccount} />
      </ConfirmationProvider>,
      { wrapper: withBreakpoint("expanded") },
    );
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByLabelText("Import account")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Import account"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onImportAccount).toHaveBeenCalledWith(savings);
    expect(screen.queryByLabelText("Import account")).not.toBeInTheDocument();
  });

  it("the Export chip carries the existing CSV export flow", async () => {
    mockedSave.mockResolvedValue("/tmp/transactions.csv");
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "export_transactions_csv") return 2;
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
        default:
          return null;
      }
    });
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(mockedSave).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: "CSV", extensions: ["csv"] }] }),
    );
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("export_transactions_csv", {
        destination: "/tmp/transactions.csv",
      }),
    );
    expect(await screen.findByText(/Exported 2 transactions/)).toBeInTheDocument();
  });

  it("the Columns chip opens the Column Management checklist", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Columns" }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Date" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Running Balance" })).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Memo" }));
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_transaction_column_visibility",
        expect.objectContaining({
          transaction_column_visibility: expect.objectContaining({ memo: false }),
        }),
      ),
    );
  });

  // Column reorder (#94, ADR-0021 phase 5): drag handles on the grid's own
  // headers, and the Columns chip panel's Move Up/Down controls, both
  // funnel through `update_transaction_column_order` -- the sibling
  // command to `update_transaction_column_visibility` above -- so a
  // restarted app loads back the same order via `get_settings`.
  it("dragging a column header handle reorders the grid and persists the order", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    const amountHandle = screen.getByRole("button", { name: "Reorder Amount column" });
    const dateHeader = screen
      .getByRole("button", { name: "Reorder Date column" })
      .closest("span") as HTMLElement;

    fireEvent.dragStart(amountHandle);
    fireEvent.dragOver(dateHeader);
    fireEvent.drop(dateHeader);

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_transaction_column_order",
        expect.objectContaining({
          transaction_column_order: expect.arrayContaining(["amount", "date"]),
        }),
      ),
    );
    const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === "update_transaction_column_order");
    const order = (call?.[1] as { transaction_column_order: string[] }).transaction_column_order;
    expect(order.indexOf("amount")).toBeLessThan(order.indexOf("date"));

    const headers = Array.from(document.querySelectorAll(".ledger-head > span")).map((el) =>
      el.textContent?.replace("⠿", ""),
    );
    expect(headers.indexOf("Amount")).toBeLessThan(headers.indexOf("Date"));
  });

  it("loads a persisted column order on mount and reflects it in the Columns chip panel", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") {
        return {
          transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY,
          transaction_column_order: ["amount", "date", "account", "payee", "memo", "category", "tags", "running_balance"],
        };
      }
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
        case "list_tags":
          return [];
        case "list_merchants":
          return [];
        default:
          return null;
      }
    });

    renderScreen();
    await findMemoCell("Coffee shop");

    const headers = Array.from(document.querySelectorAll(".ledger-head > span")).map((el) =>
      el.textContent?.replace("⠿", ""),
    );
    expect(headers.indexOf("Amount")).toBeLessThan(headers.indexOf("Date"));

    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    const panel = screen.getByRole("menu", { name: "Column Management" });
    const rowLabels = within(panel)
      .getAllByRole("menuitemcheckbox")
      .map((el) => el.textContent?.replace("✓", "").trim());
    expect(rowLabels[0]).toBe("Amount");
    expect(rowLabels[1]).toBe("Date");
  });

  it("the Columns chip panel's Move Down control reorders and persists", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    const panel = screen.getByRole("menu", { name: "Column Management" });

    await userEvent.click(within(panel).getByRole("button", { name: "Move Date down" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_transaction_column_order",
        expect.objectContaining({
          transaction_column_order: expect.arrayContaining(["date", "account"]),
        }),
      ),
    );
    const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === "update_transaction_column_order");
    const order = (call?.[1] as { transaction_column_order: string[] }).transaction_column_order;
    expect(order.indexOf("account")).toBeLessThan(order.indexOf("date"));
  });
});

// Column filtering (#91): right-click a filterable column header for a
// distinct-values checklist (Date gets presets instead), combined with the
// Filters chip's popover (Type, Show Hidden, Clear All) and CANC. See
// src/transactions/filters.test.ts for the underlying pure-module coverage
// (predicate composition, counts, date presets) -- these tests cover the
// menu interaction and the resulting grid/Quote Strip/Status Bar state.
describe("AllTransactionsScreen column filtering", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockInvokeDefaults();
  });

  function headerSpan(label: string) {
    return screen.getByText(label, { selector: ".ledger-head span" });
  }

  it("right-clicking the Account header opens a distinct-values checklist with counts", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(headerSpan("Account"));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Checking (1)" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Savings (1)" })).toBeInTheDocument();
  });

  it("selecting a value narrows the grid and updates the Quote Strip", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(headerSpan("Account"));
    const menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Checking (1)" }));

    await waitFor(() => expect(screen.queryByText("Interest")).not.toBeInTheDocument());
    expect(memoCell("Coffee shop")).toBeInTheDocument();

    const quoteStrip = screen.getByRole("status", { name: "Transactions summary" });
    expect(within(quoteStrip).getByText("1")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("OR's multiple selected values within the same column", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(headerSpan("Account"));
    let menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Checking (1)" }));
    // Menu stays open (closeOnClick: false) for multi-select.
    menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Savings (1)" }));

    await waitFor(() => expect(memoCell("Interest")).toBeInTheDocument());
    expect(memoCell("Coffee shop")).toBeInTheDocument();
  });

  it("right-clicking the Date header shows preset ranges instead of a value list", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(headerSpan("Date"));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "This month" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Last month" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "This year" })).toBeInTheDocument();
    // "All dates" is the default preset, so it renders with the active
    // checkmark suffix.
    expect(within(menu).getByRole("menuitem", { name: "All dates ✓" })).toBeInTheDocument();
    expect(within(menu).queryByText(/\(\d+\)/)).not.toBeInTheDocument();
  });

  it("Amount, Memo, and Running Balance headers have no filter menu on right-click", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    for (const label of ["Amount", "Memo", "Running Balance"]) {
      fireEvent.contextMenu(headerSpan(label));
      // Falls through to the pre-existing Column Management checklist
      // (right-click anywhere else in the header row), not a value filter.
      const menu = screen.getByRole("menu");
      expect(within(menu).getByRole("menuitemcheckbox", { name: "Date" })).toBeInTheDocument();
      expect(within(menu).queryByText(/\(\d+\)/)).not.toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
    }
  });

  it("the Filters chip opens a popover with Type, Show Hidden, and Clear All", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Filters" }));

    const popover = screen.getByRole("dialog", { name: "Filters" });
    expect(within(popover).getByLabelText("Income")).toBeInTheDocument();
    expect(within(popover).getByLabelText("Expense")).toBeInTheDocument();
    expect(within(popover).getByLabelText("Transfer")).toBeInTheDocument();
    expect(within(popover).getByLabelText("Show Hidden")).toBeInTheDocument();
    expect(within(popover).getByRole("button", { name: "Clear All" })).toBeInTheDocument();
  });

  it("the Type facet in the Filters popover narrows the grid", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const popover = screen.getByRole("dialog", { name: "Filters" });
    await userEvent.click(within(popover).getByLabelText("Income"));

    await waitFor(() => expect(screen.queryByText("Coffee shop")).not.toBeInTheDocument());
    expect(memoCell("Interest")).toBeInTheDocument();
  });

  it("shows an active badge on the Filters chip once a filter is set", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    expect(screen.queryByLabelText(/active filters/)).not.toBeInTheDocument();

    fireEvent.contextMenu(headerSpan("Account"));
    const menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Checking (1)" }));

    expect(await screen.findByLabelText("1 active filters")).toBeInTheDocument();
  });

  it("Clear All in the Filters popover resets every filter", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(headerSpan("Account"));
    let menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Checking (1)" }));
    await waitFor(() => expect(screen.queryByText("Interest")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const popover = screen.getByRole("dialog", { name: "Filters" });
    await userEvent.click(within(popover).getByRole("button", { name: "Clear All" }));

    await waitFor(() => expect(memoCell("Interest")).toBeInTheDocument());
    expect(memoCell("Coffee shop")).toBeInTheDocument();
  });

  it("CANC clears active column and Type filters", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(headerSpan("Account"));
    const menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Checking (1)" }));
    await waitFor(() => expect(screen.queryByText("Interest")).not.toBeInTheDocument());

    await userEvent.click(screen.getByText("CANC"));

    await waitFor(() => expect(memoCell("Interest")).toBeInTheDocument());
    expect(memoCell("Coffee shop")).toBeInTheDocument();
    expect(screen.queryByLabelText(/active filters/)).not.toBeInTheDocument();
  });

  it("shows a Status Bar summary while a filter is active", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(headerSpan("Account"));
    const menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Checking (1)" }));

    await waitFor(() => expect(screen.getByText(/Account: 1/)).toBeInTheDocument());
  });
});

// Live search + single-letter grid keyboard shortcuts (#92, ADR-0020/0021):
// see src/transactions/search.test.ts for the underlying pure-module
// coverage (substring matching across Payee/description/Category/Tags) --
// these tests cover the Context Bar's live wiring, Cmd+F/Esc/CANC, the
// Quote Strip/Status Bar recomputing against the combined search+filter
// set, and the grid's j/k/x/'/'/? shortcuts (guarded against text-input
// focus).
describe("AllTransactionsScreen live search + single-letter grid shortcuts (#92)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockInvokeDefaults();
  });

  function renderWithShortcuts() {
    render(
      <ConfirmationProvider>
        <ReservedShortcutProvider onOpenSettings={vi.fn()}>
          <AllTransactionsScreen initialAccountId={null} />
        </ReservedShortcutProvider>
      </ConfirmationProvider>,
      { wrapper: withBreakpoint("expanded") },
    );
  }

  function searchInput() {
    return screen.getByLabelText("Search transactions");
  }

  it("typing in the search input narrows the grid live by Payee/description", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.type(searchInput(), "coffee");

    await waitFor(() => expect(screen.queryByText("Interest")).not.toBeInTheDocument());
    expect(memoCell("Coffee shop")).toBeInTheDocument();
  });

  it("composes search with an active column filter (AND)", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    // Narrow to Checking via the Account column filter first.
    fireEvent.contextMenu(screen.getByText("Account", { selector: ".ledger-head span" }));
    const menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Checking (1)" }));
    await waitFor(() => expect(screen.queryByText("Interest")).not.toBeInTheDocument());

    // A search term matching only the Savings-Account row (already excluded
    // by the column filter) leaves nothing visible.
    await userEvent.type(searchInput(), "interest");

    await waitFor(() => expect(screen.queryByText("Coffee shop")).not.toBeInTheDocument());
    expect(screen.getByText("0 of 2")).toBeInTheDocument();
  });

  it("recomputes the Quote Strip and reflects the search term in the Status Bar summary", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.type(searchInput(), "coffee");

    await waitFor(() => expect(screen.getByText("1 of 2")).toBeInTheDocument());
    const quoteStrip = screen.getByRole("status", { name: "Transactions summary" });
    expect(within(quoteStrip).getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/Search: "coffee"/)).toBeInTheDocument();
  });

  it("Cmd+F focuses the search input from anywhere on the screen", async () => {
    renderWithShortcuts();
    await findMemoCell("Coffee shop");

    expect(document.activeElement).not.toBe(searchInput());
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(document.activeElement).toBe(searchInput());
  });

  it("Escape clears and blurs the search input", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    const input = searchInput();
    await userEvent.type(input, "coffee");
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveValue("");
    expect(input).not.toHaveFocus();
    await waitFor(() => expect(memoCell("Interest")).toBeInTheDocument());
  });

  it("CANC also clears the search term", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.type(searchInput(), "coffee");
    await waitFor(() => expect(screen.queryByText("Interest")).not.toBeInTheDocument());

    await userEvent.click(screen.getByText("CANC"));

    expect(searchInput()).toHaveValue("");
    await waitFor(() => expect(memoCell("Interest")).toBeInTheDocument());
  });

  function accountCell(text: string) {
    return screen.getByText(text, { selector: ".cell-account" });
  }

  it("j/k move the focused grid cell down/up a row", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    // Default sort is date-desc (#93): Interest (2026-09-02, Savings) is
    // row 0, Coffee shop (2026-09-01, Checking) is row 1.
    await userEvent.click(accountCell("Savings"));
    expect(accountCell("Savings")).toHaveClass("grid-cell-focused");

    fireEvent.keyDown(accountCell("Savings"), { key: "j" });
    expect(accountCell("Checking")).toHaveClass("grid-cell-focused");

    fireEvent.keyDown(accountCell("Checking"), { key: "k" });
    expect(accountCell("Savings")).toHaveClass("grid-cell-focused");
  });

  it("x toggles the focused row's checkbox", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(accountCell("Checking"));
    expect(screen.getByLabelText("Select Coffee shop")).not.toBeChecked();

    fireEvent.keyDown(accountCell("Checking"), { key: "x" });
    expect(screen.getByLabelText("Select Coffee shop")).toBeChecked();

    fireEvent.keyDown(accountCell("Checking"), { key: "x" });
    expect(screen.getByLabelText("Select Coffee shop")).not.toBeChecked();
  });

  it("/ focuses search from the grid", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(accountCell("Checking"));
    fireEvent.keyDown(accountCell("Checking"), { key: "/" });

    expect(document.activeElement).toBe(searchInput());
  });

  it("? opens an overlay listing the grid's shortcuts", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(accountCell("Checking"));
    fireEvent.keyDown(accountCell("Checking"), { key: "?" });

    const overlay = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(overlay).getByText("j / k")).toBeInTheDocument();
    expect(within(overlay).getByText("x")).toBeInTheDocument();

    await userEvent.click(within(overlay).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
  });

  it("typing inside a grid cell editor never triggers the single-letter shortcuts", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.click(memoCell("Coffee shop"));
    const input = screen.getByLabelText("Memo for Coffee shop");
    await userEvent.type(input, "x");

    expect(screen.getByLabelText("Select Coffee shop")).not.toBeChecked();
  });

  it("typing inside the search input never triggers the single-letter shortcuts", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    const checkbox = screen.getByLabelText("Select Coffee shop");
    expect(checkbox).not.toBeChecked();

    await userEvent.type(searchInput(), "jkx?");

    // The letters land in the search input's value (narrowing the grid away
    // to nothing, since no row matches "jkx?") rather than being
    // interpreted as j/k/x/? grid shortcuts -- the Coffee shop checkbox
    // (now unmounted, since its row no longer matches) was never toggled,
    // and no shortcuts overlay opened.
    expect(searchInput()).toHaveValue("jkx?");
    expect(screen.queryByLabelText("Select Coffee shop")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
  });
});

// Sticky Date Group headers + newest-first default sort (#93, ADR-0021's
// "Date Group": Today / Yesterday / explicit dates). See
// src/transactions/dateGroups.test.ts for the underlying pure-module
// coverage (Today/Yesterday/explicit-date labeling, contiguous bucketing) --
// these tests cover the screen-level composition with search/filter
// (#91/#92) and the newest-first default itself.
describe("AllTransactionsScreen Date Groups + newest-first default sort (#93)", () => {
  const NOW = new Date("2026-09-11T12:00:00");

  // Today (2026-09-11), Yesterday (2026-09-10), and an explicit-date row
  // (2026-08-15, outside the current month so the Date column's "This
  // month" preset can be used below to narrow it away).
  const dateGroupTransactions = [
    {
      id: 1,
      account_id: 1,
      account_name: "Checking",
      date: "2026-09-11",
      amount_cents: -1250,
      description: "Coffee shop",
      category_id: null,
      hidden: false,
      merchant_name: null,
    },
    {
      id: 2,
      account_id: 1,
      account_name: "Checking",
      date: "2026-09-10",
      amount_cents: 5000,
      description: "Interest",
      category_id: null,
      hidden: false,
      merchant_name: null,
    },
    {
      id: 3,
      account_id: 1,
      account_name: "Checking",
      date: "2026-08-15",
      amount_cents: -3000,
      description: "Groceries",
      category_id: null,
      hidden: false,
      merchant_name: null,
    },
  ];

  beforeEach(() => {
    mockedInvoke.mockReset();
    vi.setSystemTime(NOW);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_all_transactions":
          return dateGroupTransactions;
        case "list_categories":
          return [];
        case "list_accounts":
          return [checking];
        case "list_transfers":
          return [];
        case "list_tags_for_account":
          return {};
        case "list_tags":
          return [];
        case "list_merchants":
          return [];
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        default:
          return null;
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function groupHeaderLabels() {
    return Array.from(document.querySelectorAll(".ledger-date-group")).map((el) => el.textContent);
  }

  function memoOrder() {
    return Array.from(document.querySelectorAll(".cell-memo")).map((el) => el.textContent);
  }

  it("defaults to newest-first (date-desc) sort on load", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    expect(memoOrder()).toEqual(["Coffee shop", "Interest", "Groceries"]);
  });

  it("renders sticky Today/Yesterday/explicit-date group headers in newest-first order", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    expect(groupHeaderLabels()).toEqual(["Today", "Yesterday", "Aug 15, 2026"]);
  });

  it("recomputes Date Groups from the narrowed row set after a live search", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.type(screen.getByLabelText("Search transactions"), "interest");

    await waitFor(() => expect(screen.queryByText("Coffee shop")).not.toBeInTheDocument());
    expect(groupHeaderLabels()).toEqual(["Yesterday"]);
  });

  it("recomputes Date Groups from the narrowed row set after a column filter", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.contextMenu(screen.getByText("Date", { selector: ".ledger-head span" }));
    const menu = screen.getByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "This month" }));

    await waitFor(() => expect(screen.queryByText("Groceries")).not.toBeInTheDocument());
    expect(groupHeaderLabels()).toEqual(["Today", "Yesterday"]);
  });

  it("an explicit header-click column sort still overrides the date-desc default for the session", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    fireEvent.click(screen.getByText("Payee", { selector: ".ledger-head span" }));

    // Ascending by Payee: Coffee shop, Groceries, Interest.
    expect(memoOrder()).toEqual(["Coffee shop", "Groceries", "Interest"]);
  });
});
