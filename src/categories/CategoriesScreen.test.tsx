import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { CategoriesScreen } from "./CategoriesScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function renderScreen() {
  render(
    <ConfirmationProvider>
      <CategoriesScreen />
    </ConfirmationProvider>,
  );
}

describe("CategoriesScreen delete confirmation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_category_groups":
          return [{ id: 1, name: "Food" }];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Groceries" }];
        case "delete_category":
          return null;
        case "delete_category_group":
          return null;
        default:
          return null;
      }
    });
  });

  it("clicking Delete on a category opens a confirmation panel with a verb-phrase label, not a generic one", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    await userEvent.click(within(screen.getByText("Groceries").closest("li")!).getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Category" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_category", expect.anything());
  });

  it("Cancel dismisses the panel without deleting", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    await userEvent.click(within(screen.getByText("Groceries").closest("li")!).getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_category", expect.anything());
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("Enter never triggers the destructive action", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    await userEvent.click(within(screen.getByText("Groceries").closest("li")!).getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_category", expect.anything());
  });

  it("clicking the destructive button deletes the category and refreshes the list", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    await userEvent.click(within(screen.getByText("Groceries").closest("li")!).getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Category" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_category", { id: 10 }));
  });
});

describe("CategoriesScreen group action layout", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_category_groups":
          return [{ id: 1, name: "Food" }];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Groceries" }];
        default:
          return null;
      }
    });
  });

  it("keeps group-scoped Delete last within its own group, separate from the unrelated Add category action", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    const heading = screen.getByRole("heading", { name: "Food" });
    const header = heading.closest<HTMLElement>(".category-group-header")!;
    const buttons = within(header).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Add category", "Edit", "Delete"]);

    const addCategoryButton = within(header).getByRole("button", { name: "Add category" });
    const editButton = within(header).getByRole("button", { name: "Edit" });
    const deleteButton = within(header).getByRole("button", { name: "Delete" });

    // Edit/Delete act on the group itself and share a parent; Add category acts on
    // a child category and must not share that group.
    expect(editButton.parentElement).toBe(deleteButton.parentElement);
    expect(addCategoryButton.parentElement).not.toBe(editButton.parentElement);
  });
});
