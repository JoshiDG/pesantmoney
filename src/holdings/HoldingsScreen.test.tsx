import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { ReservedShortcutProvider } from "../ui/ReservedShortcuts";
import { HoldingsScreen } from "./HoldingsScreen";
import { Account } from "../accounts/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const account: Account = { id: 1, name: "Brokerage", account_type: "investment", institution_name: null, apr_bps: null };

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

// Keyboard navigation + scoped single-letter shortcuts (ADR-0020 "Grid
// keyboard navigation" / issue #82). Uses two holdings so Up/Down movement
// between rows is actually observable, unlike the single-row fixture above.
describe("HoldingsScreen keyboard navigation", () => {
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
            {
              id: 2,
              account_id: 1,
              ticker: "BND",
              quantity: 5,
              cost_basis_cents: null,
              price_cents: 8000,
              as_of_date: "2026-09-01",
              value_cents: 40000,
            },
          ];
        case "delete_holding":
        case "set_security_price":
        case "update_holding":
          return null;
        default:
          return null;
      }
    });
  });

  it("ArrowDown/ArrowUp move keyboard focus between row Ticker cells", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const vtiRow = screen.getByRole("button", { name: "VTI row" });
    const bndRow = screen.getByRole("button", { name: "BND row" });

    vtiRow.focus();
    expect(vtiRow).toHaveFocus();

    fireEvent.keyDown(vtiRow, { key: "ArrowDown" });
    await waitFor(() => expect(bndRow).toHaveFocus());

    fireEvent.keyDown(bndRow, { key: "ArrowUp" });
    await waitFor(() => expect(vtiRow).toHaveFocus());
  });

  it("ArrowDown at the last row is a no-op (clamped, doesn't wrap)", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const bndRow = screen.getByRole("button", { name: "BND row" });
    bndRow.focus();

    fireEvent.keyDown(bndRow, { key: "ArrowDown" });
    await waitFor(() => expect(bndRow).toHaveFocus());
  });

  it("pressing 'p' while a row is focused opens the price form for that holding (highest-frequency shortcut)", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const bndRow = screen.getByRole("button", { name: "BND row" });
    bndRow.focus();
    fireEvent.keyDown(bndRow, { key: "p" });

    expect(await screen.findByLabelText("Price for BND")).toBeInTheDocument();
  });

  it("pressing 'e' while a row is focused opens the edit form for that holding", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const vtiRow = screen.getByRole("button", { name: "VTI row" });
    vtiRow.focus();
    fireEvent.keyDown(vtiRow, { key: "e" });

    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("does not fire the 'p' shortcut while a text input has focus", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const tickerInput = screen.getByLabelText("Ticker");
    tickerInput.focus();
    fireEvent.keyDown(tickerInput, { key: "p" });

    expect(screen.queryByLabelText("Price for VTI")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Price for BND")).not.toBeInTheDocument();
  });

  it("shift-clicking a row's checkbox selects the range from the anchor row", async () => {
    renderScreen();
    await screen.findByText("VTI");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select VTI" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select BND" }), { shiftKey: true });

    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("bulk-deletes every selected holding after confirmation", async () => {
    renderScreen();
    await screen.findByText("VTI");

    await userEvent.click(screen.getByRole("checkbox", { name: "Select VTI" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select BND" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Holdings" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_holding", { id: 1 }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_holding", { id: 2 }));
  });
});

describe("HoldingsScreen Reserved Shortcut Set wiring (#78)", () => {
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

  function renderWithShortcuts() {
    render(
      <ConfirmationProvider>
        <ReservedShortcutProvider onOpenSettings={vi.fn()}>
          <HoldingsScreen account={account} />
        </ReservedShortcutProvider>
      </ConfirmationProvider>,
    );
  }

  it("Cmd+N moves focus into the always-present create form's Ticker field", async () => {
    renderWithShortcuts();
    await screen.findByText("VTI");

    expect(screen.getByLabelText("Ticker")).not.toHaveFocus();
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(screen.getByLabelText("Ticker")).toHaveFocus();
  });

  it("Delete/Backspace bulk-deletes the current selection", async () => {
    renderWithShortcuts();
    await screen.findByText("VTI");

    await userEvent.click(screen.getByRole("checkbox", { name: "Select VTI" }));
    fireEvent.keyDown(window, { key: "Delete" });

    expect(await screen.findByRole("heading", { name: "Delete Holdings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Holdings" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_holding", { id: 1 }));
  });

  it("Delete/Backspace is a no-op with nothing selected", async () => {
    renderWithShortcuts();
    await screen.findByText("VTI");

    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.queryByRole("heading", { name: "Delete Holdings" })).not.toBeInTheDocument();
  });
});
