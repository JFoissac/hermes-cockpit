//! Skills observatory: what exists on disk, and what a session actually opened.
//!
//! Both endpoints are read-only. The catalogue walks `<HERMES_HOME>/skills`
//! (no DB, no YAML crate — the frontmatter parser is 40 lines and handles the
//! three shapes the real files use); the per-session view counts real
//! `skill_view` calls in `messages`.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use crate::hermes_db::{self, SkillEntry, SkillUsage};
use crate::routes::ApiError;
use crate::state::AppState;

/// Le catalogue vient d'un parcours disque (~225 fichiers) : 250 ms par appel.
/// Un cache de 5 min suffit — les skills changent rarement en cours de session.
const CATALOGUE_TTL: Duration = Duration::from_secs(300);

static CATALOGUE: OnceLock<Mutex<Option<(Instant, PathBuf, Vec<SkillEntry>)>>> = OnceLock::new();

fn cache_lock() -> std::sync::MutexGuard<'static, Option<(Instant, PathBuf, Vec<SkillEntry>)>> {
    CATALOGUE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Deserialize)]
pub struct SkillsQuery {
    /// Filtre libre sur le nom + la description (insensible à la casse).
    q: Option<String>,
}

/// `GET /api/observatory/skills?q=` → catalogue trié catégorie puis nom.
pub async fn skills(
    State(state): State<AppState>,
    Query(query): Query<SkillsQuery>,
) -> Result<Json<Vec<SkillEntry>>, ApiError> {
    let root = hermes_db::skills_root(&state.hermes_home);

    if let Some((stamp, cached_root, entries)) = cache_lock().as_ref() {
        if *cached_root == root && stamp.elapsed() < CATALOGUE_TTL {
            return Ok(Json(hermes_db::filter_skills(entries.clone(), query.q.as_deref())));
        }
    }

    // The walk is pure `std::fs`: keep it off the async runtime.
    let walk_root = root.clone();
    let entries = tokio::task::spawn_blocking(move || hermes_db::list_skills(&walk_root))
        .await
        .map_err(|error| ApiError::from(anyhow::anyhow!("scan des skills: {error}")))?;

    *cache_lock() = Some((Instant::now(), root, entries.clone()));
    Ok(Json(hermes_db::filter_skills(entries, query.q.as_deref())))
}

/// `GET /api/observatory/sessions/{id}/skills` → skills réellement utilisés.
///
/// An unknown session, a session without any `skill_view`, or a database that
/// cannot be read all answer `[]`: the panel shows an empty state, not an error.
pub async fn session_skills(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Json<Vec<SkillUsage>> {
    match hermes_db::session_skill_usage(&state.db, &session_id).await {
        Ok(usage) => Json(usage),
        Err(error) => {
            tracing::warn!(%session_id, "usage des skills illisible: {error:#}");
            Json(Vec::new())
        }
    }
}
