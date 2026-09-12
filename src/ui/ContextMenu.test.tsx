import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, ContextMenuItem } from "./ContextMenu";

const ITEMS: ContextMenuItem[] = [
  { label: "Hide", onClick: vi.fn() },
  { label: "Link transfer", onClick: vi.fn() },
  { label: "Delete", danger: true, onClick: vi.fn() },
];

function renderMenu(items: ContextMenuItem[] = ITEMS) {
  const onClose = vi.fn();
  render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);
  return { onClose };
}

describe("ContextMenu keyboard navigation", () => {
  it("opens with the first item focused", () => {
    renderMenu();

    expect(screen.getByText("Hide").closest("button")).toHaveFocus();
  });

  it("ArrowDown/ArrowUp rove focus across items, wrapping at the edges", () => {
    renderMenu();

    const hide = screen.getByText("Hide").closest("button") as HTMLButtonElement;
    const link = screen.getByText("Link transfer").closest("button") as HTMLButtonElement;
    const del = screen.getByText("Delete").closest("button") as HTMLButtonElement;

    fireEvent.keyDown(hide, { key: "ArrowDown" });
    expect(link).toHaveFocus();

    fireEvent.keyDown(link, { key: "ArrowDown" });
    expect(del).toHaveFocus();

    fireEvent.keyDown(del, { key: "ArrowDown" });
    expect(hide).toHaveFocus();

    fireEvent.keyDown(hide, { key: "ArrowUp" });
    expect(del).toHaveFocus();
  });

  it("Home/End jump to the first/last item", () => {
    renderMenu();

    const hide = screen.getByText("Hide").closest("button") as HTMLButtonElement;
    const del = screen.getByText("Delete").closest("button") as HTMLButtonElement;

    fireEvent.keyDown(hide, { key: "End" });
    expect(del).toHaveFocus();

    fireEvent.keyDown(del, { key: "Home" });
    expect(hide).toHaveFocus();
  });

  it("Escape closes the menu", () => {
    const { onClose } = renderMenu();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("clicking an item closes the menu and fires its onClick", () => {
    const { onClose } = renderMenu();
    const item = ITEMS[1];

    fireEvent.click(screen.getByText("Link transfer"));

    expect(item.onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disabled items render inert and don't fire onClick", () => {
    const onClick = vi.fn();
    renderMenu([{ label: "Unlink transfer", disabled: true, onClick }]);

    const item = screen.getByText("Unlink transfer").closest("button") as HTMLButtonElement;
    expect(item).toBeDisabled();

    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });
});
