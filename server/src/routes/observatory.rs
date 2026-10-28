//! Observatory endpoints: everything read from the Hermes state DB.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use crate::hermes_api;
use crate::hermes_db;
use crate::model::{AgentSession, Health, HealthStatus, MessageDelta, OpencodeStatus, Subagent};
use crate::routes::ApiError;
use crate::state::AppState;

const SESSIONS_DEFAULT_LIMIT: i64 = 60;
const MESSAGES_DEFAULT_LIMIT: i64 = 200;
const SUBAGENTS_DEFAULT_LIMIT: i64 = 50;
const LIMIT_CEILING: i64 = 500;

#[derive(Debug, Deserialize)]
pub struct LimitQuery {
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct MessagesQuery {
    after_id: Option<i64>,
    limit: Option<i64>,
    /// `kinds=chat` → uniquement les messages de conversation (user/assistant).
    kinds: Option<String>,
}

pub async fn health(State(state): State<AppState>) -> Json<Health> {
    let db_ok = hermes_db::ping(&state.db).await.is_ok();
    let (api, api_detail) = match state.api.capabilities().await {
        Ok(()) => (HealthStatus::Ok, None),
        Err(detail) => (HealthStatus::Down, Some(detail)),
    };
    let opencode = if hermes_api::binary_on_path("opencode") {
        OpencodeStatus::Ok
    } else {
        OpencodeStatus::Unknown
    };

    Json(Health {
        api,
        db: if db_ok {
            HealthStatus::Ok
        } else {
            HealthStatus::Down
        },
        opencode,
        api_detail,
    })
}

pub async fn sessions(
    State(state): State<AppState>,
    Query(query): Query<LimitQuery>,
) -> Result<Json<Vec<AgentSession>>, ApiError> {
    let limit = clamp_limit(query.limit, SESSIONS_DEFAULT_LIMIT);
    Ok(Json(hermes_db::sessions(&state.db, limit).await?))
}

pub async fn messages(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<Vec<MessageDelta>>, ApiError> {
    let after_id = query.after_id.unwrap_or(0).max(0);
    let limit = clamp_limit(query.limit, MESSAGES_DEFAULT_LIMIT);
    let chat_only = query.kinds.as_deref() == Some("chat");
    Ok(Json(
        hermes_db::messages_since(&state.db, &session_id, after_id, limit, chat_only).await?,
    ))
}

pub async fn subagents(
    State(state): State<AppState>,
    Query(query): Query<LimitQuery>,
) -> Result<Json<Vec<Subagent>>, ApiError> {
    let limit = clamp_limit(query.limit, SUBAGENTS_DEFAULT_LIMIT);
    Ok(Json(hermes_db::subagents(&state.db, limit).await?))
}

/// The front calls this when no session is selected.
pub async fn noop() -> Json<Vec<serde_json::Value>> {
    Json(Vec::new())
}

fn clamp_limit(requested: Option<i64>, default: i64) -> i64 {
    requested.unwrap_or(default).clamp(1, LIMIT_CEILING)
}
