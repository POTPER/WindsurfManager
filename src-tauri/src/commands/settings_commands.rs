use crate::db::Database;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn get_settings(db: State<'_, Database>) -> Result<HashMap<String, String>, String> {
    db.get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_setting(db: State<'_, Database>, key: String, value: String) -> Result<(), String> {
    db.update_setting(&key, &value).map_err(|e| e.to_string())
}
