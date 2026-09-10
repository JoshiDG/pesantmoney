import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { MerchantsScreen } from "./MerchantsScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function renderScreen() {
  render(
    <ConfirmationProvider>
      <MerchantsScreen />
    </ConfirmationProvider>,
  );
}

describe("MerchantsScreen", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "list_merchants":
          return [{ id: 1, keyword: "blue bottle", merchant_name: "Blue Bottle Coffee" }];
        case "delete_merchant":
        case "create_merchant":
        case "update_merchant":
          return null;
        default:
          return null;
      }
    });
  });

  it("lists existing merchant entries", async () => {
    renderScreen();
    expect(await screen.findByText(/Blue Bottle Coffee/)).toBeInTheDocument();
  });

  it("adding a merchant calls create_merchant with the entered keyword and name", async () => {
    renderScreen();
    await screen.findByText(/Blue Bottle Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Add merchant" }));
    await userEvent.type(screen.getByLabelText("Keyword"), "starbucks");
    await userEvent.type(screen.getByLabelText("Merchant name"), "Starbucks");
    await userEvent.click(screen.getByRole("button", { name: "Add merchant" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("create_merchant", {
        keyword: "starbucks",
        merchant_name: "Starbucks",
      }),
    );
  });

  it("clicking Delete opens a confirmation panel with a verb-phrase label, not a generic one", async () => {
    renderScreen();
    await screen.findByText(/Blue Bottle Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("heading", { name: "Delete Merchant" })).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_merchant", expect.anything());
  });

  it("Cancel dismisses the panel without deleting", async () => {
    renderScreen();
    await screen.findByText(/Blue Bottle Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_merchant", expect.anything());
    expect(screen.getByText(/Blue Bottle Coffee/)).toBeInTheDocument();
  });

  it("clicking the destructive button deletes the merchant and refreshes the list", async () => {
    renderScreen();
    await screen.findByText(/Blue Bottle Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Merchant" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_merchant", { id: 1 }));
  });

  it("Enter never triggers the destructive action", async () => {
    renderScreen();
    await screen.findByText(/Blue Bottle Coffee/);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_merchant", expect.anything());
  });
});
