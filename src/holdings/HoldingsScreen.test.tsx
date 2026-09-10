import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { HoldingsScreen } from "./HoldingsScreen";
import { Account } from "../accounts/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const account: Account = { id: 1, name: "Brokerage", account_type: "investment", institution_name: null };

function renderScreen() {
  render(
    <ConfirmationProvider>
      <HoldingsScreen account={account} />
    </ConfirmationProvider>,
  );
}

describe("HoldingsScreen delete confirmation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_holdings_with_values":
          return [
            {
              id: 1,
              account_id: 1,
              ticker: "VTI",
              quantity: 10,
              cost_basis_cents: null,
              price_cents: 25000,
              as_of_date: "2026-09-01",
              value_cents: 250000,
            },
          ];
        case "delete_holding":
          return null;
        default:
          return null;
      }
    });
  });

  it("clicking Delete opens a confirmation panel with a verb-phrase label, not a generic one", async () => {
    renderScreen();
    await screen.findByText("VTI");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Holding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Holding" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_holding", expect.anything());
  });

  it("Cancel dismisses the panel without deleting", async () => {
    renderScreen();
    await screen.findByText("VTI");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_holding", expect.anything());
    expect(screen.getByText("VTI")).toBeInTheDocument();
  });

  it("Enter never triggers the destructive action", async () => {
    renderScreen();
    await screen.findByText("VTI");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_holding", expect.anything());
  });

  it("clicking the destructive button deletes the holding and refreshes the list", async () => {
    renderScreen();
    await screen.findByText("VTI");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Holding" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_holding", { id: 1 }));
  });
});
