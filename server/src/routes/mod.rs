//! HTTP surface of the cockpit.
//!
//! `/api/observatory/*` reads the Hermes state DB (never writes), `/api/sessions`
//! and `/api/chat/stream` proxy the local Hermes API. The built front is served
//! from `web/dist` when present.

pub mod chat;
pub mod cli;
pub mod dictation;
pub mod observatory;
pub mod models;
pub mod preview;
pub mod skills;

use std::path::{Path, PathBuf};

use axum::http::StatusCode;
use axum::http::{header, HeaderValue, Method};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::hermes_api::UpstreamError;
use crate::state::AppState;

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, format!("{error:#}"))
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("base d'état illisible: {error}"),
        )
    }
}

impl From<UpstreamError> for ApiError {
    fn from(error: UpstreamError) -> Self {
        let message = error.to_string();
        match error {
            UpstreamError::MissingKey => Self::new(StatusCode::SERVICE_UNAVAILABLE, message),
            UpstreamError::Transport(_) => Self::new(StatusCode::BAD_GATEWAY, message),
            UpstreamError::Status { status, .. } => Self::new(status, message),
        }
    }
}

/// Marque l'index HTML comme non cacheable (les assets, eux, sont hachés).
async fn no_store_html(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let mut response = next.run(request).await;
    let is_html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.starts_with("text/html"))
        .unwrap_or(false);
    if is_html {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(observatory::health))
        .route("/observatory/sessions", get(observatory::sessions))
        .route(
            "/observatory/sessions/{id}/messages",
            get(observatory::messages),
        )
        .route("/observatory/subagents", get(observatory::subagents))
        .route("/observatory/skills", get(skills::skills))
        .route(
            "/observatory/sessions/{id}/skills",
            get(skills::session_skills),
        )
        .route("/observatory/noop", get(observatory::noop))
        .route("/sessions", post(chat::create_session))
        .route("/models", get(models::list))
        .route("/preview/detect", get(preview::detect))
        .route("/sessions/{id}/model", post(models::lock))
        .route("/chat/stream", post(chat::chat_stream))
        .route("/cli/stream", post(cli::cli_stream))
        .route("/dictation/status", get(dictation::status))
        .route("/dictation/transcribe", post(dictation::transcribe))
        .with_state(state);

    let app = Router::new()
        .nest("/api", api)
        // CORS restreint aux origines de l'application : une page web quelconque
        // ne doit pas pouvoir piloter l'agent local. `tauri://localhost` (et sa
        // variante `http://tauri.localhost` sous Windows) sert l'UI packagée,
        // `127.0.0.1`/`localhost` servent le développement.
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
                    origin
                        .to_str()
                        .map(|value| {
                            value == "tauri://localhost"
                                || value.starts_with("http://tauri.localhost")
                                || value.starts_with("https://tauri.localhost")
                                || value.starts_with("http://127.0.0.1")
                                || value.starts_with("http://localhost")
                        })
                        .unwrap_or(false)
                }))
                .allow_methods([Method::GET, Method::POST])
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http());

    let served = match web_dist() {
        Some(dist) => app.fallback_service(
            ServeDir::new(&dist).fallback(ServeFile::new(dist.join("index.html"))),
        ),
        None => app.fallback(no_front),
    };

    // Posée APRÈS le fallback : sinon le service de fichiers statiques passe
    // à côté du middleware. L'index HTML ne doit jamais venir du cache (les
    // assets, eux, sont hachés) : sans ça, une mise à jour laisse l'app tourner
    // sur du code périmé — c'est arrivé avec la webview Tauri.
    served.layer(axum::middleware::from_fn(no_store_html))
}

async fn no_front() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "front non buildé (web/dist absent)" })),
    )
}

/// `web/dist` next to the crate or to the repo root, overridable by env.
fn web_dist() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("COCKPIT_WEB_DIST").filter(|v| !v.is_empty()) {
        candidates.push(PathBuf::from(configured));
    }
    candidates.push(PathBuf::from("web/dist"));
    candidates.push(PathBuf::from("../web/dist"));
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/dist"));

    candidates.into_iter().find(|path| path.is_dir())
}

