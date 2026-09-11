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

describe("CategoriesScreen keyboard navigation (ADR-0020, #76 grid-nav primitive)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_category_groups":
          return [{ id: 1, name: "Food" }];
        case "list_categories":
          return [
            { id: 10, group_id: 1, name: "Groceries" },
            { id: 11, group_id: 1, name: "Dining" },
          ];
        case "delete_category":
          return null;
        default:
          return null;
      }
    });
  });

  it("ArrowDown moves keyboard focus from one category row to the next", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    const firstRow = screen.getByText("Groceries").closest("li")!;
    const secondRow = screen.getByText("Dining").closest("li")!;
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: "ArrowDown" });

    expect(secondRow).toHaveFocus();
  });

  it("ArrowUp moves keyboard focus back to the previous category row", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    const firstRow = screen.getByText("Groceries").closest("li")!;
    const secondRow = screen.getByText("Dining").closest("li")!;
    secondRow.focus();
    fireEvent.keyDown(secondRow, { key: "ArrowUp" });

    expect(firstRow).toHaveFocus();
  });

  it("bare 'e' on a keyboard-focused row opens it for editing", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    const row = screen.getByText("Groceries").closest("li")!;
    row.focus();
    fireEvent.keyDown(row, { key: "e" });

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("'e' does not fire while a text input (the row's own selection checkbox) has focus", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    const checkbox = screen.getByLabelText("Select Groceries");
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: "e" });

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("clicking a checkbox then shift-clicking another selects the range in between", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    fireEvent.click(screen.getByLabelText("Select Groceries"));
    fireEvent.click(screen.getByLabelText("Select Dining"), { shiftKey: true });

    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("Delete selected removes every selected category after one confirmation", async () => {
    renderScreen();
    await screen.findByText("Groceries");

    fireEvent.click(screen.getByLabelText("Select Groceries"));
    fireEvent.click(screen.getByLabelText("Select Dining"));
    await userEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Categories" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_category", { id: 10 }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_category", { id: 11 }));
  });
});
