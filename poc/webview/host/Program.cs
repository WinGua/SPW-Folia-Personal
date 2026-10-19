// spw-folia-host.exe - native helper for the spw-folia SPW plugin.
//
// Hosts Folia's own production web bundle (the OBS browser-source surface, ?obs=1) inside a
// borderless WinForms window backed by WebView2, and drives it at 60 Hz from JSON lines read off
// stdin. JS measures its own frame rate and posts stats back; the host forwards them to stdout.
//
// Usage (as spawned by the JVM plugin):
//   spw-folia-host.exe --bundle <dir-with-index.html> --fullscreen --fps-log
//       [--screenshot <png>] [--shot-at <ms>] [--duration <ms>] [--window <w>x<h>]
//       [--user-data <dir>] [--devtools] [--title <text>] [--no-esc] [--exit-on-stdin-close]
//
// stdin protocol (JSON object per line, UTF-8):
//   {"type":"config","config":{...ObsBrowserSourceConfig...}}   // full Folia OBS config payload
//   {"type":"state","posMs":1234.5,"durationMs":240000,"playing":true,"rate":1,
//                   "power":0.6,"bands":[b,l,m,v,t],"spectrum":[0..255 x N]}   // 60 Hz
//   {"type":"command","command":"close"|"show"|"hide"}
// stdin EOF closes the helper (the plugin process died).
//
// stdout protocol: one JSON object per line, {"type": ...}; see docs/webview-spike.md.
//
// C# 5 only (in-box csc.exe from .NET Framework 4.8): no interpolation / ?. / expression bodies.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace SpwFolia
{
    public sealed class CliArgs
    {
        public string Bundle;
        public bool Fullscreen = true;   // protocol §7: fullscreen default
        public bool FpsLog;
        public string FpsLogPath;
        public string ScreenshotPath;
        public int ShotAtMs = 5000;
        public int DurationMs;
        public int WindowWidth = 1280;
        public int WindowHeight = 720;
        public string UserDataDir;
        public bool DevTools;
        public string Title = "spw-folia-host";
        public bool EscapeCloses = true;
        public bool ExitOnStdinClose = true;
        public bool TopMost = true;
        public string Url;          // override load URL; default = virtual host bundle
        public string DevUrl;       // protocol §1 hello devUrl / CLI dev server URL
        public string Mode;         // force visualizerMode in the demo config (e.g. sonnet/tempera)
        public string AssetsDir;    // optional extra folder served at https://spw-folia-assets.local/
        public bool NoOverlay;      // skip the placeholder HUD injection
        public string SettingsDir;  // settings UI dist dir -> https://spw-folia-settings.local/
        public string SettingsEntry = "settings-ui.js";
        public string DevSettings;  // --dev-settings: inline JSON or a path to a .json file
        public double ForceDsf;     // >0: chromium --force-device-scale-factor
        public bool DemoConfig;     // embed the synthetic demo timeline (standalone runs)
        public bool AudioLog;       // log audio-provider stats every ~2 s (loopback verification)
        public string BundleVersion;
        public bool OpenSettings;   // first run: open the injected settings UI once it is ready
        public double ExitAfterFps; // diagnostic: close when a page fps sample >= this
        public bool NoTransparency; // v0.1.7: force the window opaque (diagnostics/kill switch)

        public static CliArgs Parse(string[] argv)
        {
            CliArgs a = new CliArgs();
            for (int i = 0; i < argv.Length; i++)
            {
                string arg = argv[i];
                switch (arg)
                {
                    case "--bundle": a.Bundle = Next(argv, ref i); break;
                    case "--fullscreen": a.Fullscreen = true; break;
                    case "--fps-log":
                        a.FpsLog = true;
                        // optional path: only consume the next token when it is not another flag
                        if (i + 1 < argv.Length && !argv[i + 1].StartsWith("--", StringComparison.Ordinal)) { i++; a.FpsLogPath = argv[i]; }
                        break;
                    case "--screenshot": a.ScreenshotPath = Next(argv, ref i); break;
                    case "--shot-at": a.ShotAtMs = ParseInt(Next(argv, ref i), 5000); break;
                    case "--duration": a.DurationMs = ParseInt(Next(argv, ref i), 0); break;
                    case "--user-data": a.UserDataDir = Next(argv, ref i); break;
                    case "--user-data-dir": a.UserDataDir = Next(argv, ref i); break;
                    case "--dev-settings": a.DevSettings = Next(argv, ref i); break;
                    case "--devtools": a.DevTools = true; break;
                    case "--title": a.Title = Next(argv, ref i); break;
                    case "--no-esc": a.EscapeCloses = false; break;
                    case "--keep-alive": a.ExitOnStdinClose = false; break;
                    case "--no-topmost": a.TopMost = false; break;
                    case "--url": a.Url = Next(argv, ref i); break;
                    case "--dev-url": a.DevUrl = Next(argv, ref i); break;
                    case "--port": Next(argv, ref i); break; // dev only: dev-url already carries the port
                    case "--mode": a.Mode = Next(argv, ref i); break;
                    case "--assets": a.AssetsDir = Next(argv, ref i); break;
                    case "--no-overlay": a.NoOverlay = true; break;
                    case "--settings-dir": a.SettingsDir = Next(argv, ref i); break;
                    case "--settings-entry": a.SettingsEntry = Next(argv, ref i); break;
                    case "--force-dsf": a.ForceDsf = ParseInt(Next(argv, ref i), 0); break;
                    case "--demo": a.DemoConfig = true; break;
                    case "--audio-log": a.AudioLog = true; break;
                    case "--no-demo": a.DemoConfig = false; break;
                    case "--bundle-version": a.BundleVersion = Next(argv, ref i); break;
                    case "--open-settings": a.OpenSettings = true; break;
                    case "--no-transparency": a.NoTransparency = true; break;
                    case "--exit-after-fps": a.ExitAfterFps = ParseInt(Next(argv, ref i), 0); break;
                    case "--width": a.WindowWidth = ParseInt(Next(argv, ref i), 1280); break;
                    case "--height": a.WindowHeight = ParseInt(Next(argv, ref i), 720); break;
                    case "--windowed":
                        a.Fullscreen = false;
                        // accepts both `--windowed` and the protocol's `--windowed 1600,900` form
                        if (i + 1 < argv.Length && !argv[i + 1].StartsWith("--", StringComparison.Ordinal))
                        {
                            string spec0 = argv[i + 1];
                            int comma = spec0.IndexOf('x') >= 0 ? spec0.IndexOf('x') : spec0.IndexOf(',');
                            if (comma > 0)
                            {
                                i++;
                                a.WindowWidth = ParseInt(spec0.Substring(0, comma), 1280);
                                a.WindowHeight = ParseInt(spec0.Substring(comma + 1), 720);
                            }
                        }
                        break;
                    case "--window":
                        string spec = Next(argv, ref i);
                        if (!string.IsNullOrEmpty(spec))
                        {
                            string[] parts = spec.Split('x');
                            if (parts.Length == 2)
                            {
                                a.Fullscreen = false;
                                a.WindowWidth = ParseInt(parts[0], 1280);
                                a.WindowHeight = ParseInt(parts[1], 720);
                            }
                        }
                        break;
                }
            }
            return a;
        }

        private static string Next(string[] argv, ref int i)
        {
            if (i + 1 < argv.Length) { i++; return argv[i]; }
            return null;
        }

        private static int ParseInt(string text, int fallback)
        {
            int value;
            if (!string.IsNullOrEmpty(text) && int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out value)) return value;
            return fallback;
        }
    }

    public static class JsonUtil
    {
        public static string Escape(string text)
        {
            if (text == null) return "";
            StringBuilder sb = new StringBuilder(text.Length + 8);
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        public static string Num(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return "0";
            return value.ToString("0.###", CultureInfo.InvariantCulture);
        }

        public static bool TryGet(Dictionary<string, object> obj, string key, out object value)
        {
            value = null;
            if (obj == null) return false;
            return obj.TryGetValue(key, out value);
        }

        public static double GetDouble(Dictionary<string, object> obj, string key, double fallback)
        {
            object raw;
            if (!TryGet(obj, key, out raw) || raw == null) return fallback;
            try
            {
                if (raw is double) return (double)raw;
                if (raw is int) return (int)raw;
                if (raw is long) return (long)raw;
                if (raw is decimal) return (double)(decimal)raw;
                double parsed;
                if (double.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) return parsed;
            }
            catch (Exception) { }
            return fallback;
        }

        public static bool GetBool(Dictionary<string, object> obj, string key, bool fallback)
        {
            object raw;
            if (!TryGet(obj, key, out raw) || raw == null) return fallback;
            if (raw is bool) return (bool)raw;
            string text = Convert.ToString(raw, CultureInfo.InvariantCulture);
            if (string.Equals(text, "true", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(text, "false", StringComparison.OrdinalIgnoreCase)) return false;
            return fallback;
        }

        public static string GetString(Dictionary<string, object> obj, string key)
        {
            object raw;
            if (!TryGet(obj, key, out raw) || raw == null) return null;
            return Convert.ToString(raw, CultureInfo.InvariantCulture);
        }

        // Returns the raw JSON text of the value stored under `key` in `json` (object or array or
        // scalar), so big payloads (the Folia config) pass through byte-identical without being
        // re-serialized. String-aware balanced-brace scanner; returns null when not found.
        public static string ExtractRawValue(string json, string key)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return null;
            string needle = "\"" + key + "\"";
            int at = json.IndexOf(needle, StringComparison.Ordinal);
            while (at >= 0)
            {
                int i = at + needle.Length;
                while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
                if (i < json.Length && json[i] == ':')
                {
                    i++;
                    while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
                    if (i >= json.Length) return null;
                    int start = i;
                    if (json[i] == '{' || json[i] == '[')
                    {
                        int depth = 0;
                        bool inString = false;
                        bool escaped = false;
                        for (; i < json.Length; i++)
                        {
                            char c = json[i];
                            if (inString)
                            {
                                if (escaped) { escaped = false; }
                                else if (c == '\\') { escaped = true; }
                                else if (c == '"') { inString = false; }
                                continue;
                            }
                            if (c == '"') { inString = true; continue; }
                            if (c == '{' || c == '[') { depth++; continue; }
                            if (c == '}' || c == ']')
                            {
                                depth--;
                                if (depth == 0) return json.Substring(start, i - start + 1);
                            }
                        }
                        return null;
                    }
                    // scalar (string / number / bool / null)
                    if (json[i] == '"')
                    {
                        i++;
                        bool escaped = false;
                        for (; i < json.Length; i++)
                        {
                            char c = json[i];
                            if (escaped) { escaped = false; continue; }
                            if (c == '\\') { escaped = true; continue; }
                            if (c == '"') return json.Substring(start, i - start + 1);
                        }
                        return null;
                    }
                    for (; i < json.Length; i++)
                    {
                        char c = json[i];
                        if (c == ',' || c == '}' || c == ']' || char.IsWhiteSpace(c)) break;
                    }
                    return json.Substring(start, i - start);
                }
                at = json.IndexOf(needle, at + 1, StringComparison.Ordinal);
            }
            return null;
        }
    }

    // Thread-safe, auto-flushed JSON-lines writer on the process stdout. Safe when stdout is a pipe
    // (the plugin redirects it); silently drops writes when the handle is invalid (double-click run).
    public sealed class JsonStdout : IDisposable
    {
        private readonly object gate = new object();
        private readonly StreamWriter writer;

        public JsonStdout()
        {
            try
            {
                Stream stream = Console.OpenStandardOutput();
                writer = new StreamWriter(stream, new UTF8Encoding(false));
                writer.AutoFlush = true;
            }
            catch (Exception)
            {
                writer = null;
            }
        }

        public void WriteLine(string json)
        {
            if (writer == null) return;
            lock (gate)
            {
                try { writer.WriteLine(json); writer.Flush(); }
                catch (Exception) { }
            }
        }

        public void Simple(string type)
        {
            WriteLine("{\"type\":\"" + JsonUtil.Escape(type) + "\"}");
        }

        public void Message(string type, string message)
        {
            WriteLine("{\"type\":\"" + JsonUtil.Escape(type) + "\",\"message\":\"" + JsonUtil.Escape(message) + "\"}");
        }

        public void Error(string stage, Exception ex)
        {
            string message = ex == null ? "unknown" : ex.GetType().Name + ": " + ex.Message;
            Log("error", stage + ": " + message);
        }

        // Protocol v1 §2: diagnostics go out as {"t":"log","level":...,"msg":...}.
        public void Log(string level, string msg)
        {
            WriteLine("{\"t\":\"log\",\"level\":\"" + JsonUtil.Escape(level) + "\",\"msg\":\"" + JsonUtil.Escape(msg) + "\"}");
        }

        public void Dispose()
        {
            lock (gate)
            {
                try { if (writer != null) writer.Flush(); } catch (Exception) { }
            }
        }
    }

    public static class Program
    {
        public const string ProtocolVersion = "1";
        public const string BundleHost = "spw-folia.local";
        public const string AssetsHost = "spw-folia-assets.local";
        public const string SettingsHost = "spw-folia-settings.local";
        public const string DefaultBundleUrl = "https://spw-folia.local/index.html?obs=1&token=spike";

        private static string shimScript;
        private static string overlayScript;
        private static string defaultConfig;

        public static string BundleUrl(string overrideUrl)
        {
            return string.IsNullOrEmpty(overrideUrl) ? DefaultBundleUrl : overrideUrl;
        }

        public static string ResourceText(string name)
        {
            using (Stream stream = typeof(Program).Assembly.GetManifestResourceStream(name))
            {
                if (stream == null) throw new InvalidOperationException("embedded resource missing: " + name);
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
        }

        public static string ShimScript()
        {
            if (shimScript == null) shimScript = ResourceText("Shim.js");
            return shimScript;
        }

        public static string OverlayScript()
        {
            if (overlayScript == null) overlayScript = ResourceText("Overlay.js");
            return overlayScript;
        }

        // The demo config generated at build time from poc/webview/shared/demoData.mjs (source of
        // truth). Lets the helper run standalone (no plugin, no driver) with a synthetic timeline.
        public static string DefaultConfig()
        {
            if (defaultConfig == null) defaultConfig = ResourceText("DefaultConfig.json");
            return defaultConfig;
        }

        // Point the embedded demo config at a style: {"visualizerMode":"sonnet", ...}
        public static string PatchMode(string configJson, string mode)
        {
            if (string.IsNullOrEmpty(mode) || string.IsNullOrEmpty(configJson)) return configJson;
            int at = configJson.IndexOf("\"visualizerMode\"", StringComparison.Ordinal);
            if (at < 0) return configJson;
            int colon = configJson.IndexOf(':', at);
            if (colon < 0) return configJson;
            int quoteStart = configJson.IndexOf('"', colon + 1);
            if (quoteStart < 0) return configJson;
            int quoteEnd = configJson.IndexOf('"', quoteStart + 1);
            if (quoteEnd < 0) return configJson;
            return configJson.Substring(0, quoteStart + 1) + mode + configJson.Substring(quoteEnd);
        }

        [STAThread]
        public static int Main(string[] argv)
        {
            // task-9: guarantee the DPI awareness context of a plugin-spawned child explicitly
            // (embedded manifest is primary; this is the safety net for host-process environments).
            string dpiInit = DpiSupport.Init();

            CliArgs args = CliArgs.Parse(argv);
            JsonStdout log = new JsonStdout();
            log.Log("info", "dpi-init result=" + dpiInit + " awareness=" + DpiSupport.DescribeAwareness());
            int exitCode = 1;
            try
            {
                bool hasUrl = !string.IsNullOrEmpty(args.DevUrl) || !string.IsNullOrEmpty(args.Url);
                if (!hasUrl && string.IsNullOrEmpty(args.Bundle))
                {
                    log.Log("error", "missing --bundle <dir> (or --dev-url <url>)");
                    return 2;
                }
                if (!string.IsNullOrEmpty(args.Bundle))
                {
                    args.Bundle = Path.GetFullPath(args.Bundle);
                    if (!File.Exists(Path.Combine(args.Bundle, "index.html")))
                    {
                        log.Log("error", "bundle has no index.html: " + args.Bundle);
                        return 2;
                    }
                }
                if (!string.IsNullOrEmpty(args.SettingsDir)) args.SettingsDir = Path.GetFullPath(args.SettingsDir);
                // Packaged layout: <bundle>/settings/settings-ui.js is picked up automatically, so the
                // plugin can pass only `--bundle <plugin>/web`.
                if (string.IsNullOrEmpty(args.SettingsDir) && !string.IsNullOrEmpty(args.Bundle))
                {
                    string auto = Path.Combine(args.Bundle, "settings");
                    if (File.Exists(Path.Combine(auto, "settings-ui.js"))) args.SettingsDir = auto;
                }
                if (!string.IsNullOrEmpty(args.ScreenshotPath)) args.ScreenshotPath = Path.GetFullPath(args.ScreenshotPath);
                if (!string.IsNullOrEmpty(args.FpsLogPath)) args.FpsLogPath = Path.GetFullPath(args.FpsLogPath);
                // v0.1.10: an exception that escapes a WndProc used to surface as a modal Windows
                // "unhandled exception" dialog and kill the host with no trace in our logs. Log it as a
                // protocol line instead, then let the process die (the plugin respawns it).
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
                Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs e)
                {
                    log.Error("ui-thread", e.Exception);
                };
                AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
                {
                    log.Error("unhandled", e.ExceptionObject as Exception);
                };
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (HostForm form = new HostForm(args, log))
                {
                    Application.Run(form);
                    exitCode = form.ExitCode;
                }
                return exitCode;
            }
            catch (Exception ex)
            {
                log.Error("main", ex);
                return 1;
            }
            finally
            {
                log.Dispose();
            }
        }
    }
}
