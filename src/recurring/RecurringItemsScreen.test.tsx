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

const account: Account = { id: 1, name: "Checking", account_type: "checking", institution_name: null };
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
