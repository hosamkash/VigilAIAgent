//! Platform biometric gate (Touch ID on macOS; stubs elsewhere).

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricStatus {
    pub available: bool,
    pub platform: String,
    pub label: String,
    pub message: String,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::BiometricStatus;
    use std::fs;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub fn status() -> BiometricStatus {
        BiometricStatus {
            available: true,
            platform: "macos".into(),
            label: "Touch ID / Face ID".into(),
            message: "Uses LocalAuthentication (Touch ID or device passcode)".into(),
        }
    }

    pub fn authenticate(reason: &str) -> Result<bool, String> {
        let escaped = reason.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"import LocalAuthentication
import Foundation

let ctx = LAContext()
var err: NSError?
let reason = "{escaped}"
let policy: LAPolicy
if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) {{
    policy = .deviceOwnerAuthenticationWithBiometrics
}} else if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) {{
    policy = .deviceOwnerAuthentication
}} else {{
    fputs((err?.localizedDescription ?? "unavailable") + "\n", stderr)
    exit(2)
}}

let sem = DispatchSemaphore(value: 0)
var ok = false
ctx.evaluatePolicy(policy, localizedReason: reason) {{ success, error in
    ok = success
    if let error = error {{
        fputs(error.localizedDescription + "\n", stderr)
    }}
    sem.signal()
}}
_ = sem.wait(timeout: .now() + 60)
exit(ok ? 0 : 1)
"#
        );

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("vigil_bio_{nanos}.swift"));
        fs::write(&path, script).map_err(|e| e.to_string())?;

        let output = Command::new("swift")
            .arg(&path)
            .output()
            .map_err(|e| {
                let _ = fs::remove_file(&path);
                format!(
                    "Touch ID needs the Swift toolchain (Xcode CLT). Error: {e}"
                )
            })?;
        let _ = fs::remove_file(&path);

        match output.status.code() {
            Some(0) => Ok(true),
            Some(2) => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
            Some(_) => Ok(false),
            None => Err("Biometric process terminated".into()),
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::BiometricStatus;

    pub fn status() -> BiometricStatus {
        BiometricStatus {
            available: false,
            platform: "windows".into(),
            label: "Windows Hello".into(),
            message: "Windows Hello wiring lands in V3.1".into(),
        }
    }

    pub fn authenticate(_reason: &str) -> Result<bool, String> {
        Err("Windows Hello not yet implemented".into())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod other {
    use super::BiometricStatus;

    pub fn status() -> BiometricStatus {
        BiometricStatus {
            available: false,
            platform: std::env::consts::OS.into(),
            label: "System auth".into(),
            message: "Linux polkit biometric gate planned for V3.1".into(),
        }
    }

    pub fn authenticate(_reason: &str) -> Result<bool, String> {
        Err("Biometrics unavailable on this platform".into())
    }
}

#[cfg(target_os = "macos")]
use macos::{authenticate as platform_auth, status as platform_status};
#[cfg(target_os = "windows")]
use windows::{authenticate as platform_auth, status as platform_status};
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use other::{authenticate as platform_auth, status as platform_status};

pub fn biometric_status() -> BiometricStatus {
    platform_status()
}

pub fn authenticate_biometric(reason: &str) -> Result<bool, String> {
    let reason = if reason.trim().is_empty() {
        "Unlock Vigil AI Agent"
    } else {
        reason
    };
    platform_auth(reason)
}
