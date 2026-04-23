use crate::db::Database;
use crate::models::tag::Tag;
use tauri::State;

#[tauri::command]
pub fn get_tags(db: State<'_, Database>) -> Result<Vec<Tag>, String> {
    db.get_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag(db: State<'_, Database>, name: String, color: String) -> Result<(), String> {
    db.add_tag(&name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag(db: State<'_, Database>, name: String) -> Result<(), String> {
    db.delete_tag(&name).map_err(|e| e.to_string())
}
