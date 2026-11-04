//! Platform auth gate (biometrics or device password / PIN).
//! Success requires BOTH exit code 0 AND stdout marker `VIGIL_AUTH=1` on macOS helpers.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiometricStatus {
    /// True when a biometric prompt can be shown on this device.
    pub available: bool,
    pub platform: String,
    pub label: String,
    pub message: String,
    /// Biometrics (Touch ID / Face ID / Windows Hello / etc.).
    pub biometrics_available: bool,
    /// Typed device login password / PIN verification.
    pub password_available: bool,
    /// OS secure vault name for API keys (Layer 2).
    pub vault_label: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiometricAuthResult {
    pub authenticated: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMode {
    Biometrics,
    Password,
}

impl AuthMode {
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
            Some("password") | Some("pin") | Some("passcode") => Self::Password,
            _ => Self::Biometrics,
        }
    }

    fn as_arg(self) -> &'static str {
        match self {
            Self::Biometrics => "biometrics",
            Self::Password => "password",
        }
    }
}

fn parse_swift_auth_output(output: &std::process::Output) -> BiometricAuthResult {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let code = output.status.code();
    let marker_ok = stdout.lines().any(|l| l.trim() == "VIGIL_AUTH=1");

    println!(
        "[vigil-bio] swift exit={code:?} marker_ok={marker_ok} stdout={:?} stderr={:?}",
        stdout.trim(),
        stderr.trim()
    );

    if code == Some(0) && marker_ok {
        return BiometricAuthResult {
            authenticated: true,
            detail: "ok".into(),
        };
    }

    let detail = {
        let err = stderr.trim();
        if !err.is_empty() {
            err.lines().last().unwrap_or(err).to_string()
        } else if code == Some(2) {
            "Auth unavailable".into()
        } else {
            "cancelled or failed".into()
        }
    };

    BiometricAuthResult {
        authenticated: false,
        detail,
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{parse_swift_auth_output, AuthMode, BiometricAuthResult, BiometricStatus};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    pub fn status() -> BiometricStatus {
        let swift_ok = Path::new("/usr/bin/swift").exists();
        BiometricStatus {
            available: swift_ok,
            platform: "macos".into(),
            label: "Touch ID / Face ID".into(),
            message: "Unlock with biometrics or your Mac login password".into(),
            biometrics_available: swift_ok,
            password_available: swift_ok,
            vault_label: "Keychain".into(),
        }
    }

    fn resource_script(name: &str) -> Result<PathBuf, String> {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name);
        if manifest.is_file() {
            return Ok(manifest);
        }
        if let Ok(exe) = std::env::current_exe() {
            let candidates = [
                exe.parent().map(|p| p.join("../Resources").join(name)),
                exe
                    .parent()
                    .and_then(|p| p.parent())
                    .map(|p| p.join("Resources").join(name)),
            ];
            for c in candidates.into_iter().flatten() {
                if c.is_file() {
                    return Ok(c);
                }
            }
        }
        Err(format!(
            "{name} not found (looked in {})",
            manifest.display()
        ))
    }

    pub fn authenticate(reason: &str, mode: AuthMode) -> Result<BiometricAuthResult, String> {
        if mode == AuthMode::Password {
            return Ok(BiometricAuthResult {
                authenticated: false,
                detail: "Use the password form".into(),
            });
        }

        let script = resource_script("authenticate.swift")?;
        println!(
            "[vigil-bio] authenticate reason={reason:?} mode={:?} script={}",
            mode,
            script.display()
        );

        if !Path::new("/usr/bin/swift").exists() {
            return Err("Auth needs /usr/bin/swift (Xcode CLT)".into());
        }

        let output = Command::new("/usr/bin/swift")
            .arg(&script)
            .arg(reason)
            .arg(mode.as_arg())
            .env(
                "PATH",
                "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
            )
            .output()
            .map_err(|e| format!("Failed to spawn swift for auth: {e}"))?;

        Ok(parse_swift_auth_output(&output))
    }

    pub fn verify_device_password(password: &str) -> Result<BiometricAuthResult, String> {
        if password.is_empty() {
            return Ok(BiometricAuthResult {
                authenticated: false,
                detail: "Password required".into(),
            });
        }

        let script = resource_script("verify_password.swift")?;
        println!(
            "[vigil-bio] verify_device_password script={}",
            script.display()
        );

        if !Path::new("/usr/bin/swift").exists() {
            return Err("Auth needs /usr/bin/swift (Xcode CLT)".into());
        }

        let mut child = Command::new("/usr/bin/swift")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env(
                "PATH",
                "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
            )
            .spawn()
            .map_err(|e| format!("Failed to spawn swift for password verify: {e}"))?;

        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| "Failed to open stdin for password verify".to_string())?;
            stdin
                .write_all(password.as_bytes())
                .map_err(|e| format!("Failed to write password to verifier: {e}"))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Password verify process failed: {e}"))?;

        Ok(parse_swift_auth_output(&output))
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{AuthMode, BiometricAuthResult, BiometricStatus};
    use std::ptr;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{LogonUserW, LOGON32_LOGON_NETWORK, LOGON32_PROVIDER_DEFAULT};

    pub fn status() -> BiometricStatus {
        BiometricStatus {
            available: false, // Windows Hello biometric prompt not wired yet
            platform: "windows".into(),
            label: "Windows Hello".into(),
            message: "Unlock with your Windows password. Windows Hello biometrics planned next.".into(),
            biometrics_available: false,
            password_available: true,
            vault_label: "Credential Manager".into(),
        }
    }

    pub fn authenticate(_reason: &str, _mode: AuthMode) -> Result<BiometricAuthResult, String> {
        Ok(BiometricAuthResult {
            authenticated: false,
            detail: "Windows Hello biometrics not yet implemented — use device password".into(),
        })
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn verify_device_password(password: &str) -> Result<BiometricAuthResult, String> {
        if password.is_empty() {
            return Ok(BiometricAuthResult {
                authenticated: false,
                detail: "Password required".into(),
            });
        }

        let user = std::env::var("USERNAME").unwrap_or_default();
        if user.is_empty() {
            return Ok(BiometricAuthResult {
                authenticated: false,
                detail: "Could not resolve Windows username".into(),
            });
        }
        let domain = std::env::var("USERDOMAIN").unwrap_or_else(|_| ".".into());

        let user_w = to_wide(&user);
        let domain_w = to_wide(&domain);
        let pass_w = to_wide(password);

        let mut token: HANDLE = ptr::null_mut();
        // SAFETY: LogonUserW with NUL-terminated wide strings and out token handle.
        let ok = unsafe {
            LogonUserW(
                user_w.as_ptr(),
                domain_w.as_ptr(),
                pass_w.as_ptr(),
                LOGON32_LOGON_NETWORK,
                LOGON32_PROVIDER_DEFAULT,
                &mut token,
            )
        };

        if ok != 0 {
            if !token.is_null() {
                unsafe { CloseHandle(token) };
            }
            Ok(BiometricAuthResult {
                authenticated: true,
                detail: "ok".into(),
            })
        } else {
            Ok(BiometricAuthResult {
                authenticated: false,
                detail: "Windows password incorrect or logon denied".into(),
            })
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod other {
    use super::{AuthMode, BiometricAuthResult, BiometricStatus};

    pub fn status() -> BiometricStatus {
        BiometricStatus {
            available: false,
            platform: std::env::consts::OS.into(),
            label: "System auth".into(),
            message: "Unlock with your account password. Biometrics via polkit planned next.".into(),
            biometrics_available: false,
            password_available: true,
            vault_label: "Secret Service".into(),
        }
    }

    pub fn authenticate(_reason: &str, _mode: AuthMode) -> Result<BiometricAuthResult, String> {
        Ok(BiometricAuthResult {
            authenticated: false,
            detail: "Biometrics unavailable on this platform — use device password".into(),
        })
    }

    pub fn verify_device_password(password: &str) -> Result<BiometricAuthResult, String> {
        if password.is_empty() {
            return Ok(BiometricAuthResult {
                authenticated: false,
                detail: "Password required".into(),
            });
        }

        let user = std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .unwrap_or_default();
        if user.is_empty() {
            return Ok(BiometricAuthResult {
                authenticated: false,
                detail: "Could not resolve Linux username".into(),
            });
        }

        let mut client = pam::Client::with_password("login")
            .map_err(|e| format!("PAM init failed: {e}"))?;
        client.conversation_mut().set_credentials(&user, password);
        match client.authenticate() {
            Ok(()) => Ok(BiometricAuthResult {
                authenticated: true,
                detail: "ok".into(),
            }),
            Err(e) => Ok(BiometricAuthResult {
                authenticated: false,
                detail: format!("Password rejected ({e})"),
            }),
        }
    }
}

#[cfg(target_os = "macos")]
use macos::{
    authenticate as platform_auth, status as platform_status,
    verify_device_password as platform_verify_password,
};
#[cfg(target_os = "windows")]
use windows::{
    authenticate as platform_auth, status as platform_status,
    verify_device_password as platform_verify_password,
};
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use other::{
    authenticate as platform_auth, status as platform_status,
    verify_device_password as platform_verify_password,
};

pub fn biometric_status() -> BiometricStatus {
    platform_status()
}

pub fn authenticate_biometric(
    reason: &str,
    mode: AuthMode,
) -> Result<BiometricAuthResult, String> {
    let reason = if reason.trim().is_empty() {
        "Unlock Vigil AI Agent"
    } else {
        reason
    };
    println!("[vigil-bio] authenticate_biometric enter mode={mode:?}");
    let result = platform_auth(reason, mode);
    println!("[vigil-bio] authenticate_biometric leave => {result:?}");
    result
}

pub fn verify_device_password(password: &str) -> Result<BiometricAuthResult, String> {
    println!("[vigil-bio] verify_device_password enter");
    let result = platform_verify_password(password);
    println!("[vigil-bio] verify_device_password leave => {result:?}");
    result
}
