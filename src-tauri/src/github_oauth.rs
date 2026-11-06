//! GitHub sign-in that returns to Vigil after the browser confirmation.
//! The first time, GitHub asks the user to create a private Vigil app and install it.
//! After that, Sign in only asks them to confirm, then this command receives the token.

use crate::{VigilError, KEYRING_SERVICE};
use tauri::Manager;
use keyring::Entry;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const PORT: u16 = 43127;
const CALLBACK: &str = "http://127.0.0.1:43127/callback";
const ACCOUNT: &str = "git-oauth-app:github";

#[derive(Clone)]
struct GithubApp {
    client_id: String,
    client_secret: String,
    slug: String,
}

enum Phase {
    Register,
    Authorize,
}

struct Session {
    app: Option<GithubApp>,
    phase: Phase,
    state: String,
}

#[tauri::command]
pub async fn github_browser_login(app: tauri::AppHandle) -> Result<String, VigilError> {
    // The browser wait must not run on the UI thread. A blocked UI thread
    // leaves Vigil in the Dock and ignores clicks until the process is killed.
    let token = tauri::async_runtime::spawn_blocking(run_login)
        .await
        .map_err(|err| VigilError::Message(err.to_string()))??;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(token)
}

fn run_login() -> Result<String, VigilError> {
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|err| {
        VigilError::Message(format!(
            "GitHub sign-in is already waiting, or port {PORT} is in use ({err})"
        ))
    })?;
    let _ = listener.set_nonblocking(false);
    set_accept_timeout(&listener, 2);

    let mut session = Session {
        app: load_app(),
        phase: Phase::Register,
        state: random_state(),
    };
    if session.app.is_some() {
        session.phase = Phase::Authorize;
    }

    open_browser(&format!("http://127.0.0.1:{PORT}/start"))?;
    let deadline = Instant::now() + Duration::from_secs(300);

    loop {
        if Instant::now() >= deadline {
            return Err(VigilError::Message(
                "GitHub did not return to Vigil. Confirm the prompt in the browser, then try Sign in again."
                    .into(),
            ));
        }
        match listener.accept() {
            Ok((stream, addr)) => {
                if !addr.ip().is_loopback() {
                    continue;
                }
                if let Some(token) = handle_client(stream, &mut session)? {
                    return Ok(token);
                }
            }
            Err(err) if is_timeout(&err) => continue,
            Err(err) => return Err(VigilError::Message(err.to_string())),
        }
    }
}

fn is_timeout(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    ) || err.raw_os_error() == Some(35)
        || err.raw_os_error() == Some(60)
}

fn set_accept_timeout(listener: &TcpListener, seconds: i64) {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let timeout = libc::timeval {
            tv_sec: seconds,
            tv_usec: 0,
        };
        unsafe {
            libc::setsockopt(
                listener.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_RCVTIMEO,
                &timeout as *const libc::timeval as *const libc::c_void,
                std::mem::size_of::<libc::timeval>() as libc::socklen_t,
            );
        }
    }
    let _ = seconds;
}

fn handle_client(mut stream: TcpStream, session: &mut Session) -> Result<Option<String>, VigilError> {
    // accept() on a nonblocking listener returns a nonblocking socket, so the
    // request often is not here yet. Read it as a normal blocking stream.
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(8)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(8)));
    let request = read_head(&mut stream);
    let target = request_target(&request);
    if request.is_empty() {
        return Ok(None);
    }
    let path = route_path(target);
    let query = parse_query(if target.contains('?') { target } else { request.as_str() });
    eprintln!("vigil github sign-in: {}", request_line_for_log(&request));

    let outcome = if path == "/start" {
        start_page(session)?
    } else if path == "/callback" || request.contains("/callback") || query.contains_key("code") {
        callback(session, &query)?
    } else {
        Outcome::Page(http_response(404, "text/plain", "Not found"))
    };

    let page = match outcome {
        Outcome::Page(page) => page,
        Outcome::Token(token) => {
            let _ = stream.write_all(done_page().as_bytes());
            let _ = stream.shutdown(Shutdown::Both);
            return Ok(Some(token));
        }
    };
    let _ = stream.write_all(page.as_bytes());
    let _ = stream.shutdown(Shutdown::Both);
    Ok(None)
}

enum Outcome {
    Page(String),
    Token(String),
}

fn start_page(session: &Session) -> Result<Outcome, VigilError> {
    if let Some(app) = &session.app {
        return Ok(Outcome::Page(redirect(&authorize_url(app, &session.state)?)));
    }
    let manifest = json!({
        "name": format!("Vigil {}", &session.state[..6]),
        "url": "http://127.0.0.1:43127",
        "redirect_url": CALLBACK,
        "callback_urls": [CALLBACK],
        "setup_url": CALLBACK,
        "request_oauth_on_install": true,
        "public": false,
        "default_permissions": {
            "contents": "write",
            "metadata": "read"
        }
    });
    let manifest = serde_json::to_string(&manifest).map_err(|err| VigilError::Message(err.to_string()))?;
    let action = format!(
        "https://github.com/settings/apps/new?state={}",
        urlencode(&session.state)
    );
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Sign in to GitHub</title></head><body><p>Opening GitHub…</p><form id=\"f\" method=\"post\" action=\"{action}\"><input type=\"hidden\" name=\"manifest\" id=\"m\"></form><script type=\"application/json\" id=\"manifest\">{manifest}</script><script>document.getElementById('m').value=document.getElementById('manifest').textContent;document.getElementById('f').submit();</script></body></html>"
    );
    Ok(Outcome::Page(http_response(200, "text/html; charset=utf-8", &html)))
}

fn callback(session: &mut Session, query: &HashMap<String, String>) -> Result<Outcome, VigilError> {
    if let Some(error) = query.get("error") {
        let detail = query.get("error_description").map(String::as_str).unwrap_or(error);
        return Err(VigilError::Message(format!("GitHub: {detail}")));
    }
    match session.phase {
        Phase::Register => {
            if query.get("state").map(String::as_str) != Some(session.state.as_str()) {
                return Err(VigilError::Message("GitHub returned an unexpected sign-in response.".into()));
            }
            let code = query
                .get("code")
                .filter(|code| is_code(code))
                .ok_or_else(|| VigilError::Message("GitHub did not return a registration code.".into()))?;
            let app = exchange_manifest(code)?;
            save_app(&app)?;
            let install = format!("https://github.com/apps/{}/installations/new", app.slug);
            session.app = Some(app);
            session.phase = Phase::Authorize;
            session.state = random_state();
            Ok(Outcome::Page(redirect(&install)))
        }
        Phase::Authorize => {
            let Some(app) = session.app.clone() else {
                return Err(VigilError::Message("GitHub sign-in was not started.".into()));
            };
            if let Some(state) = query.get("state") {
                if state != &session.state {
                    return Err(VigilError::Message(
                        "GitHub returned an unexpected sign-in response.".into(),
                    ));
                }
            }
            let Some(code) = query.get("code").filter(|code| is_code(code)) else {
                return Ok(Outcome::Page(redirect(&authorize_url(&app, &session.state)?)));
            };
            let token = exchange_user_token(&app, code)?;
            Ok(Outcome::Token(token))
        }
    }
}

fn authorize_url(app: &GithubApp, state: &str) -> Result<String, VigilError> {
    if !is_client_id(&app.client_id) {
        return Err(VigilError::Message("Stored GitHub app id is invalid.".into()));
    }
    Ok(format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&state={}",
        urlencode(&app.client_id),
        urlencode(CALLBACK),
        urlencode(state)
    ))
}

fn exchange_manifest(code: &str) -> Result<GithubApp, VigilError> {
    let url = format!("https://api.github.com/app-manifests/{code}/conversions");
            let body = curl_json("POST", &url, Some("{}"))?;
    let parsed: ManifestResponse = serde_json::from_str(&body).map_err(|_| {
        VigilError::Message(github_public_error(&body))
    })?;
    if !is_client_id(&parsed.client_id) || !is_secret(&parsed.client_secret) || !is_slug(&parsed.slug) {
        return Err(VigilError::Message("GitHub did not return an app Vigil can use.".into()));
    }
    Ok(GithubApp {
        client_id: parsed.client_id,
        client_secret: parsed.client_secret,
        slug: parsed.slug,
    })
}

fn exchange_user_token(app: &GithubApp, code: &str) -> Result<String, VigilError> {
    let payload = json!({
        "client_id": app.client_id,
        "client_secret": app.client_secret,
        "code": code,
        "redirect_uri": CALLBACK
    });
    let body = curl_json(
        "POST",
        "https://github.com/login/oauth/access_token",
        Some(&payload.to_string()),
    )?;
    let parsed: TokenResponse = serde_json::from_str(&body)
        .map_err(|_| VigilError::Message(github_public_error(&body)))?;
    if let Some(error) = parsed.error {
        return Err(VigilError::Message(format!(
            "GitHub: {}",
            parsed.error_description.unwrap_or(error)
        )));
    }
    let token = parsed.access_token.unwrap_or_default();
    if token.len() < 20 || token.chars().any(|ch| ch.is_whitespace()) {
        return Err(VigilError::Message("GitHub did not return an access token.".into()));
    }
    Ok(token)
}

#[derive(Deserialize)]
struct ManifestResponse {
    client_id: String,
    client_secret: String,
    slug: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn load_app() -> Option<GithubApp> {
    let entry = Entry::new(KEYRING_SERVICE, ACCOUNT).ok()?;
    let raw = entry.get_password().ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let client_id = value.get("clientId")?.as_str()?.to_string();
    let client_secret = value.get("clientSecret")?.as_str()?.to_string();
    let slug = value.get("slug")?.as_str()?.to_string();
    if !is_client_id(&client_id) || !is_secret(&client_secret) || !is_slug(&slug) {
        return None;
    }
    Some(GithubApp {
        client_id,
        client_secret,
        slug,
    })
}

fn save_app(app: &GithubApp) -> Result<(), VigilError> {
    let raw = json!({
        "clientId": app.client_id,
        "clientSecret": app.client_secret,
        "slug": app.slug
    })
    .to_string();
    let entry = Entry::new(KEYRING_SERVICE, ACCOUNT).map_err(|err| VigilError::Message(err.to_string()))?;
    entry
        .set_password(&raw)
        .map_err(|err| VigilError::Message(err.to_string()))
}

fn curl_json(method: &str, url: &str, body: Option<&str>) -> Result<String, VigilError> {
    if !url.starts_with("https://api.github.com/") && !url.starts_with("https://github.com/") {
        return Err(VigilError::Message("Refused a sign-in request outside GitHub.".into()));
    }
    let mut command = Command::new("curl");
    command.args([
        "-sS",
        "-X",
        method,
        url,
        "-H",
        "Accept: application/json",
        "-H",
        "Content-Type: application/json",
        "-H",
        "User-Agent: Vigil",
        "--max-time",
        "30",
    ]);
    if body.is_some() {
        command.arg("--data-binary").arg("@-");
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| VigilError::Message(format!("Could not reach GitHub ({err})")))?;
    if let Some(body) = body {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| VigilError::Message("Could not reach GitHub.".into()))?;
        stdin
            .write_all(body.as_bytes())
            .map_err(|err| VigilError::Message(err.to_string()))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|err| VigilError::Message(err.to_string()))?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let err_text = String::from_utf8_lossy(&output.stderr);
        return Err(VigilError::Message(format!(
            "Could not reach GitHub ({})",
            err_text.trim().chars().take(180).collect::<String>()
        )));
    }
    if text.is_empty() {
        return Err(VigilError::Message("GitHub returned an empty response.".into()));
    }
    Ok(text)
}

fn github_public_error(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .or_else(|| value.get("error_description"))
                .or_else(|| value.get("error"))
                .and_then(|item| item.as_str())
                .map(|item| item.chars().take(180).collect())
        })
        .unwrap_or_else(|| "GitHub rejected the sign-in.".into())
}

fn open_browser(url: &str) -> Result<(), VigilError> {
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    };
    let status = result
        .map_err(|err| VigilError::Message(format!("Could not open the browser ({err})")))?;
    if !status.success() {
        return Err(VigilError::Message("Could not open the browser.".into()));
    }
    Ok(())
}

fn read_head(stream: &mut TcpStream) -> String {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let mut total = Vec::new();
    let mut buf = [0_u8; 2048];
    let deadline = Instant::now() + Duration::from_secs(15);
    while total.len() < 16_384 && Instant::now() < deadline {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                total.extend_from_slice(&buf[..n]);
                if total.windows(4).any(|item| item == b"\r\n\r\n")
                    || total.windows(2).any(|item| item == b"\n\n")
                {
                    break;
                }
            }
            Err(err) if is_timeout(&err) => {
                if !total.is_empty() {
                    break;
                }
                thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&total).into_owned()
}

fn request_line_for_log(head: &str) -> String {
    let line = head.lines().next().unwrap_or("(empty)");
    let path = line.split('?').next().unwrap_or(line);
    path.chars().take(160).collect()
}

fn request_target(head: &str) -> &str {
    head.split_whitespace().nth(1).unwrap_or("/")
}

fn route_path(target: &str) -> String {
    let raw = target.split('?').next().unwrap_or("/");
    let path = if let Some(rest) = raw.split_once("://").map(|(_, rest)| rest) {
        rest.find('/').map(|index| &rest[index..]).unwrap_or("/")
    } else {
        raw
    };
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_query(target: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some(query) = target.split_once('?').map(|(_, query)| query) else {
        return map;
    };
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        map.insert(percent_decode(key), percent_decode(value));
    }
    map
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(
                std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                16,
            ) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(if bytes[index] == b'+' { b' ' } else { bytes[index] });
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn urlencode(input: &str) -> String {
    let mut out = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn http_response(status: u16, content_type: &str, body: &str) -> String {
    let reason = if status == 200 { "OK" } else { "Not Found" };
    let len = body.len();
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}"
    )
}

fn redirect(location: &str) -> String {
    format!(
        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
}

fn done_page() -> String {
    http_response(
        200,
        "text/html; charset=utf-8",
        "<!doctype html><html><body><p>Signed in. You can close this tab and return to Vigil.</p></body></html>",
    )
}

fn random_state() -> String {
    use rand::RngCore;
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn is_code(value: &str) -> bool {
    (10..=200).contains(&value.len())
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn is_client_id(value: &str) -> bool {
    (8..=80).contains(&value.len()) && value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
}

fn is_secret(value: &str) -> bool {
    (8..=200).contains(&value.len()) && !value.chars().any(|ch| ch.is_whitespace())
}

fn is_slug(value: &str) -> bool {
    (1..=80).contains(&value.len()) && value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_callback_path_in_a_full_address() {
        assert_eq!(
            route_path("http://127.0.0.1:43127/callback?code=abc&state=def"),
            "/callback"
        );
        assert_eq!(route_path("/callback/?code=abc"), "/callback");
    }

    #[test]
    fn reads_the_callback_code() {
        let query = parse_query("/callback?code=abc123abc123abc12345&state=ok");
        assert_eq!(query.get("code").map(String::as_str), Some("abc123abc123abc12345"));
        assert_eq!(query.get("state").map(String::as_str), Some("ok"));
    }

    #[test]
    fn encodes_the_callback_address() {
        assert_eq!(
            urlencode(CALLBACK),
            "http%3A%2F%2F127.0.0.1%3A43127%2Fcallback"
        );
    }
}
