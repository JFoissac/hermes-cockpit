//! Serializable shapes of the HTTP contract.
//!
//! The field names are the contract: `web/src/types/api.ts` consumes them
//! verbatim, so no `rename_all` here except for the deliberate `apiDetail` and
//! the two enum spellings.

use serde::{Deserialize, Serialize};

/// Where a session comes from, from the UI's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionOrigin {
    #[serde(rename = "Hermes")]
    Hermes,
    #[serde(rename = "OpenCode")]
    OpenCode,
}

impl SessionOrigin {
    /// ACP rows are the ones opened by an external agent client (OpenCode);
    /// everything else is a Hermes-native session.
    pub fn from_source(source: &str, model: Option<&str>, cwd: Option<&str>) -> Self {
        fn mentions_opencode(value: &str) -> bool {
            value.to_ascii_lowercase().contains("opencode")
        }

        let external = source.eq_ignore_ascii_case("acp")
            || source.eq_ignore_ascii_case("opencode")
            || model.is_some_and(mentions_opencode)
            || cwd.is_some_and(mentions_opencode);

        if external {
            Self::OpenCode
        } else {
            Self::Hermes
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub title: Option<String>,
    pub source: String,
    pub model: Option<String>,
    pub parent_session_id: Option<String>,
    pub running: bool,
    pub message_count: i64,
    pub tool_call_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub last_activity_at: Option<f64>,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub origin: SessionOrigin,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessageDelta {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tool_name: Option<String>,
    /// The model's thinking for this turn (`reasoning` / `reasoning_content`).
    /// `null` when the row carries none — the UI then shows no thinking block.
    #[serde(default)]
    pub reasoning: Option<String>,
    /// First ~180 chars of the tool-call arguments, human-shaped
    /// (`command`, `path`, `pattern`, `query`), never raw JSON.
    #[serde(default)]
    pub tool_preview: Option<String>,
    pub timestamp: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Subagent {
    pub id: String,
    pub parent_id: String,
    pub goal: String,
    pub state: String,
    pub dispatched_at: f64,
    pub completed_at: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Ok,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpencodeStatus {
    Ok,
    Down,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Health {
    pub api: HealthStatus,
    pub db: HealthStatus,
    pub opencode: OpencodeStatus,
    /// Present only when the Hermes API probe failed; never contains a secret.
    #[serde(rename = "apiDetail", skip_serializing_if = "Option::is_none")]
    pub api_detail: Option<String>,
}
