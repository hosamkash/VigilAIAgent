//! Vigil AI Agent — Rust backend.
//! Frontend talks to Rust only. Rust talks to Node sidecar with HMAC-signed IPC.
//! API keys live in a local app-support file (not Keychain) while device auth is off.

mod biometric;
mod dictate;
mod git_ops;
mod github_oauth;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, Mac};
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

type HmacSha256 = Hmac<Sha256>;

pub(crate) const KEYRING_SERVICE: &str = "com.vigil.agent";
const SIDECAR_PORT: u16 = 47821;

/// Mirror of frontend `DEVICE_AUTH_ENABLED`. Off until account login ships —
/// no Touch ID / password prompts; settings gate stays open.
const DEVICE_AUTH_ENABLED: bool = false;

/// Set ONLY after Touch ID succeeds for Settings (when DEVICE_AUTH_ENABLED).
/// While device auth is off, starts open and stays open.
static SETTINGS_GATE_OPEN: AtomicBool = AtomicBool::new(!DEVICE_AUTH_ENABLED);

/// Session cache so macOS Keychain is not hit on every chat turn.
static API_KEY_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn api_key_cache() -> &'static Mutex<HashMap<String, String>> {
    API_KEY_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn api_keys_file_path() -> PathBuf {
    app_support_dir().join("api_keys.json")
}

fn read_api_keys_file() -> HashMap<String, String> {
    let Ok(raw) = fs::read_to_string(api_keys_file_path()) else {
        return HashMap::new();
    };
    serde_json::from_str::<HashMap<String, String>>(&raw).unwrap_or_default()
}

fn write_api_keys_file(map: &HashMap<String, String>) -> Result<(), VigilError> {
    let dir = app_support_dir();
    fs::create_dir_all(&dir).map_err(|e| VigilError::Message(e.to_string()))?;
    let raw = serde_json::to_string_pretty(map)
        .map_err(|e| VigilError::Message(e.to_string()))?;
    fs::write(api_keys_file_path(), raw).map_err(|e| VigilError::Message(e.to_string()))
}

fn put_api_key_file(provider: &str, api_key: &str) -> Result<(), VigilError> {
    let mut map = read_api_keys_file();
    map.insert(provider.to_string(), api_key.to_string());
    write_api_keys_file(&map)
}

fn remove_api_key_file(provider: &str) -> Result<(), VigilError> {
    let mut map = read_api_keys_file();
    if map.remove(provider).is_some() {
        write_api_keys_file(&map)?;
    }
    Ok(())
}

fn cache_api_key(provider: &str, api_key: &str) {
    if let Ok(mut guard) = api_key_cache().lock() {
        guard.insert(provider.to_string(), api_key.to_string());
    }
}

struct LaunchSecret {
    session_id: String,
    secret: [u8; 32],
}

static LAUNCH: OnceLock<LaunchSecret> = OnceLock::new();

fn launch_secret() -> &'static LaunchSecret {
    LAUNCH.get_or_init(|| {
        let mut secret = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret);
        let mut sid = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut sid);
        LaunchSecret {
            session_id: hex::encode(sid),
            secret,
        }
    })
}

fn provider_account(provider: &str) -> String {
    format!("api_key:{provider}")
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum VigilError {
    #[error("{0}")]
    Message(String),
}

impl serde::Serialize for VigilError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Shared launch secret + spawned sidecar child.
struct SidecarState {
    secret_hex: String,
    child: Mutex<Option<Child>>,
    /// mtime of sidecar entry script when last spawned — restart if source changed.
    script_mtime_ms: Mutex<Option<u128>>,
}

fn validate_provider(provider: &str) -> Result<(), VigilError> {
    match provider {
        "openai" | "gemini" | "anthropic" => Ok(()),
        _ => Err(VigilError::Message(format!("Unknown provider: {provider}"))),
    }
}

/// Non-secret metadata path — listing configured providers must NOT touch the OS vault
/// (avoids a second password/keychain dialog right after Settings unlock).
fn app_support_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        return PathBuf::from(home)
            .join("Library/Application Support")
            .join("com.vigil.agent");
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
        return PathBuf::from(base).join("com.vigil.agent");
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            format!("{home}/.config")
        });
        return PathBuf::from(base).join("com.vigil.agent");
    }
}

fn configured_meta_path() -> PathBuf {
    app_support_dir().join("configured_providers.json")
}

fn read_configured_meta() -> Vec<String> {
    let path = configured_meta_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

fn write_configured_meta(providers: &[String]) -> Result<(), VigilError> {
    let path = configured_meta_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| VigilError::Message(e.to_string()))?;
    }
    let raw = serde_json::to_string_pretty(providers)
        .map_err(|e| VigilError::Message(e.to_string()))?;
    fs::write(&path, raw).map_err(|e| VigilError::Message(e.to_string()))
}

fn mark_provider_configured(provider: &str) -> Result<(), VigilError> {
    let mut list = read_configured_meta();
    if !list.iter().any(|p| p == provider) {
        list.push(provider.to_string());
        write_configured_meta(&list)?;
    }
    Ok(())
}

fn unmark_provider_configured(provider: &str) -> Result<(), VigilError> {
    let list: Vec<String> = read_configured_meta()
        .into_iter()
        .filter(|p| p != provider)
        .collect();
    write_configured_meta(&list)
}

/// API keys: local file + memory only. Never touch macOS Keychain / Windows Credential
/// Manager for provider keys while device auth is off (any Keychain ACL pops a password UI).
fn read_api_key_store(provider: &str) -> Result<String, VigilError> {
    validate_provider(provider)?;
    if let Ok(guard) = api_key_cache().lock() {
        if let Some(cached) = guard.get(provider) {
            return Ok(cached.clone());
        }
    }

    if let Some(from_file) = read_api_keys_file().get(provider).cloned() {
        if !from_file.is_empty() {
            cache_api_key(provider, &from_file);
            return Ok(from_file);
        }
    }

    // Device-auth on: optional Keychain fallback (off by default — never prompt today).
    if DEVICE_AUTH_ENABLED {
        let entry = Entry::new(KEYRING_SERVICE, &provider_account(provider))
            .map_err(|e| VigilError::Message(e.to_string()))?;
        let password = entry
            .get_password()
            .map_err(|e| VigilError::Message(e.to_string()))?;
        cache_api_key(provider, &password);
        return Ok(password);
    }

    Err(VigilError::Message(format!(
        "No API key configured for {provider}. Open Settings and save the key again."
    )))
}

#[tauri::command]
fn save_api_key(provider: String, api_key: String) -> Result<(), VigilError> {
    validate_provider(&provider)?;
    if api_key.trim().is_empty() {
        return Err(VigilError::Message("API key cannot be empty".into()));
    }
    let trimmed = api_key.trim().to_string();

    // Always persist to the local file. Do NOT write Keychain while auth is off —
    // set_password also triggers the system password / Touch ID dialog.
    put_api_key_file(&provider, &trimmed)?;
    cache_api_key(&provider, &trimmed);

    if DEVICE_AUTH_ENABLED {
        let entry = Entry::new(KEYRING_SERVICE, &provider_account(&provider))
            .map_err(|e| VigilError::Message(e.to_string()))?;
        entry
            .set_password(&trimmed)
            .map_err(|e| VigilError::Message(e.to_string()))?;
    }

    mark_provider_configured(&provider)?;
    Ok(())
}

/// Metadata only — never opens Keychain (avoids password dialog after Touch ID).
#[tauri::command]
fn has_api_key(provider: String) -> Result<bool, VigilError> {
    validate_provider(&provider)?;
    if read_configured_meta().iter().any(|p| p == &provider) {
        return Ok(true);
    }
    Ok(read_api_keys_file()
        .get(&provider)
        .map(|k| !k.is_empty())
        .unwrap_or(false))
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<(), VigilError> {
    validate_provider(&provider)?;
    let _ = remove_api_key_file(&provider);
    if let Ok(mut guard) = api_key_cache().lock() {
        guard.remove(&provider);
    }
    // Never call Keychain delete while auth is off — that dialog is what the user hates.
    if DEVICE_AUTH_ENABLED {
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, &provider_account(&provider)) {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(e) => return Err(VigilError::Message(e.to_string())),
            }
        }
    }
    unmark_provider_configured(&provider)?;
    Ok(())
}

/// Metadata only — never opens Keychain.
#[tauri::command]
fn list_configured_providers() -> Result<Vec<String>, VigilError> {
    Ok(read_configured_meta())
}

#[tauri::command]
fn settings_gate_open() -> bool {
    SETTINGS_GATE_OPEN.load(Ordering::SeqCst)
}

#[tauri::command]
fn lock_settings_gate() {
    if !DEVICE_AUTH_ENABLED {
        SETTINGS_GATE_OPEN.store(true, Ordering::SeqCst);
        println!("[vigil] settings gate stays OPEN (device auth disabled)");
        return;
    }
    SETTINGS_GATE_OPEN.store(false, Ordering::SeqCst);
    println!("[vigil] settings gate LOCKED");
}

/// Called by frontend ONLY after Touch ID returns authenticated=true.
#[tauri::command]
fn unlock_settings_gate() {
    SETTINGS_GATE_OPEN.store(true, Ordering::SeqCst);
    println!("[vigil] settings gate OPEN (explicit unlock)");
}

/// Read API key from OS Keychain for the given provider.
#[tauri::command]
fn get_api_key(provider: String) -> Result<String, VigilError> {
    read_api_key_store(&provider)
}

#[tauri::command]
fn biometric_status() -> biometric::BiometricStatus {
    biometric::biometric_status()
}

#[tauri::command]
async fn authenticate_biometric(
    reason: Option<String>,
    mode: Option<String>,
    open_settings_gate: Option<bool>,
) -> Result<biometric::BiometricAuthResult, VigilError> {
    let open_gate = open_settings_gate.unwrap_or(false);
    if !DEVICE_AUTH_ENABLED {
        SETTINGS_GATE_OPEN.store(true, Ordering::SeqCst);
        println!("[vigil] authenticate_biometric skipped (device auth disabled)");
        return Ok(biometric::BiometricAuthResult {
            authenticated: true,
            detail: "device auth disabled".into(),
        });
    }

    let reason = reason.unwrap_or_else(|| "Unlock Vigil AI Agent".into());
    let auth_mode = biometric::AuthMode::parse(mode.as_deref());
    println!("[vigil] invoke authenticate_biometric reason={reason:?} mode={auth_mode:?} open_gate={open_gate}");

    let result = tauri::async_runtime::spawn_blocking(move || {
        biometric::authenticate_biometric(&reason, auth_mode).map_err(VigilError::Message)
    })
    .await
    .map_err(|e| VigilError::Message(format!("biometric task join error: {e}")))?;

    let result = result?;
    if result.authenticated && open_gate {
        SETTINGS_GATE_OPEN.store(true, Ordering::SeqCst);
        println!("[vigil] settings gate OPEN after biometric auth");
    }
    println!("[vigil] authenticate_biometric result={result:?}");
    Ok(result)
}

/// Verify a typed device login password (in-app form). No biometric UI.
#[tauri::command]
async fn verify_device_password(
    password: String,
    open_settings_gate: Option<bool>,
) -> Result<biometric::BiometricAuthResult, VigilError> {
    let open_gate = open_settings_gate.unwrap_or(false);
    if !DEVICE_AUTH_ENABLED {
        SETTINGS_GATE_OPEN.store(true, Ordering::SeqCst);
        println!("[vigil] verify_device_password skipped (device auth disabled)");
        return Ok(biometric::BiometricAuthResult {
            authenticated: true,
            detail: "device auth disabled".into(),
        });
    }

    println!("[vigil] invoke verify_device_password open_gate={open_gate}");
    let result = tauri::async_runtime::spawn_blocking(move || {
        biometric::verify_device_password(&password).map_err(VigilError::Message)
    })
    .await
    .map_err(|e| VigilError::Message(format!("password verify task join error: {e}")))?;

    let result = result?;
    if result.authenticated && open_gate {
        SETTINGS_GATE_OPEN.store(true, Ordering::SeqCst);
        println!("[vigil] settings gate OPEN after password auth");
    }
    println!(
        "[vigil] verify_device_password result authenticated={}",
        result.authenticated
    );
    Ok(result)
}

/// Start native live dictation (macOS SFSpeechRecognizer). Emits `vigil-dictation` events.
#[tauri::command]
fn start_live_dictation(
    app: tauri::AppHandle,
    locale: Option<String>,
) -> Result<(), VigilError> {
    dictate::start_live_dictation(app, locale).map_err(VigilError::Message)
}

#[tauri::command]
fn stop_live_dictation() -> Result<(), VigilError> {
    dictate::stop_live_dictation().map_err(VigilError::Message)
}

#[tauri::command]
fn live_dictation_running() -> bool {
    dictate::is_live_dictation_running()
}

/// Presence-gated key read (Layer 1), then OS vault read (Layer 2).
/// Skips presence prompt when Settings gate is already open this session.
#[tauri::command]
async fn get_api_key_with_biometric(
    provider: String,
    require_biometric: Option<bool>,
) -> Result<String, VigilError> {
    let gate_open = SETTINGS_GATE_OPEN.load(Ordering::SeqCst);
    let require =
        DEVICE_AUTH_ENABLED && require_biometric.unwrap_or(true) && !gate_open;
    if require {
        let result = tauri::async_runtime::spawn_blocking(|| {
            biometric::authenticate_biometric(
                "Unlock Vigil AI Agent to read API key",
                biometric::AuthMode::Biometrics,
            )
            .map_err(VigilError::Message)
        })
        .await
        .map_err(|e| VigilError::Message(format!("biometric task join error: {e}")))??;
        if !result.authenticated {
            return Err(VigilError::Message(format!(
                "Biometric authentication failed: {}",
                result.detail
            )));
        }
    }
    read_api_key_store(&provider)
}

/// Presence-gated key save (Layer 1), then OS vault write (Layer 2).
/// Skips presence prompt when Settings gate is already open this session.
#[tauri::command]
async fn save_api_key_with_biometric(
    provider: String,
    api_key: String,
    require_biometric: Option<bool>,
) -> Result<(), VigilError> {
    let gate_open = SETTINGS_GATE_OPEN.load(Ordering::SeqCst);
    let require =
        DEVICE_AUTH_ENABLED && require_biometric.unwrap_or(true) && !gate_open;
    if require {
        let result = tauri::async_runtime::spawn_blocking(|| {
            biometric::authenticate_biometric(
                "Unlock Vigil AI Agent to save API key",
                biometric::AuthMode::Biometrics,
            )
            .map_err(VigilError::Message)
        })
        .await
        .map_err(|e| VigilError::Message(format!("biometric task join error: {e}")))??;
        if !result.authenticated {
            return Err(VigilError::Message(format!(
                "Biometric authentication failed: {}",
                result.detail
            )));
        }
    }
    save_api_key(provider, api_key)
}

/// Masked preview — uses metadata presence only (no Keychain read / no password UI).
#[tauri::command]
fn get_api_key_hint(provider: String) -> Result<String, VigilError> {
    validate_provider(&provider)?;
    if !read_configured_meta().iter().any(|p| p == &provider) {
        return Err(VigilError::Message("No key configured".into()));
    }
    // Do not call Keychain here — would pop a password dialog after Touch ID.
    Ok("•••• configured".into())
}


/// Returns the per-launch secret as hex (32 random bytes).
#[tauri::command]
fn get_launch_secret(state: State<'_, SidecarState>) -> String {
    state.secret_hex.clone()
}

/// Returns session id + HMAC token for this launch.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchSession {
    session_id: String,
    hmac_token: String,
}

#[tauri::command]
fn get_launch_session() -> LaunchSession {
    let launch = launch_secret();
    let mut mac =
        HmacSha256::new_from_slice(&launch.secret).expect("HMAC key length is valid");
    mac.update(launch.session_id.as_bytes());
    let tag = mac.finalize().into_bytes();
    LaunchSession {
        session_id: launch.session_id.clone(),
        hmac_token: B64.encode(tag),
    }
}

/// Verify an HMAC signature from the Node sidecar (message = session_id || body).
#[tauri::command]
fn verify_sidecar_hmac(session_id: String, body: String, signature_b64: String) -> bool {
    let launch = launch_secret();
    if session_id != launch.session_id {
        return false;
    }
    let Ok(sig) = B64.decode(signature_b64) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(&launch.secret) else {
        return false;
    };
    mac.update(session_id.as_bytes());
    mac.update(body.as_bytes());
    mac.verify_slice(&sig).is_ok()
}

/// Fetch API key for sidecar use only — protected by HMAC over provider name.
#[tauri::command]
fn get_api_key_for_sidecar(
    provider: String,
    session_id: String,
    signature_b64: String,
) -> Result<String, VigilError> {
    validate_provider(&provider)?;
    if !verify_sidecar_hmac(session_id, provider.clone(), signature_b64) {
        return Err(VigilError::Message("Invalid sidecar HMAC".into()));
    }
    read_api_key_store(&provider)
}

fn find_project_root() -> Result<PathBuf, VigilError> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.clone());
        candidates.push(cwd.join(".."));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(mut dir) = exe.parent().map(Path::to_path_buf) {
            for _ in 0..6 {
                candidates.push(dir.clone());
                if !dir.pop() {
                    break;
                }
            }
        }
    }

    for c in candidates {
        let sidecar = c.join("sidecar").join("index.mjs");
        if sidecar.is_file() {
            return c
                .canonicalize()
                .or_else(|_| Ok(c))
                .map_err(|e: std::io::Error| VigilError::Message(e.to_string()));
        }
    }
    Err(VigilError::Message(
        "Could not locate sidecar/index.mjs from process cwd/exe".into(),
    ))
}

fn port_open(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn wait_for_port(port: u16, attempts: u32) -> bool {
    for _ in 0..attempts {
        if port_open(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// Ping sidecar with our launch HMAC. Returns true if it accepts our secret.
fn sidecar_accepts_secret(secret_hex: &str, session_id: &str) -> bool {
    use std::io::{Read, Write};

    let body = r#"{"op":"ping"}"#;
    let Ok(secret_bytes) = hex::decode(secret_hex) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(&secret_bytes) else {
        return false;
    };
    mac.update(session_id.as_bytes());
    mac.update(body.as_bytes());
    let sig = B64.encode(mac.finalize().into_bytes());

    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", SIDECAR_PORT)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));

    let req = format!(
        "POST / HTTP/1.1\r\nHost: 127.0.0.1:{SIDECAR_PORT}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nx-vigil-hmac: {sig}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    buf.starts_with("HTTP/1.1 200") || buf.starts_with("HTTP/1.0 200")
}

fn kill_port_holder(port: u16) {
    let _ = Command::new("lsof")
        .args(["-ti", &format!("TCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .ok()
        .and_then(|o| {
            let pids = String::from_utf8_lossy(&o.stdout);
            for pid in pids.split_whitespace() {
                let _ = Command::new("kill").args(["-9", pid]).status();
            }
            Some(())
        });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpawnResult {
    port: u16,
    session_id: String,
    already_running: bool,
    pid: Option<u32>,
}

fn sidecar_scripts_mtime_ms(root: &std::path::Path) -> Option<u128> {
    let names = ["index.mjs", "tools.mjs", "browser.mjs", "agent-stream.mjs"];
    let mut max_ms: u128 = 0;
    for name in names {
        let path = root.join("sidecar").join(name);
        let meta = fs::metadata(&path).ok()?;
        let modified = meta.modified().ok()?;
        let ms = modified
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis();
        if ms > max_ms {
            max_ms = ms;
        }
    }
    if max_ms == 0 {
        None
    } else {
        Some(max_ms)
    }
}

fn kill_managed_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    kill_port_holder(SIDECAR_PORT);
    std::thread::sleep(Duration::from_millis(200));
}

fn spawn_sidecar_process(state: &SidecarState) -> Result<SpawnResult, VigilError> {
    let launch = launch_secret();
    let root = find_project_root()?;
    let script_mtime = sidecar_scripts_mtime_ms(&root);
    let cached_mtime = state
        .script_mtime_ms
        .lock()
        .ok()
        .and_then(|g| *g);

    if port_open(SIDECAR_PORT) {
        let secret_ok = sidecar_accepts_secret(&state.secret_hex, &launch.session_id);
        let code_unchanged = match (script_mtime, cached_mtime) {
            (Some(now), Some(prev)) => now == prev,
            // First check this launch with an already-running process — restart to
            // pick up sidecar source edits (browser tools, etc.).
            (Some(_), None) => false,
            _ => true,
        };
        if secret_ok && code_unchanged {
            return Ok(SpawnResult {
                port: SIDECAR_PORT,
                session_id: launch.session_id.clone(),
                already_running: true,
                pid: None,
            });
        }
        // Stale secret or updated sidecar sources — replace the process.
        kill_managed_sidecar(state);
    }

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| VigilError::Message("sidecar lock poisoned".into()))?;
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    if wait_for_port(SIDECAR_PORT, 30) {
                        return Ok(SpawnResult {
                            port: SIDECAR_PORT,
                            session_id: launch.session_id.clone(),
                            already_running: true,
                            pid: Some(child.id()),
                        });
                    }
                }
                _ => {
                    *guard = None;
                }
            }
        }
    }

    let script = root.join("sidecar").join("index.mjs");
    if !script.is_file() {
        return Err(VigilError::Message(format!(
            "sidecar script missing: {}",
            script.display()
        )));
    }

    let mut cmd = Command::new("node");
    cmd.arg(&script)
        .current_dir(&root)
        .env("VIGIL_LAUNCH_SECRET", &state.secret_hex)
        .env("VIGIL_SESSION_ID", &launch.session_id)
        .env("VIGIL_SIDECAR_PORT", SIDECAR_PORT.to_string())
        .env("VIGIL_CWD", &root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| VigilError::Message(format!("Failed to spawn sidecar: {e}")))?;
    let pid = child.id();

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| VigilError::Message("sidecar lock poisoned".into()))?;
        *guard = Some(child);
    }

    if !wait_for_port(SIDECAR_PORT, 50) {
        return Err(VigilError::Message(
            "Sidecar spawned but did not open 127.0.0.1:47821".into(),
        ));
    }

    if let Ok(mut guard) = state.script_mtime_ms.lock() {
        *guard = script_mtime.or_else(|| sidecar_scripts_mtime_ms(&root));
    }

    Ok(SpawnResult {
        port: SIDECAR_PORT,
        session_id: launch.session_id.clone(),
        already_running: false,
        pid: Some(pid),
    })
}

/// Spawn `node sidecar/index.mjs` with launch secret + HMAC env.
#[tauri::command]
fn spawn_sidecar(state: State<'_, SidecarState>) -> Result<SpawnResult, VigilError> {
    spawn_sidecar_process(&state)
}

fn workspace_override_path() -> PathBuf {
    app_support_dir().join("workspace_path.txt")
}

fn read_workspace_override() -> Option<PathBuf> {
    let raw = fs::read_to_string(workspace_override_path()).ok()?;
    let path = PathBuf::from(raw.trim());
    if path.is_dir() { Some(path) } else { None }
}

/// Workspace cwd used by the sidecar / agent tools.
/// A folder the user opened wins over the app's own project root.
#[tauri::command]
fn get_workspace_cwd() -> Result<String, VigilError> {
    if let Some(path) = read_workspace_override() {
        return Ok(path.to_string_lossy().into_owned());
    }
    Ok(find_project_root()?.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_workspace_cwd(path: String) -> Result<String, VigilError> {
    let dir = PathBuf::from(path.trim());
    if !dir.is_dir() {
        return Err(VigilError::Message(format!(
            "Not a folder: {}",
            dir.display()
        )));
    }
    let canon = dir.canonicalize().unwrap_or(dir);
    let parent = workspace_override_path();
    if let Some(folder) = parent.parent() {
        fs::create_dir_all(folder).map_err(|e| VigilError::Message(e.to_string()))?;
    }
    fs::write(&parent, canon.to_string_lossy().as_bytes())
        .map_err(|e| VigilError::Message(e.to_string()))?;
    Ok(canon.to_string_lossy().into_owned())
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitHostProfile {
    host: String,
    base_url: String,
    login: String,
    credential_user: String,
    credential_host: String,
}

fn git_hosts_path() -> PathBuf {
    app_support_dir().join("git_hosts.json")
}

fn validate_git_host(host: &str) -> Result<(), VigilError> {
    match host {
        "github" | "gitlab" | "azure" | "other" => Ok(()),
        _ => Err(VigilError::Message(format!("Unknown git host '{host}'"))),
    }
}

fn read_git_hosts() -> Vec<GitHostProfile> {
    let Ok(raw) = fs::read_to_string(git_hosts_path()) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_git_hosts(hosts: &[GitHostProfile]) -> Result<(), VigilError> {
    let path = git_hosts_path();
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|e| VigilError::Message(e.to_string()))?;
    }
    let raw = serde_json::to_string_pretty(hosts).map_err(|e| VigilError::Message(e.to_string()))?;
    fs::write(path, raw).map_err(|e| VigilError::Message(e.to_string()))
}

fn git_token_account(host: &str) -> String {
    format!("git-token:{host}")
}

#[tauri::command]
fn list_git_hosts() -> Result<Vec<GitHostProfile>, VigilError> {
    Ok(read_git_hosts())
}

#[tauri::command]
fn save_git_host(
    host: String,
    token: String,
    base_url: String,
    login: String,
    credential_user: String,
    credential_host: String,
) -> Result<(), VigilError> {
    validate_git_host(&host)?;
    let secret = token.trim();
    if secret.is_empty() {
        return Err(VigilError::Message("Token cannot be empty".into()));
    }
    let entry = Entry::new(KEYRING_SERVICE, &git_token_account(&host))
        .map_err(|e| VigilError::Message(e.to_string()))?;
    entry
        .set_password(secret)
        .map_err(|e| VigilError::Message(e.to_string()))?;
    let mut hosts = read_git_hosts();
    hosts.retain(|item| item.host != host);
    hosts.push(GitHostProfile {
        host,
        base_url: base_url.trim().trim_end_matches('/').to_string(),
        login: login.trim().to_string(),
        credential_user: credential_user.trim().to_string(),
        credential_host: credential_host.trim().to_string(),
    });
    write_git_hosts(&hosts)
}

#[tauri::command]
fn get_git_token(host: String) -> Result<String, VigilError> {
    validate_git_host(&host)?;
    let entry = Entry::new(KEYRING_SERVICE, &git_token_account(&host))
        .map_err(|e| VigilError::Message(e.to_string()))?;
    entry
        .get_password()
        .map_err(|e| VigilError::Message(e.to_string()))
}

#[tauri::command]
fn forget_git_host(host: String) -> Result<(), VigilError> {
    validate_git_host(&host)?;
    if let Ok(entry) = Entry::new(KEYRING_SERVICE, &git_token_account(&host)) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(VigilError::Message(e.to_string())),
        }
    }
    let mut hosts = read_git_hosts();
    hosts.retain(|item| item.host != host);
    write_git_hosts(&hosts)
}

/// Dev helper: length-only preview so UI can confirm secret was minted.
#[tauri::command]
fn sidecar_shared_secret_preview(state: State<'_, SidecarState>) -> usize {
    state.secret_hex.len()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntryInfo {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, VigilError> {
    let dir = PathBuf::from(&path);
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| VigilError::Message(format!("list_dir {path}: {e}")))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".DS_Store" {
            continue;
        }
        out.push(DirEntryInfo {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            is_dir,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

fn should_skip_index_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "dist"
            | "build"
            | "target"
            | "coverage"
            | ".next"
            | ".nuxt"
            | ".turbo"
            | ".cache"
            | "out"
            | "vendor"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".vigil-agent"
    )
}

fn walk_workspace_files_inner(
    dir: &Path,
    root: &Path,
    out: &mut Vec<String>,
    max_files: usize,
) -> Result<(), VigilError> {
    if out.len() >= max_files {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|e| VigilError::Message(format!("list_workspace_files {}: {e}", dir.display())))?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".DS_Store" {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            if should_skip_index_dir(&name) {
                continue;
            }
            if name.starts_with('.') && name != ".vigil" && name != ".github" {
                continue;
            }
            dirs.push(entry.path());
        } else if meta.is_file() {
            files.push(entry.path());
        }
    }
    files.sort();
    for path in files {
        if out.len() >= max_files {
            break;
        }
        out.push(path.to_string_lossy().into_owned());
    }
    dirs.sort();
    for path in dirs {
        if out.len() >= max_files {
            break;
        }
        walk_workspace_files_inner(&path, root, out, max_files)?;
    }
    let _ = root;
    Ok(())
}

/// Flat list of workspace file paths for local codebase index / @ mentions.
#[tauri::command]
fn list_workspace_files(root: String, max_files: Option<usize>) -> Result<Vec<String>, VigilError> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(VigilError::Message(format!(
            "list_workspace_files: not a directory: {root}"
        )));
    }
    let limit = max_files.unwrap_or(20_000).clamp(100, 50_000);
    let mut out = Vec::new();
    walk_workspace_files_inner(&root_path, &root_path, &mut out, limit)?;
    Ok(out)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, VigilError> {
    std::fs::read_to_string(&path)
        .map_err(|e| VigilError::Message(format!("read_text_file {path}: {e}")))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), VigilError> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| VigilError::Message(format!("mkdir: {e}")))?;
    }
    std::fs::write(&path, contents)
        .map_err(|e| VigilError::Message(format!("write_text_file {path}: {e}")))
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), VigilError> {
    std::fs::create_dir_all(&path)
        .map_err(|e| VigilError::Message(format!("create_dir {path}: {e}")))
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), VigilError> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(&p)
            .map_err(|e| VigilError::Message(format!("delete_path {path}: {e}")))
    } else {
        std::fs::remove_file(&p)
            .map_err(|e| VigilError::Message(format!("delete_path {path}: {e}")))
    }
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), VigilError> {
    std::fs::rename(&from, &to)
        .map_err(|e| VigilError::Message(format!("rename_path {from} -> {to}: {e}")))
}

#[tauri::command]
fn run_workspace_command(command: String, cwd: String) -> Result<String, VigilError> {
    let output = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&cwd)
        .output()
        .map_err(|e| VigilError::Message(format!("run command: {e}")))?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    let err = String::from_utf8_lossy(&output.stderr);
    if !err.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&err);
    }
    if !output.status.success() {
        text.push_str(&format!("\n[exit {}]", output.status.code().unwrap_or(-1)));
    }
    Ok(text)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalStreamEvent {
    run_id: String,
    kind: String,
    text: Option<String>,
    code: Option<i32>,
}

fn emit_terminal(app: &tauri::AppHandle, event: TerminalStreamEvent) {
    let _ = app.emit("vigil-terminal", event);
}

fn pipe_terminal_lines(
    app: tauri::AppHandle,
    run_id: String,
    stream: impl std::io::Read + Send + 'static,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(text) => emit_terminal(
                    &app,
                    TerminalStreamEvent {
                        run_id: run_id.clone(),
                        kind: "chunk".into(),
                        text: Some(format!("{text}\n")),
                        code: None,
                    },
                ),
                Err(_) => break,
            }
        }
    });
}

/// Start a workspace command and stream stdout/stderr to the UI. Returns immediately.
#[tauri::command]
fn start_workspace_command(
    app: tauri::AppHandle,
    command: String,
    cwd: String,
    run_id: String,
) -> Result<(), VigilError> {
    std::thread::spawn(move || {
        let child = Command::new("sh")
            .arg("-c")
            .arg(&command)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        let mut child = match child {
            Ok(child) => child,
            Err(err) => {
                emit_terminal(
                    &app,
                    TerminalStreamEvent {
                        run_id: run_id.clone(),
                        kind: "chunk".into(),
                        text: Some(format!("Failed to start: {err}\n")),
                        code: None,
                    },
                );
                emit_terminal(
                    &app,
                    TerminalStreamEvent {
                        run_id,
                        kind: "done".into(),
                        text: None,
                        code: Some(-1),
                    },
                );
                return;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            pipe_terminal_lines(app.clone(), run_id.clone(), stdout);
        }
        if let Some(stderr) = child.stderr.take() {
            pipe_terminal_lines(app.clone(), run_id.clone(), stderr);
        }

        let code = match child.wait() {
            Ok(status) => status.code().unwrap_or(-1),
            Err(_) => -1,
        };
        emit_terminal(
            &app,
            TerminalStreamEvent {
                run_id,
                kind: "done".into(),
                text: None,
                code: Some(code),
            },
        );
    });
    Ok(())
}

#[tauri::command]
fn git_repo_info(cwd: String) -> Result<git_ops::GitRepoInfo, VigilError> {
    git_ops::repo_info(&cwd).map_err(VigilError::Message)
}

#[tauri::command]
fn git_has_commits(cwd: String) -> Result<bool, VigilError> {
    git_ops::has_commits(&cwd).map_err(VigilError::Message)
}

#[tauri::command]
fn git_create_branch(
    cwd: String,
    name: String,
    checkout: Option<bool>,
) -> Result<String, VigilError> {
    git_ops::create_branch(&cwd, &name, checkout.unwrap_or(true)).map_err(VigilError::Message)
}

#[tauri::command]
fn git_validate_branch_name(name: String) -> Result<(), VigilError> {
    git_ops::validate_branch_name(&name).map_err(VigilError::Message)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch = launch_secret();
    let secret_hex = hex::encode(launch.secret);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState {
            secret_hex,
            child: Mutex::new(None),
            script_mtime_ms: Mutex::new(None),
        })
        .setup(|app| {
            let state = app.state::<SidecarState>();
            if let Err(e) = spawn_sidecar_process(&state) {
                eprintln!("[vigil] sidecar auto-spawn: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            has_api_key,
            delete_api_key,
            list_configured_providers,
            settings_gate_open,
            lock_settings_gate,
            unlock_settings_gate,
            get_api_key,
            biometric_status,
            authenticate_biometric,
            verify_device_password,
            get_api_key_with_biometric,
            save_api_key_with_biometric,
            get_api_key_hint,
            get_launch_secret,
            get_launch_session,
            verify_sidecar_hmac,
            get_api_key_for_sidecar,
            spawn_sidecar,
            get_workspace_cwd,
            set_workspace_cwd,
            list_git_hosts,
            save_git_host,
            get_git_token,
            forget_git_host,
            github_oauth::github_browser_login,
            sidecar_shared_secret_preview,
            list_dir,
            list_workspace_files,
            read_text_file,
            write_text_file,
            create_dir,
            delete_path,
            rename_path,
            run_workspace_command,
            start_workspace_command,
            git_repo_info,
            git_has_commits,
            git_create_branch,
            git_validate_branch_name,
            start_live_dictation,
            stop_live_dictation,
            live_dictation_running,
        ])
        .build(tauri::generate_context!())
        .expect("error while running Vigil AI Agent")
        .run(|app, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
