import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { withBreakpoint } from "../ui/withBreakpoint";
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

function renderScreen(tier: "expanded" | "compact" | "mobile" = "expanded") {
  render(
    <ConfirmationProvider>
      <AllRecurringScreen />
    </ConfirmationProvider>,
    { wrapper: withBreakpoint(tier) },
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

// Keyboard grid navigation + scoped single-letter shortcuts (#80,
// ADR-0020's "Grid keyboard navigation"). A second Confirmed item is added
// so ArrowDown has somewhere to move focus to.
describe("AllRecurringScreen keyboard navigation", () => {
  const twoConfirmedItems = [
    ...allItems,
    {
      id: 3,
      account_id: 2,
      account_name: "Savings",
      description: "Internet",
      amount_cents: -6000,
      frequency: "monthly",
      next_expected_date: "2026-10-03",
      category_id: 10,
      is_confirmed: true,
    },
  ];

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
          return twoConfirmedItems;
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

  function row(description: string) {
    return screen.getByText(description).closest('[role="row"]') as HTMLElement;
  }

  it("ArrowDown moves focus from one Confirmed row to the next", async () => {
    renderScreen();
    await screen.findByText("Internet");

    const first = row("Streaming service");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });

    expect(row("Internet")).toHaveFocus();
  });

  it("bare 'e' on a focused Confirmed row opens it for editing", async () => {
    renderScreen();
    await screen.findByText("Streaming service");

    const item = row("Streaming service");
    item.focus();
    fireEvent.keyDown(item, { key: "e" });

    expect(screen.getByDisplayValue("Streaming service")).toBeInTheDocument();
  });

  it("bare 'c' on a focused Detected row confirms it", async () => {
    renderScreen();
    await screen.findByText("Gym membership");

    const item = row("Gym membership");
    item.focus();
    fireEvent.keyDown(item, { key: "c" });

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("confirm_recurring_item", { id: 2 }));
  });

  it("does not fire the bare-letter shortcut while a text input has focus", async () => {
    renderScreen();
    await screen.findByText("Streaming service");

    const checkbox = screen.getByRole("checkbox", { name: "Select Streaming service" });
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: "e" });

    expect(screen.queryByDisplayValue("Streaming service")).not.toBeInTheDocument();
  });

  it("Shift+click range-selects rows between the anchor and the clicked row", async () => {
    renderScreen();
    await screen.findByText("Internet");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Streaming service" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Internet" }), { shiftKey: true });

    expect(row("Streaming service")).toHaveClass("row-selected");
    expect(row("Internet")).toHaveClass("row-selected");
  });
});

describe("AllRecurringScreen at the Mobile tier", () => {
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

  it("renders each Recurring Item as a card with the same key fields as the desktop row", async () => {
    renderScreen("mobile");

    await screen.findByText("Streaming service");
    const cards = document.querySelectorAll(".recurring-card");
    expect(cards.length).toBe(2);

    const confirmedCard = screen.getByText("Streaming service").closest(".recurring-card") as HTMLElement;
    expect(within(confirmedCard).getByText("Checking")).toBeInTheDocument();
    expect(within(confirmedCard).getByText("-$15.00")).toBeInTheDocument();

    const detectedCard = screen.getByText("Gym membership").closest(".recurring-card") as HTMLElement;
    expect(within(detectedCard).getByText("Savings")).toBeInTheDocument();
  });

  it("Confirm/Edit/Delete keep working identically in card view", async () => {
    renderScreen("mobile");
    await screen.findByText("Gym membership");

    const detectedCard = screen.getByText("Gym membership").closest(".recurring-card") as HTMLElement;
    await userEvent.click(within(detectedCard).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("confirm_recurring_item", { id: 2 }));

    const confirmedCard = screen.getByText("Streaming service").closest(".recurring-card") as HTMLElement;
    await userEvent.click(within(confirmedCard).getByRole("button", { name: "Edit" }));
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
