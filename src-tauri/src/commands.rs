use crate::services::accounts::{self, Account, AccountType};
use crate::services::transactions::{self, Transaction};
use crate::AppState;

type CommandResult<T> = Result<T, String>;

fn to_command_error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
pub fn delete_account(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    accounts::delete(&conn, id).map_err(to_command_error)
}

#[tauri::command]
pub fn create_transaction(
    state: tauri::State<AppState>,
    account_id: i64,
    date: String,
    amount_cents: i64,
    description: String,
) -> CommandResult<Transaction> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::create(&conn, account_id, &date, amount_cents, &description)
        .map_err(to_command_error)
}

#[tauri::command]
pub fn list_transactions(
    state: tauri::State<AppState>,
    account_id: i64,
) -> CommandResult<Vec<Transaction>> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::list_for_account(&conn, account_id).map_err(to_command_error)
}

#[tauri::command]
pub fn update_transaction(
    state: tauri::State<AppState>,
    id: i64,
    date: String,
    amount_cents: i64,
    description: String,
) -> CommandResult<Transaction> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::update(&conn, id, &date, amount_cents, &description).map_err(to_command_error)
}

#[tauri::command]
pub fn delete_transaction(state: tauri::State<AppState>, id: i64) -> CommandResult<()> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::delete(&conn, id).map_err(to_command_error)
}

#[tauri::command]
pub fn account_balance_cents(state: tauri::State<AppState>, account_id: i64) -> CommandResult<i64> {
    let conn = state.db.lock().map_err(to_command_error)?;
    transactions::balance_cents(&conn, account_id).map_err(to_command_error)
}
