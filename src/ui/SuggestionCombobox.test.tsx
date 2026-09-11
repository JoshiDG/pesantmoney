import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SuggestionCombobox } from "./SuggestionCombobox";

const KNOWN_VALUES = ["Reimbursable", "Recurring", "Trip"];

function renderCombobox(overrides: Partial<Parameters<typeof SuggestionCombobox>[0]> = {}) {
  const props = {
    mode: "single" as const,
    knownValues: KNOWN_VALUES,
    values: [] as string[],
    ariaLabel: "Suggestion input",
    onCommit: vi.fn(),
    onCreateNew: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<SuggestionCombobox {...props} />);
  return props;
}

function ghostSuffixText() {
  const text = document.querySelector(".suggestion-ghost-suffix")?.textContent ?? "";
  return text === "" ? null : text;
}

describe("SuggestionCombobox ghost text", () => {
  it("shows the top prefix-matching known value as ghost text while typing", async () => {
    const user = userEvent.setup();
    renderCombobox();

    await user.type(screen.getByLabelText("Suggestion input"), "Re");

    // Both "Reimbursable" and "Recurring" start with "Re" -- the top
    // (first-listed) match wins.
    expect(ghostSuffixText()).toBe("imbursable");
  });

  it("updates the ghost live per keystroke as the prefix narrows to a different match", async () => {
    const user = userEvent.setup();
    renderCombobox();

    const input = screen.getByLabelText("Suggestion input");
    await user.type(input, "Rec");

    expect(ghostSuffixText()).toBe("urring");
  });

  it("shows no ghost text when nothing matches", async () => {
    const user = userEvent.setup();
    renderCombobox();

    await user.type(screen.getByLabelText("Suggestion input"), "xyz");

    expect(ghostSuffixText()).toBeNull();
  });

  it("shows no ghost text when the input is empty", () => {
    renderCombobox();

    expect(ghostSuffixText()).toBeNull();
  });
});

describe("SuggestionCombobox commit keys", () => {
  it("Tab commits the ghosted value (not the literal typed text) and fires onCommit", async () => {
    const user = userEvent.setup();
    const props = renderCombobox();

    await user.type(screen.getByLabelText("Suggestion input"), "Re");
    fireEvent.keyDown(screen.getByLabelText("Suggestion input"), { key: "Tab" });

    expect(props.onCommit).toHaveBeenCalledWith("Reimbursable");
    expect(props.onCreateNew).not.toHaveBeenCalled();
  });

  it("Enter commits the ghosted value the same way Tab does", async () => {
    const user = userEvent.setup();
    const props = renderCombobox();

    await user.type(screen.getByLabelText("Suggestion input"), "Trip");
    fireEvent.keyDown(screen.getByLabelText("Suggestion input"), { key: "Enter" });

    expect(props.onCommit).toHaveBeenCalledWith("Trip");
  });

  it("commits the literal typed text via onCreateNew when nothing matches", async () => {
    const user = userEvent.setup();
    const props = renderCombobox();

    await user.type(screen.getByLabelText("Suggestion input"), "Brand New Thing");
    fireEvent.keyDown(screen.getByLabelText("Suggestion input"), { key: "Enter" });

    expect(props.onCreateNew).toHaveBeenCalledWith("Brand New Thing");
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("calls onAdvance after a commit, when the caller supplies it (grid move-to-next-cell hook)", async () => {
    const user = userEvent.setup();
    const onAdvance = vi.fn();
    const props = renderCombobox({ onAdvance });

    await user.type(screen.getByLabelText("Suggestion input"), "Trip");
    fireEvent.keyDown(screen.getByLabelText("Suggestion input"), { key: "Enter" });

    expect(props.onCommit).toHaveBeenCalledWith("Trip");
    expect(onAdvance).toHaveBeenCalled();
  });
});

describe("SuggestionCombobox Escape", () => {
  it("cancels the edit without committing or creating anything", async () => {
    const user = userEvent.setup();
    const props = renderCombobox();

    await user.type(screen.getByLabelText("Suggestion input"), "Something typed");
    fireEvent.keyDown(screen.getByLabelText("Suggestion input"), { key: "Escape" });

    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onCreateNew).not.toHaveBeenCalled();
  });

  it("clears the typed draft and ghost text on cancel", async () => {
    const user = userEvent.setup();
    renderCombobox();

    const input = screen.getByLabelText("Suggestion input") as HTMLInputElement;
    await user.type(input, "Re");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(input.value).toBe("");
    expect(ghostSuffixText()).toBeNull();
  });
});

describe("SuggestionCombobox single-select mode", () => {
  it("seeds the input with the current single value", () => {
    renderCombobox({ mode: "single", values: ["Existing Value"] });

    expect((screen.getByLabelText("Suggestion input") as HTMLInputElement).value).toBe(
      "Existing Value",
    );
  });

  it("typing a new value and committing replaces the prior selection via the commit callback", async () => {
    const user = userEvent.setup();
    const props = renderCombobox({ mode: "single", values: ["Existing Value"] });

    const input = screen.getByLabelText("Suggestion input");
    await user.clear(input);
    await user.type(input, "Trip");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onCommit).toHaveBeenCalledWith("Trip");
  });

  it("does not render any chips in single-select mode", () => {
    renderCombobox({ mode: "single", values: ["Existing Value"] });

    expect(document.querySelector(".suggestion-chip")).toBeNull();
  });
});

describe("SuggestionCombobox multi-select mode", () => {
  it("renders existing selections as chips", () => {
    renderCombobox({ mode: "multi", values: ["Trip", "GF"] });

    expect(screen.getByText("Trip", { selector: ".suggestion-chip" })).toBeInTheDocument();
    expect(screen.getByText("GF", { selector: ".suggestion-chip" })).toBeInTheDocument();
  });

  it("committing a new entry fires onCommit without clearing the existing chips (caller owns the chip list)", async () => {
    const user = userEvent.setup();
    const props = renderCombobox({ mode: "multi", values: ["Trip"], knownValues: [...KNOWN_VALUES, "GF"] });

    const input = screen.getByLabelText("Suggestion input");
    await user.type(input, "GF");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onCommit).toHaveBeenCalledWith("GF");
    expect(screen.getByText("Trip", { selector: ".suggestion-chip" })).toBeInTheDocument();
  });

  it("clears the draft input after committing a chip, ready for the next entry", async () => {
    const user = userEvent.setup();
    renderCombobox({ mode: "multi", values: [], knownValues: [...KNOWN_VALUES, "GF"] });

    const input = screen.getByLabelText("Suggestion input") as HTMLInputElement;
    await user.type(input, "GF");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input.value).toBe("");
  });

  it("supports per-chip removal via onRemove", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderCombobox({ mode: "multi", values: ["Trip", "GF"], onRemove });

    await user.click(screen.getByLabelText("Remove Trip"));

    expect(onRemove).toHaveBeenCalledWith("Trip");
  });

  it("does not fire onCommit again for an entry that duplicates an existing chip", async () => {
    const user = userEvent.setup();
    const props = renderCombobox({ mode: "multi", values: ["Trip"] });

    const input = screen.getByLabelText("Suggestion input");
    await user.type(input, "Trip");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onCreateNew).not.toHaveBeenCalled();
  });
});
