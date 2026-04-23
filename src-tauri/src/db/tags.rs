use crate::db::Database;
use crate::models::tag::Tag;
use rusqlite::params;

impl Database {
    pub fn get_tags(&self) -> anyhow::Result<Vec<Tag>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT name, color FROM tags ORDER BY name")?;
        let tags = stmt
            .query_map([], |row| {
                Ok(Tag {
                    name: row.get(0)?,
                    color: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tags)
    }

    pub fn add_tag(&self, name: &str, color: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO tags (name, color) VALUES (?1, ?2)",
            params![name, color],
        )?;
        Ok(())
    }

    pub fn delete_tag(&self, name: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tags WHERE name = ?1", params![name])?;
        Ok(())
    }
}
