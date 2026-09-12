import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { ReservedShortcutProvider } from "../ui/ReservedShortcuts";
import { RulesScreen } from "./RulesScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function renderScreen() {
  render(
    <ConfirmationProvider>
      <RulesScreen />
    </ConfirmationProvider>,
  );
}

describe("RulesScreen delete confirmation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_categorization_rules":
          return [
            {
              id: 1,
              field: "description",
              match_type: "contains",
              match_value: "Coffee",
              category_id: 10,
              rename_value: null,
              hide: false,
              tag_ids: [],
              priority: 1,
            },
          ];
        case "list_accounts":
          return [];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Food" }];
        case "list_tags":
          return [];
        case "delete_categorization_rule":
          return null;
        default:
          return null;
      }
    });
  });

  it("clicking Delete opens a confirmation panel with a verb-phrase label, not a generic one", async () => {
    renderScreen();
    await screen.findByText(/Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Rule" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Rule" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_categorization_rule", expect.anything());
  });

  it("Cancel dismisses the panel without deleting", async () => {
    renderScreen();
    await screen.findByText(/Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_categorization_rule", expect.anything());
    expect(screen.getByText(/Coffee/)).toBeInTheDocument();
  });

  it("Enter never triggers the destructive action", async () => {
    renderScreen();
    await screen.findByText(/Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_categorization_rule", expect.anything());
  });

  it("clicking the destructive button deletes the rule and refreshes the list", async () => {
    renderScreen();
    await screen.findByText(/Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Rule" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_categorization_rule", { id: 1 }));
  });
});

describe("RulesScreen keyboard navigation (ADR-0020, #76 grid-nav primitive)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_categorization_rules":
          return [
            {
              id: 1,
              field: "description",
              match_type: "contains",
              match_value: "Coffee",
              category_id: 10,
              rename_value: null,
              hide: false,
              tag_ids: [],
              priority: 1,
            },
            {
              id: 2,
              field: "description",
              match_type: "contains",
              match_value: "Rent",
              category_id: 10,
              rename_value: null,
              hide: false,
              tag_ids: [],
              priority: 2,
            },
          ];
        case "list_accounts":
          return [];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Food" }];
        case "list_tags":
          return [];
        case "delete_categorization_rule":
          return null;
        default:
          return null;
      }
    });
  });

  it("ArrowDown moves keyboard focus from one rule row to the next", async () => {
    renderScreen();
    await screen.findByText(/Coffee/);

    const firstRow = screen.getByText(/Coffee/).closest("li")!;
    const secondRow = screen.getByText(/Rent/).closest("li")!;
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: "ArrowDown" });

    expect(secondRow).toHaveFocus();
  });

  it("bare 'e' on a keyboard-focused row opens it for editing", async () => {
    renderScreen();
    await screen.findByText(/Coffee/);

    const row = screen.getByText(/Coffee/).closest("li")!;
    row.focus();
    fireEvent.keyDown(row, { key: "e" });

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("'e' does not fire while a text input (the row's own selection checkbox) has focus", async () => {
    renderScreen();
    await screen.findByText(/Coffee/);

    const checkbox = screen.getByLabelText("Select rule for Coffee");
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: "e" });

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("Delete selected removes every selected rule after one confirmation", async () => {
    renderScreen();
    await screen.findByText(/Coffee/);

    fireEvent.click(screen.getByLabelText("Select rule for Coffee"));
    fireEvent.click(screen.getByLabelText("Select rule for Rent"));
    await userEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Rules" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_categorization_rule", { id: 1 }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_categorization_rule", { id: 2 }));
  });
});

describe("RulesScreen Reserved Shortcut Set wiring (#78)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_categorization_rules":
          return [
            {
              id: 1,
              field: "description",
              match_type: "contains",
              match_value: "Coffee",
              category_id: 10,
              rename_value: null,
              hide: false,
              tag_ids: [],
              priority: 1,
            },
          ];
        case "list_accounts":
          return [];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Food" }];
        case "list_tags":
          return [];
        case "delete_categorization_rule":
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
          <RulesScreen />
        </ReservedShortcutProvider>
      </ConfirmationProvider>,
    );
  }

  it("Cmd+N opens the Add rule form", async () => {
    renderWithShortcuts();
    await screen.findByText(/Coffee/);

    expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(await screen.findByLabelText("Priority")).toBeInTheDocument();
  });

  it("Delete/Backspace bulk-deletes the current selection", async () => {
    renderWithShortcuts();
    await screen.findByText(/Coffee/);

    await userEvent.click(screen.getByRole("checkbox", { name: /Select rule/ }));
    fireEvent.keyDown(window, { key: "Delete" });

    expect(await screen.findByRole("heading", { name: "Delete Rules" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Rules" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_categorization_rule", { id: 1 }));
  });

  it("Delete/Backspace is a no-op with nothing selected", async () => {
    renderWithShortcuts();
    await screen.findByText(/Coffee/);

    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.queryByRole("heading", { name: "Delete Rules" })).not.toBeInTheDocument();
  });
});
