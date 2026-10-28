//! Hermes API client: capabilities probe, session creation, SSE passthrough.
//!
//! The bearer key is read from `<HERMES_HOME>/.env` and never logged, never
//! serialized, never forwarded to the browser.

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde_json::json;

const CAPABILITIES_PATH: &str = "/v1/capabilities";
const SESSIONS_PATH: &str = "/api/sessions";
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const CONTROL_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum UpstreamError {
    #[error("clé API Hermes absente (API_SERVER_KEY)")]
    MissingKey,
    #[error("API Hermes injoignable: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("API Hermes a répondu {status}: {body}")]
    Status { status: StatusCode, body: String },
}

pub struct HermesApi {
    base: String,
    api_key: Option<String>,
    http: Client,
}

impl std::fmt::Debug for HermesApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HermesApi")
            .field("base", &self.base)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

impl HermesApi {
    pub fn new(base_url: impl Into<String>, api_key: Option<String>) -> Self {
        let base = base_url.into().trim_end_matches('/').to_string();
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .user_agent("hermes-cockpit/0.1")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            base,
            api_key,
            http,
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn has_key(&self) -> bool {
        self.api_key.is_some()
    }

    fn request(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.api_key.as_deref() {
            Some(key) => builder.bearer_auth(key),
            None => builder,
        }
    }

    /// `GET /v1/capabilities` returning 200 — the API half of `/api/health`.
    pub async fn capabilities(&self) -> Result<(), String> {
        if self.api_key.is_none() {
            return Err("clé API Hermes absente (API_SERVER_KEY)".to_string());
        }

        let response = self
            .request(
                self.http
                    .get(format!("{}{CAPABILITIES_PATH}", self.base)),
            )
            .timeout(PROBE_TIMEOUT)
            .send()
            .await
            .map_err(|error| format!("API Hermes injoignable: {error}"))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "API Hermes HTTP {} sur {CAPABILITIES_PATH}",
                response.status().as_u16()
            ))
        }
    }

    /// Relays `POST /api/sessions` untouched: the front expects `{object, session}`.
    pub async fn create_session(
        &self,
        title: Option<&str>,
    ) -> Result<(StatusCode, Vec<u8>), UpstreamError> {
        if self.api_key.is_none() {
            return Err(UpstreamError::MissingKey);
        }
        let body = match title {
            Some(title) => json!({ "title": title }),
            None => json!({}),
        };

        let response = self
            .request(self.http.post(format!("{}{SESSIONS_PATH}", self.base)))
            .json(&body)
            .timeout(CONTROL_TIMEOUT)
            .send()
            .await?;

        let status = response.status();
        let payload = response.bytes().await?;
        Ok((status, payload.to_vec()))
    }

    /// Opens the upstream SSE stream. The caller pipes `bytes_stream()` into the
    /// response body; dropping it cancels the upstream request.
    pub async fn chat_stream(
        &self,
        session_id: &str,
        message: &str,
    ) -> Result<reqwest::Response, UpstreamError> {
        self.chat_stream_with_images(session_id, message, &[], None, None, None, None).await
    }

    /// Comme [`Self::chat_stream`], avec des images collées dans le composer.
    ///
    /// `images` sont des data-URL (`data:image/png;base64,…`) : l'API Hermes
    /// accepte les parties `image_url` / `input_image`, pas les fichiers joints.
    pub async fn chat_stream_with_images(
        &self,
        session_id: &str,
        message: &str,
        images: &[String],
        provider: Option<&str>,
        model: Option<&str>,
        effort: Option<&str>,
        instructions: Option<&str>,
    ) -> Result<reqwest::Response, UpstreamError> {
        if self.api_key.is_none() {
            return Err(UpstreamError::MissingKey);
        }
        let url = format!(
            "{}{SESSIONS_PATH}/{}/chat/stream",
            self.base,
            encode_path_segment(session_id)
        );

        let message_value = if images.is_empty() {
            json!(message)
        } else {
            let mut parts = vec![json!({ "type": "text", "text": message })];
            for image in images {
                parts.push(json!({ "type": "image_url", "image_url": { "url": image } }));
            }
            json!(parts)
        };

        // Le tour peut porter son propre couple fournisseur/modèle et l'effort de
        // raisonnement : c'est ce que l'API expose via `model_options`.
        let mut payload = json!({ "message": message_value });
        let object = payload.as_object_mut().expect("objet json");
        if let Some(provider) = provider.filter(|v| !v.is_empty()) {
            object.insert("provider".into(), json!(provider));
        }
        if let Some(model) = model.filter(|v| !v.is_empty()) {
            object.insert("model".into(), json!(model));
        }
        if let Some(effort) = effort.filter(|v| !v.is_empty()) {
            object.insert(
                "model_options".into(),
                json!({ "reasoning": { "enabled": true, "effort": effort } }),
            );
        }
        // Consigne d'effort : sans elle, le réglage ne change rien sur les
        // fournisseurs qui n'exploitent pas `reasoning.effort`.
        if let Some(instructions) = instructions.filter(|v| !v.is_empty()) {
            object.insert("system_message".into(), json!(instructions));
        }

        let response = self
            .request(self.http.post(url))
            .json(&payload)
            .send()
            .await?;

        if response.status().is_success() {
            Ok(response)
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(UpstreamError::Status {
                status,
                body: truncate(&body, 500),
            })
        }
    }
}

/// True when `opencode` exists on `PATH` (npm shims included).
pub fn binary_on_path(name: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    let candidates = [
        name.to_string(),
        format!("{name}.exe"),
        format!("{name}.cmd"),
        format!("{name}.bat"),
    ];

    std::env::split_paths(&path).any(|dir| {
        candidates
            .iter()
            .any(|candidate| dir.join(candidate).is_file())
    })
}

fn encode_path_segment(raw: &str) -> String {
    let mut encoded = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    value.chars().take(max_chars).collect::<String>() + "…"
}

impl HermesApi {
    /// `GET /api/model/options` — catalogue du picker (providers + modèles).
    pub async fn model_options(&self) -> Result<(StatusCode, Vec<u8>), UpstreamError> {
        if self.api_key.is_none() {
            return Err(UpstreamError::MissingKey);
        }
        let url = self.base.clone() + "/api/model/options";
        let response = self
            .request(self.http.get(url))
            .timeout(CONTROL_TIMEOUT)
            .send()
            .await?;
        let status = response.status();
        let payload = response.bytes().await?;
        Ok((status, payload.to_vec()))
    }

    /// `POST /api/sessions/{id}/model` — verrouille le modèle d'une session.
    pub async fn lock_session_model(
        &self,
        session_id: &str,
        body: &serde_json::Value,
    ) -> Result<(StatusCode, Vec<u8>), UpstreamError> {
        if self.api_key.is_none() {
            return Err(UpstreamError::MissingKey);
        }
        let url = self.base.clone()
            + SESSIONS_PATH
            + "/"
            + &encode_path_segment(session_id)
            + "/model";
        let response = self
            .request(self.http.post(url))
            .json(body)
            .timeout(CONTROL_TIMEOUT)
            .send()
            .await?;
        let status = response.status();
        let payload = response.bytes().await?;
        Ok((status, payload.to_vec()))
    }
}
