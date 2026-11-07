# Vigil UI Driver (Windows)

FlaUI / UIA3 helper that lets Vigil AI Agent launch and automate **WinForms + DevExpress** desktop apps.

## Requirements

- Windows 10/11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

## Build

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
| `launch` | `{ "op":"launch", "path":"C:\\app\\MyApp.exe", "args":"" }` |
| `attach` | `{ "op":"attach", "pid":1234 }` or `{ "name":"MyApp" }` |
| `snapshot` | UI tree with refs `[e1]…` |
| `click` | `{ "op":"click", "ref":"e3" }` |
| `type` | `{ "op":"type", "ref":"e5", "text":"…", "clear":true }` |
| `read` | Read name/value of a ref |
| `wait` | Wait for name / AutomationId |
| `close` | Close the app |
| `ping` | Health check |

## Agent tools

Once built, Vigil exposes: `app_launch`, `app_attach`, `app_snapshot`, `app_click`, `app_type`, `app_read`, `app_wait`, `app_close`.

macOS / Linux: tools return a clear “Windows only” error.
