import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { InvestmentsScreen } from "./InvestmentsScreen";
import { Account } from "../accounts/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const accounts: Account[] = [
  { id: 1, name: "Brokerage", account_type: "investment", institution_name: null, apr_bps: null },
  { id: 2, name: "401k", account_type: "investment", institution_name: null, apr_bps: null },
  { id: 3, name: "Checking", account_type: "checking", institution_name: null, apr_bps: null },
];

const holdings = [
  {
    id: 1,
    account_id: 1,
    account_name: "Brokerage",
    ticker: "VTI",
    quantity: 10,
    cost_basis_cents: null,
    price_cents: 25000,
    as_of_date: "2026-09-01",
    value_cents: 250000,
  },
  {
    id: 2,
    account_id: 2,
    account_name: "401k",
    ticker: "VOO",
    quantity: 3,
    cost_basis_cents: null,
    price_cents: null,
    as_of_date: null,
    value_cents: null,
  },
];

function renderScreen() {
  render(
    <ConfirmationProvider>
      <InvestmentsScreen />
    </ConfirmationProvider>,
  );
}

describe("InvestmentsScreen", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_all_holdings_with_values":
          return holdings;
        case "list_accounts":
          return accounts;
        case "create_holding":
        case "update_holding":
        case "delete_holding":
        case "set_security_price":
          return null;
        default:
          return null;
      }
    });
  });

  it("renders Holdings aggregated across every investment Account", async () => {
    renderScreen();

    await screen.findByText("VTI");
    expect(screen.getByText("VOO")).toBeInTheDocument();
    expect(document.querySelector(".cell-account")).toBeInTheDocument();
    const accountCells = Array.from(document.querySelectorAll(".cell-account")).map((el) => el.textContent);
    expect(accountCells).toEqual(["Brokerage", "401k"]);
  });

  it("shows the aggregated total value across all Accounts' Holdings", async () => {
    renderScreen();

    await screen.findByText("VTI");
    expect(document.querySelector(".holdings-total-value")).toHaveTextContent("$2,500.00");
  });

  it("creating a Holding lets the user pick which investment Account it belongs to, excluding non-investment Accounts", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const accountSelect = screen.getByLabelText("Account") as HTMLSelectElement;
    const optionLabels = Array.from(accountSelect.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["Brokerage", "401k"]);

    await userEvent.selectOptions(accountSelect, "2");
    await userEvent.type(screen.getByLabelText("Ticker"), "voo");
    await userEvent.type(screen.getByLabelText("Quantity"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("create_holding", {
        account_id: 2,
        ticker: "VOO",
        quantity: 5,
        cost_basis_cents: null,
      }),
    );
  });

  it("updating a Holding's price invokes set_security_price and refreshes", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const row = screen.getByText("VTI").closest(".holdings-row") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Update price" }));

    const priceFormRow = document.querySelector(".price-form-row") as HTMLElement;
    await userEvent.type(within(priceFormRow).getByLabelText("Price for VTI"), "260");
    await userEvent.click(within(priceFormRow).getByRole("button", { name: "Update price" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "set_security_price",
        expect.objectContaining({ ticker: "VTI", price_cents: 26000 }),
      ),
    );
  });

  it("editing a Holding invokes update_holding with the new fields", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const row = screen.getByText("VTI").closest(".holdings-row") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const editForm = document.querySelector("form.holding-form") as HTMLElement;
    const tickerInput = within(editForm).getByLabelText("Ticker") as HTMLInputElement;
    await userEvent.clear(tickerInput);
    await userEvent.type(tickerInput, "voog");
    await userEvent.click(within(editForm).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_holding",
        expect.objectContaining({ id: 1, ticker: "VOOG" }),
      ),
    );
  });

  it("deleting a Holding asks for confirmation before invoking delete_holding", async () => {
    renderScreen();
    await screen.findByText("VTI");

    const row = screen.getByText("VTI").closest(".holdings-row") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_holding", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Delete Holding" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_holding", { id: 1 }));
  });
});
