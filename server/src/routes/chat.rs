//! Session creation and the SSE chat passthrough to the Hermes API.

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

use crate::routes::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateSessionBody {
    title: Option<String>,
}

/// Consigne système dérivée du niveau d'effort.
///
/// `model_options.reasoning.effort` est accepté par Hermes mais reste sans effet
/// observable sur la plupart des fournisseurs (deepseek, etc.). Pour que le
/// réglage change VRAIMENT la réponse, on l'accompagne d'une consigne envoyée
/// dans `system_message`, que l'API transmet au tour.
fn effort_instructions(effort: &str) -> Option<&'static str> {
    match effort {
        "low" => Some(
            "Sois bref : réponds directement, sans préambule, sans rappel de la question, en 3 phrases maximum.",
        ),
        "high" => Some(
            "Sois rigoureux : explicite les étapes utiles, vérifie les faits avant de les affirmer, signale les hypothèses.",
        ),
        "xhigh" => Some(
            "Sois exhaustif : vérifie chaque affirmation, signale explicitement les incertitudes, et propose au moins deux options quand c'est pertinent.",
        ),
        "ultra" => Some(
            "Mode maximal : vérifie chaque affirmation avec les outils disponibles, signale les incertitudes, compare plusieurs pistes avec leurs risques, et termine par ce qui reste à vérifier.",
        ),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
pub struct ChatBody {
    session_id: String,
    message: String,
    /// Images collées (data-URL), transmises comme parties `image_url`.
    #[serde(default)]
    images: Vec<String>,
    /// Fournisseur et modèle choisis dans le composer (facultatifs).
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
    /// Effort de raisonnement : none|low|medium|high|xhigh|max|ultra.
    #[serde(default)]
    effort: Option<String>,
}

/// `POST /api/sessions` — relayed verbatim (status + body) so the front keeps
/// receiving `{object, session}`.
pub async fn create_session(
    State(state): State<AppState>,
    payload: Option<Json<CreateSessionBody>>,
) -> Result<Response, ApiError> {
    let title = payload.and_then(|Json(body)| body.title);
    let (status, bytes) = state.api.create_session(title.as_deref()).await?;

    Ok((
        status,
        [(header::CONTENT_TYPE, HeaderValue::from_static("application/json"))],
        bytes,
    )
        .into_response())
}

/// `POST /api/chat/stream` — byte-for-byte SSE passthrough. Dropping the body
/// (client disconnect) drops the upstream response and cancels it.
pub async fn chat_stream(
    State(state): State<AppState>,
    Json(body): Json<ChatBody>,
) -> Result<Response, ApiError> {
    let upstream = state
        .api
        .chat_stream_with_images(
            &body.session_id,
            &body.message,
            &body.images,
            body.provider.as_deref(),
            body.model.as_deref(),
            body.effort.as_deref(),
            body.effort
                .as_deref()
                .and_then(effort_instructions),
        )
        .await?;

    let stream = upstream.bytes_stream();
    let mut response = Body::from_stream(stream).into_response();
    *response.status_mut() = StatusCode::OK;

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
