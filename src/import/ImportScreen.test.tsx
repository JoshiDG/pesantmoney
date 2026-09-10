import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ImportScreen } from "./ImportScreen";
import { Account } from "../accounts/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const account: Account = { id: 1, name: "Checking", account_type: "checking", institution_name: null, apr_bps: null };

describe("ImportScreen CSV guidelines", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_import_profiles") {
        return [];
      }
      return null;
    });
  });

  it("shows the CSV format guidelines before any file has been chosen", async () => {
    render(<ImportScreen account={account} onBack={vi.fn()} />);

    expect(await screen.findByRole("note")).toBeInTheDocument();
    expect(screen.getByText("CSV format guidelines")).toBeInTheDocument();
    expect(screen.getByText(/OFX and QFX files are auto-detected/)).toBeInTheDocument();
  });

  it("keeps the guidelines visible after a file is chosen", async () => {
    render(<ImportScreen account={account} onBack={vi.fn()} />);
    await screen.findByRole("note");

    const file = new File(["date,amount,description\n2026-01-01,-5.00,Coffee"], "transactions.csv", {
      type: "text/csv",
    });
    await userEvent.upload(screen.getByLabelText("Choose file to import"), file);

    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText("CSV format guidelines")).toBeInTheDocument();
    expect(screen.getByText(/OFX and QFX files are auto-detected/)).toBeInTheDocument();
  });
});
