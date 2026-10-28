//! Delegated subagents: mapping and tolerance to unparsable task JSON.

mod common;

use hermes_cockpit_server::hermes_db::{self, SUBAGENT_GOAL_FALLBACK};

#[tokio::test]
async fn maps_real_delegations() {
    let pool = common::pool().await;
    let subagents = hermes_db::subagents(&pool, 50)
        .await
        .expect("lecture des délégations");

    assert!(!subagents.is_empty(), "au moins une délégation réelle attendue");
    for subagent in &subagents {
        assert!(!subagent.id.is_empty(), "delegation_id vide");
        assert!(!subagent.parent_id.is_empty(), "parent_session_id vide");
        assert!(!subagent.state.is_empty(), "state vide");
        assert!(!subagent.goal.is_empty(), "goal vide");
        assert!(subagent.dispatched_at > 0.0, "dispatched_at doit être un epoch");
    }
    assert!(
        subagents.iter().any(|s| s.completed_at.is_some()),
        "au moins une délégation terminée attendue"
    );
}

#[test]
fn tolerates_broken_task_json() {
    assert_eq!(
        hermes_db::goal_from_task_json(Some("{ceci n'est pas du json")),
        SUBAGENT_GOAL_FALLBACK
    );
    assert_eq!(hermes_db::goal_from_task_json(None), SUBAGENT_GOAL_FALLBACK);
    assert_eq!(
        hermes_db::goal_from_task_json(Some("null")),
        SUBAGENT_GOAL_FALLBACK
    );
    assert_eq!(
        hermes_db::goal_from_task_json(Some(r#"{"goal": 42}"#)),
        SUBAGENT_GOAL_FALLBACK
    );
    assert_eq!(
        hermes_db::goal_from_task_json(Some(r#"{"goal": "   "}"#)),
        SUBAGENT_GOAL_FALLBACK
    );
    assert_eq!(
        hermes_db::goal_from_task_json(Some(r#"{"goal": "Implémenter le serveur"}"#)),
        "Implémenter le serveur"
    );
}
