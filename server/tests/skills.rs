//! Skills: the catalogue on disk and the real `skill_view` usage of a session.
//!
//! Everything here runs against the actual `%LOCALAPPDATA%/hermes/skills` tree
//! and the actual read-only `state.db` — no fixtures, so drift is caught.

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use hermes_cockpit_server::hermes_db;
use http_body_util::BodyExt;
use tower::ServiceExt;

async fn get_json(app: axum::Router, uri: &str) -> (StatusCode, serde_json::Value) {
    let response = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
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

#[tokio::test]
async fn lists_real_skills_from_disk_with_a_non_empty_name() {
    let root = hermes_db::skills_root(&common::hermes_home());
    let entries = hermes_db::list_skills(&root);

    assert!(
        !entries.is_empty(),
        "aucun SKILL.md trouvé sous {}",
        root.display()
    );
    assert!(
        entries.iter().all(|e| !e.name.trim().is_empty()),
        "chaque skill doit avoir un nom (frontmatter ou dossier)"
    );
    assert!(entries.iter().all(|e| e.has_skill_md));
    assert!(
        entries.iter().all(|e| {
            e.path
                .rsplit('/')
                .next()
                .is_some_and(|file| file.eq_ignore_ascii_case("SKILL.md"))
        }),
        "chemin attendu vers un SKILL.md"
    );
    // Trié par catégorie puis nom.
    let keys: Vec<(String, String)> = entries
        .iter()
        .map(|e| (e.category.to_lowercase(), e.name.to_lowercase()))
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted, "catalogue non trié catégorie puis nom");

    // Les descriptions viennent du frontmatter, pas d'une valeur inventée.
    let animate = entries.iter().find(|e| e.name == "animate");
    if let Some(animate) = animate {
        assert!(
            animate.description.to_lowercase().contains("animat"),
            "description frontmatter attendue, obtenu: {:?}",
            animate.description
        );
    }
    // `animate` est un dossier-jonction Windows : il doit être suivi, pas ignoré.
    assert!(
        entries.iter().any(|e| e.name == "animate"),
        "skill `animate` absent du catalogue (jonction Windows non suivie ?)"
    );
    assert!(
        entries.iter().any(|e| e.name == "hermes-agent"),
        "skill `hermes-agent` attendu dans le catalogue"
    );
}

#[tokio::test]
async fn skills_endpoint_filters_on_q() {
    let app = common::app(common::state().await);
    let (status, all) = get_json(app.clone(), "/api/observatory/skills").await;
    assert_eq!(status, StatusCode::OK);
    let all = all.as_array().expect("tableau JSON de skills");
    assert!(!all.is_empty(), "au moins un skill réel attendu");
    for key in ["name", "description", "category", "path", "has_skill_md"] {
        assert!(all[0].get(key).is_some(), "champ manquant: {key}");
    }

    let (status, filtered) = get_json(app.clone(), "/api/observatory/skills?q=animate").await;
    assert_eq!(status, StatusCode::OK);
    let filtered = filtered.as_array().expect("tableau JSON de skills");
    assert!(
        filtered
            .iter()
            .any(|entry| entry["name"] == serde_json::json!("animate")),
        "q=animate doit inclure le skill animate: {:?}",
        filtered
            .iter()
            .map(|entry| entry["name"].clone())
            .collect::<Vec<_>>()
    );
    assert!(filtered.len() < all.len(), "le filtre doit réduire la liste");
    assert!(
        filtered.iter().all(|entry| {
            let haystack = format!(
                "{} {}",
                entry["name"].as_str().unwrap_or_default().to_lowercase(),
                entry["description"]
                    .as_str()
                    .unwrap_or_default()
                    .to_lowercase()
            );
            haystack.contains("animate")
        }),
        "toutes les entrées filtrées doivent contenir « animate »"
    );

    // Insensible à la casse.
    let (_, upper) = get_json(app.clone(), "/api/observatory/skills?q=ANIMATE").await;
    assert_eq!(upper.as_array().map(Vec::len), Some(filtered.len()));

    // Aucun match → tableau vide, pas d'erreur.
    let (status, none) = get_json(app, "/api/observatory/skills?q=zzz-pas-un-skill-zzz").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(none.as_array().map(Vec::len), Some(0));
}

#[tokio::test]
async fn real_session_skill_usage_counts_at_least_one_call() {
    let pool = common::pool().await;

    // The most recent session that really called `skill_view`.
    let row = sqlx::query_scalar::<_, String>(
        "SELECT session_id FROM messages WHERE tool_name = 'skill_view' ORDER BY id DESC LIMIT 1",
    )
    .fetch_optional(&pool)
    .await
    .expect("lecture de messages")
    .expect("au moins une session avec skill_view attendue");

    let usage = hermes_db::session_skill_usage(&pool, &row)
        .await
        .expect("usage des skills de la session");

    assert!(!usage.is_empty(), "session {row} sans skill détecté");
    assert!(
        usage.iter().any(|u| u.count >= 1 && !u.name.trim().is_empty()),
        "au moins une entrée avec count >= 1 attendue: {usage:?}"
    );
    assert!(
        usage.iter().all(|u| u.count >= 1 && u.last_used_ts > 0.0),
        "count et last_used_ts doivent être renseignés: {usage:?}"
    );
    let counts: Vec<i64> = usage.iter().map(|u| u.count).collect();
    let mut descending = counts.clone();
    descending.sort_by(|a, b| b.cmp(a));
    assert_eq!(counts, descending, "tri par count décroissant attendu");

    // Same thing through HTTP.
    let app = common::app(common::state().await);
    let (status, json) =
        get_json(app, &format!("/api/observatory/sessions/{row}/skills")).await;
    assert_eq!(status, StatusCode::OK);
    let json = json.as_array().expect("tableau JSON d'usage");
    assert!(!json.is_empty());
    for key in ["name", "count", "last_used_ts"] {
        assert!(json[0].get(key).is_some(), "champ manquant: {key}");
    }
    assert!(json[0]["count"].as_i64().unwrap_or(0) >= 1);
}

#[tokio::test]
async fn unknown_session_answers_an_empty_array() {
    let app = common::app(common::state().await);
    let (status, json) = get_json(
        app,
        "/api/observatory/sessions/20990101_000000_pas_une_session/skills",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().map(Vec::len), Some(0));
}

#[tokio::test]
async fn broken_tool_calls_json_never_panics() {
    let pool = common::pool().await;

    // Whatever the corpus holds, a truncated / garbage payload must not bubble
    // up as an error: the parser skips the row.
    assert!(hermes_db::session_skill_usage(&pool, "").await.is_ok());

    // Sessions whose tool_calls are not valid JSON (if any) must be readable.
    let broken: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT session_id FROM messages
         WHERE tool_calls IS NOT NULL
           AND tool_calls LIKE '%skill_view%'
           AND json_valid(tool_calls) = 0
         LIMIT 5
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("lecture des tool_calls cassés");

    for session_id in &broken {
        let usage = hermes_db::session_skill_usage(&pool, session_id)
            .await
            .unwrap_or_else(|e| panic!("session {session_id}: {e}"));
        assert!(usage.iter().all(|u| !u.name.trim().is_empty()));
    }

    // And a synthetic session id that cannot be valid at all.
    let app = common::app(common::state().await);
    let (status, json) = get_json(app, "/api/observatory/sessions/..%2F..%2Fetc/skills").await;
    assert_eq!(status, StatusCode::OK);
    assert!(json.is_array());
}
