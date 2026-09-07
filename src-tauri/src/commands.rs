use crate::import::{self, ColumnMapping, ImportFormat, ImportResult, ParsedTransaction, PreviewRow, SignConvention};
use crate::services::accounts::{self, Account, AccountType};
use crate::services::budgets::{self, BudgetAssignment, CategoryBudgetLine};
use crate::services::categories::{self, Category, CategoryGroup};
use crate::services::import_profiles::{self, ImportProfile};
use crate::services::recurring_items::{self, Frequency, RecurringItem};
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
pub fn upcoming_recurring_items(
    state: tauri::State<AppState>,
    account_id: i64,
    within_days: i64,
) -> CommandResult<Vec<RecurringItem>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    let as_of = chrono::Local::now().format("%Y-%m-%d").to_string();
    recurring_items::upcoming(&conn, account_id, &as_of, within_days).map_err(to_command_error)
}
