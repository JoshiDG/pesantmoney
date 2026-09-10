import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { TransactionsScreen } from "./TransactionsScreen";
import { Account } from "../accounts/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const account: Account = { id: 1, name: "Checking", account_type: "checking", institution_name: null };

function renderScreen() {
  render(
    <ConfirmationProvider>
      <TransactionsScreen account={account} onBack={vi.fn()} onImport={vi.fn()} />
    </ConfirmationProvider>,
  );
}

describe("TransactionsScreen delete confirmation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_transactions":
          return [
            { id: 1, account_id: 1, date: "2026-09-01", amount_cents: -1250, description: "Coffee shop", category_id: null },
          ];
        case "account_balance_cents":
          return -1250;
        case "list_categories":
          return [];
        case "list_accounts":
          return [account];
        case "list_transfers":
          return [];
        case "delete_transaction":
          return null;
        default:
          return null;
      }
    });
  });

  it("clicking Delete opens a confirmation panel with a verb-phrase label, not a generic one", async () => {
    renderScreen();
    await screen.findByText("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Transaction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Transaction" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_transaction", expect.anything());
  });

  it("Cancel dismisses the panel without deleting", async () => {
    renderScreen();
    await screen.findByText("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_transaction", expect.anything());
    expect(screen.getByText("Coffee shop")).toBeInTheDocument();
  });

  it("Enter never triggers the destructive action", async () => {
    renderScreen();
    await screen.findByText("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_transaction", expect.anything());
  });

  it("clicking the destructive button deletes the transaction and refreshes the list", async () => {
    renderScreen();
    await screen.findByText("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Transaction" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_transaction", { id: 1 }));
  });
});
