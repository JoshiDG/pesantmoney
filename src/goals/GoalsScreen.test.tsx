import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { GoalsScreen } from "./GoalsScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function renderScreen() {
  render(
    <ConfirmationProvider>
      <GoalsScreen />
    </ConfirmationProvider>,
  );
}

describe("GoalsScreen delete confirmation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_goals_with_progress":
          return [
            {
              id: 1,
              name: "Emergency Fund",
              target_cents: 100000,
              target_date: "2026-12-31",
              linked_category_id: 10,
              linked_account_id: null,
              starting_balance_cents: null,
              progress_cents: 5000,
            },
          ];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Savings" }];
        case "list_accounts":
          return [];
        case "delete_goal":
          return null;
        default:
          return null;
      }
    });
  });

  it("clicking Delete opens a confirmation panel with a verb-phrase label, not a generic one", async () => {
    renderScreen();
    await screen.findByText("Emergency Fund");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Goal" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_goal", expect.anything());
  });

  it("Cancel dismisses the panel without deleting", async () => {
    renderScreen();
    await screen.findByText("Emergency Fund");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_goal", expect.anything());
    expect(screen.getByText("Emergency Fund")).toBeInTheDocument();
  });

  it("Enter never triggers the destructive action", async () => {
    renderScreen();
    await screen.findByText("Emergency Fund");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_goal", expect.anything());
  });

  it("clicking the destructive button deletes the goal and refreshes the list", async () => {
    renderScreen();
    await screen.findByText("Emergency Fund");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Goal" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_goal", { id: 1 }));
  });
});
