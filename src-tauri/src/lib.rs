mod commands;
mod db;
mod services;

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[tauri::command]
fn schema_version(state: tauri::State<AppState>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    services::health::schema_version(&conn).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).expect("create app data directory");

            let db_path = app_data_dir.join("pesantmoney.db");
            let conn = db::open(&db_path).expect("open application database");

            app.manage(AppState {
                db: Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            schema_version,
            commands::create_account,
            commands::list_accounts,
            commands::update_account,
            commands::delete_account,
            commands::create_transaction,
            commands::list_transactions,
            commands::update_transaction,
            commands::delete_transaction,
            commands::account_balance_cents,
            commands::create_category_group,
            commands::list_category_groups,
            commands::update_category_group,
            commands::delete_category_group,
            commands::create_category,
            commands::list_categories,
            commands::update_category,
            commands::delete_category,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
