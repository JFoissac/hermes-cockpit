//! Helpers shared by the integration tests.
//!
//! They deliberately exercise the real Hermes state database (read-only) so the
//! SQL is proven against the actual schema instead of a fixture that could drift.
#![allow(dead_code)]

use std::path::PathBuf;

use hermes_cockpit_server::hermes_api::HermesApi;
use hermes_cockpit_server::state::AppState;
use hermes_cockpit_server::{hermes_db, routes};
use sqlx::SqlitePool;

pub fn hermes_home() -> PathBuf {
    hermes_db::resolve_hermes_home().expect("HERMES_HOME ou LOCALAPPDATA doit être résolu")
}

pub fn state_db_path() -> PathBuf {
    hermes_db::state_db_path(&hermes_home())
}

pub async fn pool() -> SqlitePool {
    hermes_db::open_ro(&state_db_path())
        .await
        .unwrap_or_else(|e| panic!("ouverture lecture seule de {}: {e}", state_db_path().display()))
}

/// App state wired to a closed local port: health checks must never touch the
/// network in tests, and `api` is then deterministically `down`.
pub async fn state() -> AppState {
    AppState::new(
        pool().await,
        hermes_home(),
        HermesApi::new("http://127.0.0.1:1", None),
    )
}

pub fn app(state: AppState) -> axum::Router {
    routes::router(state)
}
