// spw-folia-host.exe core: borderless WinForms window hosting Folia's production web bundle in
// WebView2, driven from JSON lines on stdin/stdout (docs/protocol.md v1).
//
// Threading model: WinForms UI thread owns everything WebView2-related; a background thread reads
// stdin and marshals through BeginInvoke. The 15 ms WinForms timer (~64 Hz) pushes the current
// clock + audio frame to the page via chrome.webview.postMessage.
//
// C# 5 only (in-box .NET Framework 4.8 csc.exe): no interpolation / ?. / expression bodies.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SpwFolia
{
    [System.Runtime.InteropServices.ComVisible(false)]
    public sealed class HostForm : Form
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        private readonly CliArgs args;
        private readonly JsonStdout log;
        private readonly AudioRouter audio = new AudioRouter();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly Stopwatch clock = new Stopwatch();
        private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        private readonly System.Windows.Forms.Timer exitTimer = new System.Windows.Forms.Timer();

        private WebView2 webView;
        private bool webviewReady;
        private bool navDone;
        private bool closedSent;
        private bool shotTaken;
        private bool settingsAutoOpened;
        private bool settingsOpenRequested;
        private long navDoneAt;
        private long shotAtTick;
        private string currentUrl;

        // stdin state -> clock anchor (interpolated between 100 ms state messages)
        private readonly object stateGate = new object();
        private bool haveState;
        private double anchorPosMs;
        private long anchorAtTick;
        private double durationMs = 240000;
        private double rate = 1;
        private bool playing = true;
        private double lyricOffsetMs;
        private long stateReceivedTick;
        private long stateCount;

        // free-running clock when no stdin state arrives (standalone bring-up)
        private double freePosMs = 12000;
        private long lastTick;

        // config: embedded demo config (--demo) optionally refined by stdin lyrics/track
        private string baseConfigJson;
        private bool configDirty;
        private string lastSentConfig;
        private string lastLyricsRaw;
        private string lastTrackRaw;

        // host-side settings (protocol §2 `settings` out / §1 `settings` in)
        private string settingsRaw;

        private long totalFramesPosted;
        private double lastFps;
        private long lastAudioLogAt;
        private long audioLogCount;
        private int exitCode = 1;
        private string closeReason = "user";

        // task-9 diagnostics: geometry/viewport state, logged once via protocol `log` lines
        private bool geometryApplied;
        private bool layoutLogged;
        private bool pageViewportLogged;

        public int ExitCode { get { return exitCode; } }

        public HostForm(CliArgs parsedArgs, JsonStdout jsonLog)
        {
            args = parsedArgs;
            log = jsonLog;
            clock.Start();

            Text = args.Title;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.Black;
            AutoScaleMode = AutoScaleMode.None;
            KeyPreview = true;

            // task-9: window geometry is applied in OnHandleCreated/OnShown (see ApplyWindowGeometry)
            // once the handle exists and the DPI awareness context is known. Plugin-spawned children
            // must produce exactly the same fullscreen geometry as a shell launch.
            ShowInTaskbar = !args.Fullscreen;
            TopMost = args.TopMost;
            if (args.Fullscreen) Cursor.Hide(); else Cursor = Cursors.Default;
            ClientSize = new Size(
                Math.Max(64, args.Fullscreen ? 1600 : args.WindowWidth),
                Math.Max(64, args.Fullscreen ? 900 : args.WindowHeight));

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = Color.Black;
            Controls.Add(webView);

            timer.Interval = 15; // WinForms timer floor is ~15.6 ms => ~64 ticks/s, above the 60 Hz we need
            timer.Tick += OnTick;

            exitTimer.Interval = 2000;
            exitTimer.Tick += OnExitTimerTick;

            if (args.DemoConfig)
            {
                try
                {
                    baseConfigJson = Program.PatchMode(Program.DefaultConfig(), args.Mode);
                    configDirty = true;
                }
                catch (Exception ex) { log.Error("demo-config", ex); }
            }

            // --dev-settings: inline settings JSON, a path to a .json file, or {"settings":{...}}
            if (!string.IsNullOrEmpty(args.DevSettings))
            {
                try
                {
                    string text = args.DevSettings;
                    if (File.Exists(text)) text = File.ReadAllText(text, Encoding.UTF8);
                    string inner = JsonUtil.ExtractRawValue(text, "settings");
                    settingsRaw = inner != null ? inner : text.Trim();
                }
                catch (Exception ex) { log.Error("dev-settings", ex); }
            }
        }

        // ------------------------------------------------------------ task-9: window geometry/DPI

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplyWindowGeometry("handle-created");
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (!geometryApplied) ApplyWindowGeometry("shown");
            SyncWebViewBounds("shown");
        }

        protected override void OnDpiChanged(DpiChangedEventArgs e)
        {
            base.OnDpiChanged(e);
            log.Log("info", "dpi-changed old=" + e.DeviceDpiOld + " new=" + e.DeviceDpiNew
                + " suggested=" + e.SuggestedRectangle.Width + "x" + e.SuggestedRectangle.Height);
            ApplyWindowGeometry("dpi-changed");
            SyncWebViewBounds("dpi-changed");
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            SyncWebViewBounds("resize");
        }

        /// <summary>
        /// Applies the requested window mode using live monitor metrics. A fullscreen request that
        /// resolves to something implausibly small (the reported plugin-spawned "8x6" viewport case)
        /// falls back to the monitor work area / default window size instead of showing a sliver.
        /// </summary>
        private void ApplyWindowGeometry(string reason)
        {
            try
            {
                Screen monitor = Screen.PrimaryScreen;
                if (monitor == null) return;
                Rectangle mon = monitor.Bounds;
                Rectangle work = monitor.WorkingArea;
                Rectangle target;
                if (args.Fullscreen)
                {
                    target = mon;
                    if (target.Width < mon.Width / 2 || target.Height < mon.Height / 2
                        || target.Width < 320 || target.Height < 240)
                    {
                        log.Log("warn", "geometry-fallback reason=" + reason
                            + " requested=" + target.Width + "x" + target.Height
                            + " screen=" + mon.Width + "x" + mon.Height);
                        int fw = Math.Min(work.Width, 1600);
                        int fh = Math.Min(work.Height, 900);
                        target = new Rectangle(work.X + (work.Width - fw) / 2, work.Y + (work.Height - fh) / 2, fw, fh);
                    }
                }
                else
                {
                    int w = Math.Min(Math.Max(64, args.WindowWidth), work.Width);
                    int h = Math.Min(Math.Max(64, args.WindowHeight), work.Height);
                    target = new Rectangle(work.X + (work.Width - w) / 2, work.Y + (work.Height - h) / 2, w, h);
                }
                Bounds = target;
                TopMost = args.TopMost;
                ShowInTaskbar = !args.Fullscreen;
                if (args.Fullscreen) Cursor.Hide(); else Cursor = Cursors.Default;
                geometryApplied = true;
                log.Log("info", "geometry reason=" + reason
                    + " mode=" + (args.Fullscreen ? "fullscreen" : "windowed")
                    + " bounds=" + Bounds.X + "," + Bounds.Y + " " + Bounds.Width + "x" + Bounds.Height
                    + " client=" + ClientSize.Width + "x" + ClientSize.Height
                    + " screen=" + mon.Width + "x" + mon.Height
                    + " workarea=" + work.Width + "x" + work.Height
                    + " dpi=" + DpiValue()
                    + " winDpi=" + DpiSupport.DpiForWindow(Handle)
                    + " awareness=" + DpiSupport.DescribeAwareness());
                SyncWebViewBounds("geometry:" + reason);
            }
            catch (Exception ex) { log.Error("geometry", ex); }
        }

        /// <summary>Keeps the WebView2 control exactly on the client rectangle after geometry/DPI changes.</summary>
        private void SyncWebViewBounds(string reason)
        {
            try
            {
                if (webView == null) return;
                Rectangle client = ClientRectangle;
                if (webView.Bounds != client) webView.Bounds = client;
                if (!layoutLogged)
                {
                    layoutLogged = true;
                    log.Log("info", "layout reason=" + reason
                        + " client=" + client.Width + "x" + client.Height
                        + " webview=" + webView.Bounds.Width + "x" + webView.Bounds.Height);
                }
            }
            catch (Exception ex) { log.Error("layout", ex); }
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            if (!geometryApplied) ApplyWindowGeometry("load");
            Rectangle mon = Screen.PrimaryScreen != null ? Screen.PrimaryScreen.Bounds : Rectangle.Empty;
            Rectangle work = Screen.PrimaryScreen != null ? Screen.PrimaryScreen.WorkingArea : Rectangle.Empty;
            log.Log("info", "host-start pid=" + Process.GetCurrentProcess().Id
                + " parentPid=" + DpiSupport.ParentProcessId()
                + " fullscreen=" + args.Fullscreen
                + " window=" + Bounds.X + "," + Bounds.Y + " " + Bounds.Width + "x" + Bounds.Height
                + " client=" + ClientSize.Width + "x" + ClientSize.Height
                + " dpi=" + DpiValue()
                + " winDpi=" + DpiSupport.DpiForWindow(Handle)
                + " awareness=" + DpiSupport.DescribeAwareness()
                + " screen=" + mon.Width + "x" + mon.Height
                + " workarea=" + work.Width + "x" + work.Height
                + " audio=" + audio.Name);
            StartStdinReader();
            timer.Start();
            InitializeWebViewAsync();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            timer.Stop();
            exitTimer.Stop();
            SendClosed();
            log.Log("info", "host-exit code=" + exitCode + " reason=" + closeReason
                + " framesPosted=" + totalFramesPosted
                + " statesReceived=" + Interlocked.Read(ref stateCount)
                + " lastFps=" + JsonUtil.Num(lastFps)
                + " atMs=" + clock.ElapsedMilliseconds);
            try { if (webView != null) webView.Dispose(); } catch (Exception) { }
            try { audio.Dispose(); } catch (Exception) { }
            base.OnFormClosing(e);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape && args.EscapeCloses)
            {
                CloseWith("user", 0);
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        // ---------------------------------------------------------------- webview bring-up

        private async void InitializeWebViewAsync()
        {
            try
            {
                string runtime = null;
                try { runtime = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
                catch (Exception ex)
                {
                    log.Log("error", "WebView2 Runtime not found: " + ex.GetType().Name + ": " + ex.Message);
                    Stop(3);
                    return;
                }
                log.Log("info", "webview2 runtime=" + runtime);

                string userData = args.UserDataDir;
                if (string.IsNullOrEmpty(userData))
                {
                    userData = Path.Combine(
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "spw-folia"),
                        "webview");
                }
                Directory.CreateDirectory(userData);
                string browserArgs = "--autoplay-policy=no-user-gesture-required "
                    + "--disable-background-timer-throttling --disable-renderer-backgrounding "
                    + "--disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion";
                if (args.ForceDsf > 0)
                {
                    browserArgs += " --force-device-scale-factor=" + args.ForceDsf.ToString(Inv);
                }
                CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions(browserArgs);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData, options);
                await webView.EnsureCoreWebView2Async(env);
                if (webView.CoreWebView2 == null)
                {
                    log.Log("error", "CoreWebView2 is null after EnsureCoreWebView2Async");
                    Stop(1);
                    return;
                }
                CoreWebView2 core = webView.CoreWebView2;
                CoreWebView2Settings settings = core.Settings;
                settings.AreDefaultContextMenusEnabled = false;
                settings.AreDevToolsEnabled = args.DevTools;
                settings.IsStatusBarEnabled = false;
                settings.IsZoomControlEnabled = false;
                settings.IsSwipeNavigationEnabled = false;
                settings.AreBrowserAcceleratorKeysEnabled = args.DevTools;
                settings.IsScriptEnabled = true;

                if (!string.IsNullOrEmpty(args.Bundle))
                {
                    core.SetVirtualHostNameToFolderMapping(Program.BundleHost, args.Bundle, CoreWebView2HostResourceAccessKind.Allow);
                }
                if (!string.IsNullOrEmpty(args.AssetsDir))
                {
                    string assets = Path.GetFullPath(args.AssetsDir);
                    Directory.CreateDirectory(assets);
                    core.SetVirtualHostNameToFolderMapping(Program.AssetsHost, assets, CoreWebView2HostResourceAccessKind.Allow);
                }
                if (!string.IsNullOrEmpty(args.SettingsDir) && Directory.Exists(args.SettingsDir))
                {
                    core.SetVirtualHostNameToFolderMapping(Program.SettingsHost, Path.GetFullPath(args.SettingsDir), CoreWebView2HostResourceAccessKind.Allow);
                }

                core.WebMessageReceived += OnWebMessageReceived;
                core.NavigationCompleted += OnNavigationCompleted;
                core.ProcessFailed += OnProcessFailed;

                await core.AddScriptToExecuteOnDocumentCreatedAsync(Program.ShimScript());
                if (!args.NoOverlay && string.IsNullOrEmpty(args.SettingsDir))
                {
                    // Placeholder settings HUD (replaced by the real settings UI bundle once available).
                    await core.AddScriptToExecuteOnDocumentCreatedAsync(Program.OverlayScript());
                }
                if (!string.IsNullOrEmpty(args.SettingsDir) && !string.IsNullOrEmpty(args.SettingsEntry))
                {
                    // Cache-buster: the settings UI is served from a stable virtual host URL, so without a
                    // version query WebView2's HTTP disk cache can keep serving a stale settings-ui.js
                    // after a plugin upgrade. Tie the URL to the plugin version (protocol hello.bundleVersion).
                    string bundleVersion = string.IsNullOrEmpty(args.BundleVersion) ? "dev" : args.BundleVersion;
                    string entryUrl = "https://" + Program.SettingsHost + "/" + args.SettingsEntry + "?v=" + Uri.EscapeDataString(bundleVersion);
                    string inject = "(function(){var s=document.createElement('script');s.type='module';s.src='"
                        + JsonUtil.Escape(entryUrl)
                        + "';document.head?document.head.appendChild(s):document.addEventListener('DOMContentLoaded',function(){document.head.appendChild(s)});})();";
                    log.Log("info", "settings-inject url=" + entryUrl);
                    await core.AddScriptToExecuteOnDocumentCreatedAsync(inject);
                }

                webviewReady = true;
                currentUrl = ResolveUrl();
                log.Log("info", "webview-ready url=" + currentUrl + " shim=" + Encoding.UTF8.GetByteCount(Program.ShimScript()) + "B");
                core.Navigate(currentUrl);
            }
            catch (Exception ex)
            {
                log.Error("webview-init", ex);
                Stop(1);
            }
        }

        private string ResolveUrl()
        {
            if (args.DemoConfig && string.IsNullOrEmpty(args.DevUrl) && string.IsNullOrEmpty(args.Url) && !string.IsNullOrEmpty(args.Bundle))
            {
                return Program.DefaultBundleUrl;
            }
            return Program.BundleUrl(args.DevUrl ?? args.Url);
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            navDone = true;
            navDoneAt = clock.ElapsedMilliseconds;
            shotAtTick = navDoneAt + args.ShotAtMs;
            log.Log(e.IsSuccess ? "info" : "error",
                "nav-done success=" + e.IsSuccess + " status=" + e.WebErrorStatus
                + " atMs=" + navDoneAt
                + " client=" + ClientSize.Width + "x" + ClientSize.Height
                + " dpi=" + DpiValue()
                + " winDpi=" + DpiSupport.DpiForWindow(Handle)
                + " awareness=" + DpiSupport.DescribeAwareness()
                + " url=" + currentUrl);
            if (!e.IsSuccess) return;

            // §2 ready: WebView2 + bundle are up, the plugin may start streaming state.
            log.WriteLine("{\"t\":\"ready\",\"protocol\":" + Program.ProtocolVersion
                + ",\"pid\":" + Process.GetCurrentProcess().Id
                + ",\"webviewVersion\":\"" + JsonUtil.Escape(CoreWebView2Environment.GetAvailableBrowserVersionString()) + "\""
                + ",\"bundle\":\"" + JsonUtil.Escape(args.Bundle ?? "") + "\""
                + ",\"startedAtMs\":" + clock.ElapsedMilliseconds + "}");

            SendHelloToPage();
            SendSettingsToPage();
            if (configDirty) SendConfigIfNeeded();
        }

        private int DpiValue()
        {
            try { return DeviceDpi; } catch (Exception) { return 0; }
        }

        private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            log.Log("error", "webview process-failed kind=" + e.ProcessFailedKind + " reason=" + e.Reason);
            CloseWith("error", 1);
        }

        // ---------------------------------------------------------------- page -> host (§3.1)

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw = null;
            try { raw = e.WebMessageAsJson; } catch (Exception) { }
            if (string.IsNullOrEmpty(raw)) return;
            raw = raw.Trim();
            if (!raw.StartsWith("{", StringComparison.Ordinal)) return;

            Dictionary<string, object> msg = null;
            try { msg = json.DeserializeObject(raw) as Dictionary<string, object>; } catch (Exception) { }
            if (msg == null) return;
            string type = JsonUtil.GetString(msg, "type");

            if (type == "ready")
            {
                log.Log("info", "page-ready source=" + (JsonUtil.GetString(msg, "source") ?? "?"));
            }
            else if (type == "bridgeReady")
            {
                // Settings-UI bundle initialized: safe to ask it to open (first-run flow, --open-settings).
                if (args.OpenSettings && !settingsAutoOpened) OpenSettingsOnce();
            }
            else if (type == "settingsUI" || type == "ui-state")
            {
                // Settings UI reports open/close transitions (optional; ignored by protocol v1 hosts).
                string st = JsonUtil.GetString(msg, "state");
                if (st != null) log.Log("info", "settings-ui state=" + st);
            }
            else if (type == "settings")
            {
                string settingsValue = JsonUtil.ExtractRawValue(raw, "settings");
                if (settingsValue != null)
                {
                    settingsRaw = settingsValue;
                    log.WriteLine("{\"t\":\"settings\",\"settings\":" + settingsValue + "}");
                }
            }
            else if (type == "action")
            {
                string name = JsonUtil.GetString(msg, "name");
                log.WriteLine("{\"t\":\"action\",\"name\":\"" + JsonUtil.Escape(name ?? "") + "\"}");
                if (name == "close") CloseWith("user", 0);
                else if (name == "reload" && webviewReady) SafeBeginInvoke(delegate { try { webView.CoreWebView2.Reload(); } catch (Exception) { } });
                else if (name == "openDevTools" && webviewReady) SafeBeginInvoke(delegate { try { webView.CoreWebView2.OpenDevToolsWindow(); } catch (Exception) { } });
            }
            else if (type == "log")
            {
                log.WriteLine("{\"t\":\"log\",\"level\":\"" + JsonUtil.Escape(JsonUtil.GetString(msg, "level") ?? "info")
                    + "\",\"msg\":\"" + JsonUtil.Escape(JsonUtil.GetString(msg, "msg") ?? "") + "\"}");
            }
            else if (type == "fps")
            {
                lastFps = JsonUtil.GetDouble(msg, "fps", lastFps);
                if (!pageViewportLogged)
                {
                    pageViewportLogged = true;
                    int pw = (int)JsonUtil.GetDouble(msg, "w", 0);
                    int ph = (int)JsonUtil.GetDouble(msg, "h", 0);
                    log.Log("info", "page-viewport w=" + pw + " h=" + ph
                        + " dpr=" + JsonUtil.Num(JsonUtil.GetDouble(msg, "dpr", 0))
                        + " canvases=" + (int)JsonUtil.GetDouble(msg, "canvases", 0)
                        + " client=" + ClientSize.Width + "x" + ClientSize.Height);
                    if (pw > 0 && ph > 0 && (pw < 64 || ph < 64))
                    {
                        log.Log("warn", "page-viewport-tiny w=" + pw + " h=" + ph
                            + " client=" + ClientSize.Width + "x" + ClientSize.Height
                            + " bounds=" + Bounds.Width + "x" + Bounds.Height);
                        // Recover: re-apply geometry once and reload so the page re-measures itself.
                        ApplyWindowGeometry("tiny-viewport-recover");
                        SafeBeginInvoke(delegate
                        {
                            try { if (webviewReady) webView.CoreWebView2.Reload(); } catch (Exception) { }
                        });
                    }
                }
                WriteFpsSample(msg);
            }
            else if (type == "key")
            {
                string key = JsonUtil.GetString(msg, "key");
                if (key == "Escape" && args.EscapeCloses) CloseWith("user", 0);
            }
            else if (type == "eval-result")
            {
                log.Log("info", "eval-result " + (JsonUtil.GetString(msg, "value") ?? "null"));
            }
        }

        // ---------------------------------------------------------------- 60 Hz drive loop (§3.2)

        private void OnTick(object sender, EventArgs e)
        {
            long now = clock.ElapsedMilliseconds;
            long elapsed = now - lastTick;
            if (lastTick == 0) elapsed = 16;
            lastTick = now;

            if (!webviewReady || !navDone) return;

            PostState(now, elapsed);
            PostAudio(now);

            if (args.AudioLog && now - lastAudioLogAt >= 2000)
            {
                lastAudioLogAt = now;
                AudioFrame af = audio.GetFrame(now);
                audioLogCount++;
                log.WriteLine("{\"t\":\"audio-stats\",\"n\":" + audioLogCount
                    + ",\"power\":" + JsonUtil.Num(af.Power)
                    + ",\"bass\":" + JsonUtil.Num(af.Bass)
                    + ",\"lowMid\":" + JsonUtil.Num(af.LowMid)
                    + ",\"mid\":" + JsonUtil.Num(af.Mid)
                    + ",\"vocal\":" + JsonUtil.Num(af.Vocal)
                    + ",\"treble\":" + JsonUtil.Num(af.Treble)
                    + ",\"spectrumLen\":" + (af.Spectrum == null ? 0 : af.Spectrum.Length)
                    + ",\"silent\":" + (af.Silent ? "true" : "false")
                    + ",\"source\":\"" + JsonUtil.Escape(audio.Name) + "\""
                    + ",\"atMs\":" + now + "}");
            }

            if (!shotTaken && args.ScreenshotPath != null && now >= shotAtTick)
            {
                shotTaken = true;
                CaptureScreenshotAsync();
            }
            // Fallback for settings-UI bundles that never emit bridgeReady: open once, briefly after nav.
            if (args.OpenSettings && !settingsAutoOpened && now - navDoneAt >= 2500) OpenSettingsOnce();
            if (args.DurationMs > 0 && now >= args.DurationMs)
            {
                CloseWith("plugin", 0);
            }
        }

        private void PostState(long now, long elapsed)
        {
            double posMs;
            double dur;
            double rt;
            bool play;
            double offset;
            bool fresh;
            lock (stateGate)
            {
                fresh = haveState && (now - stateReceivedTick) <= 500;
                if (fresh)
                {
                    posMs = anchorPosMs;
                    if (playing && elapsed > 0) posMs += (now - anchorAtTick) * rate;
                    dur = durationMs > 0 ? durationMs : 240000;
                    rt = rate;
                    play = playing;
                    offset = lyricOffsetMs;
                }
                else
                {
                    freePosMs += elapsed * rate;
                    if (durationMs > 0 && freePosMs > durationMs) freePosMs = 0;
                    posMs = freePosMs;
                    dur = durationMs > 0 ? durationMs : 240000;
                    rt = rate;
                    play = true;
                    offset = 0;
                }
            }
            StringBuilder sb = new StringBuilder(320);
            sb.Append("{\"type\":\"state\",\"posMs\":").Append(JsonUtil.Num(posMs));
            sb.Append(",\"durationMs\":").Append(JsonUtil.Num(dur));
            sb.Append(",\"playing\":").Append(play ? "true" : "false");
            sb.Append(",\"rate\":").Append(JsonUtil.Num(rt));
            sb.Append(",\"lyricOffsetMs\":").Append(JsonUtil.Num(offset));
            sb.Append(",\"tsMs\":").Append(EpochMs());
            sb.Append('}');
            PostToPage(sb.ToString());
            Interlocked.Increment(ref totalFramesPosted);
            if (fresh) Interlocked.Increment(ref stateCount);
        }

        private void PostAudio(long now)
        {
            AudioFrame frame = audio.GetFrame(now);
            bool paused;
            lock (stateGate) { paused = haveState && !playing; }
            // protocol §5: paused / no signal -> breath on power + all five bands, empty spectrum.
            bool breathMode = paused || frame.Silent;
            double breath = (Math.Sin(EpochMs() / 2000.0) + 1.0) * 20.0;
            StringBuilder sb = new StringBuilder(512 + (frame.Spectrum == null ? 0 : frame.Spectrum.Length * 4));
            sb.Append("{\"type\":\"audio\",\"power\":").Append(JsonUtil.Num(breathMode ? breath : frame.Power));
            sb.Append(",\"bass\":").Append(JsonUtil.Num(breathMode ? breath : frame.Bass));
            sb.Append(",\"lowMid\":").Append(JsonUtil.Num(breathMode ? breath : frame.LowMid));
            sb.Append(",\"mid\":").Append(JsonUtil.Num(breathMode ? breath : frame.Mid));
            sb.Append(",\"vocal\":").Append(JsonUtil.Num(breathMode ? breath : frame.Vocal));
            sb.Append(",\"treble\":").Append(JsonUtil.Num(breathMode ? breath : frame.Treble));
            sb.Append(",\"spectrum\":[");
            if (!breathMode && frame.Spectrum != null)
            {
                for (int i = 0; i < frame.Spectrum.Length; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append(frame.Spectrum[i].ToString(Inv));
                }
            }
            sb.Append("],\"tsMs\":").Append(now).Append('}');
            PostToPage(sb.ToString());
        }

        private void PostToPage(string payload)
        {
            try { webView.CoreWebView2.PostWebMessageAsJson(payload); }
            catch (Exception ex) { log.Error("post-page", ex); }
        }

        // First-run / explicit open of the injected settings UI. Called once the bundle announces
        // bridgeReady, with a timer fallback for bundles that do not announce it.
        private void OpenSettingsOnce()
        {
            if (settingsAutoOpened) return;
            settingsAutoOpened = true;
            settingsOpenRequested = true;
            PostToPage("{\"type\":\"ui\",\"action\":\"open-settings\"}");
            log.Log("info", "open-settings requested auto=" + (args.OpenSettings ? "true" : "false"));
        }

        private static long EpochMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        // ---------------------------------------------------------------- stdin (§1)

        private void StartStdinReader()
        {
            Thread thread = new Thread(StdinLoop);
            thread.IsBackground = true;
            thread.Name = "spw-folia-stdin";
            thread.Start();
        }

        private void StdinLoop()
        {
            try
            {
                try { Console.InputEncoding = new UTF8Encoding(false); } catch (Exception) { }
                StreamReader reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (line.Length == 0) continue;
                    HandleStdinLine(line);
                }
                log.Log("info", "stdin-eof");
                if (args.ExitOnStdinClose)
                {
                    try { BeginInvoke((Action)ScheduleExitFromStdinEof); } catch (Exception) { }
                }
            }
            catch (Exception ex)
            {
                log.Error("stdin", ex);
                try { BeginInvoke((Action)ScheduleExitFromStdinEof); } catch (Exception) { }
            }
        }

        private void ScheduleExitFromStdinEof()
        {
            if (IsDisposed) return;
            exitTimer.Start();
        }

        private void OnExitTimerTick(object sender, EventArgs e)
        {
            exitTimer.Stop();
            CloseWith("plugin", 0);
        }

        private void HandleStdinLine(string line)
        {
            Dictionary<string, object> msg = null;
            try { msg = json.DeserializeObject(line) as Dictionary<string, object>; } catch (Exception) { }
            string t = msg == null ? null : JsonUtil.GetString(msg, "t");
            if (t == null) return;

            if (t == "hello")
            {
                log.Log("info", "stdin-hello pluginVersion=" + (JsonUtil.GetString(msg, "pluginVersion") ?? "?")
                    + " spwVersion=" + (JsonUtil.GetString(msg, "spwVersion") ?? "?"));
                string devUrl = JsonUtil.GetString(msg, "devUrl");
                if (!string.IsNullOrEmpty(devUrl) && webviewReady && devUrl != currentUrl)
                {
                    currentUrl = Program.BundleUrl(devUrl);
                    log.Log("info", "hello devUrl override -> " + currentUrl);
                    SafeBeginInvoke(delegate { try { webView.CoreWebView2.Navigate(currentUrl); } catch (Exception) { } });
                }
            }
            else if (t == "settings")
            {
                string settingsValue = JsonUtil.ExtractRawValue(line, "settings");
                if (settingsValue != null)
                {
                    settingsRaw = settingsValue;
                    SafeBeginInvoke(SendSettingsToPage);
                }
            }
            else if (t == "state")
            {
                ApplyState(msg);
            }
            else if (t == "lyrics")
            {
                string lyricsRaw = JsonUtil.ExtractRawValue(line, "lines");
                SendLyricsToPage(msg, line);
                if (args.DemoConfig && lyricsRaw != null && lyricsRaw != lastLyricsRaw)
                {
                    lastLyricsRaw = lyricsRaw;
                    PatchDemoLyrics(lyricsRaw);
                }
            }
            else if (t == "track")
            {
                SendTrackToPage(msg);
                if (args.DemoConfig) PatchDemoTrack(msg);
            }
            else if (t == "config")
            {
                string configRaw = JsonUtil.ExtractRawValue(line, "config");
                if (configRaw != null)
                {
                    baseConfigJson = configRaw;
                    configDirty = true;
                    SafeBeginInvoke(SendConfigIfNeeded);
                }
            }
            else if (t == "audio")
            {
                AudioFrame frame = new AudioFrame();
                frame.Power = (float)JsonUtil.GetDouble(msg, "power", 0);
                frame.Bass = (float)JsonUtil.GetDouble(msg, "bass", 0);
                frame.LowMid = (float)JsonUtil.GetDouble(msg, "lowMid", 0);
                frame.Mid = (float)JsonUtil.GetDouble(msg, "mid", 0);
                frame.Vocal = (float)JsonUtil.GetDouble(msg, "vocal", 0);
                frame.Treble = (float)JsonUtil.GetDouble(msg, "treble", 0);
                frame.Silent = JsonUtil.GetBool(msg, "silent", false);
                object spectrumObj;
                if (msg.TryGetValue("spectrum", out spectrumObj) && spectrumObj is object[])
                {
                    object[] values = (object[])spectrumObj;
                    int count = values.Length > 1024 ? 1024 : values.Length;
                    frame.Spectrum = new byte[count];
                    for (int i = 0; i < count; i++)
                    {
                        double v = ToDouble(values[i]);
                        frame.Spectrum[i] = (byte)(v < 0 ? 0 : (v > 255 ? 255 : (int)v));
                    }
                }
                audio.Stdin.Submit(frame, clock.ElapsedMilliseconds);
            }
            else if (t == "audioMode")
            {
                string mode = JsonUtil.GetString(msg, "mode");
                audio.SetMode(mode);
                log.Log("info", "audio-mode " + (mode ?? "?") + " active=" + audio.Name);
            }
            else if (t == "quit")
            {
                CloseWith("plugin", 0);
            }
            else if (t == "command")
            {
                HandleCommand(msg);
            }
        }

        private void HandleCommand(Dictionary<string, object> msg)
        {
            string command = JsonUtil.GetString(msg, "command");
            if (command == "close") CloseWith("plugin", 0);
            else if (command == "screenshot")
            {
                string path = JsonUtil.GetString(msg, "path");
                SafeBeginInvoke(delegate { CaptureScreenshotAsync(path); });
            }
            else if (command == "settings") PostToPage("{\"type\":\"ui\",\"action\":\"toggle-settings\"}");
            else if (command == "open-settings") PostToPage("{\"type\":\"ui\",\"action\":\"open-settings\"}");
            else if (command == "close-settings") PostToPage("{\"type\":\"ui\",\"action\":\"close-settings\"}");
            else if (command == "eval")
            {
                string script = JsonUtil.GetString(msg, "script");
                if (!string.IsNullOrEmpty(script)) SafeBeginInvoke(delegate { TryExec(script); });
            }
        }

        private void ApplyState(Dictionary<string, object> msg)
        {
            lock (stateGate)
            {
                anchorPosMs = JsonUtil.GetDouble(msg, "posMs", anchorPosMs);
                durationMs = JsonUtil.GetDouble(msg, "durationMs", durationMs);
                rate = JsonUtil.GetDouble(msg, "rate", 1);
                playing = JsonUtil.GetBool(msg, "playing", true);
                lyricOffsetMs = JsonUtil.GetDouble(msg, "lyricOffsetMs", 0);
                anchorAtTick = clock.ElapsedMilliseconds;
                stateReceivedTick = anchorAtTick;
                haveState = true;
            }
        }

        private static double ToDouble(object raw)
        {
            if (raw == null) return 0;
            try
            {
                if (raw is double) return (double)raw;
                if (raw is int) return (int)raw;
                if (raw is long) return (long)raw;
                if (raw is decimal) return (double)(decimal)raw;
                double parsed;
                if (double.TryParse(Convert.ToString(raw, Inv), NumberStyles.Float, Inv, out parsed)) return parsed;
            }
            catch (Exception) { }
            return 0;
        }

        // ---------------------------------------------------------------- host -> page (§3.2)

        private void SendHelloToPage()
        {
            PostToPage("{\"type\":\"hello\",\"protocol\":" + Program.ProtocolVersion
                + ",\"bundleVersion\":\"" + JsonUtil.Escape(args.BundleVersion ?? "dev") + "\"}");
        }

        private void SendSettingsToPage()
        {
            if (settingsRaw == null) return;
            PostToPage("{\"type\":\"settings\",\"settings\":" + settingsRaw + "}");
        }

        private void SendLyricsToPage(Dictionary<string, object> msg, string line)
        {
            object lines, offset, mode;
            string payload = "{\"type\":\"lyrics\"";
            if (msg.TryGetValue("lines", out lines))
            {
                string raw = JsonUtil.ExtractRawValue(line, "lines");
                if (raw != null) payload += ",\"lines\":" + raw;
            }
            if (msg.TryGetValue("offsetMs", out offset)) payload += ",\"offsetMs\":" + JsonUtil.Num(ToDouble(offset));
            if (msg.TryGetValue("translationMode", out mode)) payload += ",\"translationMode\":\"" + JsonUtil.Escape(Convert.ToString(mode, Inv)) + "\"";
            payload += "}";
            PostToPage(payload);
        }

        private void SendTrackToPage(Dictionary<string, object> msg)
        {
            StringBuilder sb = new StringBuilder("{\"type\":\"track\"");
            string[] keys = new string[] { "id", "title", "artist", "album", "coverDataUrl", "coverPath" };
            for (int i = 0; i < keys.Length; i++)
            {
                object value;
                if (!msg.TryGetValue(keys[i], out value) || value == null) continue;
                if (keys[i] == "coverDataUrl" || keys[i] == "coverPath" || keys[i] == "title" || keys[i] == "artist" || keys[i] == "album" || keys[i] == "id")
                {
                    sb.Append(",\"").Append(keys[i]).Append("\":\"").Append(JsonUtil.Escape(Convert.ToString(value, Inv))).Append('"');
                }
            }
            object duration;
            if (msg.TryGetValue("durationMs", out duration)) sb.Append(",\"durationMs\":").Append(JsonUtil.Num(ToDouble(duration)));
            sb.Append('}');
            PostToPage(sb.ToString());
        }

        // config is built page-side in production (settings publisher). The embedded demo config is a
        // standalone-run convenience and can be refined by stdin lyrics/track (--demo).
        private void SendConfigIfNeeded()
        {
            if (!webviewReady || !navDone || baseConfigJson == null) return;
            if (!configDirty && lastSentConfig == baseConfigJson) return;
            string payload = "{\"type\":\"config\",\"config\":" + baseConfigJson + "}";
            PostToPage(payload);
            lastSentConfig = baseConfigJson;
            configDirty = false;
            log.Log("info", "config-sent bytes=" + Encoding.UTF8.GetByteCount(payload));
        }

        // --demo only: keep the embedded config in sync with stdin lyrics/track so the standalone
        // demo shows the plugin's timeline. In production the page-side publisher builds the config.
        private void PatchDemoLyrics(string linesRaw)
        {
            if (baseConfigJson == null) return;
            try
            {
                Dictionary<string, object> cfg = json.DeserializeObject(baseConfigJson) as Dictionary<string, object>;
                if (cfg == null) return;
                object existing;
                Dictionary<string, object> lyrics = cfg.TryGetValue("lyrics", out existing)
                    ? existing as Dictionary<string, object> : null;
                if (lyrics == null)
                {
                    lyrics = new Dictionary<string, object>();
                    cfg["lyrics"] = lyrics;
                }
                lyrics["lines"] = ConvertProtocolLines(linesRaw);
                if (!lyrics.ContainsKey("isWordByWord")) lyrics["isWordByWord"] = true;
                baseConfigJson = json.Serialize(cfg);
                configDirty = true;
                log.Log("info", "demo-lyrics-patched bytes=" + linesRaw.Length);
                SafeBeginInvoke(SendConfigIfNeeded);
            }
            catch (Exception ex) { log.Error("patch-lyrics", ex); }
        }

        // protocol §1 lyrics {startMs,endMs,main,sub,cells[]} -> Folia LyricData lines
        // {words:[{text,startTime,endTime}], startTime, endTime, fullText, translation, isWordByWord}.
        // Time base changes from integer milliseconds to fractional seconds. The production path does
        // this conversion in the page-side publisher (folia-spec); the host only needs it for --demo.
        private List<object> ConvertProtocolLines(string linesRaw)
        {
            List<object> result = new List<object>();
            object parsed = json.DeserializeObject(linesRaw);
            object[] items = parsed as object[];
            if (items == null) return result;
            for (int i = 0; i < items.Length; i++)
            {
                Dictionary<string, object> src = items[i] as Dictionary<string, object>;
                if (src == null) continue;
                double startMs = JsonUtil.GetDouble(src, "startMs", 0);
                double endMs = JsonUtil.GetDouble(src, "endMs", startMs + 1000);
                string main = JsonUtil.GetString(src, "main");
                if (main == null) main = "";
                Dictionary<string, object> dst = new Dictionary<string, object>();
                dst["startTime"] = startMs / 1000.0;
                dst["endTime"] = endMs / 1000.0;
                dst["fullText"] = main;
                string sub = JsonUtil.GetString(src, "sub");
                if (!string.IsNullOrEmpty(sub)) dst["translation"] = sub;
                List<object> words = new List<object>();
                object cellsObj;
                if (src.TryGetValue("cells", out cellsObj) && cellsObj is object[])
                {
                    object[] cells = (object[])cellsObj;
                    for (int c = 0; c < cells.Length; c++)
                    {
                        Dictionary<string, object> cell = cells[c] as Dictionary<string, object>;
                        if (cell == null) continue;
                        Dictionary<string, object> word = new Dictionary<string, object>();
                        string text = JsonUtil.GetString(cell, "text");
                        word["text"] = text ?? "";
                        word["startTime"] = JsonUtil.GetDouble(cell, "startMs", startMs) / 1000.0;
                        word["endTime"] = JsonUtil.GetDouble(cell, "endMs", endMs) / 1000.0;
                        words.Add(word);
                    }
                }
                if (words.Count == 0)
                {
                    // fall back to per-character cells spread over the line
                    char[] chars = main.ToCharArray();
                    double span = chars.Length == 0 ? 0 : (endMs - startMs) / chars.Length;
                    for (int c = 0; c < chars.Length; c++)
                    {
                        Dictionary<string, object> word = new Dictionary<string, object>();
                        word["text"] = chars[c].ToString();
                        word["startTime"] = (startMs + c * span) / 1000.0;
                        word["endTime"] = (startMs + (c + 1) * span) / 1000.0;
                        words.Add(word);
                    }
                }
                dst["words"] = words;
                dst["isWordByWord"] = true;
                result.Add(dst);
            }
            return result;
        }

        private void PatchDemoTrack(Dictionary<string, object> msg)
        {
            if (baseConfigJson == null) return;
            try
            {
                Dictionary<string, object> cfg = json.DeserializeObject(baseConfigJson) as Dictionary<string, object>;
                if (cfg == null) return;
                string title = JsonUtil.GetString(msg, "title");
                string artist = JsonUtil.GetString(msg, "artist");
                string album = JsonUtil.GetString(msg, "album");
                string cover = JsonUtil.GetString(msg, "coverDataUrl");
                if (title != null || artist != null)
                {
                    object existing;
                    Dictionary<string, object> song = cfg.TryGetValue("song", out existing)
                        ? existing as Dictionary<string, object> : null;
                    if (song == null) { song = new Dictionary<string, object>(); cfg["song"] = song; }
                    if (title != null) song["name"] = title;
                    if (artist != null) cfg["songArtist"] = artist;
                    if (album != null) cfg["songAlbum"] = album;
                }
                if (!string.IsNullOrEmpty(cover)) cfg["coverUrl"] = cover;
                if (title != null) cfg["hasTrack"] = true;
                baseConfigJson = json.Serialize(cfg);
                configDirty = true;
                SafeBeginInvoke(SendConfigIfNeeded);
            }
            catch (Exception ex) { log.Error("patch-track", ex); }
        }

        // ---------------------------------------------------------------- diagnostics / lifecycle

        private void WriteFpsSample(Dictionary<string, object> msg)
        {
            string line = "{\"t\":\"fps\""
                + ",\"fps\":" + JsonUtil.Num(JsonUtil.GetDouble(msg, "fps", 0))
                + ",\"longFrames\":" + JsonUtil.Num(JsonUtil.GetDouble(msg, "longFrames", 0))
                + ",\"heapMB\":" + JsonUtil.Num(JsonUtil.GetDouble(msg, "heapMB", 0))
                + ",\"canvases\":" + JsonUtil.Num(JsonUtil.GetDouble(msg, "canvases", 0))
                + ",\"dpr\":" + JsonUtil.Num(JsonUtil.GetDouble(msg, "dpr", 0))
                + ",\"w\":" + JsonUtil.Num(JsonUtil.GetDouble(msg, "w", 0))
                + ",\"h\":" + JsonUtil.Num(JsonUtil.GetDouble(msg, "h", 0))
                + ",\"atMs\":" + clock.ElapsedMilliseconds + "}";
            log.WriteLine(line);
            if (!string.IsNullOrEmpty(args.FpsLogPath))
            {
                try
                {
                    File.AppendAllText(args.FpsLogPath, line + Environment.NewLine);
                }
                catch (Exception) { }
            }
            if (args.ExitAfterFps > 0 && JsonUtil.GetDouble(msg, "fps", 0) >= args.ExitAfterFps)
            {
                CloseWith("plugin", 0);
            }
        }

        private void CaptureScreenshotAsync()
        {
            CaptureScreenshotAsync(null);
        }

        private async void CaptureScreenshotAsync(string overridePath)
        {
            if (!webviewReady || webView.CoreWebView2 == null) return;
            string path = overridePath;
            if (string.IsNullOrEmpty(path)) path = args.ScreenshotPath;
            if (string.IsNullOrEmpty(path)) path = Path.Combine(Path.GetTempPath(), "spw-folia-shot.png");
            try
            {
                string directory = Path.GetDirectoryName(Path.GetFullPath(path));
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                using (FileStream stream = new FileStream(path, FileMode.Create, FileAccess.Write))
                {
                    await webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                }
                FileInfo info = new FileInfo(path);
                log.Log("info", "screenshot path=" + Path.GetFullPath(path) + " bytes=" + info.Length + " atMs=" + clock.ElapsedMilliseconds);
            }
            catch (Exception ex) { log.Error("screenshot", ex); }
        }

        private async void TryExec(string script)
        {
            try
            {
                if (!webviewReady || webView.CoreWebView2 == null) return;
                string result = await webView.CoreWebView2.ExecuteScriptAsync(script);
                log.WriteLine("{\"t\":\"eval-result\",\"value\":\"" + JsonUtil.Escape(result ?? "null") + "\"}");
            }
            catch (Exception ex) { log.Error("execute-script", ex); }
        }

        private void SendClosed()
        {
            if (closedSent) return;
            closedSent = true;
            log.WriteLine("{\"t\":\"closed\",\"reason\":\"" + JsonUtil.Escape(closeReason) + "\"}");
        }

        private void CloseWith(string reason, int code)
        {
            closeReason = reason;
            exitCode = code;
            SafeBeginInvoke(delegate { Close(); });
        }

        private void Stop(int code)
        {
            CloseWith("error", code);
        }

        private void SafeBeginInvoke(Action action)
        {
            try
            {
                if (IsHandleCreated && !IsDisposed) BeginInvoke(action);
            }
            catch (Exception) { }
        }
    }
}
