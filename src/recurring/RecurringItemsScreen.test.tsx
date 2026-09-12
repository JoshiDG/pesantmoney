import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { RecurringItemsScreen } from "./RecurringItemsScreen";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const account: Account = { id: 1, name: "Checking", account_type: "checking", institution_name: null, apr_bps: null };
const categories: Category[] = [{ id: 10, group_id: 1, name: "Subscriptions" }];

function renderScreen() {
  render(
    <ConfirmationProvider>
      <RecurringItemsScreen account={account} categories={categories} />
    </ConfirmationProvider>,
  );
}

describe("RecurringItemsScreen delete confirmation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "detect_recurring_items":
          return null;
        case "list_recurring_items":
          return [
            {
              id: 1,
              account_id: 1,
              description: "Streaming service",
              amount_cents: -1500,
              frequency: "monthly",
              next_expected_date: "2026-10-01",
              category_id: 10,
              is_confirmed: true,
            },
            {
              id: 2,
              account_id: 1,
              description: "Gym membership",
              amount_cents: -4000,
              frequency: "monthly",
              next_expected_date: "2026-10-05",
              category_id: 10,
              is_confirmed: false,
            },
          ];
        case "delete_recurring_item":
          return null;
        default:
          return null;
      }
    });
  });

  it("clicking Delete opens a confirmation panel with a verb-phrase label, not a generic one", async () => {
    renderScreen();
    await screen.findByText("Streaming service");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Recurring Item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Recurring Item" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_recurring_item", expect.anything());
  });

  it("Cancel dismisses the panel without deleting", async () => {
    renderScreen();
    await screen.findByText("Streaming service");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_recurring_item", expect.anything());
    expect(screen.getByText("Streaming service")).toBeInTheDocument();
  });

  it("Enter never triggers the destructive action", async () => {
    renderScreen();
    await screen.findByText("Streaming service");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_recurring_item", expect.anything());
  });

  it("clicking the destructive button deletes the item and refreshes the list", async () => {
    renderScreen();
    await screen.findByText("Streaming service");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Recurring Item" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_recurring_item", { id: 1 }));
  });

  it("clicking Dismiss on a detected item shows dismiss-specific copy, not the delete label", async () => {
    renderScreen();
    await screen.findByText("Gym membership");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Dismiss Recurring Item" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.queryByText(/Delete Recurring Item/)).not.toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_recurring_item", expect.anything());
  });
});

// Keyboard grid navigation + scoped single-letter shortcuts (#80,
// ADR-0020's "Grid keyboard navigation"). Two Confirmed rows are needed to
// exercise ArrowDown moving focus between rows -- the suite above only has
// one of each section.
describe("RecurringItemsScreen keyboard navigation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "detect_recurring_items":
          return null;
        case "list_recurring_items":
          return [
            {
              id: 1,
              account_id: 1,
              description: "Streaming service",
              amount_cents: -1500,
              frequency: "monthly",
              next_expected_date: "2026-10-01",
              category_id: 10,
              is_confirmed: true,
            },
            {
              id: 2,
              account_id: 1,
              description: "Internet",
              amount_cents: -6000,
              frequency: "monthly",
              next_expected_date: "2026-10-03",
              category_id: 10,
              is_confirmed: true,
            },
            {
              id: 3,
              account_id: 1,
              description: "Gym membership",
              amount_cents: -4000,
              frequency: "monthly",
              next_expected_date: "2026-10-05",
              category_id: 10,
              is_confirmed: false,
            },
          ];
        case "delete_recurring_item":
          return null;
        case "confirm_recurring_item":
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
    await screen.findByText("Streaming service");

    const first = row("Streaming service");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });

    expect(row("Internet")).toHaveFocus();
  });

  it("ArrowUp moves focus back to the previous Confirmed row", async () => {
    renderScreen();
    await screen.findByText("Internet");

    const second = row("Internet");
    second.focus();
    fireEvent.keyDown(second, { key: "ArrowUp" });

    expect(row("Streaming service")).toHaveFocus();
  });

  it("bare 'e' on a focused Confirmed row opens it for editing (scoped single-letter shortcut)", async () => {
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

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("confirm_recurring_item", { id: 3 }));
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
