import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
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
