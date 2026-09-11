import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { AllRecurringScreen } from "./AllRecurringScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const accounts = [
  { id: 1, name: "Checking", account_type: "checking", institution_name: null, apr_bps: null },
  { id: 2, name: "Savings", account_type: "savings", institution_name: null, apr_bps: null },
];

const categories = [{ id: 10, group_id: 1, name: "Subscriptions" }];

const allItems = [
  {
    id: 1,
    account_id: 1,
    account_name: "Checking",
    description: "Streaming service",
    amount_cents: -1500,
    frequency: "monthly",
    next_expected_date: "2026-10-01",
    category_id: 10,
    is_confirmed: true,
  },
  {
    id: 2,
    account_id: 2,
    account_name: "Savings",
    description: "Gym membership",
    amount_cents: -4000,
    frequency: "monthly",
    next_expected_date: "2026-10-05",
    category_id: 10,
    is_confirmed: false,
  },
];

function renderScreen() {
  render(
    <ConfirmationProvider>
      <AllRecurringScreen />
    </ConfirmationProvider>,
  );
}

describe("AllRecurringScreen", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_accounts":
          return accounts;
        case "list_categories":
          return categories;
        case "detect_recurring_items":
          return [];
        case "list_all_recurring_items":
          return allItems;
        case "confirm_recurring_item":
          return null;
        case "delete_recurring_item":
          return null;
        case "update_recurring_item":
          return null;
        default:
          return null;
      }
    });
  });

  it("renders Recurring Items aggregated across every mocked Account, with each row's Account visible", async () => {
    renderScreen();

    await screen.findByText("Streaming service");
    expect(screen.getByText("Gym membership")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
  });

  it("detects candidates across every Account on load", async () => {
    renderScreen();

    await screen.findByText("Streaming service");

    expect(mockedInvoke).toHaveBeenCalledWith("detect_recurring_items", { account_id: 1 });
    expect(mockedInvoke).toHaveBeenCalledWith("detect_recurring_items", { account_id: 2 });
  });

  it("Confirm invokes confirm_recurring_item and refreshes the list", async () => {
    renderScreen();
    await screen.findByText("Gym membership");

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("confirm_recurring_item", { id: 2 }));
  });

  it("Delete on a confirmed item opens a confirmation panel, then invokes delete_recurring_item", async () => {
    renderScreen();
    await screen.findByText("Streaming service");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("heading", { name: "Delete Recurring Item" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete Recurring Item" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_recurring_item", { id: 1 }));
  });

  it("Edit opens the form pre-filled and Save invokes update_recurring_item", async () => {
    renderScreen();
    await screen.findByText("Streaming service");

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("Streaming service")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_recurring_item",
        expect.objectContaining({ id: 1, description: "Streaming service" }),
      ),
    );
  });
});
