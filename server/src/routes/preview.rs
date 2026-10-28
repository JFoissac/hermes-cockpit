//! Détection du serveur de développement d'un projet, pour l'aperçu intégré.
//!
//! Le navigateur ne peut pas sonder des ports locaux : c'est le service Rust qui
//! le fait, puis le front charge l'URL trouvée dans le cadre d'aperçu.

use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use tokio::net::TcpStream;

use crate::routes::ApiError;
use crate::state::AppState;

/// Cache court : la détection lance un processus PowerShell (~300 ms).
static CACHE: Mutex<Option<(Instant, Option<String>, String)>> = Mutex::new(None);
const CACHE_TTL: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
pub struct DetectQuery {
    session_id: Option<String>,
    /// Texte de la conversation : on y cherche le projet dont on parle.
    hint: Option<String>,
}

/// Répertoires de projets connus, sous la racine de développement.
/// Racines où chercher les projets. Surchargeables par `COCKPIT_PROJECT_ROOTS`
/// (chemins séparés par `;`), sinon le dossier de développement de l'utilisateur
/// courant — aucun chemin personnel n'est écrit dans le code.
fn project_roots() -> Vec<String> {
    if let Some(configured) = std::env::var_os("COCKPIT_PROJECT_ROOTS") {
        let value = configured.to_string_lossy().to_string();
        let roots: Vec<String> = value
            .split(';')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect();
        if !roots.is_empty() {
            return roots;
        }
    }
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let mut dev = home.to_string_lossy().to_string();
        dev.push_str("/Dev");
        roots.push(dev);
    }
    roots
}

/// Projets cités dans `hint`, du plus récent au plus ancien.
///
/// On compare le nom des dossiers de la racine de dev au texte de la
/// conversation : c'est ce qui permet de viser « le projet dont on parle » alors
/// que le cwd des sessions est toujours le dossier utilisateur.
fn projects_in_hint(hint: &str) -> Vec<String> {
    let lower = hint.to_lowercase();
    let mut hits: Vec<(usize, String)> = Vec::new();
    for root in project_roots() {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            // Un nom trop court ou trop générique produirait des faux positifs.
            if name.len() < 4 {
                continue;
            }
            if let Some(pos) = lower.rfind(&name.to_lowercase()) {
                hits.push((pos, format!("{root}/{name}")));
            }
        }
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0));
    hits.into_iter().map(|(_, path)| path).take(4).collect()
}

async fn reachable(port: u16) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_millis(180),
            TcpStream::connect(("127.0.0.1", port))
        )
        .await,
        Ok(Ok(_))
    )
}

/// Chemin au format Windows (antislashs) pour comparer aux lignes de commande.
fn normalized_cwd(cwd: &str) -> String {
    let backslash = char::from(92);
    let quote = char::from(39);
    cwd.replace(quote, "''")
        .chars()
        .map(|c| if c == '/' { backslash } else { c })
        .collect()
}

/// Ports écoutés par un processus dont la ligne de commande contient `cwd`.
async fn ports_of_project(cwd: &str) -> Vec<u16> {
    let script = format!(
        "$c='{}'; $pids = Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -and $_.CommandLine.Contains($c) }} | Select-Object -ExpandProperty ProcessId; \
         if ($pids) {{ Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {{ $pids -contains $_.OwningProcess }} | Select-Object -ExpandProperty LocalPort -Unique }}",
        // Windows : la ligne de commande contient des antislashs.
        normalized_cwd(&cwd),
    );
    let output = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .stdin(Stdio::null())
        .output()
        .await;
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u16>().ok())
        .filter(|port| *port != 8791)
        .collect()
}

/// `GET /api/preview/detect?session_id=…` → `{ url, port, cwd, source }`.
///
/// `url` vaut `null` quand aucun serveur ne répond : le front garde alors l'URL
/// saisie à la main.
pub async fn detect(
    State(state): State<AppState>,
    Query(query): Query<DetectQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = match query.session_id.as_deref() {
        Some(id) if !id.is_empty() => {
            crate::hermes_db::session_cwd(&state.db, id).await.unwrap_or(None)
        }
        _ => None,
    };

    // Clé de cache : le projet visé, pas le cwd (toujours le même ici).
    let candidates = query
        .hint
        .as_deref()
        .filter(|h| !h.is_empty())
        .map(projects_in_hint)
        .unwrap_or_default();
    let cache_key = candidates.first().cloned().unwrap_or_else(|| cwd.clone().unwrap_or_default());

    if let Ok(guard) = CACHE.lock() {
        if let Some((at, url, key)) = guard.as_ref() {
            if at.elapsed() < CACHE_TTL && key == &cache_key {
                // Même forme de réponse que le chemin normal : le front lit
                // `port` et `source`, une réponse partielle le casserait.
                let port = url
                    .as_deref()
                    .and_then(|value| value.rsplit(':').next())
                    .and_then(|value| value.parse::<u16>().ok());
                return Ok(Json(json!({
                    "url": url,
                    "port": port,
                    "cwd": cwd,
                    "source": "cache",
                })));
            }
        }
    }

    // 1. Le projet dont parle la conversation : on ne prend un serveur que s'il
    //    écoute depuis CE dossier. Le cwd des sessions ne sert pas (il vaut
    //    toujours le dossier utilisateur ici).
    let mut found: Option<u16> = None;
    let mut source = "project";
    let mut project: Option<String> = None;
    if !candidates.is_empty() {
        for dir in candidates.iter() {
            for port in ports_of_project(&dir).await {
                if reachable(port).await {
                    found = Some(port);
                    project = Some(dir.clone());
                    break;
                }
            }
            if found.is_some() {
                break;
            }
        }
    }

    // 2. Repli : un port usuel qui répond. On le REFUSE désormais : c'est
    //    exactement comme ça que l'aperçu affichait l'app d'un autre projet.
    //    Mieux vaut ne rien montrer et le dire.
    if found.is_none() {
        source = "aucun";
    }

    let url = found.map(|port| format!("http://127.0.0.1:{port}"));
    // Un repli dépend du projet demandé : on ne le met pas en cache.
    if source != "fallback" {
        if let Ok(mut guard) = CACHE.lock() {
            *guard = Some((Instant::now(), url.clone(), cache_key.clone()));
        }
    }

    Ok(Json(json!({
        "url": url,
        "port": found,
        "cwd": cwd,
        "source": source,
        "project": project,
    })))
}
