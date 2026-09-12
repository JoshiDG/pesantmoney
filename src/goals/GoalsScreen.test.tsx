import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { ReservedShortcutProvider } from "../ui/ReservedShortcuts";
import { withBreakpoint } from "../ui/withBreakpoint";
import { GoalsScreen } from "./GoalsScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function renderScreen(tier?: "expanded" | "compact" | "mobile") {
  render(
    <ConfirmationProvider>
      <GoalsScreen />
    </ConfirmationProvider>,
    tier ? { wrapper: withBreakpoint(tier) } : undefined,
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
              created_at: "2026-01-01 00:00:00",
              progress_cents: 5000,
              pace: "insufficient_data",
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

describe("GoalsScreen keyboard grid navigation and shortcuts (ADR-0020, #81)", () => {
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
              created_at: "2026-01-01 00:00:00",
              progress_cents: 5000,
              pace: "insufficient_data",
            },
            {
              id: 2,
              name: "Payoff Credit Card",
              target_cents: 0,
              target_date: "2027-06-30",
              linked_category_id: null,
              linked_account_id: 20,
              starting_balance_cents: -50000,
              created_at: "2026-01-01 00:00:00",
              progress_cents: 1000,
              pace: "insufficient_data",
            },
          ];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Savings" }];
        case "list_accounts":
          return [
            { id: 20, name: "Visa", account_type: "credit_card", institution_name: null, apr_bps: null },
          ];
        case "delete_goal":
          return null;
        default:
          return null;
      }
    });
  });

  async function renderTwoGoals() {
    renderScreen();
    await screen.findByText("Emergency Fund");
    await screen.findByText("Payoff Credit Card");
  }

  function goalCard(name: string): HTMLElement {
    return screen.getByText(name).closest('[role="gridcell"]') as HTMLElement;
  }

  it("ArrowDown moves keyboard focus from the first goal card to the next", async () => {
    await renderTwoGoals();

    const first = goalCard("Emergency Fund");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });

    expect(goalCard("Payoff Credit Card")).toHaveFocus();
  });

  it("ArrowUp moves keyboard focus back to the previous goal card", async () => {
    await renderTwoGoals();

    const second = goalCard("Payoff Credit Card");
    second.focus();
    fireEvent.keyDown(second, { key: "ArrowUp" });

    expect(goalCard("Emergency Fund")).toHaveFocus();
  });

  it("ArrowUp on the first card is a clamped no-op, not a wrap", async () => {
    await renderTwoGoals();

    const first = goalCard("Emergency Fund");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });

    expect(first).toHaveFocus();
  });

  it("the bare 'e' shortcut opens the focused goal's edit form", async () => {
    await renderTwoGoals();

    const first = goalCard("Emergency Fund");
    first.focus();
    fireEvent.keyDown(first, { key: "e" });

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("the bare 'd' shortcut opens the confirm-gated delete dialog for the focused goal, not an immediate delete", async () => {
    await renderTwoGoals();

    const first = goalCard("Emergency Fund");
    first.focus();
    fireEvent.keyDown(first, { key: "d" });

    expect(screen.getByRole("heading", { name: "Delete Goal" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_goal", expect.anything());
  });

  it("the bare 'x' shortcut toggles row selection for the focused goal, same model as Transactions' checkbox selection", async () => {
    await renderTwoGoals();

    const first = goalCard("Emergency Fund");
    first.focus();
    fireEvent.keyDown(first, { key: "x" });

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Emergency Fund")).toBeChecked();
  });

  it("single-letter shortcuts do not fire while a nested text input (e.g. the Payoff Calculator's APR field) has focus", async () => {
    await renderTwoGoals();

    const aprInput = screen.getByLabelText("APR percent");
    aprInput.focus();
    fireEvent.keyDown(aprInput, { key: "d" });

    expect(screen.queryByRole("heading", { name: "Delete Goal" })).not.toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_goal", expect.anything());
  });

  it("clicking a row's checkbox selects it and shows the bulk actions bar", async () => {
    await renderTwoGoals();

    await userEvent.click(screen.getByLabelText("Select Emergency Fund"));

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("Clear selection empties the selection and hides the bulk actions bar", async () => {
    await renderTwoGoals();

    await userEvent.click(screen.getByLabelText("Select Emergency Fund"));
    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  });
});

describe("GoalsScreen Reserved Shortcut Set wiring (#78)", () => {
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
              created_at: "2026-01-01 00:00:00",
              progress_cents: 5000,
              pace: "insufficient_data",
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

  function renderWithShortcuts() {
    render(
      <ConfirmationProvider>
        <ReservedShortcutProvider onOpenSettings={vi.fn()}>
          <GoalsScreen />
        </ReservedShortcutProvider>
      </ConfirmationProvider>,
    );
  }

  it("Cmd+N opens the Add goal form", async () => {
    renderWithShortcuts();
    await screen.findByText("Emergency Fund");

    expect(screen.queryByLabelText("Goal name")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(await screen.findByLabelText("Goal name")).toBeInTheDocument();
  });

  it("Delete/Backspace bulk-deletes the current selection", async () => {
    renderWithShortcuts();
    await screen.findByText("Emergency Fund");

    await userEvent.click(screen.getByLabelText("Select Emergency Fund"));
    fireEvent.keyDown(window, { key: "Delete" });

    expect(await screen.findByRole("heading", { name: "Delete Goals" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete 1 Goal" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_goal", { id: 1 }));
  });

  it("Delete/Backspace is a no-op with nothing selected", async () => {
    renderWithShortcuts();
    await screen.findByText("Emergency Fund");

    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.queryByRole("heading", { name: "Delete Goals" })).not.toBeInTheDocument();
  });
});

describe("GoalsScreen at Mobile tier", () => {
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
              created_at: "2026-01-01 00:00:00",
              progress_cents: 5000,
              pace: "insufficient_data",
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

  it("still renders goal cards and their Edit/Delete actions the same way as Expanded", async () => {
    renderScreen("mobile");
    await screen.findByText("Emergency Fund");

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByText(/Target/)).toBeInTheDocument();
  });

  it("Delete confirmation still works identically at Mobile tier", async () => {
    renderScreen("mobile");
    await screen.findByText("Emergency Fund");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Goal" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_goal", { id: 1 }));
  });
});
