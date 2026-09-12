import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { withBreakpoint } from "../ui/withBreakpoint";
import { AccountsScreen } from "./AccountsScreen";
import { Account } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const CHECKING: Account = {
  id: 1,
  name: "Main Checking",
  account_type: "checking",
  institution_name: "First Bank",
  apr_bps: null,
};

const SAVINGS: Account = {
  id: 2,
  name: "Rainy Day",
  account_type: "savings",
  institution_name: null,
  apr_bps: null,
};

function renderScreen(
  overrides: Partial<Parameters<typeof AccountsScreen>[0]> = {},
  tier: "expanded" | "compact" | "mobile" = "expanded",
) {
  const onSelectAccount = vi.fn();
  const onImportAccount = vi.fn();
  const onAccountUpdated = vi.fn();
  const onAccountDeleted = vi.fn();
  render(
    <ConfirmationProvider>
      <AccountsScreen
        onSelectAccount={onSelectAccount}
        onImportAccount={onImportAccount}
        onAccountUpdated={onAccountUpdated}
        onAccountDeleted={onAccountDeleted}
        {...overrides}
      />
    </ConfirmationProvider>,
    { wrapper: withBreakpoint(tier) },
  );
  return { onSelectAccount, onImportAccount, onAccountUpdated, onAccountDeleted };
}

describe("AccountsScreen", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_accounts":
          return [CHECKING, SAVINGS];
        case "get_net_worth_by_account":
          return [[CHECKING, 125000], [SAVINGS, 50000]];
        case "account_balance_cents":
          return 0;
        case "create_account":
        case "update_account":
        case "delete_account":
          return null;
        default:
          return null;
      }
    });
  });

  it("lists every account with account type and balance", async () => {
    renderScreen();

    expect(await screen.findByText("Main Checking")).toBeInTheDocument();
    expect(screen.getByText("Rainy Day")).toBeInTheDocument();
    expect(screen.getByText("Checking", { selector: ".account-type-badge" })).toBeInTheDocument();
    expect(screen.getByText("Savings", { selector: ".account-type-badge" })).toBeInTheDocument();
    expect(screen.getByText("$1,250.00")).toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
  });

  it("top action toolbar supports filtering accounts by type via custom dropdown", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const filterBtn = screen.getByRole("button", { name: "Filter accounts by type" });
    await userEvent.click(filterBtn);

    const checkingOpt = screen.getByRole("option", { name: "Checking" });
    await userEvent.click(checkingOpt);

    expect(screen.getByText("Main Checking")).toBeInTheDocument();
    expect(screen.queryByText("Rainy Day")).not.toBeInTheDocument();
  });

  it("top action toolbar supports sorting accounts by balance via custom dropdown", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const sortBtn = screen.getByRole("button", { name: "Sort accounts" });
    await userEvent.click(sortBtn);

    const sortOpt = screen.getByRole("option", { name: "Balance (Low to High)" });
    await userEvent.click(sortOpt);

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Rainy Day");
    expect(items[1]).toHaveTextContent("Main Checking");
  });

  it("top action toolbar refresh button re-fetches account list", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const refreshBtn = screen.getByRole("button", { name: "Refresh accounts" });
    await userEvent.click(refreshBtn);

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_accounts"));
  });

  it("clicking an account row navigates to its ledger", async () => {
    const { onSelectAccount } = renderScreen();
    await screen.findByText("Main Checking");

    await userEvent.click(screen.getByText("Main Checking"));

    expect(onSelectAccount).toHaveBeenCalledWith(CHECKING);
  });

  it("right-clicking a row opens custom context menu with options", async () => {
    const { onSelectAccount, onImportAccount } = renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("View Transactions")).toBeInTheDocument();
    expect(screen.getByText("Import CSV")).toBeInTheDocument();
    expect(screen.getByText("Edit Account")).toBeInTheDocument();
    expect(screen.getByText("Delete Account")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Import CSV"));

    expect(onImportAccount).toHaveBeenCalledWith(CHECKING);
    expect(onSelectAccount).not.toHaveBeenCalled();
  });

  it("clicking action menu button (•••) opens context menu", async () => {
    const { onImportAccount } = renderScreen();
    await screen.findByText("Main Checking");

    const trigger = screen.getByRole("button", { name: "Actions for Main Checking" });
    await userEvent.click(trigger);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Import CSV"));

    expect(onImportAccount).toHaveBeenCalledWith(CHECKING);
  });

  it("adding an account creates it and refreshes the list", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    await userEvent.click(screen.getByRole("button", { name: /Add account/i }));
    await userEvent.type(screen.getByLabelText("Account name"), "New Card");
    await userEvent.click(screen.getByRole("button", { name: "Add Account" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "create_account",
        expect.objectContaining({ name: "New Card" }),
      ),
    );
  });

  it("editing an account updates it via context menu", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    fireEvent.contextMenu(row);
    await userEvent.click(screen.getByText("Edit Account"));

    const nameInput = screen.getByLabelText("Account name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Updated Checking");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_account",
        expect.objectContaining({ id: 1, name: "Updated Checking" }),
      ),
    );
  });

  it("deleting an account confirms then deletes via context menu", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    fireEvent.contextMenu(row);
    await userEvent.click(screen.getByText("Delete Account"));

    expect(screen.getByRole("heading", { name: "Delete Account" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Account" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_account", { id: 1 }));
  });

  it("renders the formal table row layout at Expanded tier", async () => {
    renderScreen({}, "expanded");
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    expect(row).toHaveClass("account-row");
    expect(row).not.toHaveClass("account-card");
  });

  it("renders each account as a stacked card at Mobile tier, with key fields", async () => {
    renderScreen({}, "mobile");
    await screen.findByText("Main Checking");

    const card = screen.getByText("Main Checking").closest("li")!;
    expect(card).toHaveClass("account-card");
    expect(card).not.toHaveClass("account-row");
    expect(within(card).getByText("Main Checking")).toBeInTheDocument();
    expect(within(card).getByText("First Bank")).toBeInTheDocument();
  });
});

describe("AccountsScreen keyboard navigation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_accounts":
          return [CHECKING, SAVINGS];
        case "get_net_worth_by_account":
          return [[CHECKING, 125000], [SAVINGS, 50000]];
        case "account_balance_cents":
          return 0;
        case "create_account":
        case "update_account":
        case "delete_account":
          return null;
        default:
          return null;
      }
    });
  });

  it("ArrowDown moves keyboard focus from the first row to the second row", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const firstRow = screen.getByText("Main Checking").closest("li")!;
    const secondRow = screen.getByText("Rainy Day").closest("li")!;
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: "ArrowDown" });

    expect(secondRow).toHaveFocus();
  });

  it("ArrowUp moves keyboard focus back to the previous row and clamps at the top", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const firstRow = screen.getByText("Main Checking").closest("li")!;
    const secondRow = screen.getByText("Rainy Day").closest("li")!;
    secondRow.focus();
    fireEvent.keyDown(secondRow, { key: "ArrowUp" });
    expect(firstRow).toHaveFocus();

    fireEvent.keyDown(firstRow, { key: "ArrowUp" });
    expect(firstRow).toHaveFocus();
  });

  it("'e' on a focused row jumps to editing that account", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    row.focus();
    fireEvent.keyDown(row, { key: "e" });

    expect(await screen.findByLabelText("Account name")).toHaveValue("Main Checking");
  });

  it("'t' on a focused row jumps to that account's Transactions view", async () => {
    const { onSelectAccount } = renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Rainy Day").closest("li")!;
    row.focus();
    fireEvent.keyDown(row, { key: "t" });

    expect(onSelectAccount).toHaveBeenCalledWith(SAVINGS);
  });

  it("does not treat 'e'/'t' as shortcuts while a text input has focus", async () => {
    const { onSelectAccount } = renderScreen();
    await screen.findByText("Main Checking");

    // Open the inline edit form for the first account -- its "Account name"
    // input is a real text input, so keystrokes typed into it must not be
    // reinterpreted as the grid's scoped single-letter shortcuts.
    const row = screen.getByText("Main Checking").closest("li")!;
    fireEvent.contextMenu(row);
    await userEvent.click(screen.getByText("Edit Account"));

    const nameInput = screen.getByLabelText("Account name");
    fireEvent.keyDown(nameInput, { key: "t" });

    expect(onSelectAccount).not.toHaveBeenCalled();
  });

  it("toggles a row's selection via its checkbox, and clears via the selection bar", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const checkbox = screen.getByRole("checkbox", { name: "Select Main Checking" });
    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(checkbox).not.toBeChecked();
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  });

  it("selecting a row's checkbox does not also navigate to its ledger", async () => {
    const { onSelectAccount } = renderScreen();
    await screen.findByText("Main Checking");

    const checkbox = screen.getByRole("checkbox", { name: "Select Main Checking" });
    fireEvent.click(checkbox);

    expect(onSelectAccount).not.toHaveBeenCalled();
  });

  it("'x' on a focused row toggles its selection", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    row.focus();
    fireEvent.keyDown(row, { key: "x" });

    expect(screen.getByRole("checkbox", { name: "Select Main Checking" })).toBeChecked();
  });

  it("the header checkbox selects and deselects every account", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const selectAll = screen.getByRole("checkbox", { name: "Select all accounts" });
    await userEvent.click(selectAll);

    expect(screen.getByRole("checkbox", { name: "Select Main Checking" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Rainy Day" })).toBeChecked();

    await userEvent.click(selectAll);

    expect(screen.getByRole("checkbox", { name: "Select Main Checking" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Rainy Day" })).not.toBeChecked();
  });
});
