//! Preview server detection: `GET /api/preview/detect` and the session `cwd`
//! lookup it relies on.
//!
//! The route probes real localhost ports, so the assertions never pin a result
//! that depends on the developer machine: a dev server may or may not be
//! running. What is pinned is the JSON shape, the null-vs-value consistency,
//! and the `cwd` resolution, which is what the front relies on.
//!
//! `session_cwd` is exercised against a throw-away SQLite database created in
//! the OS temp dir (the shared `common::pool()` is the real, read-only
//! `state.db`, where nothing can be inserted), then read back through
//! `hermes_db::open_ro` — the exact read-only path production uses.

mod common;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use hermes_cockpit_server::hermes_api::HermesApi;
use hermes_cockpit_server::hermes_db;
use hermes_cockpit_server::state::AppState;
use http_body_util::BodyExt;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tower::ServiceExt;

/// Ports the route is documented to probe (kept in sync with `routes/preview.rs`).
const PROBED_PORTS: [i64; 9] = [3000, 4321, 5173, 5183, 8000, 8080, 8081, 8888, 4173];

const KNOWN_SESSION: &str = "preview_test_session_with_cwd";
const KNOWN_CWD: &str = "C:/Bureau/Dev/hermes-cockpit";
const NULL_CWD_SESSION: &str = "preview_test_session_without_cwd";
const BLANK_CWD_SESSION: &str = "preview_test_session_with_blank_cwd";

async fn get_json(app: axum::Router, uri: &str) -> (StatusCode, serde_json::Value) {
    let response = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap_or_else(|e| panic!("{uri} → la requête a échoué: {e}"));
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        panic!(
            "{uri} → JSON invalide ({e}): {}",
            String::from_utf8_lossy(&bytes)
        )
    });
    (status, json)
}

/// A writable SQLite file with the minimal `sessions` schema `session_cwd` reads.
struct TempDb {
    path: PathBuf,
    pool: SqlitePool,
}

impl TempDb {
    async fn new() -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "hermes-cockpit-preview-test-{}-{nanos}.db",
            std::process::id()
        ));
        assert!(
            !path.exists(),
            "collision de nom de base temporaire: {}",
            path.display()
        );

        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap_or_else(|e| panic!("création de {}: {e}", path.display()));

        sqlx::query("CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT)")
            .execute(&pool)
            .await
            .expect("création de la table sessions de test");

        for (id, cwd) in [
            (KNOWN_SESSION, Some(KNOWN_CWD)),
            (NULL_CWD_SESSION, None),
            (BLANK_CWD_SESSION, Some("   ")),
        ] {
            sqlx::query("INSERT INTO sessions (id, cwd) VALUES (?1, ?2)")
                .bind(id)
                .bind(cwd)
                .execute(&pool)
                .await
                .unwrap_or_else(|e| panic!("insertion de la session {id}: {e}"));
        }

        Self { path, pool }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    /// Closes the pool *before* unlinking: on Windows an open SQLite handle
    /// blocks the delete, and the handle can be released a beat after `close`.
    async fn cleanup(self) {
        let Self { path, pool } = self;
        pool.close().await;
        for attempt in 0..20 {
            match std::fs::remove_file(&path) {
                Ok(()) => return,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
                Err(e) if attempt == 19 => {
                    eprintln!("nettoyage de {} impossible: {e}", path.display())
                }
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(50)).await,
            }
        }
    }
}

/// App state backed by the temporary DB, so `session_id` lookups hit our rows.
fn state_on(pool: SqlitePool) -> AppState {
    AppState::new(
        pool,
        common::hermes_home(),
        HermesApi::new("http://127.0.0.1:1", None),
    )
}

/// Both `url` and `port` are null, or both are set and agree with each other.
fn assert_url_port_consistency(json: &serde_json::Value) {
    let url = &json["url"];
    let port = &json["port"];
    match (url.is_null(), port.is_null()) {
        (true, true) => {}
        (false, false) => {
            let port = port.as_i64().expect("port numérique ou null");
            assert!(
                PROBED_PORTS.contains(&port),
                "port {port} hors de la liste sondée: {PROBED_PORTS:?}"
            );
            let expected = format!("http://127.0.0.1:{port}");
            assert_eq!(
                url.as_str(),
                Some(expected.as_str()),
                "url incohérente avec le port {port}"
            );
        }
        _ => panic!("url et port doivent être null ensemble: url={url}, port={port}"),
    }
}

#[tokio::test]
async fn detect_without_session_id_returns_url_port_and_cwd() {
    let app = common::app(common::state().await);
    let (status, json) = get_json(app, "/api/preview/detect").await;

    assert_eq!(status, StatusCode::OK);
    assert!(json.is_object(), "objet JSON attendu, obtenu: {json}");
    for key in ["url", "port", "cwd"] {
        assert!(json.get(key).is_some(), "clé manquante: {key}");
    }
    // Sans session_id, aucun cwd ne peut être résolu.
    assert!(json["cwd"].is_null(), "cwd doit être null: {json}");
    assert_url_port_consistency(&json);
}

#[tokio::test]
async fn detect_with_unknown_session_id_does_not_panic_and_cwd_is_null() {
    let app = common::app(common::state().await);
    let (status, json) = get_json(
        app,
        "/api/preview/detect?session_id=20990101_000000_pas_une_session",
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    for key in ["url", "port", "cwd"] {
        assert!(json.get(key).is_some(), "clé manquante: {key}");
    }
    assert!(
        json["cwd"].is_null(),
        "session inconnue → cwd null attendu: {json}"
    );
    assert_url_port_consistency(&json);
}

#[tokio::test]
async fn detect_with_empty_session_id_ignores_it_and_cwd_is_null() {
    let app = common::app(common::state().await);
    let (status, json) = get_json(app, "/api/preview/detect?session_id=").await;

    assert_eq!(status, StatusCode::OK);
    assert!(
        json["cwd"].is_null(),
        "session_id vide → cwd null attendu: {json}"
    );
    assert_url_port_consistency(&json);
}

#[tokio::test]
async fn session_cwd_returns_the_inserted_cwd_and_none_without_one() {
    let db = TempDb::new().await;

    // Read through the production read-only path, after the writes are committed.
    let ro = hermes_db::open_ro(db.path())
        .await
        .unwrap_or_else(|e| panic!("ouverture lecture seule de {}: {e}", db.path().display()));

    let found = hermes_db::session_cwd(&ro, KNOWN_SESSION)
        .await
        .expect("lecture du cwd d'une session existante");
    assert_eq!(found.as_deref(), Some(KNOWN_CWD));

    let null_cwd = hermes_db::session_cwd(&ro, NULL_CWD_SESSION)
        .await
        .expect("lecture du cwd d'une session sans répertoire");
    assert_eq!(null_cwd, None, "cwd NULL → None attendu");

    let blank_cwd = hermes_db::session_cwd(&ro, BLANK_CWD_SESSION)
        .await
        .expect("lecture du cwd d'une session au cwd blanc");
    assert_eq!(blank_cwd, None, "cwd blanc → None attendu");

    let unknown = hermes_db::session_cwd(&ro, "session_qui_n_existe_pas")
        .await
        .expect("une session inconnue ne doit pas être une erreur");
    assert_eq!(unknown, None);

    ro.close().await;
    db.cleanup().await;
}

#[tokio::test]
async fn detect_uses_the_cwd_of_the_requested_session() {
    let db = TempDb::new().await;
    let app = common::app(state_on(db.pool.clone()));

    let (status, json) = get_json(
        app.clone(),
        &format!("/api/preview/detect?session_id={KNOWN_SESSION}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["cwd"].as_str(),
        Some(KNOWN_CWD),
        "le cwd de la session doit remonter tel quel: {json}"
    );
    assert_url_port_consistency(&json);

    // A session row exists but has no cwd: still null, still 200.
    let (status, json) = get_json(
        app,
        &format!("/api/preview/detect?session_id={NULL_CWD_SESSION}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["cwd"].is_null(), "cwd absent → null attendu: {json}");

    db.cleanup().await;
}
