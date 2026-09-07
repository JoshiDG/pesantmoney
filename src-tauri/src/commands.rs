use crate::import::{self, ColumnMapping, ImportFormat, ImportResult, ParsedTransaction, PreviewRow, SignConvention};
use crate::services::accounts::{self, Account, AccountType};
use crate::services::categories::{self, Category, CategoryGroup};
use crate::services::import_profiles::{self, ImportProfile};
use crate::services::transactions::{self, Transaction};
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
