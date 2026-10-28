//! Real sessions from the Hermes state DB, straight and through HTTP.

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use hermes_cockpit_server::model::SessionOrigin;
use hermes_cockpit_server::hermes_db;
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn reads_real_sessions_sorted_desc() {
    let pool = common::pool().await;
    let sessions = hermes_db::sessions(&pool, 10)
        .await
        .expect("lecture des sessions");

    assert!(!sessions.is_empty(), "au moins une session réelle attendue");
    for session in &sessions {
        assert!(!session.id.is_empty());
        assert!(session.message_count >= 0);
        assert!(session.tool_call_count >= 0);
    }

    let times: Vec<f64> = sessions
        .iter()
        .map(|s| s.last_activity_at.unwrap_or(0.0))
        .collect();
    assert!(
        times.windows(2).all(|w| w[0] >= w[1]),
        "les sessions doivent être triées par activité décroissante: {times:?}"
    );
    assert!(
        sessions.iter().any(|s| s.origin == SessionOrigin::Hermes),
        "au moins une session Hermes attendue"
    );
}

#[tokio::test]
async fn sessions_endpoint_returns_a_json_array() {
    let app = common::app(common::state().await);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/observatory/sessions?limit=2")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("JSON valide");
    let sessions = json.as_array().expect("tableau JSON de sessions");
    assert!(!sessions.is_empty(), "au moins une session réelle");
    assert!(sessions.len() <= 2);

    let first = &sessions[0];
    for key in [
        "id",
        "title",
        "source",
        "model",
        "parent_session_id",
        "running",
        "message_count",
        "tool_call_count",
        "input_tokens",
        "output_tokens",
        "cost_usd",
        "last_activity_at",
        "cwd",
        "git_branch",
        "origin",
        "preview",
    ] {
        assert!(first.get(key).is_some(), "champ manquant: {key}");
    }
    assert!(first["origin"] == "Hermes" || first["origin"] == "OpenCode");
}

#[tokio::test]
async fn noop_endpoint_is_an_empty_array() {
    let app = common::app(common::state().await);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/observatory/noop")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"[]");
}
