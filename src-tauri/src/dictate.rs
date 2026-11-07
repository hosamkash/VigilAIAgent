//! Live macOS dictation via SFSpeechRecognizer (Swift helper).
//! Emits Tauri events so the UI paints text while the user speaks (VigilHub-like).

use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DictationEvent {
    pub kind: String,
    pub text: String,
}

struct DictationProc {
    id: u64,
    #[cfg(target_os = "macos")]
    pid: i32,
    #[cfg(target_os = "macos")]
    stdin: Option<std::fs::File>,
}

static SESSION: AtomicU64 = AtomicU64::new(1);

static DICTATION: Mutex<Option<DictationProc>> = Mutex::new(None);

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
    Err(format!("{name} not found"))
}

/// TCC aborts a bare `swift` process that touches the mic or Speech.
/// The helper must live inside a signed .app that declares the usage strings.
fn helper_executable() -> Result<PathBuf, String> {
    let script = resource_script("dictate_live.swift")?;
    let support = dirs_support()?;
    let app = support.join("DictateHelper.app");
    let contents = app.join("Contents");
    let macos = contents.join("MacOS");
    let exe = macos.join("dictate");
    let plist = contents.join("Info.plist");

    let script_mtime = std::fs::metadata(&script)
        .and_then(|m| m.modified())
        .ok();
    let exe_mtime = std::fs::metadata(&exe).and_then(|m| m.modified()).ok();
    let fresh = exe.is_file()
        && plist.is_file()
        && match (script_mtime, exe_mtime) {
            (Some(s), Some(e)) => e >= s,
            _ => false,
        };

    if !fresh {
        std::fs::create_dir_all(&macos).map_err(|e| e.to_string())?;
        std::fs::write(
            &plist,
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.vigil.agent.dictate</string>
  <key>CFBundleName</key><string>Vigil Dictate</string>
  <key>CFBundleExecutable</key><string>dictate</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>Vigil uses the microphone to turn your voice into text.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>Vigil uses speech recognition to write what you say.</string>
</dict></plist>
"#,
        )
        .map_err(|e| e.to_string())?;

        let status = Command::new("/usr/bin/swiftc")
            .arg("-O")
            .arg("-o")
            .arg(&exe)
            .arg(&script)
            .status()
            .map_err(|e| format!("swiftc failed to start: {e}"))?;
        if !status.success() {
            return Err("Failed to compile the dictation helper".into());
        }

        let signed = Command::new("/usr/bin/codesign")
            .args(["--force", "--sign", "-", "--deep"])
            .arg(&app)
            .status()
            .map_err(|e| format!("codesign failed to start: {e}"))?;
        if !signed.success() {
            return Err("Failed to sign the dictation helper".into());
        }
    }

    Ok(exe)
}

fn dirs_support() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library/Application Support/com.vigil.agent"))
}

fn emit_line(app: &AppHandle, line: &str) {
    let line = line.trim();
    if !line.starts_with("VIGIL_DICT=") {
        return;
    }
    let rest = &line["VIGIL_DICT=".len()..];
    let (kind, text) = match rest.split_once(' ') {
        Some((k, t)) => (k.to_string(), t.to_string()),
        None => (rest.to_string(), String::new()),
    };
    let _ = app.emit(
        "vigil-dictation",
        DictationEvent {
            kind: kind.to_ascii_lowercase(),
            text,
        },
    );
}

/// Start live dictation. Locale tip: ar-EG (falls back to en-US in Swift).
pub fn start_live_dictation(app: AppHandle, locale: Option<String>) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, locale);
        return Err("Native live dictation is only available on macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        stop_live_dictation().ok();

        if !Path::new("/usr/bin/swiftc").exists() {
            return Err("Live dictation needs Xcode Command Line Tools (swiftc)".into());
        }
        let exe = helper_executable()?;
        let locale = locale.unwrap_or_else(|| "ar-EG".into());
        let (pid, stdin, stdout) = spawn_disclaimed(&exe, &locale)?;
        let id = SESSION.fetch_add(1, Ordering::Relaxed);

        {
            let mut guard = DICTATION
                .lock()
                .map_err(|_| "dictation lock poisoned".to_string())?;
            *guard = Some(DictationProc {
                id,
                pid,
                stdin: Some(stdin),
            });
        }

        let app2 = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                println!("[vigil-dict] {line}");
                emit_line(&app2, &line);
            }
            let still_ours = DICTATION
                .lock()
                .ok()
                .and_then(|g| g.as_ref().map(|p| p.id == id))
                .unwrap_or(false);
            if still_ours {
                let _ = app2.emit(
                    "vigil-dictation",
                    DictationEvent {
                        kind: "end".into(),
                        text: String::new(),
                    },
                );
                if let Ok(mut guard) = DICTATION.lock() {
                    if guard.as_ref().map(|p| p.id) == Some(id) {
                        *guard = None;
                    }
                }
            }
        });

        Ok(())
    }
}

/// macOS attributes mic/speech privacy to the parent unless the child
/// disclaims responsibility. A bare spawn makes TCC abort the helper.
#[cfg(target_os = "macos")]
fn spawn_disclaimed(
    exe: &Path,
    locale: &str,
) -> Result<(i32, std::fs::File, std::fs::File), String> {
    use std::os::unix::io::FromRawFd;

    extern "C" {
        fn responsibility_spawnattrs_setdisclaim(
            attr: *mut libc::posix_spawnattr_t,
            disclaim: i32,
        ) -> i32;
        static environ: *mut *mut libc::c_char;
    }

    unsafe {
        let mut in_pipe = [0i32; 2];
        let mut out_pipe = [0i32; 2];
        if libc::pipe(in_pipe.as_mut_ptr()) != 0 || libc::pipe(out_pipe.as_mut_ptr()) != 0 {
            return Err("Failed to open dictation pipes".into());
        }

        let mut attr: libc::posix_spawnattr_t = std::ptr::null_mut();
        if libc::posix_spawnattr_init(&mut attr) != 0 {
            libc::close(in_pipe[0]);
            libc::close(in_pipe[1]);
            libc::close(out_pipe[0]);
            libc::close(out_pipe[1]);
            return Err("Failed to init dictation spawn".into());
        }
        if responsibility_spawnattrs_setdisclaim(&mut attr, 1) != 0 {
            libc::posix_spawnattr_destroy(&mut attr);
            libc::close(in_pipe[0]);
            libc::close(in_pipe[1]);
            libc::close(out_pipe[0]);
            libc::close(out_pipe[1]);
            return Err("Failed to detach dictation privacy from the parent app".into());
        }

        let mut actions: libc::posix_spawn_file_actions_t = std::ptr::null_mut();
        libc::posix_spawn_file_actions_init(&mut actions);
        libc::posix_spawn_file_actions_adddup2(&mut actions, in_pipe[0], libc::STDIN_FILENO);
        libc::posix_spawn_file_actions_adddup2(&mut actions, out_pipe[1], libc::STDOUT_FILENO);
        libc::posix_spawn_file_actions_addclose(&mut actions, in_pipe[0]);
        libc::posix_spawn_file_actions_addclose(&mut actions, in_pipe[1]);
        libc::posix_spawn_file_actions_addclose(&mut actions, out_pipe[0]);
        libc::posix_spawn_file_actions_addclose(&mut actions, out_pipe[1]);

        let exe_c = std::ffi::CString::new(exe.to_string_lossy().as_bytes())
            .map_err(|_| "Bad helper path".to_string())?;
        let arg0 = std::ffi::CString::new("dictate").unwrap();
        let arg1 = std::ffi::CString::new(locale).map_err(|_| "Bad locale".to_string())?;
        let mut argv: [*mut libc::c_char; 3] = [
            arg0.as_ptr() as *mut _,
            arg1.as_ptr() as *mut _,
            std::ptr::null_mut(),
        ];

        let mut pid: libc::pid_t = 0;
        let rc = libc::posix_spawn(
            &mut pid,
            exe_c.as_ptr(),
            &actions,
            &attr,
            argv.as_mut_ptr(),
            environ,
        );
        libc::posix_spawn_file_actions_destroy(&mut actions);
        libc::posix_spawnattr_destroy(&mut attr);
        libc::close(in_pipe[0]);
        libc::close(out_pipe[1]);

        if rc != 0 {
            libc::close(in_pipe[1]);
            libc::close(out_pipe[0]);
            return Err(format!("Failed to start dictation ({rc})"));
        }

        let stdin = std::fs::File::from_raw_fd(in_pipe[1]);
        let stdout = std::fs::File::from_raw_fd(out_pipe[0]);
        Ok((pid, stdin, stdout))
    }
}

pub fn stop_live_dictation() -> Result<(), String> {
    let proc = {
        let mut guard = DICTATION
            .lock()
            .map_err(|_| "dictation lock poisoned".to_string())?;
        guard.take()
    };
    #[cfg(target_os = "macos")]
    if let Some(mut proc) = proc {
        if let Some(mut stdin) = proc.stdin.take() {
            let _ = writeln!(stdin, "STOP");
            let _ = stdin.flush();
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
        unsafe {
            libc::kill(proc.pid, libc::SIGKILL);
            let mut status = 0;
            libc::waitpid(proc.pid, &mut status, 0);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = proc;
    }
    Ok(())
}

pub fn is_live_dictation_running() -> bool {
    DICTATION
        .lock()
        .ok()
        .map(|g| g.is_some())
        .unwrap_or(false)
}
