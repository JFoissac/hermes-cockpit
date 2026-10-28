//! Envoi d'un tour dans une session **du CLI**.
//!
//! L'API Hermes refuse (`permission_denied`) d'écrire dans une session dont la
//! source n'est pas `api_server` : c'est une règle du produit, pas un défaut de
//! configuration. La seule voie légitime pour ces conversations est donc leur
//! propre transport, le CLI : `hermes -z "<message>" --resume <session>`.
//!
//! Ce module lance ce processus et relaie sa sortie en SSE (`assistant.delta`),
//! pour que le chat du cockpit se comporte comme avec l'API.

use std::path::PathBuf;
use std::process::Stdio;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::stream;
use serde::Deserialize;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::routes::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CliBody {
    session_id: String,
    message: String,
}

/// Chemin de l'exécutable `hermes`.
fn hermes_exe() -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("HERMES_CLI") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Some(path);
        }
    }
    let home = std::env::var_os("LOCALAPPDATA")?;
    let candidate = PathBuf::from(home).join("hermes/hermes-agent/venv/Scripts/hermes.exe");
    candidate.is_file().then_some(candidate)
}

fn sse(event: &str, payload: &serde_json::Value) -> Vec<u8> {
    format!("event: {event}\ndata: {payload}\n\n").into_bytes()
}

/// `POST /api/cli/stream` — un tour dans une session du CLI, relayé en SSE.
pub async fn cli_stream(
    State(_state): State<AppState>,
    Json(body): Json<CliBody>,
) -> Result<Response, ApiError> {
    if body.session_id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "session_id manquant"));
    }
    let exe = hermes_exe().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "hermes introuvable (définis HERMES_CLI ou installe le CLI)",
        )
    })?;

    let mut child = Command::new(exe)
        .arg("-z")
        .arg(&body.message)
        .arg("--resume")
        .arg(&body.session_id)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ApiError::new(StatusCode::BAD_GATEWAY, format!("lancement du CLI : {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "sortie du CLI indisponible"))?;
    let mut lines = BufReader::new(stdout).lines();

    let session_id = body.session_id.clone();
    let stream = stream::unfold((lines, child, false), move |(mut lines, mut child, done)| {
        let session_id = session_id.clone();
        async move {
            if done {
                return None;
            }
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let frame = sse(
                        "assistant.delta",
                        &json!({ "delta": format!("{line}\n"), "session_id": session_id }),
                    );
                    Some((Ok::<Vec<u8>, std::io::Error>(frame), (lines, child, false)))
                }
                Ok(None) => {
                    let status = child.wait().await.ok().and_then(|s| s.code()).unwrap_or(0);
                    let frame = sse("done", &json!({ "exit_code": status, "transport": "cli" }));
                    Some((Ok(frame), (lines, child, true)))
                }
                Err(error) => Some((Err(error), (lines, child, true))),
            }
        }
    });

    let mut response = Body::from_stream(stream).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(
        header::HeaderName::from_static("x-accel-buffering"),
        HeaderValue::from_static("no"),
    );
    Ok(response)
}
