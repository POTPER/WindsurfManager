use crate::db::Database;
use crate::models::account::{Account, AddAccountParams, UpdateAccountParams};
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

impl Database {
    pub fn add_account(&self, params: AddAccountParams) -> anyhow::Result<Account> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();

        conn.execute(
            "INSERT INTO accounts (id, email, nickname, password, group_name, sort_order, status, created_at, auth_provider)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 'inactive', ?6, 'firebase')",
            params![id, params.email, params.nickname, params.password, params.group_name, now],
        )?;

        for tag in &params.tags {
            conn.execute(
                "INSERT OR IGNORE INTO account_tags (account_id, tag_name) VALUES (?1, ?2)",
                params![id, tag],
            )?;
        }

        drop(conn);
        self.get_account(&id)
    }

    pub fn get_account(&self, id: &str) -> anyhow::Result<Account> {
        let conn = self.conn.lock().unwrap();

        let mut account = conn.query_row(
            "SELECT id, email, nickname, password, token, refresh_token, token_expires_at,
                    auth_provider, devin_auth1_token, devin_account_id, devin_primary_org_id,
                    group_name, sort_order, status, created_at, last_login_at
             FROM accounts WHERE id = ?1",
            params![id],
            |row| {
                Ok(Account {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    nickname: row.get(2)?,
                    password: row.get(3)?,
                    token: row.get(4)?,
                    refresh_token: row.get(5)?,
                    token_expires_at: row.get(6)?,
                    auth_provider: row.get(7)?,
                    devin_auth1_token: row.get(8)?,
                    devin_account_id: row.get(9)?,
                    devin_primary_org_id: row.get(10)?,
                    group_name: row.get(11)?,
                    sort_order: row.get(12)?,
                    status: row.get(13)?,
                    created_at: row.get(14)?,
                    last_login_at: row.get(15)?,
                    tags: Vec::new(),
                })
            },
        )?;

        let mut stmt = conn.prepare(
            "SELECT tag_name FROM account_tags WHERE account_id = ?1 ORDER BY tag_name",
        )?;
        let tags: Vec<String> = stmt
            .query_map(params![id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        account.tags = tags;

        Ok(account)
    }

    pub fn get_all_accounts(&self) -> anyhow::Result<Vec<Account>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, email, nickname, password, token, refresh_token, token_expires_at,
                    auth_provider, devin_auth1_token, devin_account_id, devin_primary_org_id,
                    group_name, sort_order, status, created_at, last_login_at
             FROM accounts ORDER BY sort_order, created_at",
        )?;

        let accounts: Vec<Account> = stmt
            .query_map([], |row| {
                Ok(Account {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    nickname: row.get(2)?,
                    password: row.get(3)?,
                    token: row.get(4)?,
                    refresh_token: row.get(5)?,
                    token_expires_at: row.get(6)?,
                    auth_provider: row.get(7)?,
                    devin_auth1_token: row.get(8)?,
                    devin_account_id: row.get(9)?,
                    devin_primary_org_id: row.get(10)?,
                    group_name: row.get(11)?,
                    sort_order: row.get(12)?,
                    status: row.get(13)?,
                    created_at: row.get(14)?,
                    last_login_at: row.get(15)?,
                    tags: Vec::new(),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        let mut tag_stmt =
            conn.prepare("SELECT tag_name FROM account_tags WHERE account_id = ?1 ORDER BY tag_name")?;

        let accounts: Vec<Account> = accounts
            .into_iter()
            .map(|mut a| {
                if let Ok(tags) = tag_stmt
                    .query_map(params![a.id], |row| row.get::<_, String>(0))
                {
                    a.tags = tags.filter_map(|r| r.ok()).collect();
                }
                a
            })
            .collect();

        Ok(accounts)
    }

    pub fn update_account(&self, params: UpdateAccountParams) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();

        if let Some(nickname) = &params.nickname {
            conn.execute(
                "UPDATE accounts SET nickname = ?1 WHERE id = ?2",
                params![nickname, params.id],
            )?;
        }

        if let Some(password) = &params.password {
            conn.execute(
                "UPDATE accounts SET password = ?1 WHERE id = ?2",
                params![password, params.id],
            )?;
        }

        if let Some(group_name) = &params.group_name {
            conn.execute(
                "UPDATE accounts SET group_name = ?1 WHERE id = ?2",
                params![group_name, params.id],
            )?;
        }

        if let Some(sort_order) = params.sort_order {
            conn.execute(
                "UPDATE accounts SET sort_order = ?1 WHERE id = ?2",
                params![sort_order, params.id],
            )?;
        }

        if let Some(tags) = &params.tags {
            conn.execute(
                "DELETE FROM account_tags WHERE account_id = ?1",
                params![params.id],
            )?;
            for tag in tags {
                conn.execute(
                    "INSERT OR IGNORE INTO account_tags (account_id, tag_name) VALUES (?1, ?2)",
                    params![params.id, tag],
                )?;
            }
        }

        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        Ok(())
    }
}
