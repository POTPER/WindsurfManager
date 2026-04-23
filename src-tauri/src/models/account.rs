use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub nickname: String,
    pub password: String,
    pub token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
    pub auth_provider: String,
    pub devin_auth1_token: Option<String>,
    pub devin_account_id: Option<String>,
    pub devin_primary_org_id: Option<String>,
    pub group_name: Option<String>,
    pub sort_order: i32,
    pub status: String,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddAccountParams {
    pub email: String,
    pub password: String,
    pub nickname: String,
    pub group_name: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAccountParams {
    pub id: String,
    pub nickname: Option<String>,
    pub password: Option<String>,
    pub group_name: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub sort_order: Option<i32>,
}
