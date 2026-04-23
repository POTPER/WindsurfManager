mod commands;
mod db;
mod models;
mod services;

use commands::account_commands::*;
use commands::tag_commands::*;
use commands::settings_commands::*;
use db::Database;
use services::keyring_service;
use tauri::Manager;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("windsurf_manager_lib=debug,info")),
        )
        .init();

    info!("Starting Windsurf Manager v2");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("data.db");

            let passphrase = keyring_service::get_or_create_passphrase()
                .expect("Failed to initialize master passphrase");

            let database = Database::open(&db_path, &passphrase)
                .expect("Failed to open encrypted database");

            app.manage(database);

            info!("App setup complete, database at {:?}", db_path);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_account,
            get_all_accounts,
            get_account,
            update_account,
            delete_account,
            get_tags,
            add_tag,
            delete_tag,
            get_settings,
            update_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
