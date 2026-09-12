import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { CommandRegistryProvider, useCommands } from "./CommandRegistry";

function Fixture({ commands }: { commands: { id: string; label: string; run: () => void }[] }) {
  useCommands("test", commands);
  return <CommandPalette />;
}

function renderPalette(commands: { id: string; label: string; run: () => void }[]) {
  render(
    <CommandRegistryProvider>
      <Fixture commands={commands} />
    </CommandRegistryProvider>,
  );
}

describe("CommandPalette", () => {
  it("is closed by default", () => {
    renderPalette([{ id: "a", label: "Dashboard", run: vi.fn() }]);
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("opens on Cmd+K and closes on Escape without side effects", () => {
    const run = vi.fn();
    renderPalette([{ id: "a", label: "Dashboard", run }]);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("opens on Ctrl+K (Windows/Linux fallback)", () => {
    renderPalette([{ id: "a", label: "Dashboard", run: vi.fn() }]);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("fuzzy-filters results as the user types", () => {
    renderPalette([
      { id: "dashboard", label: "Dashboard", run: vi.fn() },
      { id: "accounts", label: "Accounts", run: vi.fn() },
      { id: "transactions", label: "Transactions", run: vi.fn() },
    ]);
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    const input = screen.getByLabelText("Search commands");
    fireEvent.change(input, { target: { value: "acc" } });

    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Transactions")).not.toBeInTheDocument();
  });

  it("runs the selected command and closes on Enter, navigating via its run()", () => {
    const run = vi.fn();
    renderPalette([{ id: "accounts", label: "Accounts", run }]);
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    const input = screen.getByLabelText("Search commands");
    fireEvent.change(input, { target: { value: "acc" } });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("moves the active selection with arrow keys before activating with Enter", () => {
    const runA = vi.fn();
    const runB = vi.fn();
    renderPalette([
      { id: "a", label: "Alpha", run: runA },
      { id: "b", label: "Beta", run: runB },
    ]);
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(runB).toHaveBeenCalledTimes(1);
    expect(runA).not.toHaveBeenCalled();
  });

  it("clicking a result runs it", () => {
    const run = vi.fn();
    renderPalette([{ id: "a", label: "Alpha", run }]);
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.click(screen.getByText("Alpha"));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
