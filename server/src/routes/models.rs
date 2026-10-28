//! Catalogue de modèles et verrou de modèle par session (relais de l'API Hermes).

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::http::{header, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;

use crate::routes::ApiError;
use crate::state::AppState;

/// Le catalogue interroge les fournisseurs côté Hermes (~600 ms mesuré) : un cache
/// de 5 min évite de payer ce coût à chaque ouverture de l'app.
const MODELS_TTL: Duration = Duration::from_secs(300);

static MODELS: OnceLock<Mutex<Option<(Instant, Vec<u8>)>>> = OnceLock::new();

fn models_lock() -> std::sync::MutexGuard<'static, Option<(Instant, Vec<u8>)>> {
    MODELS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn json_response(status: axum::http::StatusCode, bytes: Vec<u8>) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, HeaderValue::from_static("application/json"))],
        bytes,
    )
        .into_response()
}

/// `GET /api/models` — relais de `GET /api/model/options`.
pub async fn list(State(state): State<AppState>) -> Result<Response, ApiError> {
    if let Some((stamp, cached)) = models_lock().as_ref() {
        if stamp.elapsed() < MODELS_TTL {
            return Ok(json_response(axum::http::StatusCode::OK, cached.clone()));
        }
    }

    let (status, bytes) = state.api.model_options().await?;
    if status.is_success() {
        *models_lock() = Some((Instant::now(), bytes.clone()));
    }
    Ok(json_response(status, bytes))
}

/// `POST /api/sessions/{id}/model` — relais du verrou de modèle.
pub async fn lock(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    let (status, bytes) = state.api.lock_session_model(&session_id, &body).await?;
    Ok(json_response(status, bytes))
}
