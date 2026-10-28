//! Hermes Cockpit server: bootstrap, logging, bind on 127.0.0.1:8791.

use anyhow::Context;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

use hermes_cockpit_server::routes;
use hermes_cockpit_server::state::AppState;

const DEFAULT_PORT: u16 = 8791;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=warn,hyper=warn")),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let state = AppState::from_env().await?;
    let port = std::env::var("PORT")
        .ok()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let app = routes::router(state.clone());

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("bind {addr}"))?;

    tracing::info!(
        %addr,
        started_at = %chrono::Utc::now().to_rfc3339(),
        db = %state.db_path().display(),
        hermes_home = %state.hermes_home.display(),
        api_base = state.api.base(),
        api_key_present = state.api.has_key(),
        "hermes-cockpit-server prêt"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("serveur axum")?;

    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("arrêt demandé");
}
