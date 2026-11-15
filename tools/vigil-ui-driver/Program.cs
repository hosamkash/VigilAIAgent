using System.Diagnostics;
using System.Drawing.Imaging;
using System.Globalization;
using System.Text;
using System.Text.Json;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using FlaUI.Core.WindowsAPI;
using FlaUI.UIA3;

namespace VigilUiDriver;

/// <summary>
/// Windows-only UI automation host for Vigil AI Agent.
/// Speaks NDJSON on stdin/stdout — one request line → one response line.
/// Targets WinForms + DevExpress via UIA3 (FlaUI).
/// </summary>
internal static class Program
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private static UIA3Automation? _automation;
    private static Application? _app;
    private static readonly Dictionary<string, AutomationElement> Refs = new(StringComparer.OrdinalIgnoreCase);

    private static int Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;
        // Ready signal for the Node sidecar.
        Write(new { ok = true, output = "vigil-ui-driver ready", version = 1 });

        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            line = line.Trim();
            if (line.Length == 0) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var op = root.TryGetProperty("op", out var opEl)
                    ? opEl.GetString() ?? ""
                    : "";
                var response = Handle(op, root);
                Write(response);
            }
            catch (Exception ex)
            {
                Write(new { ok = false, error = ex.Message });
            }
        }

        Cleanup();
        return 0;
    }

    private static object Handle(string op, JsonElement root) => op.ToLowerInvariant() switch
    {
        "ping" => new
        {
            ok = true,
            output = "pong",
            attached = _app != null,
            pid = _app?.ProcessId,
            title = SafeName(TryMainWindow()),
        },
        "launch" => Launch(root),
        "attach" => Attach(root),
        "snapshot" => Snapshot(root),
        "search" => Search(root),
        "screenshot" => Screenshot(root),
        "click" => Click(root),
        "type" => Type(root),
        "select" => Select(root),
        "keys" => Keys(root),
        "windows" => ListWindows(),
        "focus_window" => FocusWindow(root),
        "screen_map" => ScreenMap(root),
        "read" => Read(root),
        "wait" => Wait(root),
        "close" => CloseApp(),
        _ => new { ok = false, error = $"Unknown op '{op}'" },
    };

    private static object Launch(JsonElement root)
    {
        var path = GetString(root, "path");
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return new { ok = false, error = $"Executable not found: {path}" };

        Cleanup();
        _automation = new UIA3Automation();
        var args = GetString(root, "args") ?? "";
        var cwd = GetString(root, "cwd") ?? GetString(root, "workingDirectory");

        if (!string.IsNullOrWhiteSpace(cwd) && Directory.Exists(cwd))
        {
            var psi = new ProcessStartInfo
            {
                FileName = path,
                Arguments = args,
                WorkingDirectory = cwd,
                UseShellExecute = false,
            };
            _app = Application.Launch(psi);
        }
        else
        {
            _app = string.IsNullOrWhiteSpace(args)
                ? Application.Launch(path)
                : Application.Launch(path, args);
        }

        // Give WinForms / DevExpress a moment to create the main window.
        Thread.Sleep(800);
        try { _app.WaitWhileMainHandleIsMissing(TimeSpan.FromSeconds(20)); }
        catch { /* some apps have no classic main handle yet */ }

        var win = TryMainWindow();
        win?.SetForeground();
        return new
        {
            ok = true,
            output = $"Launched {path} (pid={_app.ProcessId})",
            pid = _app.ProcessId,
            title = SafeName(win),
            path,
        };
    }

    private static object Attach(JsonElement root)
    {
        Cleanup(keepAutomation: false);
        _automation = new UIA3Automation();

        if (root.TryGetProperty("pid", out var pidEl) && pidEl.TryGetInt32(out var pid))
        {
            _app = Application.Attach(pid);
        }
        else
        {
            var name = GetString(root, "name") ?? GetString(root, "processName");
            if (string.IsNullOrWhiteSpace(name))
                return new { ok = false, error = "attach requires pid or name" };

            var matches = Process.GetProcesses()
                .Where(p =>
                {
                    try
                    {
                        return p.ProcessName.Equals(name, StringComparison.OrdinalIgnoreCase)
                            || (p.MainWindowTitle?.Contains(name, StringComparison.OrdinalIgnoreCase) ?? false);
                    }
                    catch { return false; }
                })
                .GroupBy(p => p.Id)
                .Select(g => g.First())
                .ToList();

            if (matches.Count == 0)
                return new { ok = false, error = $"No process matching '{name}'" };
            if (matches.Count > 1)
            {
                var candidates = matches.Select(p =>
                {
                    string title = "";
                    try { title = p.MainWindowTitle ?? ""; } catch { /* */ }
                    return new { pid = p.Id, processName = p.ProcessName, title };
                }).ToList();
                return new
                {
                    ok = false,
                    error = $"Multiple processes match '{name}'. Pass pid from candidates.",
                    candidates,
                };
            }
            _app = Application.Attach(matches[0]);
        }

        var win = TryMainWindow();
        win?.SetForeground();
        return new
        {
            ok = true,
            output = $"Attached pid={_app.ProcessId}",
            pid = _app.ProcessId,
            title = SafeName(win),
        };
    }

    private static object Snapshot(JsonElement root)
    {
        EnsureApp();
        var max = root.TryGetProperty("max", out var maxEl) && maxEl.TryGetInt32(out var m) ? m : 100;
        max = Math.Clamp(max, 10, 200);

        Refs.Clear();
        var win = RequireWindow();
        win.SetForeground();

        var lines = new List<string>
        {
            $"- App pid={_app!.ProcessId}",
            $"- Window: {SafeName(win)}",
        };

        var interesting = new HashSet<ControlType>
        {
            ControlType.Button,
            ControlType.Edit,
            ControlType.Document,
            ControlType.CheckBox,
            ControlType.RadioButton,
            ControlType.ComboBox,
            ControlType.ListItem,
            ControlType.MenuItem,
            ControlType.TabItem,
            ControlType.Hyperlink,
            ControlType.TreeItem,
            ControlType.DataItem,
            ControlType.Text,
            ControlType.Pane,
            ControlType.Window,
            ControlType.ToolBar,
            ControlType.SplitButton,
        };

        var count = 0;
        Walk(win, 0, 8, el =>
        {
            if (count >= max) return false;
            ControlType ct;
            try { ct = el.ControlType; }
            catch { return true; }

            if (!interesting.Contains(ct) && ct != ControlType.Custom) return true;

            string name;
            string autoId;
            bool enabled;
            bool offscreen;
            try
            {
                name = (el.Name ?? "").Trim();
                autoId = (el.AutomationId ?? "").Trim();
                enabled = el.IsEnabled;
                offscreen = el.IsOffscreen;
            }
            catch { return true; }

            if (offscreen) return true;
            if (string.IsNullOrEmpty(name) && string.IsNullOrEmpty(autoId) && ct == ControlType.Pane)
                return true;
            if (string.IsNullOrEmpty(name) && string.IsNullOrEmpty(autoId) && ct == ControlType.Text)
                return true;

            count++;
            var refId = $"e{count}";
            Refs[refId] = el;

            var bits = new List<string> { $"[{refId}]", ct.ToString() };
            if (!string.IsNullOrEmpty(name)) bits.Add($"\"{Truncate(name, 60)}\"");
            if (!string.IsNullOrEmpty(autoId)) bits.Add($"id={autoId}");
            if (!enabled) bits.Add("disabled");

            try
            {
                if (el.Patterns.Value.IsSupported)
                {
                    var val = el.Patterns.Value.Pattern.Value;
                    if (!string.IsNullOrEmpty(val)) bits.Add($"value=\"{Truncate(val, 40)}\"");
                }
            }
            catch { /* ignore */ }

            lines.Add("  - " + string.Join(" ", bits));
            return true;
        });

        return new { ok = true, output = string.Join("\n", lines), count };
    }

    private static object Click(JsonElement root)
    {
        EnsureApp();
        var el = ResolveRef(root);
        el.Focus();
        try
        {
            if (el.Patterns.Invoke.IsSupported)
                el.Patterns.Invoke.Pattern.Invoke();
            else if (el.Patterns.SelectionItem.IsSupported)
                el.Patterns.SelectionItem.Pattern.Select();
            else if (el.Patterns.Toggle.IsSupported)
                el.Patterns.Toggle.Pattern.Toggle();
            else
                el.Click();
        }
        catch
        {
            el.Click();
        }
        Thread.Sleep(200);
        return new { ok = true, output = $"Clicked {GetString(root, "ref")}" };
    }

    private static object Type(JsonElement root)
    {
        EnsureApp();
        var el = ResolveRef(root);
        var text = GetString(root, "text") ?? "";
        var clear = !root.TryGetProperty("clear", out var clearEl) || clearEl.ValueKind != JsonValueKind.False;

        el.Focus();
        Thread.Sleep(80);

        try
        {
            if (el.Patterns.Value.IsSupported)
            {
                if (clear) el.Patterns.Value.Pattern.SetValue(text);
                else el.Patterns.Value.Pattern.SetValue((el.Patterns.Value.Pattern.Value ?? "") + text);
            }
            else
            {
                var asEdit = el.AsTextBox();
                if (clear) asEdit.Text = text;
                else
                {
                    Keyboard.Type(text);
                }
            }
        }
        catch
        {
            if (clear)
            {
                Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_A);
                Keyboard.Type(VirtualKeyShort.DELETE);
            }
            Keyboard.Type(text);
        }

        if (root.TryGetProperty("submit", out var sub) && sub.ValueKind == JsonValueKind.True)
            Keyboard.Type(VirtualKeyShort.ENTER);

        Thread.Sleep(150);
        return new { ok = true, output = $"Typed into {GetString(root, "ref")}" };
    }

    private static object Read(JsonElement root)
    {
        EnsureApp();
        var el = ResolveRef(root);
        var name = SafeName(el);
        var autoId = "";
        var value = "";
        var help = "";
        try { autoId = el.AutomationId ?? ""; } catch { /* */ }
        try
        {
            if (el.Patterns.Value.IsSupported)
                value = el.Patterns.Value.Pattern.Value ?? "";
        }
        catch { /* */ }
        try { help = el.HelpText ?? ""; } catch { /* */ }

        var output = $"name={name}\nid={autoId}\nvalue={value}\nhelp={help}\ncontrol={el.ControlType}";
        return new { ok = true, output, name, value, automationId = autoId };
    }

    private static object Wait(JsonElement root)
    {
        EnsureApp();
        var ms = root.TryGetProperty("ms", out var msEl) && msEl.TryGetInt32(out var n)
            ? Math.Clamp(n, 0, 60_000)
            : 5_000;
        var nameContains = GetString(root, "nameContains") ?? GetString(root, "name") ?? "";
        var autoId = GetString(root, "automationId") ?? GetString(root, "id") ?? "";

        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < ms)
        {
            try
            {
                var win = TryMainWindow();
                if (win != null)
                {
                    if (string.IsNullOrEmpty(nameContains) && string.IsNullOrEmpty(autoId))
                    {
                        Thread.Sleep(ms);
                        break;
                    }

                    AutomationElement? found = null;
                    if (!string.IsNullOrEmpty(autoId))
                    {
                        found = win.FindFirstDescendant(_automation!.ConditionFactory.ByAutomationId(autoId));
                    }
                    if (found == null && !string.IsNullOrEmpty(nameContains))
                    {
                        // Contains match — DevExpress captions often include extra whitespace/prefixes.
                        Walk(win, 0, 10, el =>
                        {
                            if (found != null) return false;
                            try
                            {
                                var n = el.Name ?? "";
                                if (n.Contains(nameContains, StringComparison.OrdinalIgnoreCase)
                                    && !el.IsOffscreen)
                                {
                                    found = el;
                                    return false;
                                }
                            }
                            catch { /* continue */ }
                            return true;
                        });
                    }

                    if (found != null && !found.IsOffscreen)
                        return new { ok = true, output = $"Found after {sw.ElapsedMilliseconds}ms: {SafeName(found)}" };
                }
            }
            catch { /* retry */ }
            Thread.Sleep(200);
        }

        if (string.IsNullOrEmpty(nameContains) && string.IsNullOrEmpty(autoId))
            return new { ok = true, output = $"Waited {ms}ms" };
        return new { ok = false, error = $"Timeout after {ms}ms waiting for '{nameContains}{autoId}'" };
    }

    private static object Search(JsonElement root)
    {
        EnsureApp();
        var queryRaw = GetString(root, "query") ?? GetString(root, "q") ?? "";
        var query = NormalizeSearch(queryRaw);
        if (string.IsNullOrWhiteSpace(query))
            return new { ok = false, error = "search requires query" };

        var max = root.TryGetProperty("max", out var maxEl) && maxEl.TryGetInt32(out var m) ? m : 40;
        max = Math.Clamp(max, 1, 100);

        Refs.Clear();
        var win = RequireWindow();
        win.SetForeground();

        var lines = new List<string>
        {
            $"- Search \"{Truncate(queryRaw.Trim(), 60)}\" (normalized match)",
            $"- Window: {SafeName(win)}",
        };
        var count = 0;

        Walk(win, 0, 12, el =>
        {
            if (count >= max) return false;
            string name;
            string autoId;
            string help;
            ControlType ct;
            bool offscreen;
            try
            {
                name = (el.Name ?? "").Trim();
                autoId = (el.AutomationId ?? "").Trim();
                help = (el.HelpText ?? "").Trim();
                ct = el.ControlType;
                offscreen = el.IsOffscreen;
            }
            catch { return true; }

            if (offscreen) return true;

            var hay = NormalizeSearch($"{name} {autoId} {help} {ct}");
            if (!hay.Contains(query, StringComparison.Ordinal)) return true;

            count++;
            var refId = $"e{count}";
            Refs[refId] = el;
            var bits = new List<string> { $"[{refId}]", ct.ToString() };
            if (!string.IsNullOrEmpty(name)) bits.Add($"\"{Truncate(name, 60)}\"");
            if (!string.IsNullOrEmpty(autoId)) bits.Add($"id={autoId}");
            lines.Add("  - " + string.Join(" ", bits));
            return true;
        });

        if (count == 0)
            lines.Add("  (no matches)");

        return new { ok = true, output = string.Join("\n", lines), count };
    }

    private static object Screenshot(JsonElement root)
    {
        EnsureApp();
        var win = RequireWindow();
        win.SetForeground();
        Thread.Sleep(120);

        using var capture = Capture.Element(win);
        using var ms = new MemoryStream();
        capture.Bitmap.Save(ms, ImageFormat.Png);
        var bytes = ms.ToArray();
        var b64 = Convert.ToBase64String(bytes);
        var title = SafeName(win);
        return new
        {
            ok = true,
            output = $"Screenshot {capture.Bitmap.Width}x{capture.Bitmap.Height} of \"{Truncate(title, 80)}\" ({bytes.Length} bytes). Image sent to IDE.",
            imageBase64 = b64,
            width = capture.Bitmap.Width,
            height = capture.Bitmap.Height,
            title,
            pid = _app!.ProcessId,
        };
    }

    private static object Select(JsonElement root)
    {
        EnsureApp();
        var el = ResolveRef(root);
        var value = GetString(root, "value") ?? GetString(root, "text") ?? "";
        if (string.IsNullOrWhiteSpace(value))
            return new { ok = false, error = "select requires value" };

        el.Focus();
        Thread.Sleep(80);

        try
        {
            if (el.Patterns.Value.IsSupported)
            {
                el.Patterns.Value.Pattern.SetValue(value);
                return new { ok = true, output = $"Selected/set value \"{Truncate(value, 60)}\" on {GetString(root, "ref")}" };
            }
        }
        catch { /* fall through */ }

        // Expand combo then pick matching ListItem / MenuItem.
        try
        {
            if (el.Patterns.ExpandCollapse.IsSupported)
                el.Patterns.ExpandCollapse.Pattern.Expand();
            else
                el.Click();
            Thread.Sleep(200);
        }
        catch
        {
            try { el.Click(); } catch { /* */ }
            Thread.Sleep(200);
        }

        AutomationElement? hit = null;
        var needle = NormalizeSearch(value);
        Walk(RequireWindow(), 0, 10, child =>
        {
            if (hit != null) return false;
            try
            {
                var ct = child.ControlType;
                if (ct is not (ControlType.ListItem or ControlType.MenuItem or ControlType.DataItem or ControlType.Text))
                    return true;
                var n = child.Name ?? "";
                if (NormalizeSearch(n).Contains(needle, StringComparison.Ordinal))
                {
                    hit = child;
                    return false;
                }
            }
            catch { /* */ }
            return true;
        });

        if (hit == null)
            return new { ok = false, error = $"No list item matching '{value}'" };

        try
        {
            if (hit.Patterns.SelectionItem.IsSupported)
                hit.Patterns.SelectionItem.Pattern.Select();
            else if (hit.Patterns.Invoke.IsSupported)
                hit.Patterns.Invoke.Pattern.Invoke();
            else
                hit.Click();
        }
        catch
        {
            hit.Click();
        }

        Thread.Sleep(150);
        return new { ok = true, output = $"Selected \"{Truncate(SafeName(hit), 60)}\" for {GetString(root, "ref")}" };
    }

    private static object Keys(JsonElement root)
    {
        EnsureApp();
        var keys = GetString(root, "keys") ?? GetString(root, "text") ?? "";
        if (string.IsNullOrWhiteSpace(keys))
            return new { ok = false, error = "keys required (e.g. Ctrl+S, Alt+F, Enter)" };

        var win = TryMainWindow();
        win?.SetForeground();
        Thread.Sleep(60);

        var parts = keys.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 1)
        {
            TypeKeyToken(parts[0]);
        }
        else
        {
            var mods = new List<VirtualKeyShort>();
            VirtualKeyShort? main = null;
            foreach (var part in parts)
            {
                var vk = ParseKeyToken(part);
                if (vk is VirtualKeyShort.CONTROL or VirtualKeyShort.MENU or VirtualKeyShort.SHIFT or VirtualKeyShort.LWIN)
                    mods.Add(vk.Value);
                else
                    main = vk;
            }
            if (main == null)
                return new { ok = false, error = $"Could not parse keys '{keys}'" };
            if (mods.Count == 0)
                Keyboard.Type(main.Value);
            else
            {
                var chord = mods.Append(main.Value).ToArray();
                Keyboard.TypeSimultaneously(chord);
            }
        }

        Thread.Sleep(120);
        return new { ok = true, output = $"Pressed {keys}" };
    }

    private static object ListWindows()
    {
        EnsureApp();
        if (_automation == null || _app == null)
            return new { ok = false, error = "No app attached" };

        Window[] wins;
        try { wins = _app.GetAllTopLevelWindows(_automation); }
        catch (Exception ex) { return new { ok = false, error = ex.Message }; }

        var lines = new List<string> { $"- Windows for pid={_app.ProcessId} ({wins.Length})" };
        for (var i = 0; i < wins.Length; i++)
        {
            var title = SafeName(wins[i]);
            lines.Add($"  [{i}] \"{Truncate(title, 80)}\"");
        }
        return new
        {
            ok = true,
            output = string.Join("\n", lines),
            count = wins.Length,
            windows = wins.Select((w, i) => new { index = i, title = SafeName(w) }).ToList(),
        };
    }

    private static object FocusWindow(JsonElement root)
    {
        EnsureApp();
        if (_automation == null || _app == null)
            return new { ok = false, error = "No app attached" };

        Window[] wins;
        try { wins = _app.GetAllTopLevelWindows(_automation); }
        catch (Exception ex) { return new { ok = false, error = ex.Message }; }

        Window? target = null;
        if (root.TryGetProperty("index", out var idxEl) && idxEl.TryGetInt32(out var idx))
        {
            if (idx < 0 || idx >= wins.Length)
                return new { ok = false, error = $"index {idx} out of range (0..{wins.Length - 1})" };
            target = wins[idx];
        }
        else
        {
            var title = GetString(root, "title") ?? GetString(root, "name") ?? "";
            if (string.IsNullOrWhiteSpace(title))
                return new { ok = false, error = "focus_window requires index or title" };
            target = wins.FirstOrDefault(w =>
                SafeName(w).Contains(title, StringComparison.OrdinalIgnoreCase));
            if (target == null)
                return new { ok = false, error = $"No window title containing '{title}'" };
        }

        target.SetForeground();
        Thread.Sleep(100);
        return new { ok = true, output = $"Focused \"{Truncate(SafeName(target), 80)}\"", title = SafeName(target) };
    }

    private static object ScreenMap(JsonElement root)
    {
        EnsureApp();
        var maxMenus = root.TryGetProperty("maxMenus", out var mm) && mm.TryGetInt32(out var n)
            ? Math.Clamp(n, 1, 30)
            : 12;
        var maxItems = root.TryGetProperty("maxItems", out var mi) && mi.TryGetInt32(out var ni)
            ? Math.Clamp(ni, 5, 80)
            : 40;
        var timeoutMs = root.TryGetProperty("timeoutMs", out var tm) && tm.TryGetInt32(out var t)
            ? Math.Clamp(t, 5_000, 120_000)
            : 60_000;

        var win = RequireWindow();
        win.SetForeground();
        var sw = Stopwatch.StartNew();
        var paths = new List<string>();
        var skipNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "exit", "quit", "close", "خروج", "إغلاق", "اغلاق", "إنهاء", "انهاء",
        };

        // Collect top-level menu items (MenuBar / Menu).
        var topMenus = new List<AutomationElement>();
        Walk(win, 0, 4, el =>
        {
            if (topMenus.Count >= maxMenus) return false;
            try
            {
                if (el.ControlType == ControlType.MenuItem)
                {
                    // Prefer items that look top-level: parent is MenuBar or Menu or Pane.
                    var parent = el.Parent;
                    var pct = parent?.ControlType;
                    if (pct is ControlType.MenuBar or ControlType.Menu or ControlType.ToolBar or ControlType.Pane)
                    {
                        var name = SafeName(el);
                        if (!string.IsNullOrEmpty(name) && !skipNames.Contains(name))
                            topMenus.Add(el);
                    }
                }
            }
            catch { /* */ }
            return true;
        });

        // De-dupe by name
        topMenus = topMenus
            .GroupBy(SafeName)
            .Select(g => g.First())
            .Take(maxMenus)
            .ToList();

        foreach (var menu in topMenus)
        {
            if (sw.ElapsedMilliseconds > timeoutMs) break;
            var menuName = SafeName(menu);
            if (string.IsNullOrEmpty(menuName)) continue;

            try
            {
                menu.Focus();
                if (menu.Patterns.ExpandCollapse.IsSupported)
                    menu.Patterns.ExpandCollapse.Pattern.Expand();
                else
                    menu.Click();
                Thread.Sleep(250);
            }
            catch
            {
                try { menu.Click(); Thread.Sleep(250); }
                catch { continue; }
            }

            var itemCount = 0;
            Walk(win, 0, 8, el =>
            {
                if (sw.ElapsedMilliseconds > timeoutMs) return false;
                if (itemCount >= maxItems) return false;
                try
                {
                    if (el.ControlType != ControlType.MenuItem) return true;
                    var childName = SafeName(el);
                    if (string.IsNullOrEmpty(childName)) return true;
                    if (string.Equals(childName, menuName, StringComparison.OrdinalIgnoreCase)) return true;
                    if (skipNames.Contains(childName)) return true;
                    paths.Add($"{menuName} → {childName}");
                    itemCount++;
                }
                catch { /* */ }
                return true;
            });

            // Collapse / Escape
            try
            {
                if (menu.Patterns.ExpandCollapse.IsSupported)
                    menu.Patterns.ExpandCollapse.Pattern.Collapse();
                else
                    Keyboard.Type(VirtualKeyShort.ESCAPE);
            }
            catch
            {
                try { Keyboard.Type(VirtualKeyShort.ESCAPE); } catch { /* */ }
            }
            Thread.Sleep(120);
        }

        var lines = new List<string>
        {
            $"- Screen map pid={_app!.ProcessId}",
            $"- Window: {SafeName(win)}",
            $"- Top menus scanned: {topMenus.Count}",
            $"- Menu paths: {paths.Count}",
        };
        foreach (var p in paths.Take(120))
            lines.Add($"  - {p}");
        if (paths.Count == 0)
            lines.Add("  (no menu paths found — try app_snapshot / app_search_ui)");

        return new
        {
            ok = true,
            output = string.Join("\n", lines),
            menuCount = topMenus.Count,
            pathCount = paths.Count,
            paths,
        };
    }

    private static VirtualKeyShort? ParseKeyToken(string token)
    {
        var t = token.Trim();
        if (t.Length == 0) return null;
        return t.ToLowerInvariant() switch
        {
            "ctrl" or "control" => VirtualKeyShort.CONTROL,
            "alt" or "menu" => VirtualKeyShort.MENU,
            "shift" => VirtualKeyShort.SHIFT,
            "win" or "meta" or "cmd" => VirtualKeyShort.LWIN,
            "enter" or "return" => VirtualKeyShort.ENTER,
            "esc" or "escape" => VirtualKeyShort.ESCAPE,
            "tab" => VirtualKeyShort.TAB,
            "space" => VirtualKeyShort.SPACE,
            "backspace" or "bksp" => VirtualKeyShort.BACK,
            "delete" or "del" => VirtualKeyShort.DELETE,
            "up" => VirtualKeyShort.UP,
            "down" => VirtualKeyShort.DOWN,
            "left" => VirtualKeyShort.LEFT,
            "right" => VirtualKeyShort.RIGHT,
            "f1" => VirtualKeyShort.F1,
            "f2" => VirtualKeyShort.F2,
            "f3" => VirtualKeyShort.F3,
            "f4" => VirtualKeyShort.F4,
            "f5" => VirtualKeyShort.F5,
            "f6" => VirtualKeyShort.F6,
            "f7" => VirtualKeyShort.F7,
            "f8" => VirtualKeyShort.F8,
            "f9" => VirtualKeyShort.F9,
            "f10" => VirtualKeyShort.F10,
            "f11" => VirtualKeyShort.F11,
            "f12" => VirtualKeyShort.F12,
            _ when t.Length == 1 && char.IsLetterOrDigit(t[0]) =>
                (VirtualKeyShort)char.ToUpperInvariant(t[0]),
            _ => null,
        };
    }

    private static void TypeKeyToken(string token)
    {
        var vk = ParseKeyToken(token);
        if (vk != null)
        {
            Keyboard.Type(vk.Value);
            return;
        }
        Keyboard.Type(token);
    }

    private static object CloseApp()
    {
        try
        {
            _app?.Close();
        }
        catch
        {
            try { _app?.Kill(); } catch { /* */ }
        }
        Cleanup();
        return new { ok = true, output = "Application closed." };
    }

    /// <summary>Arabic-friendly normalize: Alef variants, taa marbuta, alif maqsura, strip marks.</summary>
    private static string NormalizeSearch(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s.Normalize(NormalizationForm.FormKD))
        {
            var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (cat is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark)
                continue;
            var c = ch switch
            {
                'أ' or 'إ' or 'آ' or 'ٱ' => 'ا',
                'ة' => 'ه',
                'ى' => 'ي',
                _ => char.ToLowerInvariant(ch),
            };
            sb.Append(c);
        }
        return sb.ToString().Trim();
    }

    private static AutomationElement ResolveRef(JsonElement root)
    {
        var refId = GetString(root, "ref") ?? "";
        if (string.IsNullOrWhiteSpace(refId) || !Refs.TryGetValue(refId, out var el))
            throw new InvalidOperationException($"Unknown ref '{refId}'. Call snapshot first.");
        try
        {
            _ = el.Properties.Name.Value;
            return el;
        }
        catch
        {
            throw new InvalidOperationException($"Ref '{refId}' is stale. Call snapshot again.");
        }
    }

    private static void Walk(AutomationElement el, int depth, int maxDepth, Func<AutomationElement, bool> visit)
    {
        if (depth > maxDepth) return;
        if (!visit(el)) return;
        AutomationElement[] children;
        try { children = el.FindAllChildren(); }
        catch { return; }
        foreach (var child in children)
        {
            try { Walk(child, depth + 1, maxDepth, visit); }
            catch { /* skip broken nodes */ }
        }
    }

    private static Window? TryMainWindow()
    {
        if (_app == null || _automation == null) return null;
        try { return _app.GetMainWindow(_automation, TimeSpan.FromSeconds(3)); }
        catch
        {
            try
            {
                return _app.GetAllTopLevelWindows(_automation).FirstOrDefault();
            }
            catch { return null; }
        }
    }

    private static Window RequireWindow()
    {
        var win = TryMainWindow()
            ?? throw new InvalidOperationException("No application window. Launch or attach first.");
        return win;
    }

    private static void EnsureApp()
    {
        if (_app == null || _automation == null)
            throw new InvalidOperationException("No app attached. Call launch or attach first.");
    }

    private static void Cleanup(bool keepAutomation = false)
    {
        Refs.Clear();
        try { _app?.Dispose(); } catch { /* */ }
        _app = null;
        if (!keepAutomation)
        {
            try { _automation?.Dispose(); } catch { /* */ }
            _automation = null;
        }
    }

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;

    private static string SafeName(AutomationElement? el)
    {
        if (el == null) return "";
        try { return (el.Name ?? "").Trim(); }
        catch { return ""; }
    }

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s : s[..max] + "…";

    private static void Write(object payload)
    {
        Console.WriteLine(JsonSerializer.Serialize(payload, JsonOpts));
        Console.Out.Flush();
    }
}
