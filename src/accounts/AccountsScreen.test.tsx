import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
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

function renderScreen(overrides: Partial<Parameters<typeof AccountsScreen>[0]> = {}) {
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
        case "create_account":
        case "update_account":
        case "delete_account":
          return null;
        default:
          return null;
      }
    });
  });

  it("lists every account", async () => {
    renderScreen();

    expect(await screen.findByText("Main Checking")).toBeInTheDocument();
    expect(screen.getByText("Rainy Day")).toBeInTheDocument();
  });

  it("clicking an account row navigates to its ledger", async () => {
    const { onSelectAccount } = renderScreen();
    await screen.findByText("Main Checking");

    await userEvent.click(screen.getByText("Main Checking"));

    expect(onSelectAccount).toHaveBeenCalledWith(CHECKING);
  });

  it("clicking Import on a row invokes the import handler without navigating", async () => {
    const { onSelectAccount, onImportAccount } = renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Import" }));

    expect(onImportAccount).toHaveBeenCalledWith(CHECKING);
    expect(onSelectAccount).not.toHaveBeenCalled();
  });

  it("adding an account creates it and refreshes the list", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    await userEvent.type(screen.getByLabelText("Account name"), "New Card");
    await userEvent.click(screen.getByRole("button", { name: "Add Account" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "create_account",
        expect.objectContaining({ name: "New Card" }),
      ),
    );
  });

  it("editing an account updates it", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));

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

  it("deleting an account confirms then deletes", async () => {
    renderScreen();
    await screen.findByText("Main Checking");

    const row = screen.getByText("Main Checking").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Account" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Account" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_account", { id: 1 }));
  });
});
