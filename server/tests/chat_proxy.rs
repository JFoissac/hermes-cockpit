//! Proxy behaviour proven against a local mock: no Hermes turn, no network.

mod common;

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::Path;
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use hermes_cockpit_server::hermes_api::HermesApi;
use hermes_cockpit_server::state::AppState;
use http_body_util::BodyExt;
use tower::ServiceExt;

const SSE_BODY: &str = "event: assistant.delta\ndata: {\"text\":\"bonjour\"}\n\nevent: done\ndata: {}\n\n";

#[derive(Clone, Default)]
struct Seen {
    authorization: Arc<Mutex<Option<String>>>,
    chat_body: Arc<Mutex<Option<String>>>,
    create_body: Arc<Mutex<Option<String>>>,
}

async fn mock_chat_stream(
    axum::extract::State(seen): axum::extract::State<Seen>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    body: String,
) -> Response {
    *seen.authorization.lock().unwrap() = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    *seen.chat_body.lock().unwrap() = Some(body);
    assert_eq!(session_id, "sess-1");

    (
        [
            (header::CONTENT_TYPE, "text/event-stream"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        SSE_BODY,
    )
        .into_response()
}

async fn mock_create_session(
    axum::extract::State(seen): axum::extract::State<Seen>,
    body: String,
) -> Response {
    *seen.create_body.lock().unwrap() = Some(body);
    (
        StatusCode::CREATED,
        [(header::CONTENT_TYPE, "application/json")],
        r#"{"object":"hermes.session","session":{"id":"api_test","source":"api_server"}}"#,
    )
        .into_response()
}

/// Boots an in-process Hermes API stand-in on an ephemeral port.
async fn spawn_mock() -> (String, Seen) {
    let seen = Seen::default();
    let app = Router::new()
        .route("/api/sessions/{id}/chat/stream", post(mock_chat_stream))
        .route("/api/sessions", post(mock_create_session))
        .with_state(seen.clone());

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind mock");
    let addr = listener.local_addr().expect("addr mock");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("mock serveur");
    });

    (format!("http://{addr}"), seen)
}

async fn cockpit_pointing_at(api_base: &str) -> Router {
    let state = AppState::new(
        common::pool().await,
        common::hermes_home(),
        HermesApi::new(api_base, Some("test-key".to_string())),
    );
    common::app(state)
}

#[tokio::test]
async fn chat_stream_is_a_byte_for_byte_sse_passthrough() {
    let (api_base, seen) = spawn_mock().await;
    let app = cockpit_pointing_at(&api_base).await;

    let request = Request::post("/api/chat/stream")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"session_id":"sess-1","message":"salut"}"#))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("text/event-stream")
    );
    assert_eq!(
        response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok()),
        Some("no-cache")
    );

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        std::str::from_utf8(&bytes).unwrap(),
        SSE_BODY,
        "les octets SSE amont doivent être recopiés tels quels"
    );

    assert_eq!(
        seen.authorization.lock().unwrap().as_deref(),
        Some("Bearer test-key"),
        "la clé doit être envoyée à Hermes, jamais au front"
    );
    assert_eq!(
        seen.chat_body.lock().unwrap().as_deref(),
        Some(r#"{"message":"salut"}"#),
        "le body relayé doit être {{message}}"
    );
}

#[tokio::test]
async fn create_session_relays_status_and_body() {
    let (api_base, seen) = spawn_mock().await;
    let app = cockpit_pointing_at(&api_base).await;

    let request = Request::post("/api/sessions")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"title":"Ma session"}"#))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        std::str::from_utf8(&bytes).unwrap(),
        r#"{"object":"hermes.session","session":{"id":"api_test","source":"api_server"}}"#
    );
    assert_eq!(
        seen.create_body.lock().unwrap().as_deref(),
        Some(r#"{"title":"Ma session"}"#)
    );
}
