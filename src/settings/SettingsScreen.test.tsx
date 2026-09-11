import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmationProvider } from "../ui/ConfirmationProvider";
import { withBreakpoint } from "../ui/withBreakpoint";
import { SettingsScreen } from "./SettingsScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function renderScreen(tier?: "expanded" | "compact" | "mobile") {
  render(
    <ConfirmationProvider>
      <SettingsScreen />
    </ConfirmationProvider>,
    tier ? { wrapper: withBreakpoint(tier) } : undefined,
  );
}

describe("SettingsScreen tab strip", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_settings":
          return {
            update_checks_enabled: false,
            bill_notifications_enabled: false,
            overspend_notifications_enabled: false,
          };
        case "get_backup_status":
          return { outcome: "success", taken_at: "2026-09-01T00:00:00Z" };
        case "list_category_groups":
          return [{ id: 1, name: "Food" }];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Groceries" }];
        case "list_categorization_rules":
          return [
            {
              id: 1,
              field: "description",
              match_type: "contains",
              match_value: "Coffee",
              category_id: 10,
              rename_value: null,
              hide: false,
              tag_ids: [],
              priority: 1,
            },
          ];
        case "list_accounts":
          return [];
        case "list_tags":
          return [];
        case "list_merchants":
          return [{ id: 1, keyword: "blue bottle", merchant_name: "Blue Bottle Coffee" }];
        default:
          return null;
      }
    });
  });

  it("defaults to the General tab and shows today's Settings content", async () => {
    renderScreen();

    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    await screen.findByText("Enable automatic update checks");
    expect(screen.getByText("Export data")).toBeInTheDocument();
  });

  it("renders a tab strip with General, Categories, Rules, and Merchants", async () => {
    renderScreen();
    await screen.findByText("Enable automatic update checks");

    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rules" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Merchants" })).toBeInTheDocument();
  });

  it("switches to the Categories tab and renders CategoriesScreen content", async () => {
    renderScreen();
    await screen.findByText("Enable automatic update checks");

    await userEvent.click(screen.getByRole("tab", { name: "Categories" }));

    await screen.findByText("Groceries");
    expect(screen.getByRole("tab", { name: "Categories" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Enable automatic update checks")).not.toBeInTheDocument();
  });

  it("switches to the Rules tab and renders RulesScreen content", async () => {
    renderScreen();
    await screen.findByText("Enable automatic update checks");

    await userEvent.click(screen.getByRole("tab", { name: "Rules" }));

    await screen.findByText(/Coffee/);
    expect(screen.getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the Merchants tab and renders MerchantsScreen content", async () => {
    renderScreen();
    await screen.findByText("Enable automatic update checks");

    await userEvent.click(screen.getByRole("tab", { name: "Merchants" }));

    await screen.findByText(/Blue Bottle Coffee/);
    expect(screen.getByRole("tab", { name: "Merchants" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches back to General from another tab and still shows General content", async () => {
    renderScreen();
    await screen.findByText("Enable automatic update checks");

    await userEvent.click(screen.getByRole("tab", { name: "Merchants" }));
    await screen.findByText(/Blue Bottle Coffee/);

    await userEvent.click(screen.getByRole("tab", { name: "General" }));

    await screen.findByText("Enable automatic update checks");
    expect(screen.getByText("Export data")).toBeInTheDocument();
  });
});

describe("SettingsScreen at Mobile tier", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_settings":
          return {
            update_checks_enabled: false,
            bill_notifications_enabled: false,
            overspend_notifications_enabled: false,
          };
        case "get_backup_status":
          return { outcome: "success", taken_at: "2026-09-01T00:00:00Z" };
        case "list_category_groups":
          return [{ id: 1, name: "Food" }];
        case "list_categories":
          return [{ id: 10, group_id: 1, name: "Groceries" }];
        case "list_categorization_rules":
          return [];
        case "list_accounts":
          return [];
        case "list_tags":
          return [];
        case "list_merchants":
          return [{ id: 1, keyword: "blue bottle", merchant_name: "Blue Bottle Coffee" }];
        default:
          return null;
      }
    });
  });

  it("still renders all four tabs and today's General content", async () => {
    renderScreen("mobile");

    await screen.findByText("Enable automatic update checks");
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rules" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Merchants" })).toBeInTheDocument();
  });

  it("tab switching still works identically at Mobile tier", async () => {
    renderScreen("mobile");
    await screen.findByText("Enable automatic update checks");

    await userEvent.click(screen.getByRole("tab", { name: "Categories" }));

    await screen.findByText("Groceries");
    expect(screen.getByRole("tab", { name: "Categories" })).toHaveAttribute("aria-selected", "true");
  });

  it("toggling a setting still works identically at Mobile tier", async () => {
    renderScreen("mobile");
    await screen.findByText("Enable automatic update checks");

    await userEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "update_settings",
        expect.objectContaining({ update_checks_enabled: true }),
      ),
    );
  });
});
