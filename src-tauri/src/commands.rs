use serde::Serialize;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use crate::import::{self, ColumnMapping, ImportFormat, ImportResult, ParsedTransaction, PreviewRow, SignConvention};
use crate::services::accounts::{self, Account, AccountType};
use crate::services::backup::{self, BackupStatus};
use crate::services::budgets::{self, BudgetAssignment, CategoryBudgetLine};
use crate::services::categories::{self, Category, CategoryGroup};
use crate::services::categorization_rules::{self, CategorizationRule, MatchType, RuleActions, RuleField};
use crate::services::csv_export;
use crate::services::goals::{self, Goal, GoalWithProgress, PayoffProjection};
use crate::services::holdings::{self, Holding, HoldingWithAccount, HoldingWithValue, SecurityPrice};
use crate::services::import_profiles::{self, ImportProfile};
use crate::services::merchants::{self, Merchant};
use crate::services::notifications;
use crate::services::recurring_items::{self, Frequency, RecurringItem, RecurringItemWithAccount};
use crate::services::reports::{self, CategoryIncome, CategorySpending, MonthlyCashFlow};
use crate::services::settings::{self, Settings};
use crate::services::tags::{self, Tag};
use crate::services::transactions::{self, Transaction, TransactionWithAccount};
use crate::services::transfers::{self, Transfer};
use crate::services::gdrive::{self, GDriveBackupFile, GDriveConfig, GDriveStatus, GDriveSyncResult};
use crate::services::folder_sync::{self, FolderBackupFile, FolderSyncConfig, FolderSyncResult, FolderSyncStatus};
use crate::AppState;

/// How many days ahead a confirmed Recurring Item's `next_expected_date` can
/// be before it counts as "upcoming" for the bill notification. Not
/// currently user-configurable -- see Settings for the on/off toggles.
const BILL_NOTIFICATION_WINDOW_DAYS: i64 = 3;

type CommandResult<T> = Result<T, String>;

fn to_command_error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_account(
    state: tauri::State<AppState>,
    name: String,
    account_type: AccountType,
    institution_name: Option<String>,
) -> CommandResult<Account> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::create(&conn, &name, account_type, institution_name.as_deref())
        .map_err(to_command_error)
}

#[tauri::command]
pub fn list_accounts(state: tauri::State<AppState>) -> CommandResult<Vec<Account>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::list(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_account(
    state: tauri::State<AppState>,
    id: i64,
    name: String,
    account_type: AccountType,
    institution_name: Option<String>,
) -> CommandResult<Account> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::update(&conn, id, &name, account_type, institution_name.as_deref())
        .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_account(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::delete(&conn, id).map_err(to_command_error)
}

/// Sets (or clears, with `apr_bps: null`) a debt Account's APR -- the manual
/// input the payoff projection calculator (`project_debt_payoff`) reads.
/// Never fetched or inferred; see ADR-0003 / ADR-0016.
#[tauri::command(rename_all = "snake_case")]
pub fn set_account_apr(
    state: tauri::State<AppState>,
    id: i64,
    apr_bps: Option<i64>,
) -> CommandResult<Account> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::set_apr(&conn, id, apr_bps).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_transaction(
    state: tauri::State<AppState>,
    account_id: i64,
    date: String,
    amount_cents: i64,
    description: String,
    category_id: Option<i64>,
) -> CommandResult<Transaction> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::create(&conn, account_id, &date, amount_cents, &description, category_id)
        .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_transactions(
    state: tauri::State<AppState>,
    account_id: i64,
) -> CommandResult<Vec<Transaction>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::list_for_account(&conn, account_id).map_err(to_command_error)
}

/// Backs the all-Accounts Transactions view (#51): every Transaction across
/// every Account, each carrying its Account's name. Alongside
/// `list_transactions`, not a replacement -- Import and per-Account balance
/// display keep calling `list_transactions` unchanged.
#[tauri::command(rename_all = "snake_case")]
pub fn list_all_transactions(state: tauri::State<AppState>) -> CommandResult<Vec<TransactionWithAccount>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::list_all_with_accounts(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_transaction(
    state: tauri::State<AppState>,
    id: i64,
    date: String,
    amount_cents: i64,
    description: String,
    category_id: Option<i64>,
) -> CommandResult<Transaction> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::update(&conn, id, &date, amount_cents, &description, category_id)
        .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_transaction(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::delete(&conn, id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn account_balance_cents(state: tauri::State<AppState>, account_id: i64) -> CommandResult<i64> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::balance_cents(&conn, account_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_net_worth(state: tauri::State<AppState>) -> CommandResult<i64> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::net_worth_cents(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_net_worth_by_account(state: tauri::State<AppState>) -> CommandResult<Vec<(Account, i64)>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::net_worth_by_account(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_cash_flow_for_range(
    state: tauri::State<AppState>,
    account_id: Option<i64>,
    start_date: String,
    end_date: String,
) -> CommandResult<(i64, i64)> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::income_expense_totals_for_range(&conn, account_id, &start_date, &end_date)
        .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_net_worth_as_of(state: tauri::State<AppState>, date: String) -> CommandResult<i64> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::net_worth_as_of(&conn, &date).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_daily_cash_flow_for_range(
    state: tauri::State<AppState>,
    account_id: Option<i64>,
    start_date: String,
    end_date: String,
) -> CommandResult<Vec<(String, i64, i64)>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::daily_income_expense_totals_for_range(&conn, account_id, &start_date, &end_date)
        .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_monthly_cash_flow_for_range(
    state: tauri::State<AppState>,
    start_month: String,
    end_month: String,
) -> CommandResult<Vec<MonthlyCashFlow>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    reports::monthly_cash_flow_for_range(&conn, &start_month, &end_month).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_spending_by_category_for_range(
    state: tauri::State<AppState>,
    start_month: String,
    end_month: String,
) -> CommandResult<Vec<CategorySpending>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    reports::spending_by_category_for_range(&conn, &start_month, &end_month).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_income_by_category_for_range(
    state: tauri::State<AppState>,
    start_date: String,
    end_date: String,
) -> CommandResult<Vec<CategoryIncome>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    reports::income_by_category_for_range(&conn, &start_date, &end_date).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_category_group(state: tauri::State<AppState>, name: String) -> CommandResult<CategoryGroup> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categories::create_group(&conn, &name).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_category_groups(state: tauri::State<AppState>) -> CommandResult<Vec<CategoryGroup>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categories::list_groups(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_category_group(
    state: tauri::State<AppState>,
    id: i64,
    name: String,
) -> CommandResult<CategoryGroup> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categories::update_group(&conn, id, &name).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_category_group(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categories::delete_group(&conn, id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_category(
    state: tauri::State<AppState>,
    group_id: i64,
    name: String,
) -> CommandResult<Category> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categories::create(&conn, group_id, &name).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_categories(state: tauri::State<AppState>) -> CommandResult<Vec<Category>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categories::list(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_category(
    state: tauri::State<AppState>,
    id: i64,
    group_id: i64,
    name: String,
) -> CommandResult<Category> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categories::update(&conn, id, group_id, &name).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_category(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categories::delete(&conn, id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn create_import_profile(
    state: tauri::State<AppState>,
    institution_name: String,
    date_column: i64,
    amount_column: i64,
    description_column: i64,
    sign_convention: SignConvention,
    has_header_row: bool,
) -> CommandResult<ImportProfile> {
    let conn = state.db.lock().map_err(to_command_error)?;
    import_profiles::create(
        &conn,
        &institution_name,
        date_column,
        amount_column,
        description_column,
        sign_convention,
        has_header_row,
    )
    .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn create_recurring_item(
    state: tauri::State<AppState>,
    account_id: i64,
    description: String,
    amount_cents: i64,
    frequency: Frequency,
    next_expected_date: String,
    category_id: Option<i64>,
) -> CommandResult<RecurringItem> {
    let conn = state.db.lock().map_err(to_command_error)?;
    recurring_items::create(
        &conn,
        account_id,
        &description,
        amount_cents,
        frequency,
        &next_expected_date,
        category_id,
    )
    .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_import_profiles(state: tauri::State<AppState>) -> CommandResult<Vec<ImportProfile>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    import_profiles::list(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn preview_import(
    state: tauri::State<AppState>,
    account_id: i64,
    file_contents: String,
    format: ImportFormat,
    mapping: Option<ColumnMapping>,
    profile_id: Option<i64>,
) -> CommandResult<Vec<PreviewRow>> {
    let conn = state.db.lock().map_err(to_command_error)?;

    // A saved Import Profile (by id) and an inline mapping are two ways to
    // supply the same thing; an inline mapping wins if both are somehow
    // given, since it reflects what's currently on screen.
    let resolved_mapping = match mapping {
        Some(mapping) => Some(mapping),
        None => match profile_id {
            Some(profile_id) => Some(
                import_profiles::get(&conn, profile_id)
                    .map_err(to_command_error)?
                    .ok_or_else(|| "Import profile not found".to_string())?
                    .to_column_mapping(),
            ),
            None => None,
        },
    };

    import::preview_import(&conn, account_id, &file_contents, format, resolved_mapping.as_ref())
        .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn commit_import(
    state: tauri::State<AppState>,
    account_id: i64,
    transactions: Vec<ParsedTransaction>,
) -> CommandResult<ImportResult> {
    let conn = state.db.lock().map_err(to_command_error)?;
    import::commit_import(&conn, account_id, transactions).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn link_transfer(
    state: tauri::State<AppState>,
    from_transaction_id: i64,
    to_transaction_id: i64,
) -> CommandResult<Transfer> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transfers::link(&conn, from_transaction_id, to_transaction_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn unlink_transfer(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transfers::unlink(&conn, id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_transfers(state: tauri::State<AppState>) -> CommandResult<Vec<Transfer>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transfers::list(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn suggest_transfer_matches(
    state: tauri::State<AppState>,
    account_id: i64,
) -> CommandResult<Vec<(Transaction, Transaction)>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transfers::suggest_matches(&conn, account_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn income_expense_totals(
    state: tauri::State<AppState>,
    account_id: Option<i64>,
) -> CommandResult<(i64, i64)> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::income_expense_totals(&conn, account_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn assign_budget(
    state: tauri::State<AppState>,
    category_id: i64,
    month: String,
    assigned_cents: i64,
) -> CommandResult<BudgetAssignment> {
    let conn = state.db.lock().map_err(to_command_error)?;
    budgets::assign(&conn, category_id, &month, assigned_cents).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_budget_for_month(
    state: tauri::State<AppState>,
    month: String,
) -> CommandResult<Vec<CategoryBudgetLine>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    budgets::list_budget_for_month(&conn, &month).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_ready_to_assign(state: tauri::State<AppState>, month: String) -> CommandResult<i64> {
    let conn = state.db.lock().map_err(to_command_error)?;
    budgets::ready_to_assign_cents(&conn, &month).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_recurring_items(
    state: tauri::State<AppState>,
    account_id: i64,
) -> CommandResult<Vec<RecurringItem>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    recurring_items::list_for_account(&conn, account_id).map_err(to_command_error)
}

/// Backs the all-Accounts Recurring screen (#52): every Recurring Item
/// across every Account, each carrying its Account's name. Alongside
/// `list_recurring_items`, not a replacement -- detection still runs per
/// Account and keeps calling `recurring_items::list_for_account` internally
/// unchanged.
#[tauri::command(rename_all = "snake_case")]
pub fn list_all_recurring_items(
    state: tauri::State<AppState>,
) -> CommandResult<Vec<RecurringItemWithAccount>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    recurring_items::list_all_with_accounts(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_recurring_item(
    state: tauri::State<AppState>,
    id: i64,
    description: String,
    amount_cents: i64,
    frequency: Frequency,
    next_expected_date: String,
    category_id: Option<i64>,
) -> CommandResult<RecurringItem> {
    let conn = state.db.lock().map_err(to_command_error)?;
    recurring_items::update(
        &conn,
        id,
        &description,
        amount_cents,
        frequency,
        &next_expected_date,
        category_id,
    )
    .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_recurring_item(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    recurring_items::delete(&conn, id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn confirm_recurring_item(state: tauri::State<AppState>, id: i64) -> CommandResult<RecurringItem> {
    let conn = state.db.lock().map_err(to_command_error)?;
    recurring_items::confirm(&conn, id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn detect_recurring_items(
    state: tauri::State<AppState>,
    account_id: i64,
) -> CommandResult<Vec<RecurringItem>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    recurring_items::detect_candidates(&conn, account_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_goal(
    state: tauri::State<AppState>,
    name: String,
    target_cents: i64,
    target_date: String,
    linked_category_id: Option<i64>,
    linked_account_id: Option<i64>,
) -> CommandResult<Goal> {
    let conn = state.db.lock().map_err(to_command_error)?;
    goals::create(
        &conn,
        &name,
        target_cents,
        &target_date,
        linked_category_id,
        linked_account_id,
    )
    .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_goals_with_progress(state: tauri::State<AppState>) -> CommandResult<Vec<GoalWithProgress>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    goals::list_with_progress(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_goal(
    state: tauri::State<AppState>,
    id: i64,
    name: String,
    target_cents: i64,
    target_date: String,
) -> CommandResult<Goal> {
    let conn = state.db.lock().map_err(to_command_error)?;
    goals::update(&conn, id, &name, target_cents, &target_date).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_goal(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    goals::delete(&conn, id).map_err(to_command_error)
}

/// Projects a debt-free date for `account_id` given a hypothetical
/// `monthly_payment_cents` -- a recompute-on-demand what-if calculator (see
/// the "Payoff Projection" term in CONTEXT.md / ADR-0016). Never persists
/// the payment amount and never touches Goal progress.
#[tauri::command(rename_all = "snake_case")]
pub fn project_debt_payoff(
    state: tauri::State<AppState>,
    account_id: i64,
    monthly_payment_cents: i64,
) -> CommandResult<PayoffProjection> {
    let conn = state.db.lock().map_err(to_command_error)?;
    goals::project_account_payoff(&conn, account_id, monthly_payment_cents).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn upcoming_recurring_items(
    state: tauri::State<AppState>,
    account_id: i64,
    within_days: i64,
) -> CommandResult<Vec<RecurringItem>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    let as_of = chrono::Local::now().format("%Y-%m-%d").to_string();
    recurring_items::upcoming(&conn, account_id, &as_of, within_days).map_err(to_command_error)
}

/// Dashboard-facing sibling of `upcoming_recurring_items`: spans every
/// Account rather than one, for the Recurring widget's "upcoming across all
/// accounts" view.
#[tauri::command(rename_all = "snake_case")]
pub fn upcoming_recurring_items_all(
    state: tauri::State<AppState>,
    within_days: i64,
) -> CommandResult<Vec<RecurringItem>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    let as_of = chrono::Local::now().format("%Y-%m-%d").to_string();
    recurring_items::upcoming_all(&conn, &as_of, within_days).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_holding(
    state: tauri::State<AppState>,
    account_id: i64,
    ticker: String,
    quantity: f64,
    cost_basis_cents: Option<i64>,
) -> CommandResult<Holding> {
    let conn = state.db.lock().map_err(to_command_error)?;
    holdings::create_holding(&conn, account_id, &ticker, quantity, cost_basis_cents)
        .map_err(to_command_error)
}

/// Resolves `tag_names` (create-if-not-exists, per issue #38 -- there's no
/// dedicated Tag management screen) into ids for a rule's tag action.
fn resolve_tag_names(conn: &rusqlite::Connection, tag_names: &[String]) -> rusqlite::Result<Vec<i64>> {
    tag_names.iter().map(|name| tags::get_or_create(conn, name).map(|tag| tag.id)).collect()
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn create_categorization_rule(
    state: tauri::State<AppState>,
    field: RuleField,
    match_type: MatchType,
    match_value: String,
    category_id: Option<i64>,
    rename_value: Option<String>,
    hide: bool,
    tag_names: Vec<String>,
    priority: i64,
) -> CommandResult<CategorizationRule> {
    let conn = state.db.lock().map_err(to_command_error)?;
    let tag_ids = resolve_tag_names(&conn, &tag_names).map_err(to_command_error)?;
    categorization_rules::create(
        &conn,
        field,
        match_type,
        &match_value,
        RuleActions {
            category_id,
            rename_value,
            hide,
            tag_ids,
        },
        priority,
    )
    .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_holdings(state: tauri::State<AppState>, account_id: i64) -> CommandResult<Vec<Holding>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    holdings::list_holdings_for_account(&conn, account_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_holding(
    state: tauri::State<AppState>,
    id: i64,
    ticker: String,
    quantity: f64,
    cost_basis_cents: Option<i64>,
) -> CommandResult<Holding> {
    let conn = state.db.lock().map_err(to_command_error)?;
    holdings::update_holding(&conn, id, &ticker, quantity, cost_basis_cents).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_holding(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    holdings::delete_holding(&conn, id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_security_price(
    state: tauri::State<AppState>,
    ticker: String,
    price_cents: i64,
    as_of_date: String,
) -> CommandResult<SecurityPrice> {
    let conn = state.db.lock().map_err(to_command_error)?;
    holdings::set_price(&conn, &ticker, price_cents, &as_of_date).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_latest_price(state: tauri::State<AppState>, ticker: String) -> CommandResult<Option<SecurityPrice>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    holdings::latest_price(&conn, &ticker).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_holdings_with_values(
    state: tauri::State<AppState>,
    account_id: i64,
) -> CommandResult<Vec<HoldingWithValue>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    holdings::list_holdings_with_values(&conn, account_id).map_err(to_command_error)
}

/// All-Accounts sibling of `list_holdings_with_values` for the top-level
/// Investments screen (#53) -- returns Holdings from every investment
/// Account with Account-identifying metadata per row, alongside (not
/// replacing) the existing per-Account query above.
#[tauri::command(rename_all = "snake_case")]
pub fn list_all_holdings_with_values(state: tauri::State<AppState>) -> CommandResult<Vec<HoldingWithAccount>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    holdings::list_all_holdings_with_values(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_categorization_rules(state: tauri::State<AppState>) -> CommandResult<Vec<CategorizationRule>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categorization_rules::list(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn update_categorization_rule(
    state: tauri::State<AppState>,
    id: i64,
    field: RuleField,
    match_type: MatchType,
    match_value: String,
    category_id: Option<i64>,
    rename_value: Option<String>,
    hide: bool,
    tag_names: Vec<String>,
    priority: i64,
) -> CommandResult<CategorizationRule> {
    let conn = state.db.lock().map_err(to_command_error)?;
    let tag_ids = resolve_tag_names(&conn, &tag_names).map_err(to_command_error)?;
    categorization_rules::update(
        &conn,
        id,
        field,
        match_type,
        &match_value,
        RuleActions {
            category_id,
            rename_value,
            hide,
            tag_ids,
        },
        priority,
    )
    .map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_categorization_rule(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categorization_rules::delete(&conn, id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn apply_categorization_rules(
    state: tauri::State<AppState>,
    account_id: Option<i64>,
) -> CommandResult<usize> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categorization_rules::apply_to_uncategorized(&conn, account_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_merchant(
    state: tauri::State<AppState>,
    keyword: String,
    merchant_name: String,
) -> CommandResult<Merchant> {
    let conn = state.db.lock().map_err(to_command_error)?;
    merchants::create(&conn, &keyword, &merchant_name)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_merchants(state: tauri::State<AppState>) -> CommandResult<Vec<Merchant>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    merchants::list(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_merchant(
    state: tauri::State<AppState>,
    id: i64,
    keyword: String,
    merchant_name: String,
) -> CommandResult<Merchant> {
    let conn = state.db.lock().map_err(to_command_error)?;
    merchants::update(&conn, id, &keyword, &merchant_name)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_merchant(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    merchants::delete(&conn, id).map_err(to_command_error)
}

/// Grid-editable Payee (#72, ADR-0019): a new, on-demand, single-Transaction
/// writer to `merchant_name`, alongside (not replacing) the existing
/// import-time-only writers -- Merchant-dictionary match and Categorization
/// Rule rename (ADR-0011/ADR-0012). Kept as its own command rather than
/// folded into `update_transaction` so that command's existing callers
/// (date/amount/description/category edits) are unaffected by this new
/// field -- they don't need to start passing a `merchant_name` they have no
/// opinion about. `merchant_name: None` clears the Payee override, falling
/// back to `description` per the Payee glossary entry.
#[tauri::command(rename_all = "snake_case")]
pub fn set_transaction_merchant_name(
    state: tauri::State<AppState>,
    id: i64,
    merchant_name: Option<String>,
) -> CommandResult<Transaction> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::set_merchant_name(&conn, id, merchant_name.as_deref()).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_transaction_hidden(
    state: tauri::State<AppState>,
    id: i64,
    hidden: bool,
) -> CommandResult<Transaction> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::set_hidden(&conn, id, hidden).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_visible_transactions(
    state: tauri::State<AppState>,
    account_id: i64,
    include_hidden: bool,
) -> CommandResult<Vec<Transaction>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::list_visible_for_account(&conn, account_id, include_hidden).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_tags(state: tauri::State<AppState>) -> CommandResult<Vec<Tag>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    tags::list_all(&conn).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_tags_for_transaction(state: tauri::State<AppState>, transaction_id: i64) -> CommandResult<Vec<Tag>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    tags::list_for_transaction(&conn, transaction_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_tags_for_account(
    state: tauri::State<AppState>,
    account_id: i64,
) -> CommandResult<std::collections::HashMap<i64, Vec<Tag>>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    tags::map_for_account(&conn, account_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_tag(state: tauri::State<AppState>, name: String) -> CommandResult<Tag> {
    let conn = state.db.lock().map_err(to_command_error)?;
    tags::get_or_create(&conn, &name).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn attach_tag_to_transaction(
    state: tauri::State<AppState>,
    transaction_id: i64,
    tag_id: i64,
) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    tags::attach(&conn, transaction_id, tag_id).map_err(to_command_error)
}

#[tauri::command(rename_all = "snake_case")]
pub fn detach_tag_from_transaction(
    state: tauri::State<AppState>,
    transaction_id: i64,
    tag_id: i64,
) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    tags::detach(&conn, transaction_id, tag_id).map_err(to_command_error)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
}

#[tauri::command]
pub fn get_settings(state: tauri::State<AppState>) -> CommandResult<Settings> {
    Ok(settings::load(&state.app_data_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_settings(
    state: tauri::State<AppState>,
    update_checks_enabled: bool,
    bill_notifications_enabled: bool,
    overspend_notifications_enabled: bool,
) -> CommandResult<Settings> {
    // Preserves `transaction_column_visibility` (set via the separate
    // `update_transaction_column_visibility` command below) rather than
    // resetting it to defaults every time the Settings screen saves one of
    // these three toggles.
    let mut new_settings = settings::load(&state.app_data_dir);
    new_settings.update_checks_enabled = update_checks_enabled;
    new_settings.bill_notifications_enabled = bill_notifications_enabled;
    new_settings.overspend_notifications_enabled = overspend_notifications_enabled;
    settings::save(&state.app_data_dir, &new_settings).map_err(to_command_error)?;
    Ok(new_settings)
}

/// Column Management (#68): persists the Transactions grid's Column Set
/// visibility choices. A separate command from `update_settings` (rather
/// than adding a parameter there) because it's set from the Transactions
/// grid's header context menu, not the Settings screen -- same
/// load-mutate-save pattern as `update_settings`, just merging one field
/// into the currently-saved `Settings` instead of requiring every field.
#[tauri::command(rename_all = "snake_case")]
pub fn update_transaction_column_visibility(
    state: tauri::State<AppState>,
    transaction_column_visibility: settings::TransactionColumnVisibility,
) -> CommandResult<Settings> {
    let mut new_settings = settings::load(&state.app_data_dir);
    new_settings.transaction_column_visibility = transaction_column_visibility;
    settings::save(&state.app_data_dir, &new_settings).map_err(to_command_error)?;
    Ok(new_settings)
}

/// Column reorder (#94, ADR-0021 phase 5): persists the Transactions grid's
/// Column Set left-to-right order, alongside `transaction_column_visibility`
/// above. Same load-mutate-save pattern as
/// `update_transaction_column_visibility` -- a separate command since it's
/// set from drag-reorder on the grid's own headers or the Columns chip's
/// up/down controls, not the Settings screen.
#[tauri::command(rename_all = "snake_case")]
pub fn update_transaction_column_order(
    state: tauri::State<AppState>,
    transaction_column_order: Vec<String>,
) -> CommandResult<Settings> {
    let mut new_settings = settings::load(&state.app_data_dir);
    new_settings.transaction_column_order = transaction_column_order;
    settings::save(&state.app_data_dir, &new_settings).map_err(to_command_error)?;
    Ok(new_settings)
}

/// Evaluates the upcoming-bill and category-overspend conditions (see
/// `services::notifications`) and fires a native OS notification for each
/// one that just became true and hasn't already been notified. Intended to
/// be polled periodically by the frontend (on launch and on an interval)
/// while the app is running -- there is no background daemon, so nothing
/// fires while the app is closed.
///
/// Returns the number of notifications fired, mostly for the frontend to log
/// / test against; the frontend does not need to do anything else with it.
#[tauri::command]
pub fn run_notification_check(app: tauri::AppHandle, state: tauri::State<AppState>) -> CommandResult<usize> {
    let conn = state.db.lock().map_err(to_command_error)?;
    let settings = settings::load(&state.app_data_dir);

    if !settings.bill_notifications_enabled && !settings.overspend_notifications_enabled {
        return Ok(0);
    }

    let now = chrono::Local::now();
    let as_of = now.format("%Y-%m-%d").to_string();
    let month = now.format("%Y-%m").to_string();

    let candidates = notifications::pending(
        &conn,
        &as_of,
        BILL_NOTIFICATION_WINDOW_DAYS,
        &month,
        settings.bill_notifications_enabled,
        settings.overspend_notifications_enabled,
    )
    .map_err(to_command_error)?;

    for candidate in &candidates {
        let (title, body) = candidate.title_and_body();
        // A failed notification (e.g. OS-level permission denied) shouldn't
        // stop the rest of the batch or surface as an app error -- the
        // condition stays logged as "notified" either way, matching how a
        // user who dismisses/misses a real OS notification isn't re-shown it.
        let _ = app.notification().builder().title(title).body(body).show();
    }

    Ok(candidates.len())
}

/// Checks GitHub Releases (via the Tauri updater plugin) for a newer version.
/// Network failures, missing manifests, etc. are surfaced as a normal
/// `CommandResult` error string rather than panicking, so a user with no
/// network connection just sees "couldn't check for updates" in the UI.
///
/// Gated on the stored `update_checks_enabled` preference here, not just in
/// the frontend's button visibility, so a disabled user gets no network call
/// no matter what invokes this command.
#[tauri::command]
pub async fn check_for_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<UpdateCheckResult> {
    let update_checks_enabled = settings::load(&state.app_data_dir).update_checks_enabled;
    if !update_checks_enabled {
        return Err("Update checks are disabled in Settings.".to_string());
    }

    let current_version = app.package_info().version.to_string();

    let updater = app.updater().map_err(to_command_error)?;
    let update = updater.check().await.map_err(to_command_error)?;

    Ok(match update {
        Some(update) => UpdateCheckResult {
            available: true,
            current_version,
            latest_version: Some(update.version),
        },
        None => UpdateCheckResult {
            available: false,
            current_version,
            latest_version: None,
        },
    })
}

/// The outcome of the automatic rolling backup taken once at app launch, for
/// display in Settings. A failure here (disk full, permission denied, etc.)
/// never blocks startup, but it must still be visible to the user rather
/// than silently disappearing into a log no one reads.
#[tauri::command]
pub fn get_backup_status(state: tauri::State<AppState>) -> CommandResult<BackupStatus> {
    let status = state.last_backup.lock().map_err(to_command_error)?;
    Ok(status.clone())
}

/// Copies the SQLite database file to a user-chosen `destination`, for the
/// manual "Export data" action in Settings. `destination` is a full file
/// path, normally chosen via a native save dialog on the frontend. A plain
/// file copy is sufficient given ADR-0006 (no app-level encryption) and
/// ADR-0005 (single device, no sync) — there's no structured format to
/// preserve beyond the database itself.
///
/// Holds the database lock for the duration of the copy so no write from
/// elsewhere in the app lands mid-copy, and surfaces any I/O failure (disk
/// full, permission denied, invalid path) as a normal `CommandResult` error
/// rather than failing silently.
#[tauri::command(rename_all = "snake_case")]
pub fn export_data(state: tauri::State<AppState>, destination: String) -> CommandResult<()> {
    let _conn = state.db.lock().map_err(to_command_error)?;
    backup::export_to(&state.db_path, std::path::Path::new(&destination)).map_err(to_command_error)
}

/// Writes every Transaction across every Account to `destination` as a
/// portable, human-readable CSV file — an alternative to [`export_data`]'s
/// raw database-file copy, for a user who wants to open their transactions
/// in a spreadsheet or import them into another tool. Returns the number of
/// rows written so the frontend can confirm the export succeeded.
#[tauri::command(rename_all = "snake_case")]
pub fn export_transactions_csv(state: tauri::State<AppState>, destination: String) -> CommandResult<usize> {
    let conn = state.db.lock().map_err(to_command_error)?;
    csv_export::export_transactions_csv(&conn, std::path::Path::new(&destination)).map_err(to_command_error)
}

#[tauri::command]
pub fn get_gdrive_status(state: tauri::State<AppState>) -> CommandResult<GDriveStatus> {
    Ok(gdrive::get_status(&state.app_data_dir))
}

#[tauri::command]
pub fn start_gdrive_auth(state: tauri::State<AppState>) -> CommandResult<String> {
    gdrive::start_oauth_listener(state.app_data_dir.clone())
}

#[tauri::command(rename_all = "snake_case")]
pub fn exchange_gdrive_code(
    state: tauri::State<AppState>,
    code: String,
    redirect_uri: String,
    client_id: Option<String>,
    client_secret: Option<String>,
) -> CommandResult<GDriveConfig> {
    gdrive::exchange_auth_code(
        &state.app_data_dir,
        &code,
        &redirect_uri,
        client_id.as_deref(),
        client_secret.as_deref(),
    )
}

#[tauri::command]
pub fn disconnect_gdrive(state: tauri::State<AppState>) -> CommandResult<()> {
    gdrive::disconnect(&state.app_data_dir).map_err(to_command_error)
}

#[tauri::command]
pub fn sync_gdrive_now(state: tauri::State<AppState>) -> CommandResult<GDriveSyncResult> {
    let _conn = state.db.lock().map_err(to_command_error)?;
    Ok(gdrive::sync_now(&state.db_path, &state.app_data_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_gdrive_auto_sync(state: tauri::State<AppState>, enabled: bool) -> CommandResult<GDriveConfig> {
    gdrive::update_auto_sync(&state.app_data_dir, enabled).map_err(to_command_error)
}

#[tauri::command]
pub fn list_gdrive_backups(state: tauri::State<AppState>) -> CommandResult<Vec<GDriveBackupFile>> {
    gdrive::list_remote_backups(&state.app_data_dir)
}

#[tauri::command(rename_all = "snake_case")]
pub fn restore_gdrive_backup(state: tauri::State<AppState>, file_id: String) -> CommandResult<()> {
    let _conn = state.db.lock().map_err(to_command_error)?;
    gdrive::restore_remote_backup(&state.db_path, &state.app_data_dir, &file_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_gdrive_credentials(
    state: tauri::State<AppState>,
    client_id: String,
    client_secret: String,
) -> CommandResult<GDriveConfig> {
    gdrive::update_credentials(&state.app_data_dir, client_id, client_secret).map_err(to_command_error)
}

#[tauri::command]
pub fn get_folder_sync_status(state: tauri::State<AppState>) -> CommandResult<FolderSyncStatus> {
    Ok(folder_sync::get_status(&state.app_data_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_folder_sync_path(
    state: tauri::State<AppState>,
    folder_path: Option<String>,
) -> CommandResult<FolderSyncConfig> {
    folder_sync::set_sync_folder(&state.app_data_dir, folder_path).map_err(to_command_error)
}

#[tauri::command]
pub fn sync_folder_now(state: tauri::State<AppState>) -> CommandResult<FolderSyncResult> {
    let _conn = state.db.lock().map_err(to_command_error)?;
    Ok(folder_sync::sync_now(&state.db_path, &state.app_data_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_folder_auto_sync(state: tauri::State<AppState>, enabled: bool) -> CommandResult<FolderSyncConfig> {
    folder_sync::update_auto_sync(&state.app_data_dir, enabled).map_err(to_command_error)
}

#[tauri::command]
pub fn list_folder_backups(state: tauri::State<AppState>) -> CommandResult<Vec<FolderBackupFile>> {
    folder_sync::list_backups(&state.app_data_dir)
}

#[tauri::command(rename_all = "snake_case")]
pub fn restore_folder_backup(state: tauri::State<AppState>, file_path: String) -> CommandResult<()> {
    let _conn = state.db.lock().map_err(to_command_error)?;
    folder_sync::restore_backup(&state.db_path, &state.app_data_dir, &file_path)
}



