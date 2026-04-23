use crate::db::Database;
use crate::models::account::{Account, AddAccountParams, UpdateAccountParams};
use tauri::State;

#[tauri::command]
pub fn add_account(db: State<'_, Database>, params: AddAccountParams) -> Result<Account, String> {
    db.add_account(params).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_accounts(db: State<'_, Database>) -> Result<Vec<Account>, String> {
    db.get_all_accounts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_account(db: State<'_, Database>, id: String) -> Result<Account, String> {
    db.get_account(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_account(db: State<'_, Database>, params: UpdateAccountParams) -> Result<(), String> {
    db.update_account(params).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_account(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.delete_account(&id).map_err(|e| e.to_string())
}
