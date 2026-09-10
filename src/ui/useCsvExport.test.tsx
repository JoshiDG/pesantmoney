import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useCsvExport } from "./useCsvExport";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);

function CsvExportHost() {
  const { exportCsv, exporting, result, error } = useCsvExport();
  return (
    <div>
      <button type="button" onClick={exportCsv} disabled={exporting}>
        {exporting ? "Exporting…" : "Export CSV…"}
      </button>
      {result && <p>{result}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

describe("useCsvExport", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedSave.mockReset();
  });

  it("renders an Export CSV button", () => {
    render(<CsvExportHost />);
    expect(screen.getByRole("button", { name: "Export CSV…" })).toBeInTheDocument();
  });

  it("clicking the button opens the save dialog and invokes export_transactions_csv", async () => {
    mockedSave.mockResolvedValue("/tmp/transactions.csv");
    mockedInvoke.mockResolvedValue(3);

    render(<CsvExportHost />);
    await userEvent.click(screen.getByRole("button", { name: "Export CSV…" }));

    expect(mockedSave).toHaveBeenCalledWith({
      defaultPath: expect.stringMatching(/^pesantmoney-transactions-\d{4}-\d{2}-\d{2}\.csv$/),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("export_transactions_csv", {
        destination: "/tmp/transactions.csv",
      }),
    );
    expect(await screen.findByText("Exported 3 transactions to /tmp/transactions.csv.")).toBeInTheDocument();
  });

  it("does not invoke the export command if the save dialog is cancelled", async () => {
    mockedSave.mockResolvedValue(null);

    render(<CsvExportHost />);
    await userEvent.click(screen.getByRole("button", { name: "Export CSV…" }));

    await waitFor(() => expect(mockedSave).toHaveBeenCalled());
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("shows an error message when the export command fails", async () => {
    mockedSave.mockResolvedValue("/tmp/transactions.csv");
    mockedInvoke.mockRejectedValue("disk full");

    render(<CsvExportHost />);
    await userEvent.click(screen.getByRole("button", { name: "Export CSV…" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});
