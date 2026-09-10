import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { TransactionsScreen } from "./TransactionsScreen";
import { Account } from "../accounts/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);

const account: Account = { id: 1, name: "Checking", account_type: "checking", institution_name: null, apr_bps: null };

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
        case "list_tags_for_account":
          return {};
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

describe("TransactionsScreen CSV export", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedSave.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_transactions":
          return [];
        case "account_balance_cents":
          return 0;
        case "list_categories":
          return [];
        case "list_accounts":
          return [account];
        case "list_transfers":
          return [];
        case "list_tags_for_account":
          return {};
        case "export_transactions_csv":
          return 5;
        default:
          return null;
      }
    });
  });

  it("shows an Export CSV button next to Import", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "Import" });

    expect(screen.getByRole("button", { name: "Export CSV…" })).toBeInTheDocument();
  });

  it("clicking Export CSV opens the save dialog, invokes export_transactions_csv, and shows a success message", async () => {
    mockedSave.mockResolvedValue("/tmp/transactions.csv");
    renderScreen();
    await screen.findByRole("button", { name: "Import" });

    await userEvent.click(screen.getByRole("button", { name: "Export CSV…" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("export_transactions_csv", {
        destination: "/tmp/transactions.csv",
      }),
    );
    expect(await screen.findByText("Exported 5 transactions to /tmp/transactions.csv.")).toBeInTheDocument();
  });

  it("shows an error message if the export fails", async () => {
    mockedSave.mockResolvedValue("/tmp/transactions.csv");
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "export_transactions_csv") {
        throw "disk full";
      }
      switch (cmd) {
        case "list_transactions":
          return [];
        case "account_balance_cents":
          return 0;
        case "list_categories":
          return [];
        case "list_accounts":
          return [account];
        case "list_transfers":
          return [];
        case "list_tags_for_account":
          return {};
        default:
          return null;
      }
    });
    renderScreen();
    await screen.findByRole("button", { name: "Import" });

    await userEvent.click(screen.getByRole("button", { name: "Export CSV…" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("CSV export failed: disk full");
  });
});
