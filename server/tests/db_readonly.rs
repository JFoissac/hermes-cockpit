//! The cockpit must never write to Hermes' state database.

mod common;

#[tokio::test]
async fn state_db_rejects_writes() {
    let path = common::state_db_path();
    assert!(
        path.is_file(),
        "state.db introuvable: {} (HERMES_HOME ?)",
        path.display()
    );

    let pool = common::pool().await;

    let ping: i64 = sqlx::query_scalar("SELECT 1")
        .fetch_one(&pool)
        .await
        .expect("lecture de state.db");
    assert_eq!(ping, 1);

    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .expect("comptage des sessions");
    assert!(sessions > 0, "state.db ne contient aucune session");

    let err = sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind("__cockpit_readonly_probe__")
        .execute(&pool)
        .await
        .expect_err("un DELETE doit échouer sur une connexion read-only");

    let message = err.to_string().to_lowercase();
    assert!(
        message.contains("readonly") || message.contains("read-only") || message.contains("read only"),
        "erreur inattendue (attendu: readonly database): {message}"
    );
}
