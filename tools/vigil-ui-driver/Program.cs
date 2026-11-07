using System.Diagnostics;
using System.Text;
using System.Text.Json;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
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
        "ping" => new { ok = true, output = "pong", attached = _app != null },
        "launch" => Launch(root),
        "attach" => Attach(root),
        "snapshot" => Snapshot(root),
        "click" => Click(root),
        "type" => Type(root),
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
        _app = string.IsNullOrWhiteSpace(args)
            ? Application.Launch(path)
            : Application.Launch(path, args);

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

            var proc = Process.GetProcesses()
                .FirstOrDefault(p =>
                    p.ProcessName.Equals(name, StringComparison.OrdinalIgnoreCase)
                    || (p.MainWindowTitle?.Contains(name, StringComparison.OrdinalIgnoreCase) ?? false));
            if (proc == null)
                return new { ok = false, error = $"No process matching '{name}'" };
            _app = Application.Attach(proc);
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
