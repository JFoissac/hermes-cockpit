//! Dictation endpoints: honest status, honest 501, and a broken binary that
//! must never be mistaken for a transcript.
//!
//! Env-dependent assertions run under one mutex because `std::env` is shared by
//! the whole test binary; the detection itself is exercised through `detect_in`
//! so the other tests never touch the process environment.

mod common;

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Mutex;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

use hermes_cockpit_server::routes::dictation;
use hermes_cockpit_server::state::AppState;

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn lock_env() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Sets (or clears) a variable and restores the previous value on drop.
struct EnvVar {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvVar {
    fn set(key: &'static str, value: Option<&str>) -> Self {
        let previous = std::env::var_os(key);
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
        Self { key, previous }
    }
}

impl Drop for EnvVar {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

/// A throwaway directory holding a fake `whisper-cli` (or nothing at all).
fn temp_dir(tag: &str) -> PathBuf {
    let unique = format!(
        "hermes-cockpit-dictation-{tag}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    );
    let dir = std::env::temp_dir().join(unique);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("dossier temporaire créable");
    dir
}

fn fake_binary_name() -> &'static str {
    if cfg!(windows) {
        "whisper-cli.exe"
    } else {
        "whisper-cli"
    }
}

fn write_fake_binary(dir: &std::path::Path) -> PathBuf {
    let path = dir.join(fake_binary_name());
    std::fs::write(&path, b"").expect("faux binaire écrit");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).unwrap();
    }
    path
}

async fn get_json(state: AppState, uri: &str) -> (StatusCode, Value) {
    let response = common::app(state)
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).expect("JSON valide"))
}

async fn post_json(state: AppState, uri: &str, body: Value) -> (StatusCode, Value) {
    let response = common::app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).expect("JSON valide"))
}

#[tokio::test]
async fn status_reports_browser_and_transcribe_is_not_implemented_without_binary() {
    let state = common::state().await;
    let _guard = lock_env();
    let empty = temp_dir("empty-path");
    let _path = EnvVar::set("PATH", Some(&empty.to_string_lossy()));
    let _bin = EnvVar::set("CROQ_WHISPER_BIN", None);

    let (status_code, body) = get_json(state.clone(), "/api/dictation/status").await;
    assert_eq!(status_code, StatusCode::OK);
    assert_eq!(body["engine"], "browser", "aucun binaire → navigateur");
    assert_eq!(body["available"], true, "le navigateur transcrit toujours");
    assert_eq!(body["language"], "fr-FR");
    let detail = body["detail"].as_str().expect("detail attendu");
    assert!(
        detail.contains("navigateur"),
        "detail doit expliquer la transcription navigateur: {detail}"
    );

    let (status_code, body) = post_json(
        state,
        "/api/dictation/transcribe",
        json!({ "audio_base64": "aGVsbG8=", "format": "webm" }),
    )
    .await;
    assert_eq!(status_code, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(
        body["error"], "local transcription not configured",
        "aucune transcription inventée sans binaire"
    );

    let _ = std::fs::remove_dir_all(&empty);
}

#[tokio::test]
async fn detection_finds_fake_binary_in_temp_dir() {
    let dir = temp_dir("fake-bin");
    let binary = write_fake_binary(&dir);
    let path_var = dir.to_string_lossy().into_owned();

    let found = dictation::detect_in(None, Some(&path_var)).expect("faux whisper-cli détecté");
    assert_eq!(found, binary, "le binaire trouvé vient du dossier temporaire");

    // An explicit env path wins, and a missing one is not trusted.
    let explicit = binary.to_string_lossy().into_owned();
    assert_eq!(
        dictation::detect_in(Some(&explicit), None).as_deref(),
        Some(binary.as_path())
    );
    assert!(
        dictation::detect_in(Some("C:/nope/whisper-cli"), Some(&path_var)).is_some(),
        "le PATH reste consulté quand le chemin explicite est faux"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn status_switches_to_local_and_broken_binary_answers_502() {
    let state = common::state().await;
    let _guard = lock_env();
    let dir = temp_dir("broken-bin");
    let broken = write_fake_binary(&dir);
    let _bin = EnvVar::set("CROQ_WHISPER_BIN", Some(&broken.to_string_lossy()));

    let (status_code, body) = get_json(state.clone(), "/api/dictation/status").await;
    assert_eq!(status_code, StatusCode::OK);
    assert_eq!(body["engine"], "local");
    assert_eq!(body["available"], true);
    assert!(
        body["detail"]
            .as_str()
            .is_some_and(|detail| detail.contains("whisper-cli")),
        "detail doit nommer le binaire: {}",
        body["detail"]
    );

    // The fake binary cannot produce a transcript: 502, never a fake success.
    let (status_code, body) = post_json(
        state,
        "/api/dictation/transcribe",
        json!({ "audio_base64": "aGVsbG8=", "format": "wav" }),
    )
    .await;
    assert_eq!(status_code, StatusCode::BAD_GATEWAY, "échec = 502: {body}");
    assert!(body["error"].is_string(), "message d'erreur attendu");
    assert!(
        body["error"].as_str().unwrap().chars().count() <= 400,
        "le détail d'erreur reste raisonnable"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn transcribe_rejects_empty_audio_when_local_engine_is_configured() {
    let state = common::state().await;
    let _guard = lock_env();
    let dir = temp_dir("valid-bin");
    let binary = write_fake_binary(&dir);
    let _bin = EnvVar::set("CROQ_WHISPER_BIN", Some(&binary.to_string_lossy()));

    let (status_code, body) = post_json(
        state.clone(),
        "/api/dictation/transcribe",
        json!({ "audio_base64": "", "format": "wav" }),
    )
    .await;
    assert_eq!(status_code, StatusCode::BAD_REQUEST, "corps vide refusé: {body}");
    assert!(body["error"].as_str().unwrap().contains("vide"));

    let (status_code, body) = post_json(
        state,
        "/api/dictation/transcribe",
        json!({ "audio_base64": "aGVsbG8=", "format": "" }),
    )
    .await;
    assert_eq!(status_code, StatusCode::BAD_REQUEST, "format vide refusé: {body}");
    assert!(body["error"].as_str().unwrap().contains("format"));

    let _ = std::fs::remove_dir_all(&dir);
}
