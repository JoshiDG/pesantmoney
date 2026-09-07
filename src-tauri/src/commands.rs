use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

use crate::import::{self, ColumnMapping, ImportFormat, ImportResult, ParsedTransaction, PreviewRow, SignConvention};
use crate::services::accounts::{self, Account, AccountType};
use crate::services::backup::{self, BackupStatus};
use crate::services::budgets::{self, BudgetAssignment, CategoryBudgetLine};
use crate::services::categories::{self, Category, CategoryGroup};
use crate::services::categorization_rules::{self, CategorizationRule, MatchType, RuleField};
use crate::services::goals::{self, Goal, GoalWithProgress};
use crate::services::holdings::{self, Holding, HoldingWithValue, SecurityPrice};
use crate::services::import_profiles::{self, ImportProfile};
use crate::services::recurring_items::{self, Frequency, RecurringItem};
use crate::services::settings::{self, Settings};
use crate::services::transactions::{self, Transaction};
use crate::services::transfers::{self, Transfer};
use crate::AppState;

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

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn create_categorization_rule(
    state: tauri::State<AppState>,
    field: RuleField,
    match_type: MatchType,
    match_value: String,
    category_id: i64,
    priority: i64,
) -> CommandResult<CategorizationRule> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categorization_rules::create(&conn, field, match_type, &match_value, category_id, priority)
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
    category_id: i64,
    priority: i64,
) -> CommandResult<CategorizationRule> {
    let conn = state.db.lock().map_err(to_command_error)?;
    categorization_rules::update(&conn, id, field, match_type, &match_value, category_id, priority)
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
) -> CommandResult<Settings> {
    let new_settings = Settings {
        update_checks_enabled,
    };
    settings::save(&state.app_data_dir, &new_settings).map_err(to_command_error)?;
    Ok(new_settings)
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
