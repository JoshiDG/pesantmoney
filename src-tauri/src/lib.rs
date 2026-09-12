mod commands;
mod db;
mod import;
mod services;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
    pub db_path: PathBuf,
    pub last_backup: Mutex<services::backup::BackupStatus>,
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).expect("create app data directory");

            let db_path = app_data_dir.join("pesantmoney.db");
            let conn = db::open(&db_path).expect("open application database");

            // Rolling automatic snapshot, taken once per launch with no user
            // action needed. Failure here (disk full, permission denied,
            // etc.) must never block startup — it's recorded in AppState and
            // surfaced later via the `get_backup_status` command instead.
            let last_backup = services::backup::run_startup_backup(&db_path, &app_data_dir);

            // Auto-sync to configured local sync folder (e.g. Dropbox / Google Drive Desktop)
            let folder_config = services::folder_sync::load_config(&app_data_dir);
            if folder_config.auto_sync && folder_config.sync_folder_path.is_some() {
                let _ = services::folder_sync::sync_now(&db_path, &app_data_dir);
            }

            app.manage(AppState {
                db: Mutex::new(conn),
                app_data_dir,
                db_path,
                last_backup: Mutex::new(last_backup),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            schema_version,
            commands::create_account,
            commands::list_accounts,
            commands::update_account,
            commands::delete_account,
            commands::set_account_apr,
            commands::create_transaction,
            commands::list_transactions,
            commands::list_all_transactions,
            commands::update_transaction,
            commands::delete_transaction,
            commands::account_balance_cents,
            commands::get_net_worth,
            commands::get_net_worth_by_account,
            commands::get_cash_flow_for_range,
            commands::get_net_worth_as_of,
            commands::get_daily_cash_flow_for_range,
            commands::get_monthly_cash_flow_for_range,
            commands::get_spending_by_category_for_range,
            commands::get_income_by_category_for_range,
            commands::create_category_group,
            commands::list_category_groups,
            commands::update_category_group,
            commands::delete_category_group,
            commands::create_category,
            commands::list_categories,
            commands::update_category,
            commands::delete_category,
            commands::create_import_profile,
            commands::list_import_profiles,
            commands::preview_import,
            commands::commit_import,
            commands::link_transfer,
            commands::unlink_transfer,
            commands::list_transfers,
            commands::suggest_transfer_matches,
            commands::income_expense_totals,
            commands::assign_budget,
            commands::get_budget_for_month,
            commands::get_ready_to_assign,
            commands::create_recurring_item,
            commands::list_recurring_items,
            commands::list_all_recurring_items,
            commands::update_recurring_item,
            commands::delete_recurring_item,
            commands::confirm_recurring_item,
            commands::detect_recurring_items,
            commands::upcoming_recurring_items,
            commands::upcoming_recurring_items_all,
            commands::create_holding,
            commands::list_holdings,
            commands::update_holding,
            commands::delete_holding,
            commands::set_security_price,
            commands::get_latest_price,
            commands::list_holdings_with_values,
            commands::list_all_holdings_with_values,
            commands::create_goal,
            commands::list_goals_with_progress,
            commands::update_goal,
            commands::delete_goal,
            commands::project_debt_payoff,
            commands::create_categorization_rule,
            commands::list_categorization_rules,
            commands::update_categorization_rule,
            commands::delete_categorization_rule,
            commands::apply_categorization_rules,
            commands::create_merchant,
            commands::list_merchants,
            commands::update_merchant,
            commands::delete_merchant,
            commands::set_transaction_hidden,
            commands::set_transaction_merchant_name,
            commands::list_visible_transactions,
            commands::list_tags,
            commands::list_tags_for_transaction,
            commands::list_tags_for_account,
            commands::create_tag,
            commands::attach_tag_to_transaction,
            commands::detach_tag_from_transaction,
            commands::get_settings,
            commands::update_settings,
            commands::update_transaction_column_visibility,
            commands::update_transaction_column_order,
            commands::check_for_update,
            commands::get_backup_status,
            commands::export_data,
            commands::export_transactions_csv,
            commands::run_notification_check,
            commands::get_gdrive_status,
            commands::start_gdrive_auth,
            commands::exchange_gdrive_code,
            commands::disconnect_gdrive,
            commands::sync_gdrive_now,
            commands::set_gdrive_auto_sync,
            commands::list_gdrive_backups,
            commands::restore_gdrive_backup,
            commands::update_gdrive_credentials,
            commands::get_folder_sync_status,
            commands::set_folder_sync_path,
            commands::sync_folder_now,
            commands::set_folder_auto_sync,
            commands::list_folder_backups,
            commands::restore_folder_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
