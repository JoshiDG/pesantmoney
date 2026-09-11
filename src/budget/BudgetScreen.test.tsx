import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { withBreakpoint } from "../ui/withBreakpoint";
import { BudgetScreen } from "./BudgetScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function mockBudgetData() {
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_budget_for_month":
        return [
          {
            category_id: 10,
            category_name: "Groceries",
            group_id: 1,
            group_name: "Food",
            assigned_cents: 20000,
            activity_cents: -5000,
            available_cents: 15000,
          },
        ];
      case "get_ready_to_assign":
        return 30000;
      case "assign_budget":
        return null;
      default:
        return null;
    }
  });
}

describe("BudgetScreen", () => {
  beforeEach(() => {
    mockBudgetData();
  });

  it("renders Ready to Assign and the grouped budget table (Expanded tier)", async () => {
    render(<BudgetScreen />);

    await screen.findByText("Groceries");
    expect(screen.getByText("Ready to Assign")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
  });

  it("still renders the same content and supports editing an assigned amount at Mobile tier", async () => {
    render(<BudgetScreen />, { wrapper: withBreakpoint("mobile") });

    await screen.findByText("Groceries");
    expect(screen.getByText("Ready to Assign")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "$200.00" }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "250");
    input.blur();

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "assign_budget",
        expect.objectContaining({ category_id: 10, assigned_cents: 25000 }),
      ),
    );
  });

  it("month navigation controls remain present and clickable at Mobile tier", async () => {
    render(<BudgetScreen />, { wrapper: withBreakpoint("mobile") });

    await screen.findByText("Groceries");
    const previous = screen.getByRole("button", { name: "Previous month" });
    const next = screen.getByRole("button", { name: "Next month" });
    expect(previous).toBeInTheDocument();
    expect(next).toBeInTheDocument();

    await userEvent.click(next);
    expect(mockedInvoke).toHaveBeenCalledWith("get_budget_for_month", expect.anything());
  });
});
