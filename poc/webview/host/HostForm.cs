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
using System.Runtime.InteropServices;
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
        // v0.1.11: cross-thread flags. The stdin background thread reads webviewReady/navDone and
        // teardown (CloseWith) races the UI thread, so all of them are volatile. Every WebView2 call
        // is UI-thread-only now: under WebView2 Runtime 155 the WinForms `CoreWebView2` getter throws
        // InvalidOperationException("CoreWebView2 can only be accessed from the UI thread.") when it is
        // touched off-thread (Runtime 150 happened to tolerate it) — that exception used to kill the
        // Folia window 2 s after a lyrics replay on the user's other device.
        private volatile bool webviewReady;
        private volatile bool navDone;
        private volatile bool closedSent;
        private volatile bool closing;
        private bool shotTaken;
        private bool settingsAutoOpened;
        private bool settingsOpenRequested;
        private long navDoneAt;
        private long shotAtTick;
        private string currentUrl;
        // Early stdin is legal (protocol §1 allows hello/settings/config/lyrics before the page is up).
        // The last lyrics/track payloads are cached so they can be replayed once navigation completes.
        private volatile string lastLyricsPayload;
        private volatile string lastTrackPayload;

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
        private volatile string settingsRaw;

        // v0.1.7 player-page transparent background: a colour-key window (the desktop shows through
        // wherever the page paints transparent). Driven by settings.transparentPlayerBackground.
        private bool transparencyTarget;
        private bool transparencyActive;
        private static readonly Color TransparencyKeyColor = Color.FromArgb(255, 0, 255);

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

        // Cursor visibility: fullscreen hides the mouse pointer only after an idle period and
        // shows it again on any movement, so the settings gear is always reachable (v0.1.1 hotfix).
        private const long CursorIdleMs = 2500;
        private Point cursorPos;
        private long lastCursorMoveAt = -1;
        private bool cursorVisible = true;
        private bool settingsOverlayOpen;

        // v0.1.7 transparent player background: the colour-key window is click-through, so an opaque
        // window comes back through this global hotkey instead of a mouse click. Ctrl+Alt+B is the
        // advertised combo ("B" for background); the rest are fallbacks for apps that already own it.
        private const int TransparencyHotkeyId = 0x5357;
        private const uint ModAlt = 0x0001;
        private const uint ModControl = 0x0002;
        private static readonly uint[] HotkeyMods = { ModControl | ModAlt, ModControl | ModAlt, ModControl | ModAlt, ModControl | ModAlt | 0x0004 };
        private static readonly uint[] HotkeyVks = { 0x42 /* B */, 0x59 /* Y */, 0x50 /* P */, 0x42 /* B */ };
        private bool transparencyHotkeyRegistered;
        // v0.1.9: "鼠标穿透" — while the player background is transparent the page may ask the host to
        // let clicks fall through to the desktop. The two chrome floats (bottom-right round button and
        // top-right gear) stay clickable: the page reports their rectangles and only those forward.
        private bool mousePassthrough;
        private double hitViewportWidth;
        private double hitViewportHeight;
        private readonly List<RectangleF> hitRegionsCss = new List<RectangleF>();
        // v0.2.2: while a button is held down inside an interactive rectangle the catcher region is
        // dropped for the whole window so a drag cannot slip out of the page's hands.
        private bool catcherDragActive;

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ClientToScreen(IntPtr hWnd, ref NativePoint pt);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ScreenToClient(IntPtr hWnd, ref NativePoint pt);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool EnumChildWindows(IntPtr parent, EnumChildProc proc, IntPtr param);

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);

        private delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);

        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        private struct NativePoint
        {
            public int X;
            public int Y;
        }

        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        private struct MouseHookStruct
        {
            public NativePoint Pt;
            public uint MouseData;
            public uint Flags;
            public uint Time;
            public IntPtr ExtraInfo;
        }

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

            // v0.1.7: apply the persisted player-page transparency before the window is shown, so a
            // relaunch with the switch on comes up transparent instead of flashing an opaque frame.
            ApplyTransparencyFromSettings();
        }

        // ------------------------------------------------------------ v0.1.7: player transparency

        /// <summary>
        /// Player-page transparent background (Folia's `transparentPlayerBackground`): the page paints
        /// its own background fully transparent and the host keys that colour out of the window, so the
        /// desktop (or anything behind the window) really shows through. Verified with
        /// repro/transparency-runtime-probe.cs — the key can be toggled on a live WebView2 surface.
        /// </summary>
        private void ApplyTransparencyFromSettings()
        {
            bool on = false;
            if (!string.IsNullOrEmpty(settingsRaw))
            {
                try
                {
                    string raw = JsonUtil.ExtractRawValue(settingsRaw, "transparentPlayerBackground");
                    on = raw != null && raw.Trim().Equals("true", StringComparison.OrdinalIgnoreCase);
                }
                catch (Exception ex) { log.Error("transparency-parse", ex); }
            }
            if (args.NoTransparency) on = false;
            bool passthrough = false;
            if (!string.IsNullOrEmpty(settingsRaw))
            {
                try
                {
                    string passRaw = JsonUtil.ExtractRawValue(settingsRaw, "mousePassthrough");
                    passthrough = passRaw != null && passRaw.Trim().Equals("true", StringComparison.OrdinalIgnoreCase);
                }
                catch (Exception ex) { log.Error("passthrough-parse", ex); }
            }
            if (args.NoTransparency) passthrough = false;
            // v0.1.9: passthrough only exists inside a transparent session — leaving transparency
            // always releases the mouse so the next opaque session starts fully clickable.
            if (!on) passthrough = false;
            if (passthrough != mousePassthrough)
            {
                mousePassthrough = passthrough;
                log.Log("info", "transparency passthrough=" + (passthrough ? "on" : "off")
                    + " rects=" + hitRegionsCss.Count);
                // v0.2.2: the catcher window region is the hit test — re-apply it on every toggle.
                ApplyInputCatcherRegion();
            }
            // Keep the target in sync with the page even when the window is already in that mode:
            // exiting via the badge/hotkey leaves the page switch on, so the next "on" must re-apply.
            transparencyTarget = on;
            if (on == transparencyActive) return;
            if (IsHandleCreated) SafeBeginInvoke(delegate { SetTransparency(on); });
            else SetTransparency(on);
        }

        private void SetTransparency(bool on)
        {
            if (on == transparencyActive) return;
            try
            {
                if (on)
                {
                    TransparencyKey = Color.Empty;
                    BackColor = TransparencyKeyColor;
                    TransparencyKey = TransparencyKeyColor;
                    webView.DefaultBackgroundColor = Color.Transparent;
                }
                else
                {
                    // Clear the key first, otherwise the window flashes magenta while going opaque.
                    BackColor = Color.Black;
                    TransparencyKey = Color.Empty;
                    webView.DefaultBackgroundColor = Color.Black;
                }
                transparencyActive = on;
                transparencyTarget = on;
                EnsureTransparencyHotkey();
                if (on) ShowInputCatcher();
                else HideInputCatcher();
                log.Log("info", "transparency mode=" + (on ? "on" : "off"));
            }
            catch (Exception ex) { log.Error("transparency", ex); }
        }

        private void EnsureTransparencyHotkey()
        {
            if (!IsHandleCreated) return;
            // v0.1.8: registered for the whole lifetime, and it *toggles* (see WndProc), so the
            // keyboard can also switch transparency back on after an auto-advance or a hotkey exit.
            if (transparencyHotkeyRegistered) return;
            for (int i = 0; i < HotkeyVks.Length && !transparencyHotkeyRegistered; i++)
            {
                transparencyHotkeyRegistered = RegisterHotKey(Handle, TransparencyHotkeyId, HotkeyMods[i], HotkeyVks[i]);
                if (transparencyHotkeyRegistered)
                {
                    log.Log("info", "transparency hotkey=registered mods=0x" + HotkeyMods[i].ToString("X")
                        + " vk=0x" + HotkeyVks[i].ToString("X"));
                }
            }
            if (!transparencyHotkeyRegistered) log.Log("info", "transparency hotkey=failed");
        }

        /// <summary>
        /// A colour-key layered window is click-through: once the player background is transparent the
        /// user can no longer click the page, so the host registers a global hotkey as the way back to
        /// an opaque window. The page is told about it so the setting (and its persistence) stays in sync.
        /// </summary>
        protected override void WndProc(ref Message m)
        {
            const int WM_HOTKEY = 0x0312;
            // unchecked: IntPtr.ToInt32() is a *checked* narrowing conversion on x64 .NET; a param whose
            // low dword has bit 31 set would throw OverflowException out of WndProc (see
            // TransparencyInputCatcher.Forward for the same fix and the v0.1.9 crash it caused).
            if (m.Msg == WM_HOTKEY && unchecked((int)m.WParam.ToInt64()) == TransparencyHotkeyId)
            {
                // Toggle: transparency is display-only (the layered colour-key window swallows the
                // mouse), so the keyboard must be able to leave *and* re-enter the mode.
                if (transparencyActive) ExitTransparentMode("hotkey");
                else EnterTransparentMode("hotkey");
                return;
            }
            base.WndProc(ref m);
        }

        /// <summary>Keyboard path back into transparent mode; mirrors the page switch on.</summary>
        private void EnterTransparentMode(string source)
        {
            log.Log("info", "transparency enter source=" + source);
            SetTransparency(true);
            SyncPageTransparency(true);
        }

        /// <summary>
        /// The colour-key player window cannot receive clicks, so transparency is left either with the
        /// global hotkey or by clicking the badge window. Both paths land here: restore the opaque
        /// window and push the switch back to off so the setting (and its persistence) stays in sync.
        /// </summary>
        private void ExitTransparentMode(string source)
        {
            log.Log("info", "transparency exit source=" + source
                + " hotkey=" + (transparencyHotkeyRegistered ? "on" : "off"));
            SetTransparency(false);
            SyncPageTransparency(false);
        }

        // ------------------------------------------------------------ v0.1.8b: click-through fix

        // A colour-key layered window is click-through for the whole client area, so real mouse input
        // never reaches the page. A separate layered overlay window (alpha 1/255, not colour-keyed) sits
        // on top of the player window, receives the mouse, and forwards every event into the WebView2
        // input child window. The transparent page therefore behaves like a normal window while the
        // desktop still shows through wherever the page paints transparent.
        private TransparencyInputCatcher inputCatcher;

        private IntPtr TargetInputHandle()
        {
            return FindWebViewInputWindow();
        }

        private void ShowInputCatcher()
        {
            try
            {
                if (inputCatcher == null)
                {
                    inputCatcher = new TransparencyInputCatcher(TargetInputHandle);
                    // v0.2.2: region-based pass-through — the catcher only receives what the page
                    // claims, and reports button holds so a drag can expand to the whole window.
                    inputCatcher.DragStateChanged = OnCatcherDragStateChanged;
                }
                ApplyInputCatcherBounds();
                if (transparencyActive && inputCatcher != null && inputCatcher.Visible)
                {
                    inputCatcher.BringToFront();
                    log.Log("info", "transparency mouse=catcher raised bounds=" + inputCatcher.Bounds);
                }
                if (!inputCatcher.Visible) inputCatcher.Show();

                log.Log("info", "transparency mouse=catcher shown bounds=" + inputCatcher.Bounds);
            }
            catch (Exception ex) { log.Error("transparency-mouse", ex); }
        }

        private void SyncInputCatcherBounds()
        {
            if (!transparencyActive || inputCatcher == null || !inputCatcher.Visible) return;
            try
            {
                if (inputCatcher.Bounds != Bounds)
                {
                    inputCatcher.Bounds = Bounds;
                    ApplyInputCatcherRegion();
                    inputCatcher.BringToFront();
                    log.Log("info", "transparency mouse=catcher synced bounds=" + inputCatcher.Bounds);
                }
            }
            catch (Exception ex) { log.Error("transparency-mouse", ex); }
        }

        private void ApplyInputCatcherBounds()
        {
            if (inputCatcher == null) return;
            try
            {
                inputCatcher.Bounds = Bounds;
                // v0.2.2: the region scales with the window — rebuild it alongside the bounds.
                ApplyInputCatcherRegion();
            }
            catch (Exception) { }
        }

        private void HideInputCatcher()
        {
            try
            {
                if (inputCatcher != null && inputCatcher.Visible)
                {
                    inputCatcher.Hide();
                    log.Log("info", "transparency mouse=catcher hidden");
                }
            }
            catch (Exception ex) { log.Error("transparency-mouse", ex); }
        }

        private void DisposeInputCatcher()
        {
            try
            {
                if (inputCatcher == null) return;
                inputCatcher.Dispose();
                inputCatcher = null;
            }
            catch (Exception ex) { log.Error("transparency-mouse", ex); }
        }

        private IntPtr FindWebViewInputWindow()
        {
            IntPtr found = IntPtr.Zero;
            if (!IsHandleCreated) return found;
            try
            {
                EnumChildWindows(Handle, delegate(IntPtr h, IntPtr param)
                {
                    StringBuilder cls = new StringBuilder(128);
                    GetClassName(h, cls, 128);
                    string name = cls.ToString();
                    if (name == "Chrome_WidgetWin_1") { found = h; return false; }
                    if (found == IntPtr.Zero && name == "Chrome_RenderWidgetHostHWND") found = h;
                    return true;
                }, IntPtr.Zero);
            }
            catch (Exception ex) { log.Error("transparency-mouse", ex); }
            return found;
        }

        // ------------------------------------------------------------ v0.1.9: desktop mouse passthrough

        /// <summary>
        /// The page reports its interactive chrome rectangles in CSS pixels: the bottom-right round
        /// button, the top-right gear, the open player panel and the full-screen settings overlay.
        /// While "鼠标穿透" is on only those rectangles keep receiving clicks; every other press is
        /// replayed onto whatever window sits below the transparent player window.
        /// </summary>
        private void UpdateHitRegions(Dictionary<string, object> msg)
        {
            try
            {
                double vw = JsonUtil.GetDouble(msg, "vw", 0);
                double vh = JsonUtil.GetDouble(msg, "vh", 0);
                List<RectangleF> next = new List<RectangleF>();
                object rectsObject;
                if (msg.TryGetValue("rects", out rectsObject))
                {
                    object[] rects = rectsObject as object[];
                    if (rects != null)
                    {
                        for (int i = 0; i < rects.Length; i++)
                        {
                            Dictionary<string, object> item = rects[i] as Dictionary<string, object>;
                            if (item == null) continue;
                            float x = (float)JsonUtil.GetDouble(item, "x", 0);
                            float y = (float)JsonUtil.GetDouble(item, "y", 0);
                            float w = (float)JsonUtil.GetDouble(item, "w", 0);
                            float h = (float)JsonUtil.GetDouble(item, "h", 0);
                            if (w > 1 && h > 1) next.Add(new RectangleF(x, y, w, h));
                        }
                    }
                }
                hitViewportWidth = vw;
                hitViewportHeight = vh;
                hitRegionsCss.Clear();
                hitRegionsCss.AddRange(next);
                // v0.2.2: page rects changed — rebuild the catcher window region (= hit test).
                ApplyInputCatcherRegion();
            }
            catch (Exception ex) { log.Error("hitbox", ex); }
        }

        /// <summary>
        /// v0.2.2 (SPW-island shaped-input-peer model): the catcher window's region IS the hit test.
        /// The page's interactive rectangles are scaled from CSS pixels to window pixels, inflated by
        /// the same ±4 CSS px of slop the v0.1.9 point test used, and unioned into a window region via
        /// SetWindowRgn. Windows then delivers input only inside those rectangles and hands everything
        /// outside — clicks, wheel, hover, drags — to the window below at OS hit-test level. No
        /// synthetic input any more, so elevated windows and anti-cheat games work too.
        /// Fail-open: no rects / bad viewport / passthrough off -> null region (whole window).
        /// While a button is held (catcherDragActive) the region is dropped for drag continuity.
        /// </summary>
        private void ApplyInputCatcherRegion()
        {
            if (inputCatcher == null) return;
            try
            {
                List<Rectangle> rects = null;
                if (mousePassthrough && !catcherDragActive
                    && hitRegionsCss.Count > 0 && hitViewportWidth > 0 && hitViewportHeight > 0)
                {
                    double scaleX = inputCatcher.ClientSize.Width / hitViewportWidth;
                    double scaleY = inputCatcher.ClientSize.Height / hitViewportHeight;
                    if (scaleX > 0 && scaleY > 0)
                    {
                        rects = new List<Rectangle>();
                        Rectangle clip = new Rectangle(Point.Empty, inputCatcher.ClientSize);
                        for (int i = 0; i < hitRegionsCss.Count; i++)
                        {
                            RectangleF r = hitRegionsCss[i];
                            Rectangle rect = Rectangle.Round(new RectangleF(
                                (float)((r.Left - 4) * scaleX), (float)((r.Top - 4) * scaleY),
                                (float)((r.Width + 8) * scaleX), (float)((r.Height + 8) * scaleY)));
                            rect.Intersect(clip);
                            if (rect.Width > 0 && rect.Height > 0) rects.Add(rect);
                        }
                    }
                }
                inputCatcher.ApplyHitRegion(rects);
            }
            catch (Exception ex) { log.Error("transparency-mouse", ex); }
        }

        /// <summary>Catcher drag bookkeeping: expand to the whole window while a button is held.</summary>
        private void OnCatcherDragStateChanged(bool dragging)
        {
            try
            {
                if (catcherDragActive == dragging) return;
                catcherDragActive = dragging;
                log.Log("info", "transparency mouse=catcher drag=" + (dragging ? "on" : "off"));
                ApplyInputCatcherRegion();
            }
            catch (Exception ex) { log.Error("transparency-mouse", ex); }
        }
        private void SyncPageTransparency(bool on)
        {
            try
            {
                if (webView == null || webView.CoreWebView2 == null) return;
                webView.CoreWebView2.ExecuteScriptAsync(
                    "window.__spwFoliaSetTransparent && window.__spwFoliaSetTransparent(" + (on ? "true" : "false") + ");");
            }
            catch (Exception ex) { log.Error("transparency-sync-page", ex); }
        }

        // ------------------------------------------------------------ task-9: window geometry/DPI

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplyWindowGeometry("handle-created");
            EnsureTransparencyHotkey();
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
                Cursor = Cursors.Default;
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
                ApplyInputCatcherBounds();
            }
            catch (Exception ex) { log.Error("geometry", ex); }
        }

        /// <summary>
        /// Tracks physical cursor movement (the WebView2 child owns mouse input, so we poll the OS
        /// cursor position from the 15 ms host tick). Shows the pointer on movement and while the
        /// settings overlay is open; hides it after a short idle period in fullscreen for immersion.
        /// </summary>
        private void TrackCursor()
        {
            try
            {
                if (!args.Fullscreen)
                {
                    SetCursorVisible(true);
                    return;
                }
                if (transparencyActive && mousePassthrough)
                {
                    // operating the desktop underneath needs a visible pointer all the time
                    SetCursorVisible(true);
                    return;
                }
                Point pos = Cursor.Position;
                long now = clock.ElapsedMilliseconds;
                if (lastCursorMoveAt < 0 || pos != cursorPos)
                {
                    cursorPos = pos;
                    lastCursorMoveAt = now;
                }
                bool idle = now - lastCursorMoveAt >= CursorIdleMs;
                SetCursorVisible(settingsOverlayOpen || !idle);
            }
            catch (Exception ex) { log.Error("cursor-track", ex); }
        }

        private void ShowCursorNow()
        {
            try
            {
                lastCursorMoveAt = clock.ElapsedMilliseconds;
                SetCursorVisible(true);
            }
            catch (Exception) { }
        }

        private void SetCursorVisible(bool visible)
        {
            if (cursorVisible == visible) return;
            cursorVisible = visible;
            try
            {
                if (visible) Cursor.Show(); else Cursor.Hide();
                log.Log("info", "cursor " + (visible ? "show" : "hide")
                    + " overlay=" + (settingsOverlayOpen ? "open" : "closed")
                    + " idleMs=" + (clock.ElapsedMilliseconds - lastCursorMoveAt));
            }
            catch (Exception ex) { log.Error("cursor", ex); }
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
            // v0.1.11: mark the teardown first. `closing` makes PostToPage / CloseWith / stdin handlers
            // no-ops, so no background thread can start a new WebView2 call while it is being disposed
            // (that race is a native-crash candidate: the other device saw the process die with
            // -805306369 / 0xCFFFFFFF during teardown, without reaching the host-exit log line).
            closing = true;
            try { ShowCursorNow(); } catch (Exception) { }
            timer.Stop();
            exitTimer.Stop();
            if (transparencyHotkeyRegistered)
            {
                UnregisterHotKey(Handle, TransparencyHotkeyId);
                transparencyHotkeyRegistered = false;
            }
            try { DisposeInputCatcher(); } catch (Exception) { }

            SendClosed();
            log.Log("info", "host-exit code=" + exitCode + " reason=" + closeReason
                + " framesPosted=" + totalFramesPosted
                + " statesReceived=" + Interlocked.Read(ref stateCount)
                + " lastFps=" + JsonUtil.Num(lastFps)
                + " dropped=" + log.DroppedLines()
                + " atMs=" + clock.ElapsedMilliseconds);
            try { if (webView != null) webView.Dispose(); } catch (Exception ex) { log.Error("webview-dispose", ex); }
            try { audio.Dispose(); } catch (Exception ex) { log.Error("audio-dispose", ex); }
            base.OnFormClosing(e);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            ShowCursorNow();
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
                    // Iframe guard: AddScriptToExecuteOnDocumentCreated runs in every frame, so without
                    // the top-window check the settings UI would mount a second time inside the live
                    // preview iframe (double overlay / React-root conflict).
                    string inject = "(function(){if(window.top!==window)return;var s=document.createElement('script');s.type='module';s.src='"
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
            // Replay lyrics/track that arrived over stdin before the page was ready (protocol §1
            // allows them early; dropping them would leave the settings preview and page inputs empty).
            if (lastLyricsPayload != null) PostToPage(lastLyricsPayload);
            if (lastTrackPayload != null) PostToPage(lastTrackPayload);
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
                // Settings UI reports open/close transitions so the host can keep the system cursor
                // visible while the overlay is open (protocol §7.5).
                string st = JsonUtil.GetString(msg, "state");
                if (st != null && st.Length > 0)
                {
                    settingsOverlayOpen = st == "open";
                    log.Log("info", "settings-ui state=" + st);
                    TrackCursor();
                }
            }
            else if (type == "settings")
            {
                string settingsValue = JsonUtil.ExtractRawValue(raw, "settings");
                if (settingsValue != null)
                {
                    settingsRaw = settingsValue;
                    ApplyTransparencyFromSettings();
                    log.WriteLine("{\"t\":\"settings\",\"settings\":" + settingsValue + "}");
                }
            }
            else if (type == "hitbox")
            {
                UpdateHitRegions(msg);
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
            SyncInputCatcherBounds();
            TrackCursor();
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

        /// <summary>
        /// Posts one protocol message into the page. Caller-agnostic: safe from any thread.
        ///
        /// v0.1.11/v0.2.0: WebView2's managed wrapper throws
        /// <c>InvalidOperationException("CoreWebView2 can only be accessed from the UI thread.")</c>
        /// when its members are touched from any other thread (WebView2 Runtime 155 enforces this;
        /// Runtime 150 happened to let the same off-thread COM call pass). The stdin pump calls this
        /// through HandleStdinLine for lyrics/track/command lines, so the marshalling and the
        /// readiness checks (including the <c>CoreWebView2</c> property read) must live on the UI
        /// thread, inside a try/catch: anything else used to kill the whole stdin pump.
        /// </summary>
        private void PostToPage(string payload)
        {
            if (payload == null || closing || IsDisposed) return;
            if (InvokeRequired)
            {
                // Already marshalling with BeginInvoke keeps stdin ordering intact (queued FIFO).
                SafeBeginInvoke(delegate { PostCore(payload); });
                return;
            }
            PostCore(payload);
        }

        /// <summary>UI-thread half of <see cref="PostToPage"/>: every WebView2 touch lives here.</summary>
        private void PostCore(string payload)
        {
            if (closing || IsDisposed) return;
            try
            {
                if (!webviewReady || webView == null)
                {
                    // Never let early stdin (allowed by §1) surface as a NullReferenceException: before
                    // WebView2 is created there is simply no page to post to yet. Settings/config/lyrics/
                    // track are cached by their callers and flushed on navigation completion.
                    log.Log("debug", "post-page-skip reason=not-ready bytes=" + Encoding.UTF8.GetByteCount(payload));
                    return;
                }
                CoreWebView2 core = webView.CoreWebView2;
                if (core == null)
                {
                    log.Log("debug", "post-page-skip reason=no-core bytes=" + Encoding.UTF8.GetByteCount(payload));
                    return;
                }
                core.PostWebMessageAsJson(payload);
            }
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
                    // v0.1.11: a single malformed line, or any exception reached from a handler, used to
                    // be fatal: it fell into the outer catch, which started the 2 s exit timer and closed
                    // the host with code 0 (observed on the user's other device for the stdin-thread
                    // WebView2 thread-affinity throw). stdin is the plugin's lifeline; log and continue.
                    try { HandleStdinLine(line); }
                    catch (Exception ex)
                    {
                        log.Error("stdin-line", ex);
                        log.Log("info", "stdin-line-skip bytes=" + Encoding.UTF8.GetByteCount(line));
                    }
                }
                log.Log("info", "stdin-eof");
                if (args.ExitOnStdinClose) ScheduleExitOnUiThread();
            }
            catch (Exception ex)
            {
                // Only a reader-level failure (broken/dead stdin pipe) can land here now.
                log.Error("stdin-reader", ex);
                if (args.ExitOnStdinClose) ScheduleExitOnUiThread();
            }
        }

        private void ScheduleExitOnUiThread()
        {
            try { BeginInvoke((Action)ScheduleExitFromStdinEof); } catch (Exception) { }
        }

        private void ScheduleExitFromStdinEof()
        {
            if (IsDisposed || closing) return;
            exitTimer.Start();
        }

        private void OnExitTimerTick(object sender, EventArgs e)
        {
            exitTimer.Stop();
            CloseWith("plugin", 0);
        }

        private void HandleStdinLine(string line)
        {
            if (closing) return;
            Dictionary<string, object> msg = null;
            try { msg = json.DeserializeObject(line) as Dictionary<string, object>; } catch (Exception) { }
            string t = msg == null ? null : JsonUtil.GetString(msg, "t");
            if (t == null) return;

            if (t == "hello")
            {
                log.Log("info", "stdin-hello pluginVersion=" + (JsonUtil.GetString(msg, "pluginVersion") ?? "?")
                    + " spwVersion=" + (JsonUtil.GetString(msg, "spwVersion") ?? "?"));
                string devUrl = JsonUtil.GetString(msg, "devUrl");
                if (!string.IsNullOrEmpty(devUrl))
                {
                    // Navigation is WebView2 work: run the whole check/navigate block on the UI thread.
                    SafeBeginInvoke(delegate
                    {
                        if (closing || !webviewReady || webView == null) return;
                        string target = Program.BundleUrl(devUrl);
                        if (target == currentUrl) return;
                        currentUrl = target;
                        log.Log("info", "hello devUrl override -> " + currentUrl);
                        try { webView.CoreWebView2.Navigate(currentUrl); } catch (Exception) { }
                    });
                }
            }
            else if (t == "settings")
            {
                string settingsValue = JsonUtil.ExtractRawValue(line, "settings");
                if (settingsValue != null)
                {
                    settingsRaw = settingsValue;
                    // ApplyTransparencyFromSettings touches the form/WebView2 (window key, hotkey,
                    // DefaultBackgroundColor) and SendSettingsToPage posts into the page: both must be
                    // UI-thread work even though the message arrived on the stdin thread.
                    SafeBeginInvoke(delegate
                    {
                        if (closing) return;
                        ApplyTransparencyFromSettings();
                        SendSettingsToPage();
                    });
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
            else if (command == "settings")
            {
                SafeBeginInvoke(delegate
                {
                    if (closing) return;
                    settingsOverlayOpen = !settingsOverlayOpen;
                    PostToPage("{\"type\":\"ui\",\"action\":\"toggle-settings\"}");
                });
            }
            else if (command == "open-settings")
            {
                SafeBeginInvoke(delegate
                {
                    if (closing) return;
                    settingsOverlayOpen = true;
                    PostToPage("{\"type\":\"ui\",\"action\":\"open-settings\"}");
                });
            }
            else if (command == "close-settings")
            {
                SafeBeginInvoke(delegate
                {
                    if (closing) return;
                    settingsOverlayOpen = false;
                    PostToPage("{\"type\":\"ui\",\"action\":\"close-settings\"}");
                });
            }
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
            lastLyricsPayload = payload;
            PostToPage(payload);
        }

        private void SendTrackToPage(Dictionary<string, object> msg)
        {
            StringBuilder sb = new StringBuilder("{\"type\":\"track\"");
            string[] keys = new string[] { "id", "title", "artist", "album", "coverDataUrl", "coverUrl", "coverPath" };
            // The plugin reports the cover as `coverDataUrl` (a data: URL); the injected settings
            // page and Folia's own config type read `coverUrl`. Emit both spellings from one value so
            // the cover reaches the page under either name — this drives the 封面取色 theme derivation
            // and every style that draws the cover.
            string coverForPage = null;
            for (int i = 0; i < keys.Length; i++)
            {
                object value;
                if (!msg.TryGetValue(keys[i], out value) || value == null) continue;
                string text = Convert.ToString(value, Inv);
                if (keys[i] == "coverDataUrl" || keys[i] == "coverUrl") coverForPage = text;
                if (keys[i] == "coverDataUrl" || keys[i] == "coverUrl" || keys[i] == "coverPath" || keys[i] == "title" || keys[i] == "artist" || keys[i] == "album" || keys[i] == "id")
                {
                    sb.Append(",\"").Append(keys[i]).Append("\":\"").Append(JsonUtil.Escape(text)).Append('"');
                }
            }
            if (coverForPage != null && !msg.ContainsKey("coverUrl"))
            {
                sb.Append(",\"coverUrl\":\"").Append(JsonUtil.Escape(coverForPage)).Append('"');
            }
            object duration;
            if (msg.TryGetValue("durationMs", out duration)) sb.Append(",\"durationMs\":").Append(JsonUtil.Num(ToDouble(duration)));
            sb.Append('}');
            lastTrackPayload = sb.ToString();
            PostToPage(lastTrackPayload);
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
            if (closing) return; // teardown already running: keep the first reason/code
            closeReason = reason;
            exitCode = code;
            SafeBeginInvoke(delegate { try { if (!IsDisposed) Close(); } catch (Exception) { } });
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

// ---------------------------------------------------------------------------
// v0.1.7b: player-page transparency escape hatch
// ---------------------------------------------------------------------------

    /// <summary>
    /// v0.1.8b: invisible (alpha 1/255) layered window that covers the transparent player window. It is
    /// NOT colour-keyed, so it still receives mouse input, and forwards every event into the WebView2
    /// input child window. That makes the transparent player page clickable while the desktop keeps
    /// showing through wherever the page paints transparent.
    ///
    /// v0.2.2 (SPW-island shaped input peer): the window region IS the hit test — ApplyHitRegion
    /// unions the page's interactive rectangles into a SetWindowRgn shape, so input outside them falls
    /// through to the window below natively (right-click, wheel, hover and drags included). While a
    /// button is held the region is dropped so a drag keeps receiving its moves and cannot be
    /// swallowed when the pointer leaves one rectangle.
    /// </summary>
    internal sealed class TransparencyInputCatcher : Form
    {
        private const int WS_EX_LAYERED = 0x00080000;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private const int LWA_ALPHA = 0x00000002;
        private const int WM_MOUSEMOVE = 0x0200;
        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_LBUTTONUP = 0x0202;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_RBUTTONUP = 0x0205;
        private const int WM_MOUSEWHEEL = 0x020A;

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint colorKey, byte alpha, int flags);

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ScreenToClient(IntPtr hWnd, ref NativePoint pt);

        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        private struct NativePoint
        {
            public int X;
            public int Y;
        }

        private const int VK_LBUTTON = 0x01;
        private const int VK_RBUTTON = 0x02;
        private const int RGN_OR = 2;

        [System.Runtime.InteropServices.DllImport("gdi32.dll")]
        private static extern IntPtr CreateRectRgn(int x1, int y1, int x2, int y2);

        [System.Runtime.InteropServices.DllImport("gdi32.dll")]
        private static extern int CombineRgn(IntPtr hDest, IntPtr hSrc1, IntPtr hSrc2, int fnCombineMode);

        [System.Runtime.InteropServices.DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr hObject);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        private readonly Func<IntPtr> target;
        private int buttonsDown;
        private bool dragActive;
        private List<Rectangle> lastRegionRects;

        /// <summary>Raised when the held-button state changes (true = drag in progress).</summary>
        public Action<bool> DragStateChanged;

        public TransparencyInputCatcher(Func<IntPtr> inputHandle)
        {
            target = inputHandle;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.Black;
            AutoScaleMode = AutoScaleMode.None;
            TabStop = false;
            SetStyle(ControlStyles.Selectable, false);
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // alpha 1/255 is invisible to the eye but keeps the window hit-testable
            SetLayeredWindowAttributes(Handle, 0, 1, LWA_ALPHA);
            // v0.2.2: handle recreation drops the window region — put the last shape back.
            ApplyHitRegion(lastRegionRects);
        }

        protected override void WndProc(ref Message m)
        {
            if (Forward(ref m)) return;
            base.WndProc(ref m);
        }

        private bool Forward(ref Message m)
        {
            int msg = m.Msg;
            if (msg != WM_MOUSEMOVE && msg != WM_LBUTTONDOWN && msg != WM_LBUTTONUP
                && msg != WM_RBUTTONDOWN && msg != WM_RBUTTONUP && msg != WM_MOUSEWHEEL) return false;

            // v0.1.10: never narrow a message parameter with IntPtr.ToInt32(). On x64 .NET that is a
            // *checked* conversion and Win32 hands us WPARAM/LPARAM zero-extended to 64 bits, so any
            // param whose low dword has bit 31 set (a negative mouse-wheel delta, a negative screen
            // coordinate, ...) threw OverflowException straight out of WndProc - the v0.1.9 crash.
            // ToInt64() + unchecked cast keeps the low 32 bits and cannot throw.
            int lp = unchecked((int)m.LParam.ToInt64());
            NativePoint pt = new NativePoint();
            if (msg == WM_MOUSEWHEEL)
            {
                // WM_MOUSEWHEEL: LOWORD(wParam) = key state, HIWORD(wParam) = signed wheel delta,
                // lParam = *screen* coordinates (not client, and not the delta).
                pt.X = (short)(lp & 0xFFFF);
                pt.Y = (short)((lp >> 16) & 0xFFFF);
            }
            else
            {
                pt.X = (short)(lp & 0xFFFF);
                pt.Y = (short)((lp >> 16) & 0xFFFF);
                Point screen = PointToScreen(new Point(pt.X, pt.Y));
                pt.X = screen.X;
                pt.Y = screen.Y;
            }
            // v0.2.2: the window region already decided that this point belongs to the page, so
            // everything arriving here is forwarded — no software hit test, no synthetic replay.
            if (msg == WM_MOUSEMOVE) HealDragState();
            if (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN) BeginDrag();
            bool up = msg == WM_LBUTTONUP || msg == WM_RBUTTONUP;
            IntPtr targetHandle = target();
            if (targetHandle != IntPtr.Zero)
            {
                if (msg == WM_MOUSEWHEEL)
                {
                    // Forward verbatim: the page's input window expects the cursor position in screen
                    // coordinates and the wheel delta in HIWORD(wParam), exactly as Windows wrote them.
                    SendMessage(targetHandle, (uint)msg, m.WParam, m.LParam);
                }
                else
                {
                    ScreenToClient(targetHandle, ref pt);
                    SendMessage(targetHandle, (uint)msg, m.WParam, MakeLParam(pt.X, pt.Y));
                }
            }
            if (up) EndDrag();
            return true;
        }

        /// <summary>First button down: keep the whole window until every button is back up.</summary>
        private void BeginDrag()
        {
            if (buttonsDown < 0) buttonsDown = 0;
            buttonsDown++;
            if (dragActive) return;
            dragActive = true;
            Action<bool> changed = DragStateChanged;
            if (changed != null) changed(true);
        }

        private void EndDrag()
        {
            if (buttonsDown > 0) buttonsDown--;
            if (!dragActive || buttonsDown > 0) return;
            dragActive = false;
            Action<bool> changed = DragStateChanged;
            if (changed != null) changed(false);
        }

        /// <summary>
        /// Self-heal for a lost button-up (e.g. the WebView2 input window took mouse capture and ate
        /// it): the next move checks the real button state and drops the drag when nothing is held,
        /// so the catcher region can never stay expanded forever.
        /// </summary>
        private void HealDragState()
        {
            if (!dragActive) return;
            bool held = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0
                || (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
            if (held) return;
            buttonsDown = 0;
            dragActive = false;
            Action<bool> changed = DragStateChanged;
            if (changed != null) changed(false);
        }

        /// <summary>
        /// v0.2.2: the window region IS the hit test (SPW-island's shaped input peer). rects is the
        /// union of the page's interactive rectangles in window pixels; input outside it falls through
        /// to the window below at OS hit-test level. null/empty = whole window (fail-open).
        /// Ownership: the HRGN handed to SetWindowRgn is owned by the system afterwards (MSDN), so it
        /// is never deleted here; only the temporary CombineRgn operands are.
        /// </summary>
        public void ApplyHitRegion(List<Rectangle> rects)
        {
            lastRegionRects = rects;
            if (!IsHandleCreated) return;
            IntPtr combined = IntPtr.Zero;
            try
            {
                if (rects != null)
                {
                    for (int i = 0; i < rects.Count; i++)
                    {
                        Rectangle r = rects[i];
                        if (r.Width <= 0 || r.Height <= 0) continue;
                        IntPtr one = CreateRectRgn(r.Left, r.Top, r.Right, r.Bottom);
                        if (one == IntPtr.Zero) continue;
                        if (combined == IntPtr.Zero) { combined = one; continue; }
                        IntPtr next = CreateRectRgn(0, 0, 0, 0);
                        if (next != IntPtr.Zero)
                        {
                            CombineRgn(next, combined, one, RGN_OR);
                            DeleteObject(combined);
                            combined = next;
                        }
                        DeleteObject(one);
                    }
                }
                if (SetWindowRgn(Handle, combined, true) != 0) combined = IntPtr.Zero;
            }
            catch (Exception) { }
            finally
            {
                if (combined != IntPtr.Zero) DeleteObject(combined);
            }
        }
        private static IntPtr MakeLParam(int x, int y)
        {
            // MAKELPARAM: mask both halves so negative/large values cannot corrupt the high word.
            return (IntPtr)(((y & 0xFFFF) << 16) | (x & 0xFFFF));
        }
    }
