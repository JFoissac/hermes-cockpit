//! Reasoning (thinking) and tool-argument previews on the messages contract.
//!
//! Same discipline as the other integration tests: the real Hermes `state.db`,
//! read-only, so the SQL is proven against the actual schema — plus one tiny
//! throwaway database for the rows a healthy DB never contains.

mod common;

use hermes_cockpit_server::hermes_db::{self, TOOL_PREVIEW_MAX_CHARS};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

/// Every message must carry both new keys, nullable or not — never absent.
#[tokio::test]
async fn messages_expose_reasoning_and_tool_preview_keys() {
    let pool = common::pool().await;
    let sessions = hermes_db::sessions(&pool, 20)
        .await
        .expect("lecture des sessions");

    for session in &sessions {
        let messages = hermes_db::messages_since(&pool, &session.id, 0, 200, true)
            .await
            .expect("lecture des messages");
        if messages.is_empty() {
            continue;
        }

        let json = serde_json::to_value(&messages).expect("sérialisation JSON");
        let array = json.as_array().expect("tableau JSON de messages");
        assert_eq!(array.len(), messages.len());
        for message in array {
            assert!(message.get("reasoning").is_some(), "clé `reasoning` absente");
            assert!(
                message.get("tool_preview").is_some(),
                "clé `tool_preview` absente"
            );
            for key in ["id", "session_id", "role", "content", "timestamp"] {
                assert!(message.get(key).is_some(), "champ manquant: {key}");
            }
        }

        // The thinking is real data, not a placeholder: some assistant turn has it.
        assert!(
            messages
                .iter()
                .any(|m| m.role == "assistant" && m.reasoning.as_deref().is_some_and(|r| !r.is_empty())),
            "session {} : aucun raisonnement exploitable sur {} messages",
            session.id,
            messages.len()
        );
        for message in messages.iter().filter(|m| m.reasoning.is_some()) {
            let reasoning = message.reasoning.as_deref().unwrap();
            assert!(!reasoning.is_empty());
            assert_eq!(reasoning, reasoning.trim(), "raisonnement non nettoyé");
        }
        return;
    }

    panic!("aucune session réelle avec messages");
}

/// Real tool rows answer calls: the arguments preview of the call they belong to.
#[tokio::test]
async fn tool_rows_carry_an_arguments_preview() {
    let pool = common::pool().await;
    let sessions = hermes_db::sessions(&pool, 60)
        .await
        .expect("lecture des sessions");
    assert!(!sessions.is_empty(), "au moins une session réelle attendue");

    let mut sessions_with_tool_rows = 0usize;
    for session in sessions.iter().filter(|s| s.tool_call_count > 0) {
        let messages = hermes_db::messages_since(&pool, &session.id, 0, 200, false)
            .await
            .expect("lecture des messages");
        let tool_rows: Vec<_> = messages.iter().filter(|m| m.role == "tool").collect();
        if tool_rows.is_empty() {
            continue;
        }
        sessions_with_tool_rows += 1;

        let with_preview: Vec<_> = tool_rows
            .iter()
            .filter(|m| m.tool_preview.as_deref().is_some_and(|p| !p.trim().is_empty()))
            .collect();
        if with_preview.is_empty() {
            continue;
        }

        for row in &with_preview {
            let preview = row.tool_preview.as_deref().unwrap();
            assert!(
                preview.chars().count() <= TOOL_PREVIEW_MAX_CHARS + 1,
                "aperçu trop long ({} chars): {preview}",
                preview.chars().count()
            );
            assert!(!preview.contains('\n'), "aperçu multi-ligne: {preview:?}");
            assert_ne!(preview, "null");
            assert_ne!(preview, "{}");
        }
        assert!(
            with_preview.iter().any(|m| !m
                .tool_preview
                .as_deref()
                .unwrap()
                .starts_with(['{', '['])),
            "aucun aperçu lisible (que du JSON brut): {:?}",
            with_preview
                .iter()
                .map(|m| m.tool_preview.clone())
                .collect::<Vec<_>>()
        );
        assert!(
            with_preview.iter().all(|m| m.tool_name.is_some()),
            "une ligne d'outil doit garder son tool_name"
        );
        return;
    }

    panic!(
        "aucune ligne role='tool' avec tool_preview non vide ({} sessions à lignes d'outils inspectées)",
        sessions_with_tool_rows
    );
}

/// Tolerance to a corrupt row: broken `tool_calls` must not fail the request.
#[tokio::test]
async fn broken_tool_calls_do_not_break_the_query() {
    let dir = std::env::temp_dir().join(format!("cockpit-messages-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dossier temporaire");
    let path = dir.join("state.db");
    let _ = std::fs::remove_file(&path);

    let writer = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true),
        )
        .await
        .expect("création de la base de test");

    sqlx::query(
        r#"
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            tool_call_id TEXT,
            tool_calls TEXT,
            tool_name TEXT,
            timestamp REAL NOT NULL,
            reasoning TEXT,
            reasoning_content TEXT
        )
        "#,
    )
    .execute(&writer)
    .await
    .expect("schéma minimal");

    type Row<'a> = (
        &'a str,
        Option<&'a str>,
        Option<&'a str>,
        Option<&'a str>,
        Option<&'a str>,
        f64,
        Option<&'a str>,
        Option<&'a str>,
    );
    let rows: [Row; 4] = [
        // 1 — user turn
        ("user", Some("salut"), None, None, None, 1.0, None, None),
        // 2 — tool result whose `tool_calls` is truncated JSON
        ("tool", Some("sortie"), Some("call_1"), Some(r#"[{"function":"#), Some("terminal"), 2.0, None, None),
        // 3 — assistant turn: reasoning + a well-formed call
        (
            "assistant",
            None,
            None,
            Some(r#"[{"id":"call_2","function":{"name":"terminal","arguments":"{\"command\":\"ls -la\"}"}}]"#),
            None,
            3.0,
            None,
            Some("L'utilisateur veut lister le dossier."),
        ),
        // 4 — tool result answering call_2
        ("tool", Some("total 0"), Some("call_2"), None, Some("terminal"), 4.0, None, None),
    ];
    for (role, content, call_id, calls, name, ts, reasoning, reasoning_content) in rows {
        sqlx::query(
            "INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, reasoning, reasoning_content)
             VALUES ('sess-test', ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(role)
        .bind(content)
        .bind(call_id)
        .bind(calls)
        .bind(name)
        .bind(ts)
        .bind(reasoning)
        .bind(reasoning_content)
        .execute(&writer)
        .await
        .expect("insertion");
    }
    writer.close().await;

    let pool = hermes_db::open_ro(&path)
        .await
        .expect("ouverture lecture seule du fichier de test");
    let messages = hermes_db::messages_since(&pool, "sess-test", 0, 50, false)
        .await
        .expect("une ligne au JSON cassé ne doit pas faire échouer la requête");
    pool.close().await;
    let _ = std::fs::remove_dir_all(&dir);

    assert_eq!(messages.len(), 4, "toutes les lignes lisibles doivent sortir");
    assert_eq!(messages[1].role, "tool");
    assert!(
        messages[1].tool_preview.is_none(),
        "JSON cassé → aucun aperçu, pas de panique : {:?}",
        messages[1].tool_preview
    );
    assert_eq!(
        messages[2].reasoning.as_deref(),
        Some("L'utilisateur veut lister le dossier.")
    );
    assert_eq!(messages[2].tool_preview.as_deref(), Some("ls -la"));
    assert_eq!(
        messages[3].tool_preview.as_deref(),
        Some("ls -la"),
        "la ligne d'outil hérite des arguments de l'appel qui la précède"
    );
}

/// Argument shaping: talking field first, raw string otherwise, hard cap.
#[test]
fn preview_picks_talking_fields_and_truncates() {
    use serde_json::json;

    // `arguments` as the model sends it: JSON serialized into a string.
    let call = |arguments: serde_json::Value| {
        json!([{ "id": "c1", "function": { "name": "t", "arguments": arguments } }]).to_string()
    };

    assert_eq!(
        hermes_db::tool_preview_from_calls(
            Some(&call(json!(r#"{"command":"git status"}"#))),
            Some("c1")
        )
        .as_deref(),
        Some("git status")
    );
    assert_eq!(
        hermes_db::tool_preview_from_calls(
            Some(&call(json!(r#"{"pattern":"TODO|FIXME","path":"src"}"#))),
            Some("c1")
        )
        .as_deref(),
        Some("TODO|FIXME")
    );
    // Object arguments (some providers skip the string hop).
    assert_eq!(
        hermes_db::tool_preview_from_calls(Some(&call(json!({"query": "moi" }))), None).as_deref(),
        Some("moi")
    );
    // Plain text arguments are kept verbatim (whitespace collapsed).
    assert_eq!(
        hermes_db::tool_preview_from_calls(Some(&call(json!("ligne   un\nligne deux"))), None)
            .as_deref(),
        Some("ligne un ligne deux")
    );
    // Unknown fields: no raw-JSON soup when a talking field exists elsewhere.
    assert_eq!(
        hermes_db::tool_preview_from_calls(
            Some(&call(json!(r#"{"path":"/tmp/a","content":"x"}"#))),
            None
        )
        .as_deref(),
        Some("/tmp/a")
    );
    // Unparsable JSON, empty, or no arguments → None, never a panic.
    assert_eq!(hermes_db::tool_preview_from_calls(Some("[{oops"), None), None);
    assert_eq!(hermes_db::tool_preview_from_calls(Some("not json"), None), None);
    assert_eq!(hermes_db::tool_preview_from_calls(Some("[]"), None), None);
    assert_eq!(hermes_db::tool_preview_from_calls(Some(""), None), None);
    assert_eq!(hermes_db::tool_preview_from_calls(None, None), None);
    // A missing call_id in a batch shows nothing rather than the wrong call.
    let batch = json!([
        { "id": "other", "function": { "name": "t", "arguments": "{\"command\":\"nope\"}" } },
        { "id": "other2", "function": { "name": "t", "arguments": "{\"command\":\"nope2\"}" } }
    ])
    .to_string();
    assert_eq!(hermes_db::tool_preview_from_calls(Some(&batch), Some("c9")), None);
    // A single-call row is unambiguous even without an id match.
    let single = json!([
        { "id": "other", "function": { "name": "t", "arguments": "{\"command\":\"only\"}" } }
    ])
    .to_string();
    assert_eq!(
        hermes_db::tool_preview_from_calls(Some(&single), Some("c9")).as_deref(),
        Some("only")
    );

    let long = "x".repeat(TOOL_PREVIEW_MAX_CHARS * 2);
    let truncated =
        hermes_db::tool_preview_from_calls(Some(&call(json!(long))), None).expect("aperçu tronqué");
    assert_eq!(truncated.chars().count(), TOOL_PREVIEW_MAX_CHARS + 1);
    assert!(truncated.ends_with('…'));
}
