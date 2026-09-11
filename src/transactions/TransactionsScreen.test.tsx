import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { withBreakpoint } from "../ui/withBreakpoint";
import { TransactionsScreen } from "./TransactionsScreen";
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

const account: Account = { id: 1, name: "Checking", account_type: "checking", institution_name: null, apr_bps: null };

function renderScreen() {
  render(
    <ConfirmationProvider>
      <TransactionsScreen account={account} onBack={vi.fn()} onImport={vi.fn()} />
    </ConfirmationProvider>,
    { wrapper: withBreakpoint("expanded") },
  );
}

function memoCell(text: string) {
  return screen.getByText(text, { selector: ".cell-memo" });
}

function findMemoCell(text: string) {
  return screen.findByText(text, { selector: ".cell-memo" });
}

describe("TransactionsScreen delete confirmation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_visible_transactions":
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
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "update_transaction_column_visibility":
          return null;
        case "delete_transaction":
          return null;
        default:
          return null;
      }
    });
  });

  it("clicking Delete opens a confirmation panel with a verb-phrase label, not a generic one", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Transaction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Transaction" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_transaction", expect.anything());
  });

  it("Cancel dismisses the panel without deleting", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_transaction", expect.anything());
    expect(memoCell("Coffee shop")).toBeInTheDocument();
  });

  it("Enter never triggers the destructive action", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_transaction", expect.anything());
  });

  it("clicking the destructive button deletes the transaction and refreshes the list", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Transaction" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_transaction", { id: 1 }));
  });
});

describe("TransactionsScreen Show hidden toggle (#70)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      const params = args as Record<string, unknown> | undefined;
      switch (cmd) {
        case "list_visible_transactions":
          if (params?.include_hidden) {
            return [
              { id: 1, account_id: 1, date: "2026-09-01", amount_cents: -1250, description: "Coffee shop", category_id: null, hidden: false, merchant_name: null },
              { id: 2, account_id: 1, date: "2026-09-02", amount_cents: -900, description: "Old subscription", category_id: null, hidden: true, merchant_name: null },
            ];
          }
          return [
            { id: 1, account_id: 1, date: "2026-09-01", amount_cents: -1250, description: "Coffee shop", category_id: null, hidden: false, merchant_name: null },
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

  it("defaults to off: fetches without include_hidden set, and hidden transactions are excluded", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    expect(mockedInvoke).toHaveBeenCalledWith("list_visible_transactions", {
      account_id: 1,
      include_hidden: false,
    });
    expect(screen.queryByText("Old subscription")).not.toBeInTheDocument();
  });

  it("checking Show hidden refetches with include_hidden: true and renders the hidden transaction dimmed", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await userEvent.click(screen.getByLabelText("Show hidden"));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("list_visible_transactions", {
        account_id: 1,
        include_hidden: true,
      }),
    );
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

describe("TransactionsScreen Tag editing wiring (#71)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_visible_transactions":
          return [
            { id: 1, account_id: 1, date: "2026-09-01", amount_cents: -1250, description: "Coffee shop", category_id: null, hidden: false, merchant_name: null },
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
        case "list_tags":
          return [{ id: 5, name: "Reimbursable" }];
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "update_transaction_column_visibility":
          return null;
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
  });

  it("fetches list_tags and seeds the grid's Tags editor", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_tags"));

    fireEvent.click(document.querySelector(".cell-tags") as HTMLElement);
    expect(screen.getByLabelText("Tags for Coffee shop")).toBeInTheDocument();
  });

  it("adding a known Tag name attaches it without calling create_tag", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_tags"));

    fireEvent.click(document.querySelector(".cell-tags") as HTMLElement);
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

  it("adding an unmatched Tag name calls create_tag then attaches, ungated (no confirmation)", async () => {
    renderScreen();
    await findMemoCell("Coffee shop");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("list_tags"));

    fireEvent.click(document.querySelector(".cell-tags") as HTMLElement);
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
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("TransactionsScreen CSV export", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedSave.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_visible_transactions":
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
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "update_transaction_column_visibility":
          return null;
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
        case "list_visible_transactions":
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
        case "get_settings":
          return { transaction_column_visibility: DEFAULT_COLUMN_VISIBILITY };
        case "update_transaction_column_visibility":
          return null;
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
