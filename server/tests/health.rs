//! `/api/health` must answer 200 with a JSON body even when the Hermes API is down.

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn health_reports_api_and_db() {
    // Port 1 is closed: the capabilities probe fails fast, no network involved.
    let app = common::app(common::state().await);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("JSON valide");

    assert_eq!(json["db"], "ok", "state.db doit être lisible");
    assert!(json.get("api").is_some(), "champ api manquant");
    assert_eq!(json["api"], "down", "aucune API sur le port 1");
    assert!(json.get("opencode").is_some(), "champ opencode manquant");
    assert!(
        json.get("apiDetail").is_some(),
        "apiDetail doit expliquer l'échec"
    );
}
