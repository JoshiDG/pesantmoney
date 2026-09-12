import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReservedShortcutProvider, useReservedShortcuts } from "./ReservedShortcuts";

function Screen({
  onNew,
  onFocusSearch,
  onCloseModal,
  onDeleteSelection,
}: {
  onNew?: () => void;
  onFocusSearch?: () => void;
  onCloseModal?: () => boolean;
  onDeleteSelection?: () => void;
}) {
  useReservedShortcuts({ onNew, onFocusSearch, onCloseModal, onDeleteSelection });
  return (
    <div>
      <input aria-label="a text input" />
    </div>
  );
}

function renderWithProvider(props: Parameters<typeof Screen>[0], onOpenSettings = vi.fn()) {
  render(
    <ReservedShortcutProvider onOpenSettings={onOpenSettings}>
      <Screen {...props} />
    </ReservedShortcutProvider>,
  );
  return { onOpenSettings };
}

describe("ReservedShortcutProvider", () => {
  it("fires onNew for Cmd+N", () => {
    const onNew = vi.fn();
    renderWithProvider({ onNew });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("fires onNew for Ctrl+N (Windows/Linux fallback)", () => {
    const onNew = vi.fn();
    renderWithProvider({ onNew });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("fires onFocusSearch for Cmd+F", () => {
    const onFocusSearch = vi.fn();
    renderWithProvider({ onFocusSearch });
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenSettings for Cmd+, regardless of screen handlers", () => {
    const { onOpenSettings } = renderWithProvider({});
    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("fires onCloseModal for Cmd+W", () => {
    const onCloseModal = vi.fn(() => true);
    renderWithProvider({ onCloseModal });
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    expect(onCloseModal).toHaveBeenCalledTimes(1);
  });

  it("fires onCloseModal for Escape", () => {
    const onCloseModal = vi.fn(() => true);
    renderWithProvider({ onCloseModal });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseModal).toHaveBeenCalledTimes(1);
  });

  it("fires onDeleteSelection for Delete and Backspace", () => {
    const onDeleteSelection = vi.fn();
    renderWithProvider({ onDeleteSelection });
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(onDeleteSelection).toHaveBeenCalledTimes(2);
  });

  it("does not fire onNew/onFocusSearch/onCloseModal/onDeleteSelection while a text input has focus", () => {
    const onNew = vi.fn();
    const onFocusSearch = vi.fn();
    const onCloseModal = vi.fn(() => true);
    const onDeleteSelection = vi.fn();
    renderWithProvider({ onNew, onFocusSearch, onCloseModal, onDeleteSelection });

    const input = screen.getByLabelText("a text input");
    input.focus();

    fireEvent.keyDown(input, { key: "n", metaKey: true });
    fireEvent.keyDown(input, { key: "f", metaKey: true });
    fireEvent.keyDown(input, { key: "w", metaKey: true });
    fireEvent.keyDown(input, { key: "Delete" });
    fireEvent.keyDown(input, { key: "Backspace" });

    expect(onNew).not.toHaveBeenCalled();
    expect(onFocusSearch).not.toHaveBeenCalled();
    expect(onCloseModal).not.toHaveBeenCalled();
    expect(onDeleteSelection).not.toHaveBeenCalled();
  });

  it("still fires onCloseModal for Escape while a text input has focus (input-aware)", () => {
    const onCloseModal = vi.fn(() => true);
    renderWithProvider({ onCloseModal });

    const input = screen.getByLabelText("a text input");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCloseModal).toHaveBeenCalledTimes(1);
  });

  it("does nothing for reserved keys when no handler is registered for that action", () => {
    // No throw, no crash -- a screen with no "new record"/search/delete
    // concept simply omits the handler.
    renderWithProvider({});
    expect(() => {
      fireEvent.keyDown(window, { key: "n", metaKey: true });
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.keyDown(window, { key: "w", metaKey: true });
      fireEvent.keyDown(window, { key: "Delete" });
    }).not.toThrow();
  });

  it("hands control back to no-op handlers once the screen unmounts", () => {
    const onNew = vi.fn();
    const onOpenSettings = vi.fn();
    const { unmount } = render(
      <ReservedShortcutProvider onOpenSettings={onOpenSettings}>
        <Screen onNew={onNew} />
      </ReservedShortcutProvider>,
    );
    unmount();
    expect(() => fireEvent.keyDown(window, { key: "n", metaKey: true })).not.toThrow();
    expect(onNew).not.toHaveBeenCalled();
  });
});
