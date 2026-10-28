//! Dictation: local speech-to-text, honestly reported.
//!
//! Two local engines are supported, in this order:
//!
//! 1. an explicit whisper binary (`CROQ_WHISPER_BIN`) — an operator who names a
//!    binary means it, so it wins over anything auto-detected;
//! 2. sherpa-onnx (NeMo Parakeet TDT) through the Node addon already shipped
//!    with the desktop app: `node scripts/transcribe.mjs <wav> <modele>`. This
//!    is the engine that actually works inside the Tauri webview, where the Web
//!    Speech API does not exist;
//! 3. `whisper-cli` found on `PATH`.
//!
//! Without any of those, `GET /status` reports `engine = "browser"` (a real
//! browser can still transcribe with the Web Speech API) and `POST /transcribe`
//! answers 501 — so a caller cannot mistake silence for success.
//!
//! `POST /transcribe` never fabricates a transcript: every failure mode — bad
//! base64, unsupported container, missing node, timeout, non-zero exit, empty
//! decoder output — maps to an explicit error carrying the underlying detail.
//!
//! Env overrides (all optional): `COCKPIT_SHERPA_ADDON`, `COCKPIT_SPEECH_MODEL`,
//! `COCKPIT_NODE_BIN`, `COCKPIT_DICTATION_SCRIPT`, `CROQ_WHISPER_BIN`.
//!
//! `engine = "none"` is part of the wire contract for a future build without a
//! browser, but the server cannot observe the client: it answers `browser` when
//! it has no local engine.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::routes::ApiError;

/// Language used by the browser and by the local decoder.
pub const LANGUAGE: &str = "fr-FR";

const TIMEOUT: Duration = Duration::from_secs(30);
/// Loading the 652 MB int8 encoder takes ~7 s, decoding a sentence ~1 s: 60 s
/// leaves room for a cold page cache without hanging a request forever.
const SHERPA_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
const MAX_DETAIL_CHARS: usize = 300;
const ENV_BIN: &str = "CROQ_WHISPER_BIN";
const ENV_SHERPA_ADDON: &str = "COCKPIT_SHERPA_ADDON";
const ENV_SPEECH_MODEL: &str = "COCKPIT_SPEECH_MODEL";
const ENV_NODE_BIN: &str = "COCKPIT_NODE_BIN";
const ENV_DICTATION_SCRIPT: &str = "COCKPIT_DICTATION_SCRIPT";

/// The Node addon shipped with OpenChamber on this machine.
/// Chemins par défaut du moteur local, résolus depuis l'environnement de la
/// machine : aucun chemin absolu d'utilisateur n'est codé en dur (rien qui
/// permette d'identifier quelqu'un dans le dépôt).
fn default_sherpa_addon() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("COCKPIT_SHERPA_ADDON") {
        return Some(PathBuf::from(explicit));
    }
    let local = std::env::var_os("LOCALAPPDATA")?;
    Some(
        PathBuf::from(local).join(
            "Programs/@openchamberelectron/resources/app.asar.unpacked/node_modules/\
             sherpa-onnx-win-x64/sherpa-onnx.node",
        ),
    )
}

/// Modèle Parakeet TDT 0.6b v3 (int8, multilingue) installé par l'utilisateur,
/// résolu depuis son profil : aucun chemin personnel n'est écrit dans le code.
fn default_speech_model() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("COCKPIT_SPEECH_MODEL") {
        return Some(PathBuf::from(explicit));
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(
        ".config/openchamber/speech-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    ))
}

#[cfg(windows)]
const BINARY_NAMES: [&str; 5] = [
    "whisper-cli.exe",
    "whisper-cli.cmd",
    "whisper-cli.bat",
    "whisper-cli.com",
    "whisper-cli",
];
#[cfg(not(windows))]
const BINARY_NAMES: [&str; 1] = ["whisper-cli"];

#[cfg(windows)]
const NODE_NAMES: [&str; 4] = ["node.exe", "node.cmd", "node.bat", "node"];
#[cfg(not(windows))]
const NODE_NAMES: [&str; 1] = ["node"];

#[derive(Debug, Serialize)]
pub struct StatusBody {
    pub available: bool,
    pub engine: &'static str,
    pub language: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TranscribeBody {
    pub audio_base64: String,
    pub format: String,
}

#[derive(Debug, Serialize)]
pub struct TranscriptBody {
    pub text: String,
    pub engine: &'static str,
    pub language: &'static str,
}

/// Everything needed to shell out to `node scripts/transcribe.mjs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sherpa {
    pub node: PathBuf,
    pub script: PathBuf,
    pub addon: PathBuf,
    pub model: PathBuf,
}

impl Sherpa {
    /// Short, human-readable identity of the model, for status and errors.
    fn model_name(&self) -> String {
        self.model
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.model.display().to_string())
    }
}

/// The local engine that will actually run, if any.
#[derive(Debug)]
enum Engine {
    Whisper(PathBuf),
    Sherpa(Sherpa),
}

/// Explicit whisper override first (the operator named it), then sherpa-onnx,
/// then whisper-cli discovered on `PATH`.
fn select_engine() -> Option<Engine> {
    if let Some(bin) = explicit_whisper() {
        return Some(Engine::Whisper(bin));
    }
    if let Some(sherpa) = detect_sherpa() {
        return Some(Engine::Sherpa(sherpa));
    }
    path_whisper().map(Engine::Whisper)
}

/// `GET /api/dictation/status` — where the transcription will happen.
pub async fn status() -> Json<StatusBody> {
    let body = match select_engine() {
        Some(Engine::Sherpa(sherpa)) => StatusBody {
            available: true,
            engine: "local",
            language: LANGUAGE,
            detail: Some(format!(
                "transcription locale via sherpa-onnx / Parakeet ({}, aucune clé d'API)",
                sherpa.model_name()
            )),
        },
        Some(Engine::Whisper(bin)) => StatusBody {
            available: true,
            engine: "local",
            language: LANGUAGE,
            detail: Some(format!(
                "transcription locale via {} (aucune clé d'API)",
                bin.display()
            )),
        },
        None => StatusBody {
            available: true,
            engine: "browser",
            language: LANGUAGE,
            detail: Some(
                "la transcription se fait dans le navigateur (Web Speech API), sans clé d'API ; \
                 aucun binaire local configuré"
                    .to_string(),
            ),
        },
    };

    Json(body)
}

/// `POST /api/dictation/transcribe` — local decoding, or an honest 501.
pub async fn transcribe(
    Json(body): Json<TranscribeBody>,
) -> Result<Json<TranscriptBody>, ApiError> {
    let format = body.format.trim();
    if format.is_empty() || format.len() > 16 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "format audio manquant (wav, webm, ogg…)",
        ));
    }
    let format = format.to_string();

    let audio = decode_base64(&body.audio_base64).map_err(|reason| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("audio_base64 invalide : {reason}"),
        )
    })?;
    if audio.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "audio_base64 vide"));
    }
    if audio.len() > MAX_AUDIO_BYTES {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "audio trop volumineux ({} octets, maximum {MAX_AUDIO_BYTES})",
                audio.len()
            ),
        ));
    }

    // No engine at all: say so, exactly as before, without pretending.
    let Some(engine) = select_engine() else {
        return Err(ApiError::new(
            StatusCode::NOT_IMPLEMENTED,
            "local transcription not configured",
        ));
    };

    let text = match engine {
        Engine::Whisper(bin) => run_local(&bin, &audio)
            .await
            .map_err(|failure| failure.into_api_error(&bin.display().to_string(), TIMEOUT))?,
        Engine::Sherpa(sherpa) => transcribe_with_sherpa(&sherpa, &format, &audio).await?,
    };

    Ok(Json(TranscriptBody {
        text,
        engine: "local",
        language: LANGUAGE,
    }))
}

/* ── sherpa-onnx via Node ──────────────────────────────────────────────── */

/// Only WAV is decodable by the local script: refuse other containers clearly
/// instead of handing it bytes it would misread.
pub fn is_wav_format(format: &str) -> bool {
    matches!(format.trim().to_ascii_lowercase().as_str(), "wav" | "wave")
}

/// `audio` is the decoded payload of a WAV that the front already resampled to
/// 16 kHz mono. It goes through a temp file because the Node script takes a path.
async fn transcribe_with_sherpa(
    sherpa: &Sherpa,
    format: &str,
    audio: &[u8],
) -> Result<String, ApiError> {
    if !is_wav_format(format) {
        return Err(ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            format!(
                "le moteur local (sherpa-onnx) n'accepte que du WAV PCM 16 kHz mono ; \
                 format reçu : {format}"
            ),
        ));
    }

    let wav_path = temp_wav_path();
    tokio::fs::write(&wav_path, audio).await.map_err(|error| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("écriture du WAV temporaire impossible : {error}"),
        )
    })?;

    let outcome = run_sherpa(sherpa, &wav_path).await;
    // Best effort: a leaked temp file is not worth failing a transcription.
    let _ = tokio::fs::remove_file(&wav_path).await;

    outcome.map_err(|failure| failure.into_sherpa_api_error(sherpa))
}

/// One process per request: `node scripts/transcribe.mjs <wav> <modele> <addon>`.
async fn run_sherpa(sherpa: &Sherpa, wav: &Path) -> Result<String, RunFailure> {
    let mut command = Command::new(&sherpa.node);
    command
        .arg(&sherpa.script)
        .arg(wav)
        .arg(&sherpa.model)
        .arg(&sherpa.addon)
        .env(ENV_SHERPA_ADDON, &sherpa.addon)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // No console window may flash when the desktop app spawns node.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let child = command
        .spawn()
        .map_err(|error| RunFailure::Spawn(format!("{} : {error}", sherpa.node.display())))?;

    match tokio::time::timeout(SHERPA_TIMEOUT, child.wait_with_output()).await {
        Err(_) => Err(RunFailure::Timeout),
        Ok(Err(error)) => Err(RunFailure::Spawn(error.to_string())),
        Ok(Ok(output)) => collect_output(&output),
    }
}

/// One temp file per request: pid + nanoseconds, so two concurrent dictations
/// can never overwrite each other's audio.
fn temp_wav_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "cockpit-dictation-{}-{nanos}.wav",
        std::process::id()
    ))
}

fn env_path(key: &str) -> Option<PathBuf> {
    let raw = std::env::var(key).ok()?;
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

fn path_var() -> Option<String> {
    std::env::var_os("PATH").map(|value| value.to_string_lossy().into_owned())
}

/// sherpa-onnx is usable when the addon, a complete model directory, the Node
/// script and a node binary are all present. Node comes from `PATH` so a
/// stripped `PATH` disables the engine instead of half-enabling it.
fn detect_sherpa() -> Option<Sherpa> {
    detect_sherpa_in(
        env_path(ENV_SHERPA_ADDON).as_deref(),
        env_path(ENV_SPEECH_MODEL).as_deref(),
        std::env::var(ENV_NODE_BIN).ok().as_deref(),
        path_var().as_deref(),
        env_path(ENV_DICTATION_SCRIPT),
    )
}

/// Same detection with every input injected, so tests never touch the process
/// environment (and never race each other).
pub fn detect_sherpa_in(
    addon: Option<&Path>,
    model: Option<&Path>,
    node_override: Option<&str>,
    path_var: Option<&str>,
    script_override: Option<PathBuf>,
) -> Option<Sherpa> {
    let addon = addon
        .map(Path::to_path_buf)
        .or_else(default_sherpa_addon)?;
    if !is_runnable(&addon) {
        return None;
    }

    let model = model
        .map(Path::to_path_buf)
        .or_else(default_speech_model)?;
    if !model_is_transducer(&model) {
        return None;
    }

    let script = match script_override {
        Some(path) if is_runnable(&path) => path,
        Some(_) => return None,
        None => find_script()?,
    };

    let node = node_binary(node_override, path_var)?;

    Some(Sherpa {
        node,
        script,
        addon,
        model,
    })
}

/// A Parakeet-style offline model: encoder/decoder/joiner `.onnx` + `tokens.txt`.
pub fn model_is_transducer(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .map(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase())
        .collect();

    let has = |stem: &str| {
        names
            .iter()
            .any(|name| name.starts_with(stem) && name.ends_with(".onnx"))
    };

    names.iter().any(|name| name == "tokens.txt")
        && has("encoder")
        && has("decoder")
        && has("joiner")
}

/// `COCKPIT_NODE_BIN` first, then `node` on `PATH`.
fn node_binary(node_override: Option<&str>, path_var: Option<&str>) -> Option<PathBuf> {
    if let Some(raw) = node_override {
        let trimmed = raw.trim().trim_matches('"');
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if is_runnable(&candidate) {
                return Some(candidate);
            }
        }
    }

    for dir in split_search_path(path_var?) {
        for name in NODE_NAMES {
            let candidate = dir.join(name);
            if is_runnable(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

/// The script lives in the repo (`server/scripts`), so a dev build finds it
/// through `CARGO_MANIFEST_DIR`; a packaged build finds it next to the exe.
fn find_script() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(exe) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        candidates.push(exe.join("scripts/transcribe.mjs"));
        candidates.push(exe.join("../scripts/transcribe.mjs"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/transcribe.mjs"));
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("scripts/transcribe.mjs"));
        candidates.push(cwd.join("../scripts/transcribe.mjs"));
    }
    candidates.push(PathBuf::from("scripts/transcribe.mjs"));

    first_existing(&candidates)
}

fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| is_runnable(path)).cloned()
}

/// Explicit `CROQ_WHISPER_BIN` only — the user named it, so it wins.
fn explicit_whisper() -> Option<PathBuf> {
    detect_in(std::env::var(ENV_BIN).ok().as_deref(), None)
}

/// whisper-cli discovered on `PATH`.
fn path_whisper() -> Option<PathBuf> {
    detect_in(None, path_var().as_deref())
}

/* ── whisper ───────────────────────────────────────────────────────────── */

/// Same detection, with both inputs injected so tests never touch the process
/// environment (and never race each other).
pub fn detect_in(explicit: Option<&str>, path_var: Option<&str>) -> Option<PathBuf> {
    if let Some(raw) = explicit {
        let trimmed = raw.trim().trim_matches('"');
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if is_runnable(&candidate) {
                return Some(candidate);
            }
        }
    }

    for dir in split_search_path(path_var?) {
        for name in BINARY_NAMES {
            let candidate = dir.join(name);
            if is_runnable(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

fn split_search_path(path_var: &str) -> Vec<PathBuf> {
    let separator = if cfg!(windows) { ';' } else { ':' };
    path_var
        .split(separator)
        .map(|entry| entry.trim().trim_matches('"'))
        .filter(|entry| !entry.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn is_runnable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

enum RunFailure {
    Spawn(String),
    Timeout,
    Exit { code: String, stderr: String },
    Empty,
}

impl RunFailure {
    fn into_api_error(self, label: &str, timeout: Duration) -> ApiError {
        match self {
            RunFailure::Timeout => ApiError::new(
                StatusCode::GATEWAY_TIMEOUT,
                format!("{label} n'a pas répondu en {} s", timeout.as_secs()),
            ),
            RunFailure::Spawn(reason) => ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!(
                    "{label} n'a pas pu démarrer : {}",
                    truncate_detail(&reason)
                ),
            ),
            RunFailure::Exit { code, stderr } => ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!(
                    "{label} a échoué (code {code}) : {}",
                    truncate_detail(&stderr)
                ),
            ),
            RunFailure::Empty => ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("{label} n'a produit aucun texte"),
            ),
        }
    }

    /// sherpa-onnx wording: name the engine and the model, keep the real stderr.
    fn into_sherpa_api_error(self, sherpa: &Sherpa) -> ApiError {
        let label = format!("sherpa-onnx ({})", sherpa.model_name());
        match self {
            RunFailure::Timeout => ApiError::new(
                StatusCode::GATEWAY_TIMEOUT,
                format!(
                    "{label} n'a pas répondu en {} s",
                    SHERPA_TIMEOUT.as_secs()
                ),
            ),
            RunFailure::Spawn(reason) => ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!(
                    "{label} n'a pas pu lancer node ({}) : {}",
                    sherpa.node.display(),
                    truncate_detail(&reason)
                ),
            ),
            RunFailure::Exit { code, stderr } => ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!(
                    "transcription locale impossible (code {code}) : {}",
                    truncate_detail(&stderr)
                ),
            ),
            RunFailure::Empty => ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("{label} n'a reconnu aucune parole dans cet audio"),
            ),
        }
    }
}

/// Audio on stdin, transcript on stdout, 30 s at most. The child is killed if
/// this future is dropped (client disconnect).
async fn run_local(bin: &Path, audio: &[u8]) -> Result<String, RunFailure> {
    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| RunFailure::Spawn(error.to_string()))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(audio)
            .await
            .map_err(|error| RunFailure::Spawn(format!("écriture sur stdin : {error}")))?;
        // Dropping `stdin` closes the pipe: the decoder sees EOF.
    }

    match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
        Err(_) => Err(RunFailure::Timeout),
        Ok(Err(error)) => Err(RunFailure::Spawn(error.to_string())),
        Ok(Ok(output)) => collect_output(&output),
    }
}

/// A non-zero exit is a failure; an empty stdout is *not* a transcript.
fn collect_output(output: &std::process::Output) -> Result<String, RunFailure> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let code = output
            .status
            .code()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "signal".to_string());
        return Err(RunFailure::Exit { code, stderr });
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Err(RunFailure::Empty);
    }
    Ok(text)
}

fn truncate_detail(raw: &str) -> String {
    let cleaned = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return "(aucune sortie d'erreur)".to_string();
    }
    let mut truncated: String = cleaned.chars().take(MAX_DETAIL_CHARS).collect();
    if cleaned.chars().count() > MAX_DETAIL_CHARS {
        truncated.push('…');
    }
    truncated
}

fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Standard base64 decoder, padding optional. Kept in-tree: the audio path is
/// the only caller and a dependency for 30 lines would not pay for itself.
pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;

    for byte in input.bytes() {
        if byte.is_ascii_whitespace() {
            continue;
        }
        if byte == b'=' {
            break;
        }
        let value = base64_value(byte)
            .ok_or_else(|| format!("caractère inattendu '{}'", byte as char))?;
        buffer = ((buffer << 6) | u32::from(value)) & 0xffff;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{
        decode_base64, detect_in, detect_sherpa_in, first_existing, is_wav_format,
        model_is_transducer, node_binary, temp_wav_path, truncate_detail, MAX_DETAIL_CHARS,
    };
    use std::path::{Path, PathBuf};

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cockpit-dictation-unit-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dossier temporaire créable");
        dir
    }

    fn touch(path: &Path) {
        std::fs::write(path, b"").expect("fichier temporaire écrit");
    }

    fn node_name() -> &'static str {
        if cfg!(windows) {
            "node.exe"
        } else {
            "node"
        }
    }

    #[test]
    fn decodes_padded_and_unpadded_base64() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGk").unwrap(), b"hi");
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert_eq!(decode_base64(" aGk\n").unwrap(), b"hi");
        assert!(decode_base64("a$k").is_err(), "alphabet invalide refusé");
    }

    #[test]
    fn detection_without_binary_returns_none() {
        let empty = std::env::temp_dir().join("cockpit-dictation-empty-path");
        let _ = std::fs::create_dir_all(&empty);
        let path_var = empty.to_string_lossy().into_owned();

        assert!(detect_in(None, None).is_none());
        assert!(detect_in(Some("   "), Some(&path_var)).is_none());
        assert!(detect_in(Some("/nope/whisper-cli"), Some(&path_var)).is_none());
    }

    #[test]
    fn truncation_caps_error_output() {
        let long = "x".repeat(MAX_DETAIL_CHARS * 2);
        let short = truncate_detail(&long);
        assert_eq!(short.chars().count(), MAX_DETAIL_CHARS + 1);
        assert!(short.ends_with('…'));
        assert_eq!(truncate_detail("  \n "), "(aucune sortie d'erreur)");
        assert_eq!(truncate_detail(" a   b "), "a b");
    }

    #[test]
    fn only_wav_containers_reach_the_local_decoder() {
        assert!(is_wav_format("wav"));
        assert!(is_wav_format("WAV"));
        assert!(is_wav_format(" wave "));
        assert!(!is_wav_format("webm"));
        assert!(!is_wav_format("ogg"));
        assert!(!is_wav_format(""));
    }

    #[test]
    fn model_dir_needs_encoder_decoder_joiner_and_tokens() {
        let dir = temp_dir("model-ok");
        for name in [
            "encoder.int8.onnx",
            "decoder.int8.onnx",
            "joiner.int8.onnx",
            "tokens.txt",
        ] {
            touch(&dir.join(name));
        }
        assert!(model_is_transducer(&dir), "modèle Parakeet complet accepté");

        // Un fichier manquant suffit à refuser le dossier.
        std::fs::remove_file(dir.join("joiner.int8.onnx")).unwrap();
        assert!(!model_is_transducer(&dir), "joiner absent → modèle refusé");

        let empty = temp_dir("model-empty");
        assert!(!model_is_transducer(&empty));
        assert!(!model_is_transducer(Path::new("C:/nope/nowhere")));

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&empty);
    }

    #[test]
    fn node_lookup_prefers_override_then_path() {
        let dir = temp_dir("node-path");
        touch(&dir.join(node_name()));
        let path_var = dir.to_string_lossy().into_owned();

        let found = node_binary(None, Some(&path_var)).expect("node trouvé sur le PATH");
        assert_eq!(found.parent(), Some(dir.as_path()));

        let explicit = found.to_string_lossy().into_owned();
        assert_eq!(
            node_binary(Some(&explicit), None).as_deref(),
            Some(found.as_path())
        );
        assert!(node_binary(Some("C:/nope/node.exe"), Some("")).is_none());
        assert!(node_binary(None, Some("")).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sherpa_detection_requires_every_piece() {
        let dir = temp_dir("sherpa");
        let addon = dir.join("sherpa-onnx.node");
        touch(&addon);
        let model = dir.join("model");
        std::fs::create_dir_all(&model).unwrap();
        for name in [
            "encoder.int8.onnx",
            "decoder.int8.onnx",
            "joiner.int8.onnx",
            "tokens.txt",
        ] {
            touch(&model.join(name));
        }
        let node = dir.join(node_name());
        touch(&node);
        let script = dir.join("transcribe.mjs");
        touch(&script);
        let path_var = dir.to_string_lossy().into_owned();

        let detected = detect_sherpa_in(
            Some(&addon),
            Some(&model),
            None,
            Some(&path_var),
            Some(script.clone()),
        )
        .expect("toutes les pièces réunies → moteur détecté");
        assert_eq!(detected.model, model);
        assert_eq!(detected.node, node);
        assert_eq!(detected.script, script);

        // PATH sans node : pas de détection partielle.
        assert!(detect_sherpa_in(
            Some(&addon),
            Some(&model),
            None,
            Some(""),
            Some(script.clone())
        )
        .is_none());
        // Addon absent : idem.
        assert!(detect_sherpa_in(
            Some(&dir.join("absent.node")),
            Some(&model),
            None,
            Some(&path_var),
            Some(script.clone())
        )
        .is_none());
        // Modèle incomplet : idem.
        std::fs::remove_file(model.join("tokens.txt")).unwrap();
        assert!(detect_sherpa_in(
            Some(&addon),
            Some(&model),
            None,
            Some(&path_var),
            Some(script)
        )
        .is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn first_existing_skips_missing_candidates() {
        let dir = temp_dir("first");
        let scripts = dir.join("scripts");
        std::fs::create_dir_all(&scripts).unwrap();
        let script = scripts.join("transcribe.mjs");
        touch(&script);

        let candidates = vec![
            dir.join("nope/transcribe.mjs"),
            script.clone(),
            dir.join("other/transcribe.mjs"),
        ];
        assert_eq!(
            first_existing(&candidates).as_deref(),
            Some(script.as_path())
        );
        assert!(first_existing(&[]).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn temp_wav_paths_are_unique_and_wav_suffixed() {
        let first = temp_wav_path();
        let second = temp_wav_path();
        assert_ne!(first, second, "deux dictées ne partagent pas le même fichier");
        for path in [&first, &second] {
            assert_eq!(
                path.extension().and_then(|value| value.to_str()),
                Some("wav")
            );
            assert_eq!(path.parent(), Some(std::env::temp_dir().as_path()));
        }
    }
}
