//! Vigil AI Agent — Rust backend.
//! Frontend talks to Rust only. Rust talks to Node sidecar with HMAC-signed IPC.
//! API keys live in the OS keychain via the `keyring` crate (never plaintext / localStorage).

mod biometric;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, Mac};
use keyring::Entry;
use rand::RngCore;
use serde::Serialize;
use sha2::Sha256;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Manager, State};

type HmacSha256 = Hmac<Sha256>;

const KEYRING_SERVICE: &str = "com.vigil.agent";
const SIDECAR_PORT: u16 = 47821;

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
enum VigilError {
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
}

fn validate_provider(provider: &str) -> Result<(), VigilError> {
    match provider {
        "openai" | "gemini" | "anthropic" => Ok(()),
        _ => Err(VigilError::Message(format!("Unknown provider: {provider}"))),
    }
}

fn read_keyring(provider: &str) -> Result<String, VigilError> {
    validate_provider(provider)?;
    let entry = Entry::new(KEYRING_SERVICE, &provider_account(provider))
        .map_err(|e| VigilError::Message(e.to_string()))?;
    entry
        .get_password()
        .map_err(|e| VigilError::Message(e.to_string()))
}

#[tauri::command]
fn save_api_key(provider: String, api_key: String) -> Result<(), VigilError> {
    validate_provider(&provider)?;
    if api_key.trim().is_empty() {
        return Err(VigilError::Message("API key cannot be empty".into()));
    }
    let entry = Entry::new(KEYRING_SERVICE, &provider_account(&provider))
        .map_err(|e| VigilError::Message(e.to_string()))?;
    entry
        .set_password(api_key.trim())
        .map_err(|e| VigilError::Message(e.to_string()))?;
    Ok(())
}

#[tauri::command]
fn has_api_key(provider: String) -> Result<bool, VigilError> {
    validate_provider(&provider)?;
    let entry = Entry::new(KEYRING_SERVICE, &provider_account(&provider))
        .map_err(|e| VigilError::Message(e.to_string()))?;
    match entry.get_password() {
        Ok(p) => Ok(!p.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(VigilError::Message(e.to_string())),
    }
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<(), VigilError> {
    validate_provider(&provider)?;
    let entry = Entry::new(KEYRING_SERVICE, &provider_account(&provider))
        .map_err(|e| VigilError::Message(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(VigilError::Message(e.to_string())),
    }
}

#[tauri::command]
fn list_configured_providers() -> Result<Vec<String>, VigilError> {
    let mut out = Vec::new();
    for p in ["openai", "gemini", "anthropic"] {
        if has_api_key(p.to_string())? {
            out.push(p.to_string());
        }
    }
    Ok(out)
}

/// Read API key from OS Keychain for the given provider.
#[tauri::command]
fn get_api_key(provider: String) -> Result<String, VigilError> {
    read_keyring(&provider)
}

#[tauri::command]
fn biometric_status() -> biometric::BiometricStatus {
    biometric::biometric_status()
}

#[tauri::command]
fn authenticate_biometric(reason: Option<String>) -> Result<bool, VigilError> {
    biometric::authenticate_biometric(reason.as_deref().unwrap_or("Unlock Vigil AI Agent"))
        .map_err(VigilError::Message)
}

/// Biometric-gated key read. If `require_biometric` is true, Touch ID runs first.
#[tauri::command]
fn get_api_key_with_biometric(
    provider: String,
    require_biometric: Option<bool>,
) -> Result<String, VigilError> {
    if require_biometric.unwrap_or(true) {
        let ok = biometric::authenticate_biometric("Unlock Vigil AI Agent to read API key")
            .map_err(VigilError::Message)?;
        if !ok {
            return Err(VigilError::Message(
                "Biometric authentication failed or cancelled".into(),
            ));
        }
    }
    read_keyring(&provider)
}

/// Biometric-gated key save.
#[tauri::command]
fn save_api_key_with_biometric(
    provider: String,
    api_key: String,
    require_biometric: Option<bool>,
) -> Result<(), VigilError> {
    if require_biometric.unwrap_or(true) {
        let ok = biometric::authenticate_biometric("Unlock Vigil AI Agent to save API key")
            .map_err(VigilError::Message)?;
        if !ok {
            return Err(VigilError::Message(
                "Biometric authentication failed or cancelled".into(),
            ));
        }
    }
    save_api_key(provider, api_key)
}

/// Masked preview without full secret (last 4 chars). Still keychain-gated optionally.
#[tauri::command]
fn get_api_key_hint(provider: String) -> Result<String, VigilError> {
    let key = read_keyring(&provider)?;
    Ok(mask_key(&key))
}

fn mask_key(key: &str) -> String {
    let trimmed = key.trim();
    if trimmed.len() <= 4 {
        return "••••".into();
    }
    let suffix = &trimmed[trimmed.len() - 4..];
    if trimmed.starts_with("sk-") {
        format!("sk-…{suffix}")
    } else if trimmed.starts_with("AIza") {
        format!("AIza…{suffix}")
    } else {
        format!("…{suffix}")
    }
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
    read_keyring(&provider)
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

fn spawn_sidecar_process(state: &SidecarState) -> Result<SpawnResult, VigilError> {
    let launch = launch_secret();

    if port_open(SIDECAR_PORT) {
        if sidecar_accepts_secret(&state.secret_hex, &launch.session_id) {
            return Ok(SpawnResult {
                port: SIDECAR_PORT,
                session_id: launch.session_id.clone(),
                already_running: true,
                pid: None,
            });
        }
        // Stale sidecar (manual run / previous launch secret) — replace it.
        {
            let mut guard = state
                .child
                .lock()
                .map_err(|_| VigilError::Message("sidecar lock poisoned".into()))?;
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        kill_port_holder(SIDECAR_PORT);
        std::thread::sleep(Duration::from_millis(200));
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

    let root = find_project_root()?;
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

/// Workspace cwd used by the sidecar / agent tools.
#[tauri::command]
fn get_workspace_cwd() -> Result<String, VigilError> {
    Ok(find_project_root()?.to_string_lossy().into_owned())
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
            get_api_key,
            biometric_status,
            authenticate_biometric,
            get_api_key_with_biometric,
            save_api_key_with_biometric,
            get_api_key_hint,
            get_launch_secret,
            get_launch_session,
            verify_sidecar_hmac,
            get_api_key_for_sidecar,
            spawn_sidecar,
            get_workspace_cwd,
            sidecar_shared_secret_preview,
            list_dir,
            read_text_file,
            write_text_file,
            create_dir,
            delete_path,
            rename_path,
            run_workspace_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vigil AI Agent");
}
