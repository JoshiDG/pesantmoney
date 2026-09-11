import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmCreateDialog } from "./ConfirmCreateDialog";

// A reusable "create new" confirmation dialog (#67/#72): Payee's instance is
// the simple yes/no variant exercised here. #73's Category-creation instance
// reuses the same component with `extraField` populated (a Group dropdown) --
// not exercised by this issue, but the shape below is designed for it.
describe("ConfirmCreateDialog", () => {
  it("renders the title and message, with Yes/No buttons by default", () => {
    render(
      <ConfirmCreateDialog
        title="Add to Merchant dictionary?"
        message='Add "Blue Bottle Coffee" to your Merchant dictionary for future imports?'
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Add to Merchant dictionary?" })).toBeInTheDocument();
    expect(
      screen.getByText('Add "Blue Bottle Coffee" to your Merchant dictionary for future imports?'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
  });

  it("clicking Yes calls onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmCreateDialog
        title="Add to Merchant dictionary?"
        message="Add it?"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Yes" }));

    expect(onConfirm).toHaveBeenCalled();
  });

  it("clicking No calls onCancel, not onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmCreateDialog
        title="Add to Merchant dictionary?"
        message="Add it?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "No" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("supports custom confirm/cancel labels for other callers (e.g. #73's Category flow)", () => {
    render(
      <ConfirmCreateDialog
        title="Create category?"
        message='Create category "Groceries"?'
        confirmLabel="Create"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("renders an optional extra field (e.g. a Group dropdown) when supplied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConfirmCreateDialog
        title="Create category?"
        message='Create category "Groceries"?'
        extraField={{
          label: "Group",
          value: "1",
          options: [
            { value: "1", label: "Essentials" },
            { value: "2", label: "Fun" },
          ],
          onChange,
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const select = screen.getByLabelText("Group") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("1");

    await user.selectOptions(select, "2");

    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("renders no extra field when none is supplied", () => {
    render(
      <ConfirmCreateDialog
        title="Add to Merchant dictionary?"
        message="Add it?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
