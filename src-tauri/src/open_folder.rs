//! OS “Open with Vigil”: parse launch paths and (Windows) Explorer verbs.

use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct LaunchOpenPath(pub Mutex<Option<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsOpenMenuStatus {
    pub platform: String,
    pub installed: bool,
    pub hint: String,
}

#[cfg(windows)]
const WIN_MENU_KEY: &str = "VigilAIAgent";
#[cfg(windows)]
const WIN_MENU_LABEL: &str = "Open with Vigil";

pub fn parse_open_candidate(arg: &str) -> Option<String> {
    let t = arg.trim().trim_matches('"');
    if t.is_empty() || t.starts_with('-') {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("vigil:") {
        return path_from_vigil_open(t);
    }
    if lower.starts_with("file:") {
        return path_from_file_url(t);
    }
    Some(t.to_string())
}

fn path_from_vigil_open(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    if !lower.contains("://open") {
        return None;
    }
    for key in ["path=", "folder=", "dir="] {
        if let Some(idx) = lower.find(key) {
            let rest = raw.get(idx + key.len()..)?;
            let val = rest.split('&').next().unwrap_or("").replace('+', " ");
            let decoded = percent_decode_basic(&val);
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
    }
    None
}

fn path_from_file_url(raw: &str) -> Option<String> {
    let without = raw
        .strip_prefix("file://")
        .or_else(|| raw.strip_prefix("FILE://"))?;
    let decoded = percent_decode_basic(without);
    #[cfg(windows)]
    {
        let mut path = decoded;
        if path.starts_with('/') {
            if let Some(rest) = path.get(1..) {
                if rest.chars().nth(1) == Some(':') {
                    path = rest.to_string();
                }
            }
        }
        path = path.replace('/', "\\");
        return if path.is_empty() { None } else { Some(path) };
    }
    #[cfg(not(windows))]
    {
        if decoded.is_empty() {
            None
        } else {
            Some(decoded)
        }
    }
}

fn percent_decode_basic(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(c) = u8::from_str_radix(hex, 16) {
                    out.push(c);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn resolve_workspace_dir(candidate: &str) -> Option<String> {
    let p = PathBuf::from(candidate);
    if p.is_dir() {
        return Some(canon_string(&p));
    }
    if p.is_file() {
        return p.parent().filter(|d| d.is_dir()).map(canon_string);
    }
    None
}

fn canon_string(p: &Path) -> String {
    p.canonicalize()
        .unwrap_or_else(|_| p.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

pub fn folder_from_args<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    for a in args {
        if let Some(c) = parse_open_candidate(a.as_ref()) {
            if let Some(dir) = resolve_workspace_dir(&c) {
                return Some(dir);
            }
        }
    }
    None
}

pub fn remember_launch_path(state: &LaunchOpenPath, path: String) {
    if let Ok(mut g) = state.0.lock() {
        *g = Some(path);
    }
}

pub fn offer_folder(app: &AppHandle, path: String) {
    if path.trim().is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<LaunchOpenPath>() {
        remember_launch_path(&state, path.clone());
    }
    let _ = app.emit("vigil://open-folder", path);
}

pub fn collect_cli_folder() -> Option<String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    folder_from_args(args)
}

#[tauri::command]
pub fn take_launch_open_path(state: State<LaunchOpenPath>) -> Option<String> {
    state.0.lock().ok()?.take()
}

pub fn is_multi_instance() -> bool {
    std::env::var("VIGIL_MULTI_INSTANCE")
        .ok()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn normalize_path_key(s: &str) -> String {
    s.replace('\\', "/")
        .trim()
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

pub fn should_reuse_window(current: Option<&str>, incoming: &str) -> bool {
    let incoming = normalize_path_key(incoming);
    if incoming.is_empty() {
        return true;
    }
    match current {
        None => true,
        Some(cur) if normalize_path_key(cur).is_empty() => true,
        Some(cur) => normalize_path_key(cur) == incoming,
    }
}

fn instances_path() -> PathBuf {
    crate::app_support_dir().join("window-instances.json")
}

#[derive(Serialize, Deserialize, Clone)]
struct WindowInstance {
    pid: u32,
    workspace: String,
    port: u16,
}

fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .map(|o| {
                let text = String::from_utf8_lossy(&o.stdout);
                text.contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
}

fn load_instances() -> Vec<WindowInstance> {
    let raw = fs::read_to_string(instances_path()).unwrap_or_default();
    let list: Vec<WindowInstance> = serde_json::from_str(&raw).unwrap_or_default();
    list.into_iter().filter(|i| pid_alive(i.pid)).collect()
}

fn save_instances(list: &[WindowInstance]) {
    let path = instances_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, serde_json::to_vec_pretty(list).unwrap_or_default());
}

pub fn register_this_instance(workspace: &str, port: u16) {
    let pid = std::process::id();
    let mut list: Vec<WindowInstance> = load_instances()
        .into_iter()
        .filter(|i| i.pid != pid)
        .collect();
    list.push(WindowInstance {
        pid,
        workspace: workspace.to_string(),
        port,
    });
    save_instances(&list);
}

fn find_instance_for_folder(folder: &str) -> Option<WindowInstance> {
    let key = normalize_path_key(folder);
    load_instances()
        .into_iter()
        .find(|i| normalize_path_key(&i.workspace) == key)
}

fn focus_pid(pid: u32) {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"System Events\" to set frontmost of (first process whose unix id is {pid}) to true"
        );
        let _ = Command::new("osascript").args(["-e", &script]).status();
    }
    #[cfg(windows)]
    {
        let _ = pid;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = pid;
    }
}

pub fn pick_free_tcp_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok().map(|a| a.port()))
        .filter(|p| *p != 0)
        .unwrap_or(47822)
}

pub fn spawn_new_window(folder: &str) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let port = pick_free_tcp_port();
    let id = format!("{port}-{}", std::process::id());
    let mut cmd = Command::new(&exe);
    cmd.arg(folder)
        .env("VIGIL_MULTI_INSTANCE", "1")
        .env("VIGIL_INSTANCE_ID", &id)
        .env("VIGIL_SIDECAR_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_folder_in_new_window(path: String) -> Result<(), String> {
    let dir = resolve_workspace_dir(&path).ok_or_else(|| "Not a folder".to_string())?;
    spawn_new_window(&dir)
}

pub fn handle_second_instance(app: &AppHandle, argv: Vec<String>) {
    let args = argv.iter().skip(1);
    if let Some(dir) = folder_from_args(args) {
        if let Some(existing) = find_instance_for_folder(&dir) {
            if existing.pid == std::process::id() {
                offer_folder(app, dir);
                focus_main(app);
            } else {
                focus_pid(existing.pid);
            }
            return;
        }
        let current = crate::current_workspace_dir_string();
        if should_reuse_window(current.as_deref(), &dir) {
            offer_folder(app, dir);
            focus_main(app);
        } else if spawn_new_window(&dir).is_err() {
            offer_folder(app, dir);
            focus_main(app);
        }
        return;
    }
    focus_main(app);
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn os_open_menu_status() -> OsOpenMenuStatus {
    #[cfg(windows)]
    {
        return windows_status();
    }
    #[cfg(target_os = "macos")]
    {
        return OsOpenMenuStatus {
            platform: "macos".into(),
            installed: true,
            hint: "Right-click a folder → Open With → Vigil AI Agent, or drop the folder on the Dock icon. Requires the installed .app (not only a browser tab)."
                .into(),
        };
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        OsOpenMenuStatus {
            platform: std::env::consts::OS.into(),
            installed: false,
            hint: "Explorer / Finder “Open with Vigil” is Windows + macOS.".into(),
        }
    }
}

#[tauri::command]
pub fn install_os_open_menu() -> Result<OsOpenMenuStatus, String> {
    #[cfg(windows)]
    {
        windows_install()?;
        return Ok(windows_status());
    }
    #[cfg(not(windows))]
    {
        Ok(os_open_menu_status())
    }
}

#[tauri::command]
pub fn uninstall_os_open_menu() -> Result<OsOpenMenuStatus, String> {
    #[cfg(windows)]
    {
        windows_uninstall()?;
        return Ok(windows_status());
    }
    #[cfg(not(windows))]
    {
        Ok(os_open_menu_status())
    }
}

#[cfg(windows)]
fn exe_path() -> Result<String, String> {
    Ok(std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned())
}

#[cfg(windows)]
fn windows_status() -> OsOpenMenuStatus {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let installed = hkcu
        .open_subkey(format!(
            r"Software\Classes\Directory\shell\{WIN_MENU_KEY}\command"
        ))
        .is_ok();
    OsOpenMenuStatus {
        platform: "windows".into(),
        installed,
        hint: if installed {
            "Right-click a folder in Explorer → Open with Vigil. Windows 11 may put it under “Show more options”."
                .into()
        } else {
            "Not installed. Click Install to add the Explorer menu (this user only, no admin)."
                .into()
        },
    }
}

#[cfg(windows)]
fn windows_install() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe = exe_path()?;
    let icon = format!("{exe},0");
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    write_verb(
        &hkcu,
        r"Software\Classes\Directory\shell",
        &format!("\"{exe}\" \"%1\""),
        &icon,
    )?;
    write_verb(
        &hkcu,
        r"Software\Classes\Directory\Background\shell",
        &format!("\"{exe}\" \"%V\""),
        &icon,
    )?;
    write_verb(
        &hkcu,
        r"Software\Classes\*\shell",
        &format!("\"{exe}\" \"%1\""),
        &icon,
    )?;
    Ok(())
}

#[cfg(windows)]
fn write_verb(hkcu: &winreg::RegKey, parent: &str, command: &str, icon: &str) -> Result<(), String> {
    let shell = hkcu
        .create_subkey(parent)
        .map_err(|e| e.to_string())?
        .0;
    let key = shell
        .create_subkey(WIN_MENU_KEY)
        .map_err(|e| e.to_string())?
        .0;
    key.set_value("", &WIN_MENU_LABEL)
        .map_err(|e| e.to_string())?;
    key.set_value("Icon", &icon.to_string())
        .map_err(|e| e.to_string())?;
    key.set_value("MUIVerb", &WIN_MENU_LABEL)
        .map_err(|e| e.to_string())?;
    let cmd = key.create_subkey("command").map_err(|e| e.to_string())?.0;
    cmd.set_value("", &command.to_string())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn windows_uninstall() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for parent in [
        r"Software\Classes\Directory\shell",
        r"Software\Classes\Directory\Background\shell",
        r"Software\Classes\*\shell",
    ] {
        let _ = hkcu.delete_subkey_all(format!("{parent}\\{WIN_MENU_KEY}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vigil_open_url() {
        assert_eq!(
            parse_open_candidate("vigil://open?path=%2Ftmp%2Fproj"),
            Some("/tmp/proj".into())
        );
    }

    #[test]
    fn skips_flags() {
        assert_eq!(parse_open_candidate("--dev"), None);
    }

    #[test]
    fn parses_file_url_unix() {
        let got = parse_open_candidate("file:///tmp/demo");
        assert!(got.as_deref() == Some("/tmp/demo") || got.as_deref() == Some("\\tmp\\demo"));
    }

    #[test]
    fn reuses_empty_or_same_folder() {
        assert!(should_reuse_window(None, "/tmp/a"));
        assert!(should_reuse_window(Some("/tmp/proj/"), "/tmp/proj"));
        assert!(!should_reuse_window(Some("/tmp/a"), "/tmp/b"));
    }
}
