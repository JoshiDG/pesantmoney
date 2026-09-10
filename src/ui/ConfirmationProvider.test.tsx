import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConfirmationProvider, useConfirmation } from "./ConfirmationProvider";

function Harness() {
  const { confirm } = useConfirmation();
  const [result, setResult] = useState<string>("idle");

  async function trigger() {
    setResult("pending");
    const confirmed = await confirm({
      title: "Delete Account",
      message: 'Delete the account "Checking"? This cannot be undone.',
      confirmLabel: "Delete Account",
    });
    setResult(confirmed ? "confirmed" : "cancelled");
  }

  return (
    <div>
      <button type="button" onClick={trigger}>
        Open
      </button>
      <p data-testid="result">{result}</p>
    </div>
  );
}

function renderHarness() {
  render(
    <ConfirmationProvider>
      <Harness />
    </ConfirmationProvider>,
  );
}

describe("ConfirmationProvider", () => {
  it("renders the panel with the screen-supplied title, message, and verb-phrase confirm label", async () => {
    renderHarness();
    await userEvent.click(screen.getByText("Open"));

    expect(screen.getByRole("heading", { name: "Delete Account" })).toBeInTheDocument();
    expect(screen.getByText('Delete the account "Checking"? This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("clicking Cancel dismisses the panel and resolves the promise false, without side effects", async () => {
    renderHarness();
    await userEvent.click(screen.getByText("Open"));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByTestId("result")).toHaveTextContent("cancelled");
    expect(screen.queryByRole("button", { name: "Delete Account" })).not.toBeInTheDocument();
  });

  it("pressing Escape dismisses the panel and resolves the promise false", async () => {
    renderHarness();
    await userEvent.click(screen.getByText("Open"));

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("cancelled"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("pressing Enter triggers Cancel, never the destructive action, regardless of focus", async () => {
    renderHarness();
    await userEvent.click(screen.getByText("Open"));

    const destructiveButton = screen.getByRole("button", { name: "Delete Account" });
    destructiveButton.focus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("cancelled"));
  });

  it("clicking the destructive button resolves the promise true", async () => {
    renderHarness();
    await userEvent.click(screen.getByText("Open"));

    await userEvent.click(screen.getByRole("button", { name: "Delete Account" }));

    expect(screen.getByTestId("result")).toHaveTextContent("confirmed");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
