use crate::services::accounts::{self, Account, AccountType};
use crate::services::categories::{self, Category, CategoryGroup};
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
