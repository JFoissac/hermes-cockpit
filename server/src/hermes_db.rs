//! Read-only access to Hermes' `state.db`.
//!
//! Every pool built here is opened with `mode=ro` + `query_only`: a write is a
//! bug, and SQLite must reject it rather than the caller's discipline.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

use crate::model::{AgentSession, MessageDelta, SessionOrigin, Subagent};

/// Shown when `async_delegations.task_json` cannot be parsed.
pub const SUBAGENT_GOAL_FALLBACK: &str = "(objectif indisponible)";
const PREVIEW_MAX_CHARS: usize = 140;
/// Tool arguments are a one-line teaser in the transcript, not a dump.
pub const TOOL_PREVIEW_MAX_CHARS: usize = 180;
/// Argument keys that actually say what a call does, in decreasing usefulness
/// (`pattern`/`query` before `path`: for a search, what beats where).
const TOOL_PREVIEW_KEYS: [&str; 6] = ["command", "pattern", "query", "path", "file_path", "url"];

/// `HERMES_HOME`, else `%LOCALAPPDATA%/hermes`, else a POSIX-ish fallback.
pub fn resolve_hermes_home() -> Result<PathBuf> {
    if let Some(value) = std::env::var_os("HERMES_HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(value));
    }
    if let Some(value) = std::env::var_os("LOCALAPPDATA").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(value).join("hermes"));
    }
    if let Some(value) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(value).join(".local/share/hermes"));
    }
    anyhow::bail!("HERMES_HOME introuvable (ni HERMES_HOME ni LOCALAPPDATA)")
}

pub fn state_db_path(hermes_home: &Path) -> PathBuf {
    hermes_home.join("state.db")
}

/// Opens the state DB read-only. The pool is lazy: a missing database surfaces
/// as `/api/health` `db:"down"` and an error on the observatory endpoints,
/// instead of preventing the cockpit from booting at all.
pub async fn open_ro(path: &Path) -> Result<SqlitePool> {
    if !path.is_file() {
        anyhow::bail!("state.db introuvable: {}", path.display());
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false)
        .busy_timeout(Duration::from_millis(300))
        .pragma("query_only", "true");

    Ok(SqlitePoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(5))
        .connect_lazy_with(options))
}

/// Current unix time in seconds (the unit Hermes stores in REAL columns).
pub fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Répertoire de travail enregistré pour une session (sert à l'aperçu).
pub async fn session_cwd(pool: &SqlitePool, session_id: &str) -> Result<Option<String>> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT cwd FROM sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(pool)
            .await
            .context("lecture du cwd de session")?;
    Ok(row.and_then(|(cwd,)| cwd).filter(|c| !c.trim().is_empty()))
}

pub async fn ping(pool: &SqlitePool) -> Result<()> {
    sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(pool)
        .await
        .context("state.db illisible")?;
    Ok(())
}

/// Sessions whose turn lease has not expired.
pub async fn running_ids(pool: &SqlitePool, now: f64) -> Result<HashSet<String>> {
    let rows = sqlx::query("SELECT conversation_id FROM session_turn_leases WHERE expires_at > ?")
        .bind(now)
        .fetch_all(pool)
        .await
        .context("lecture de session_turn_leases")?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.get::<Option<String>, _>("conversation_id"))
        .collect())
}

pub async fn sessions(pool: &SqlitePool, limit: i64) -> Result<Vec<AgentSession>> {
    let running = running_ids(pool, now_epoch()).await?;

    let rows = sqlx::query(
        r#"
        SELECT s.id,
               s.title,
               s.source,
               s.model,
               s.parent_session_id,
               s.message_count,
               s.tool_call_count,
               s.input_tokens,
               s.output_tokens,
               s.estimated_cost_usd,
               COALESCE(s.last_activity_at, s.started_at) AS last_activity_at,
               s.cwd,
               s.git_branch,
               (SELECT m.content
                  FROM messages m
                 WHERE m.session_id = s.id
                   AND m.role = 'user'
                   AND m.content IS NOT NULL
                   AND LENGTH(TRIM(m.content)) > 0
                 ORDER BY m.timestamp, m.id
                 LIMIT 1) AS preview_raw
          FROM sessions s
         WHERE s.archived = 0
           AND s.hidden = 0
         ORDER BY COALESCE(s.last_activity_at, s.started_at) DESC
         LIMIT ?
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .context("lecture de sessions")?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let source = row.get::<Option<String>, _>("source").unwrap_or_default();
            let model = row.get::<Option<String>, _>("model");
            let cwd = row.get::<Option<String>, _>("cwd");
            let preview_raw = row.get::<Option<String>, _>("preview_raw");
            let running = running.contains(&id);

            AgentSession {
                origin: SessionOrigin::from_source(&source, model.as_deref(), cwd.as_deref()),
                id,
                title: row.get("title"),
                source,
                model,
                parent_session_id: row.get("parent_session_id"),
                running,
                message_count: row.get::<Option<i64>, _>("message_count").unwrap_or(0),
                tool_call_count: row.get::<Option<i64>, _>("tool_call_count").unwrap_or(0),
                input_tokens: row.get::<Option<i64>, _>("input_tokens").unwrap_or(0),
                output_tokens: row.get::<Option<i64>, _>("output_tokens").unwrap_or(0),
                cost_usd: row
                    .get::<Option<f64>, _>("estimated_cost_usd")
                    .unwrap_or(0.0),
                last_activity_at: row.get("last_activity_at"),
                cwd,
                git_branch: row.get("git_branch"),
                preview: shape_preview(preview_raw.as_deref()),
            }
        })
        .collect())
}

pub async fn messages_since(
    pool: &SqlitePool,
    session_id: &str,
    after_id: i64,
    limit: i64,
    chat_only: bool,
) -> Result<Vec<MessageDelta>> {
    // after_id = 0 → on veut la FIN de la conversation (les derniers messages), pas le début.
    // Les lignes sans texte (assistant vide d'un tour d'outils, session_meta) ne sont pas du chat.
    let rows = if after_id > 0 {
        sqlx::query(
            r#"
            SELECT m.id,
                   m.session_id,
                   m.role,
                   m.content,
                   m.tool_name,
                   m.timestamp,
                   COALESCE(NULLIF(m.reasoning, ''), NULLIF(m.reasoning_content, '')) AS reasoning_raw,
                   NULLIF(m.tool_calls, '') AS tool_calls_raw,
                   m.tool_call_id,
                   CASE WHEN m.role = 'tool' THEN (
                       SELECT a.tool_calls
                         FROM messages a
                        WHERE a.session_id = m.session_id
                          AND a.id < m.id
                          AND a.role = 'assistant'
                          AND a.tool_calls IS NOT NULL
                        ORDER BY a.id DESC
                        LIMIT 1
                   ) END AS previous_calls_raw
              FROM messages m
             WHERE m.session_id = ?1
               AND m.id > ?2
               AND m.role IN ('user', 'assistant', 'tool')
               AND (?4 = 0 OR m.role IN ('user', 'assistant'))
             ORDER BY m.id ASC
             LIMIT ?3
            "#,
        )
        .bind(session_id)
        .bind(after_id)
        .bind(limit)
        .bind(i64::from(chat_only))
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT * FROM (
                SELECT m.id,
                       m.session_id,
                       m.role,
                       m.content,
                       m.tool_name,
                       m.timestamp,
                       COALESCE(NULLIF(m.reasoning, ''), NULLIF(m.reasoning_content, '')) AS reasoning_raw,
                       NULLIF(m.tool_calls, '') AS tool_calls_raw,
                       m.tool_call_id,
                       CASE WHEN m.role = 'tool' THEN (
                           SELECT a.tool_calls
                             FROM messages a
                            WHERE a.session_id = m.session_id
                              AND a.id < m.id
                              AND a.role = 'assistant'
                              AND a.tool_calls IS NOT NULL
                            ORDER BY a.id DESC
                            LIMIT 1
                       ) END AS previous_calls_raw
                  FROM messages m
                 WHERE m.session_id = ?1
                   AND m.role IN ('user', 'assistant', 'tool')
                   AND (?3 = 0 OR m.role IN ('user', 'assistant'))
                   -- Sur une grosse session, les ?2 dernieres LIGNES sont souvent
                   -- presque toutes des outils : l'ecran parait vide. On cale donc
                   -- le debut sur le 40e dernier echange et on renvoie ce qui suit.
                   AND m.id >= COALESCE((
                       SELECT MIN(id) FROM (
                           SELECT id FROM messages
                            WHERE session_id = ?1
                              AND role = 'user'
                              AND length(coalesce(content, '')) > 0
                            ORDER BY id DESC
                            LIMIT 12
                       )
                   ), 0)
                 -- Les 800 dernières lignes à partir de ce plancher : on garde
                 -- toujours la fin de la conversation, jamais le début.
                 ORDER BY m.id DESC
                 LIMIT 800
            ) ORDER BY id ASC
            "#,
        )
        .bind(session_id)
        .bind(limit)
        .bind(i64::from(chat_only))
        .fetch_all(pool)
        .await
    }
    .context("lecture de messages")?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let tool_call_id = row.get::<Option<String>, _>("tool_call_id");
            // A tool result row has no `tool_calls` of its own: the arguments it
            // answers live on the assistant row just above it.
            let tool_preview = tool_preview_from_calls(
                row.get::<Option<String>, _>("tool_calls_raw").as_deref(),
                tool_call_id.as_deref(),
            )
            .or_else(|| {
                tool_preview_from_calls(
                    row.get::<Option<String>, _>("previous_calls_raw").as_deref(),
                    tool_call_id.as_deref(),
                )
            });

            MessageDelta {
                id: row.get::<i64, _>("id"),
                session_id: row.get::<Option<String>, _>("session_id").unwrap_or_default(),
                role: row.get::<Option<String>, _>("role").unwrap_or_default(),
                content: row.get::<Option<String>, _>("content").unwrap_or_default(),
                tool_name: row.get("tool_name"),
                reasoning: shape_reasoning(row.get::<Option<String>, _>("reasoning_raw").as_deref()),
                tool_preview,
                timestamp: row.get::<Option<f64>, _>("timestamp").unwrap_or(0.0),
            }
        })
        .collect())
}

/// The model's thinking, trimmed; `None` when the row has none.
///
/// Kept whole (no truncation): the UI collapses it behind a "thinking" toggle.
fn shape_reasoning(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.is_empty() {
        None
    } else {
        Some(raw.to_string())
    }
}

/// One-line teaser of a tool call's arguments, parsed from the `tool_calls`
/// JSON column (`[{"function":{"name":…,"arguments":"{…}"}}]`).
///
/// `call_id` pins the right entry when the row batches several calls. Anything
/// unparsable yields `None`: a broken row must never fail the query, and raw
/// JSON must never reach the transcript.
pub fn tool_preview_from_calls(raw: Option<&str>, call_id: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let calls = value.as_array()?;
    let call = pick_call(calls, call_id)?;
    let arguments = call.get("function")?.get("arguments")?;
    let text = preview_from_arguments(arguments)?;
    shape_tool_preview(&text)
}

/// The entry matching `call_id`; a single-call row is unambiguous, a batch is not.
fn pick_call<'a>(
    calls: &'a [serde_json::Value],
    call_id: Option<&str>,
) -> Option<&'a serde_json::Value> {
    if let Some(call_id) = call_id {
        let call_id = call_id.trim();
        if !call_id.is_empty() {
            if let Some(found) = calls.iter().find(|call| {
                ["id", "call_id"].iter().any(|key| {
                    call.get(*key)
                        .and_then(|value| value.as_str())
                        .is_some_and(|value| value == call_id)
                })
            }) {
                return Some(found);
            }
            // No match in a batch: refuse to display the wrong call's arguments.
            return if calls.len() == 1 { calls.first() } else { None };
        }
    }
    calls.first()
}

/// `arguments` is normally JSON-in-a-string; pull out the field that talks.
fn preview_from_arguments(arguments: &serde_json::Value) -> Option<String> {
    match arguments {
        serde_json::Value::String(raw) => {
            let raw = raw.trim();
            if raw.is_empty() {
                return None;
            }
            if let Ok(serde_json::Value::Object(map)) = serde_json::from_str(raw) {
                if let Some(found) = talking_field(&map) {
                    return Some(found);
                }
            }
            Some(raw.to_string())
        }
        serde_json::Value::Object(map) => talking_field(map)
            .or_else(|| serde_json::to_string(arguments).ok()),
        serde_json::Value::Null => None,
        other => Some(other.to_string()),
    }
}

/// First argument among [`TOOL_PREVIEW_KEYS`] holding a usable scalar.
fn talking_field(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    TOOL_PREVIEW_KEYS.iter().find_map(|key| {
        map.get(*key).and_then(scalar_text)
    })
}

fn scalar_text(value: &serde_json::Value) -> Option<String> {
    let text = match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::Bool(flag) => flag.to_string(),
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn shape_tool_preview(text: &str) -> Option<String> {
    let flattened = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.is_empty() {
        return None;
    }
    let mut preview: String = flattened.chars().take(TOOL_PREVIEW_MAX_CHARS).collect();
    if flattened.chars().count() > TOOL_PREVIEW_MAX_CHARS {
        preview.push('…');
    }
    Some(preview)
}

pub async fn subagents(pool: &SqlitePool, limit: i64) -> Result<Vec<Subagent>> {
    let rows = sqlx::query(
        r#"
        SELECT delegation_id, parent_session_id, state, task_json, dispatched_at, completed_at
          FROM async_delegations
         ORDER BY dispatched_at DESC
         LIMIT ?
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .context("lecture de async_delegations")?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let task_json = row.get::<Option<String>, _>("task_json");
            Subagent {
                id: row
                    .get::<Option<String>, _>("delegation_id")
                    .unwrap_or_default(),
                parent_id: row
                    .get::<Option<String>, _>("parent_session_id")
                    .unwrap_or_default(),
                goal: goal_from_task_json(task_json.as_deref()),
                state: row.get::<Option<String>, _>("state").unwrap_or_default(),
                dispatched_at: row.get::<Option<f64>, _>("dispatched_at").unwrap_or(0.0),
                completed_at: row.get("completed_at"),
            }
        })
        .collect())
}

/// `task_json.goal`, or the fallback string — never a panic, never `null`.
pub fn goal_from_task_json(raw: Option<&str>) -> String {
    let Some(raw) = raw else {
        return SUBAGENT_GOAL_FALLBACK.to_string();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return SUBAGENT_GOAL_FALLBACK.to_string();
    };
    value
        .get("goal")
        .and_then(|goal| goal.as_str())
        .map(str::trim)
        .filter(|goal| !goal.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| SUBAGENT_GOAL_FALLBACK.to_string())
}

/// One-line, bounded preview from the first user message of a session.
fn shape_preview(raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    let flattened = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.is_empty() {
        return None;
    }
    let mut preview: String = flattened.chars().take(PREVIEW_MAX_CHARS).collect();
    if flattened.chars().count() > PREVIEW_MAX_CHARS {
        preview.push('…');
    }
    Some(preview)
}

// ─────────────────────────────── Skills ──────────────────────────────────────
//
// Two questions, two sources:
//   * "what skills exist?" → the filesystem (`<HERMES_HOME>/skills`), no DB;
//   * "what did this session actually open?" → `messages`, read-only.
//
// The shapes below are the HTTP contract. They live here (instead of `model.rs`)
// because they are only ever produced by the two readers just underneath.

/// A skill folder found on disk. `category` is the folder path between the
/// skills root and the skill folder (`""` for a skill sitting at the root).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SkillEntry {
    pub name: String,
    pub description: String,
    pub category: String,
    pub path: String,
    pub has_skill_md: bool,
}

/// How many times a session actually called `skill_view` on a skill.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SkillUsage {
    pub name: String,
    pub count: i64,
    pub last_used_ts: f64,
}

/// Deepest folder nesting accepted while walking the skills tree
/// (`mlops/evaluation/<skill>/SKILL.md` is already 3 levels).
const SKILLS_MAX_DEPTH: usize = 6;
/// Upper bound on `messages` rows scanned for one session's skill usage.
pub const SESSION_SKILL_ROWS_LIMIT: i64 = 5000;

/// `<HERMES_HOME>/skills`, overridable with `COCKPIT_SKILLS_DIR`.
pub fn skills_root(hermes_home: &Path) -> PathBuf {
    std::env::var_os("COCKPIT_SKILLS_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| hermes_home.join("skills"))
}

/// Every `SKILL.md` under `root`, sorted by category then name.
///
/// Blocking by design (pure filesystem): call it from `spawn_blocking`.
/// Dot-folders (`.archive`, `.curator_backups`, …) are skipped — archived skills
/// are not available to the agent, so listing them would be a lie.
pub fn list_skills(root: &Path) -> Vec<SkillEntry> {
    let mut found = Vec::new();
    let mut visited: HashSet<PathBuf> = HashSet::new();
    walk_skills(root, root, 0, &mut found, &mut visited);
    found.sort_by(|a, b| {
        a.category
            .to_lowercase()
            .cmp(&b.category.to_lowercase())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    found
}

/// Case-insensitive filter on name + description; a blank `q` keeps everything.
pub fn filter_skills(entries: Vec<SkillEntry>, q: Option<&str>) -> Vec<SkillEntry> {
    let needle = q.unwrap_or("").trim().to_lowercase();
    if needle.is_empty() {
        return entries;
    }
    entries
        .into_iter()
        .filter(|entry| {
            entry.name.to_lowercase().contains(&needle)
                || entry.description.to_lowercase().contains(&needle)
        })
        .collect()
}

/// What the current folder looks like while walking.
///
/// Symlinks and Windows junctions are followed (several real skill folders are
/// junctions), guarded by `visited` on the canonical path so a loop cannot hang
/// the scan.
fn walk_skills(
    dir: &Path,
    root: &Path,
    depth: usize,
    out: &mut Vec<SkillEntry>,
    visited: &mut HashSet<PathBuf>,
) {
    if depth > SKILLS_MAX_DEPTH {
        return;
    }
    let canonical = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    if !visited.insert(canonical) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let mut subdirs: Vec<PathBuf> = Vec::new();
    let mut skill_md: Option<PathBuf> = None;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.eq_ignore_ascii_case("node_modules") {
            continue;
        }
        // `metadata` follows links; a dead link simply drops the entry.
        let Ok(metadata) = std::fs::metadata(entry.path()) else {
            continue;
        };
        if metadata.is_dir() {
            subdirs.push(entry.path());
        } else if metadata.is_file() && name.eq_ignore_ascii_case("SKILL.md") {
            skill_md = Some(entry.path());
        }
    }

    if let Some(frontmatter_path) = skill_md {
        if let Some(skill_entry) = read_skill(root, dir, &frontmatter_path) {
            out.push(skill_entry);
            // A skill folder is a leaf: its `references/` are not skills.
            return;
        }
    }

    for subdir in subdirs {
        walk_skills(&subdir, root, depth + 1, out, visited);
    }
}

fn read_skill(root: &Path, dir: &Path, skill_md: &Path) -> Option<SkillEntry> {
    let raw = std::fs::read_to_string(skill_md).ok()?;
    let (front_name, front_description) = parse_frontmatter(&raw);
    let folder = dir
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let name = front_name
        .filter(|value| !value.is_empty())
        .unwrap_or(folder);

    let category = dir
        .strip_prefix(root)
        .ok()
        .and_then(|rel| rel.parent())
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    Some(SkillEntry {
        name,
        description: front_description.unwrap_or_default(),
        category,
        path: display_path(skill_md),
        has_skill_md: true,
    })
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Minimal YAML frontmatter reader: only `name` and `description`, no crate.
///
/// Handles the three shapes the real files use: `key: value`, `key: "quoted"`,
/// and block scalars (`key: >`, `>-`, `|`, `|-`) folded into one line.
pub fn parse_frontmatter(text: &str) -> (Option<String>, Option<String>) {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    if !matches!(lines.next().map(str::trim), Some("---")) {
        return (None, None);
    }

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut block: Option<(char, Vec<String>)> = None;

    for line in lines {
        let trimmed = line.trim_end();
        if trimmed.trim() == "---" {
            break;
        }
        let indented = trimmed.starts_with(' ') || trimmed.starts_with('\t');

        // Continuation of a `>` / `|` block.
        if let Some((key, collected)) = block.as_mut() {
            if indented || trimmed.trim().is_empty() {
                collected.push(trimmed.trim().to_string());
                continue;
            }
            let value = join_block(collected);
            match *key {
                'n' => name = Some(value),
                _ => description = Some(value),
            }
            block = None;
        }

        let Some((key, value)) = trimmed.trim().split_once(':') else {
            continue;
        };
        let key = key.trim();
        if !key.eq_ignore_ascii_case("name") && !key.eq_ignore_ascii_case("description") {
            continue;
        }
        let value = value.trim();
        let marker = key.to_ascii_lowercase().chars().next().unwrap_or('d');

        if matches!(value, ">" | ">-" | ">+" | "|" | "|-" | "|+") {
            block = Some((marker, Vec::new()));
            continue;
        }

        let value = unquote(value);
        if marker == 'n' {
            name = Some(value);
        } else {
            description = Some(value);
        }
    }

    if let Some((key, collected)) = block {
        let value = join_block(&collected);
        match key {
            'n' => name = name.or(Some(value)),
            _ => description = description.or(Some(value)),
        }
    }

    (name, description)
}

/// Block scalar → single line (blank lines dropped, words joined by a space).
fn join_block(collected: &[String]) -> String {
    collected
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    let unquoted = if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        let inner = &value[1..value.len() - 1];
        inner.replace("\\\"", "\"").replace("\\\\", "\\")
    } else if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
        value[1..value.len() - 1].replace("''", "'")
    } else {
        value.to_string()
    };
    unquoted.trim().to_string()
}

/// `skill_view` calls of one session, counted per call id so the assistant row
/// (the call) and the tool row (the result) never double-count.
///
/// A missing session is just an empty list; an unreadable `tool_calls` payload
/// is skipped instead of failing the whole read.
pub async fn session_skill_usage(pool: &SqlitePool, session_id: &str) -> Result<Vec<SkillUsage>> {
    let rows = sqlx::query(
        r#"
        SELECT id, tool_name, tool_calls, content, tool_call_id, timestamp
          FROM messages
         WHERE session_id = ?1
           AND (tool_name = 'skill_view' OR tool_calls LIKE '%skill_view%')
         ORDER BY id DESC
         LIMIT ?2
        "#,
    )
    .bind(session_id)
    .bind(SESSION_SKILL_ROWS_LIMIT)
    .fetch_all(pool)
    .await
    .context("lecture des skill_view de la session")?;

    let observations: Vec<SkillRow> = rows
        .into_iter()
        .map(|row| {
            (
                row.get::<i64, _>("id"),
                row.get::<Option<String>, _>("tool_name"),
                row.get::<Option<String>, _>("tool_calls"),
                row.get::<Option<String>, _>("content"),
                row.get::<Option<String>, _>("tool_call_id"),
                row.get::<Option<f64>, _>("timestamp"),
            )
        })
        .collect();

    Ok(aggregate_skill_usage(observations))
}

/// One raw `messages` row, as read above.
type SkillRow = (
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<f64>,
);

/// Pure fold over `messages` rows: `(id, tool_name, tool_calls, content,
/// tool_call_id, timestamp)`.
///
/// The same `skill_view` call appears twice in the DB — once as the assistant's
/// `tool_calls` entry (with the arguments) and once as the tool result (with the
/// name in `content`, `tool_call_id` pointing back). Both are keyed on the call
/// id so one call is exactly one count; rows newer than the window are why the
/// result-only pass exists. Unreadable JSON is skipped, never fatal.
fn aggregate_skill_usage(rows: Vec<SkillRow>) -> Vec<SkillUsage> {
    // Pass 1: the calls themselves (authoritative — they carry arguments).
    let mut calls: HashMap<String, (String, f64)> = HashMap::new();
    for (id, _, tool_calls, _, _, timestamp) in &rows {
        let Some(raw) = tool_calls.as_deref() else {
            continue;
        };
        for (call_id, name) in skill_calls_from_tool_calls(raw, *id) {
            calls.insert(call_id, (name, timestamp.unwrap_or(0.0)));
        }
    }
    let known_calls: HashSet<String> = calls.keys().cloned().collect();

    // Pass 2: results whose call row is not in the window (old rows, truncation).
    for (id, tool_name, tool_calls, content, tool_call_id, timestamp) in &rows {
        if tool_name.as_deref() != Some("skill_view") {
            continue;
        }
        if tool_calls
            .as_deref()
            .is_some_and(|raw| !skill_calls_from_tool_calls(raw, *id).is_empty())
        {
            continue;
        }
        let call_id = tool_call_id.as_deref().unwrap_or("").trim().to_string();
        if !call_id.is_empty() && known_calls.contains(&call_id) {
            // Already counted from the assistant row.
            continue;
        }
        let Some(name) = content.as_deref().and_then(skill_name_from_result) else {
            continue;
        };
        let key = if call_id.is_empty() {
            format!("row{id}")
        } else {
            format!("tc:{call_id}")
        };
        calls
            .entry(key)
            .or_insert((name, timestamp.unwrap_or(0.0)));
    }

    let mut totals: HashMap<String, (i64, f64)> = HashMap::new();
    for (_, (name, ts)) in calls {
        let name = name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        let slot = totals.entry(name).or_insert((0, 0.0));
        slot.0 += 1;
        if ts > slot.1 {
            slot.1 = ts;
        }
    }

    let mut usage: Vec<SkillUsage> = totals
        .into_iter()
        .map(|(name, (count, last_used_ts))| SkillUsage {
            name,
            count,
            last_used_ts,
        })
        .collect();

    usage.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| b.last_used_ts.partial_cmp(&a.last_used_ts).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| a.name.cmp(&b.name))
    });
    usage
}

/// `(call_id, skill name)` pairs of the `skill_view` entries of a `tool_calls`
/// JSON array. Anything unreadable is skipped — never a panic.
fn skill_calls_from_tool_calls(raw: &str, row_id: i64) -> Vec<(String, String)> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };

    items
        .iter()
        .enumerate()
        .filter(|(_, item)| {
            item.get("function")
                .and_then(|function| function.get("name"))
                .and_then(|name| name.as_str())
                == Some("skill_view")
        })
        .filter_map(|(index, item)| {
            let name = item
                .get("function")
                .and_then(|function| function.get("arguments"))
                .and_then(skill_name_from_arguments)?;
            let call_id = item
                .get("id")
                .or_else(|| item.get("call_id"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("row{row_id}#{index}"));
            Some((call_id, name))
        })
        .collect()
}

/// `arguments` is either a JSON string (`"{\"name\": …}"`) or an object.
fn skill_name_from_arguments(arguments: &serde_json::Value) -> Option<String> {
    let value = match arguments {
        serde_json::Value::String(text) => serde_json::from_str::<serde_json::Value>(text).ok()?,
        other => other.clone(),
    };
    value
        .get("name")
        .and_then(|name| name.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

/// A `skill_view` result payload (`{"success":true,"name":"…"}`), tolerantly.
fn skill_name_from_result(raw: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    value
        .get("name")
        .and_then(|name| name.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod skills_tests {
    use super::*;

    #[test]
    fn parses_plain_quoted_and_block_frontmatter() {
        let plain = "---\nname: animate\ndescription: Build an animation from scratch.\n---\nbody";
        let (name, description) = parse_frontmatter(plain);
        assert_eq!(name.as_deref(), Some("animate"));
        assert_eq!(description.as_deref(), Some("Build an animation from scratch."));

        let quoted = "---\nname: codex\ndescription: \"Delegate coding to OpenAI Codex CLI (features, PRs).\"\nversion: 1.0.1\n---\n";
        let (name, description) = parse_frontmatter(quoted);
        assert_eq!(name.as_deref(), Some("codex"));
        assert_eq!(
            description.as_deref(),
            Some("Delegate coding to OpenAI Codex CLI (features, PRs).")
        );

        let folded = "---\nname: mlops\ndescription: >-\n  Runs harness\n  evaluations.\nmetadata:\n  hermes: {}\n---\n";
        let (name, description) = parse_frontmatter(folded);
        assert_eq!(name.as_deref(), Some("mlops"));
        assert_eq!(description.as_deref(), Some("Runs harness evaluations."));
    }

    #[test]
    fn tolerates_files_without_frontmatter() {
        assert_eq!(parse_frontmatter("# juste du markdown"), (None, None));
        assert_eq!(parse_frontmatter("---\nname: orphan\n"), (Some("orphan".into()), None));
    }

    #[test]
    fn counts_calls_once_per_call_id_and_survives_broken_json() {
        let rows: Vec<SkillRow> = vec![
            // Assistant row: two skill_view calls + one unrelated tool.
            (
                1,
                None,
                Some(
                    r#"[{"id":"c1","type":"function","function":{"name":"skill_view","arguments":"{\"name\": \"animate\"}"}},
                        {"id":"c2","type":"function","function":{"name":"skill_view","arguments":{"name":"codex"}}},
                        {"id":"c3","type":"function","function":{"name":"terminal","arguments":"{\"command\":\"ls\"}"}}]"#
                        .to_string(),
                ),
                None,
                None,
                Some(100.0),
            ),
            // Matching result rows: keyed on tool_call_id, so no double count.
            (2, Some("skill_view".into()), None, Some(r#"{"success":true,"name":"animate"}"#.into()), Some("c1".into()), Some(101.0)),
            (3, Some("skill_view".into()), None, Some(r#"{"success":true,"name":"codex"}"#.into()), Some("c2".into()), Some(102.0)),
            // Broken payloads: skipped, no panic.
            (4, None, Some("[{not json".to_string()), None, None, Some(103.0)),
            (5, Some("skill_view".into()), None, Some("<<garbage>>".into()), Some("c9".into()), Some(104.0)),
            // Result whose call row fell out of the window: still counted.
            (6, Some("skill_view".into()), None, Some(r#"{"success":true,"name":"sketch"}"#.into()), Some("c42".into()), Some(200.0)),
        ];

        let usage = aggregate_skill_usage(rows);
        let counts: HashMap<&str, i64> = usage.iter().map(|u| (u.name.as_str(), u.count)).collect();
        assert_eq!(counts.get("animate"), Some(&1));
        assert_eq!(counts.get("codex"), Some(&1));
        assert_eq!(counts.get("sketch"), Some(&1));
        assert_eq!(usage.len(), 3);
        // Tri par count desc puis récence.
        assert_eq!(usage[0].name, "sketch");
        assert_eq!(usage[0].last_used_ts, 200.0);
        // `terminal` n'est pas un skill.
        assert!(!counts.contains_key("terminal"));
    }

    #[test]
    fn filters_on_name_and_description_case_insensitively() {
        let entries = vec![
            SkillEntry {
                name: "animate".into(),
                description: "Build an animation".into(),
                category: String::new(),
                path: "a".into(),
                has_skill_md: true,
            },
            SkillEntry {
                name: "codex".into(),
                description: "Delegate to CLI".into(),
                category: "autonomous-ai-agents".into(),
                path: "b".into(),
                has_skill_md: true,
            },
        ];
        assert_eq!(filter_skills(entries.clone(), Some("ANIM")).len(), 1);
        assert_eq!(filter_skills(entries.clone(), Some("delegate")).len(), 1);
        assert_eq!(filter_skills(entries.clone(), Some("  ")).len(), 2);
        assert_eq!(filter_skills(entries, Some("zzz")).len(), 0);
    }
}

