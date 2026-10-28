//! Shared application state: read-only DB pool, Hermes home, API client.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use sqlx::SqlitePool;

use crate::hermes_api::HermesApi;
use crate::hermes_db;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub hermes_home: Arc<PathBuf>,
    pub api: Arc<HermesApi>,
}

impl AppState {
    pub fn new(db: SqlitePool, hermes_home: PathBuf, api: HermesApi) -> Self {
        Self {
            db,
            hermes_home: Arc::new(hermes_home),
            api: Arc::new(api),
        }
    }

    /// Everything comes from the environment; nothing is hard-coded at call sites.
    pub async fn from_env() -> Result<Self> {
        let hermes_home = hermes_db::resolve_hermes_home()?;
        let db_path = hermes_db::state_db_path(&hermes_home);
        let db = hermes_db::open_ro(&db_path)
            .await
            .with_context(|| format!("ouverture de {}", db_path.display()))?;

        let api_base = std::env::var("HERMES_API_BASE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:8642".to_string());
        let api_key = read_api_key(&hermes_home);

        Ok(Self::new(db, hermes_home, HermesApi::new(api_base, api_key)))
    }

    pub fn db_path(&self) -> PathBuf {
        hermes_db::state_db_path(&self.hermes_home)
    }
}

/// Reads `API_SERVER_KEY` from `<hermes_home>/.env`. The value is never logged.
pub fn read_api_key(hermes_home: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(hermes_home.join(".env")).ok()?;
    parse_env_value(&raw, "API_SERVER_KEY")
}

/// Minimal dotenv parser: exact key match, optional `export `, quoted values.
pub fn parse_env_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((raw_key, raw_value)) = line.split_once('=') else {
            continue;
        };
        if raw_key.trim() != key {
            continue;
        }
        let value = raw_value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|inner| inner.strip_suffix('"'))
            .or_else(|| {
                value
                    .strip_prefix('\'')
                    .and_then(|inner| inner.strip_suffix('\''))
            })
            .unwrap_or(value);
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::parse_env_value;

    #[test]
    fn parses_quoted_and_exported_values() {
        let env = "OTHER=1\nexport API_SERVER_KEY=\"abc123\"\nAPI_SERVER_KEY=late\n";
        assert_eq!(parse_env_value(env, "API_SERVER_KEY").as_deref(), Some("abc123"));
        assert_eq!(parse_env_value("API_SERVER_KEY='x y'", "API_SERVER_KEY").as_deref(), Some("x y"));
        assert_eq!(parse_env_value("API_SERVER_KEY=\n", "API_SERVER_KEY"), None);
        assert_eq!(parse_env_value("API_SERVER_KEY_EXTRA=1", "API_SERVER_KEY"), None);
    }
}
