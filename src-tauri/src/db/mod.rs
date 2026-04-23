pub mod accounts;
pub mod tags;
pub mod settings;

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tracing::info;

pub struct Database {
    pub conn: Mutex<Connection>,
}

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  auth_provider TEXT NOT NULL DEFAULT 'firebase',
  devin_auth1_token TEXT,
  devin_account_id TEXT,
  devin_primary_org_id TEXT,
  group_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'inactive',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY,
  color TEXT NOT NULL DEFAULT '#409EFF'
);

CREATE TABLE IF NOT EXISTS account_tags (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL REFERENCES tags(name) ON DELETE CASCADE,
  PRIMARY KEY (account_id, tag_name)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

impl Database {
    pub fn open(db_path: &Path, passphrase: &str) -> anyhow::Result<Self> {
        let conn = Connection::open(db_path)?;

        conn.pragma_update(None, "key", passphrase)?;

        conn.pragma_update(None, "foreign_keys", "ON")?;

        Self::migrate(&conn)?;

        info!("Database opened at {:?}", db_path);

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn migrate(conn: &Connection) -> anyhow::Result<()> {
        let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;

        if version < 1 {
            conn.execute_batch(SCHEMA_V1)?;
            conn.pragma_update(None, "user_version", 1)?;
            info!("Database migrated to version 1");
        }

        Ok(())
    }
}
