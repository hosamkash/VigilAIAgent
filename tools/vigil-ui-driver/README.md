# Vigil UI Driver (Windows)

FlaUI / UIA3 helper that lets Vigil AI Agent launch and automate **WinForms + DevExpress** desktop apps.

## Requirements

- Windows 10/11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

## Build (recommended: in-app button)

In Vigil on Windows:

1. Open the **Run** sidebar → card **اختبار تطبيقات ويندوز (EXE)** → **تثبيت محرك الاختبار**
2. Or **Settings → Desktop apps** → same button

Requires [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) once. No terminal needed.

### Manual (optional)

```bat
cd tools\vigil-ui-driver
dotnet restore
dotnet publish -c Release -r win-x64 --self-contained false -o publish
```

Output: `tools/vigil-ui-driver/publish/vigil-ui-driver.exe`

The Node sidecar looks for that path (or `VIGIL_UI_DRIVER` env override).

## Protocol

Long-running process. Sidecar writes one JSON object per line to stdin; driver answers with one JSON line on stdout.

| op | purpose |
| --- | --- |
| `launch` | `{ "op":"launch", "path":"C:\\app\\MyApp.exe", "args":"", "cwd":"…" }` |
| `attach` | `{ "op":"attach", "pid":1234 }` or `{ "name":"MyApp" }` (multi-match → candidates) |
| `snapshot` | UI tree with refs `[e1]…` |
| `search` | Fuzzy UI search (AR/EN) → matching refs |
| `screenshot` | PNG of main window (`imageBase64`) |
| `screen_map` | Bounded top-menu crawl → path list |
| `windows` / `focus_window` | List / focus top-level windows |
| `select` | Combo/list select by ref + value |
| `keys` | Hotkeys (`Ctrl+S`, `Alt+F`, …) |
| `click` | `{ "op":"click", "ref":"e3" }` |
| `type` | `{ "op":"type", "ref":"e5", "text":"…", "clear":true }` |
| `read` | Read name/value of a ref |
| `wait` | Wait for name / AutomationId |
| `close` | Close the app |
| `ping` | Health check |

## Agent tools

Once built: `app_launch`, `app_attach`, `app_snapshot`, `app_search_ui`, `app_screenshot`, `app_screen_map`, `app_list_windows`, `app_focus_window`, `app_select`, `app_keys`, `app_click`, `app_type`, `app_read`, `app_wait`, `app_profiles_list`, `app_profiles_save`, `app_close`.

macOS / Linux: tools return a clear “Windows only” error.
