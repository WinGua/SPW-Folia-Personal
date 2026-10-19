// Probe: can synthetic WM_MOUSE messages posted to WebView2's child HWND drive the page inside a
// colour-key (click-through) host window? Used to decide whether the transparent player window can
// regain in-page clicking (v0.1.8).
// C# 5 only (in-box csc.exe): no interpolation / ?. / expression bodies.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class ClickProbe
{
    private static readonly string LogPath = @"D:\输出目录\dsh2\tmp-inspect\clickprobe.log";
    private static StreamWriter log;
    private static WebView2 webView;
    private static Form form;
    private static int hitCount;

    [DllImport("user32.dll")] private static extern IntPtr PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr param);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder name, int max);
    [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr hWnd, ref POINT p);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);

    private delegate bool EnumProc(IntPtr hWnd, IntPtr param);

    private struct POINT { public int X; public int Y; }
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    private const uint WM_MOUSEMOVE = 0x0200;
    private const uint WM_LBUTTONDOWN = 0x0201;
    private const uint WM_LBUTTONUP = 0x0202;
    private const uint MK_LBUTTON = 0x0001;

    private static void Log(string line)
    {
        if (log != null) { log.WriteLine(line); log.Flush(); }
    }

    private static IntPtr MakeLParam(int x, int y)
    {
        return (IntPtr)((y << 16) | (x & 0xFFFF));
    }

    [STAThread]
    private static void Main()
    {
        log = new StreamWriter(LogPath, false, Encoding.UTF8);
        form = new Form();
        form.FormBorderStyle = FormBorderStyle.None;
        form.StartPosition = FormStartPosition.Manual;
        form.Bounds = new System.Drawing.Rectangle(200, 200, 700, 500);
        form.BackColor = System.Drawing.Color.FromArgb(255, 0, 255);
        form.TransparencyKey = System.Drawing.Color.FromArgb(255, 0, 255);
        form.TopMost = true;
        webView = new WebView2();
        webView.Dock = DockStyle.Fill;
        webView.DefaultBackgroundColor = System.Drawing.Color.Transparent;
        form.Controls.Add(webView);
        form.Load += OnLoaded;
        Application.Run(form);
    }

    private static async void OnLoaded(object sender, EventArgs e)
    {
        try
        {
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, @"D:\输出目录\dsh2\tmp-inspect\clickprobe-ud", null);
            await webView.EnsureCoreWebView2Async(env);
            Log("webview ready");
            webView.CoreWebView2.NavigateToString(
                "<html><body style='margin:0;background:transparent;font-family:sans-serif'>" +
                "<div id='pad' style='position:absolute;left:100px;top:100px;width:300px;height:200px;background:rgba(30,30,30,.85);color:#fff;font-size:28px'>" +
                "<span id='count'>0</span> clicks</div>" +
                "<script>var n=0;document.getElementById('pad').addEventListener('mousedown',function(){n++;document.getElementById('count').textContent=n;window.chrome.webview.postMessage('click '+n);});</script>" +
                "</body></html>");
            webView.CoreWebView2.WebMessageReceived += delegate (object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                Log("page says: " + a.TryGetWebMessageAsString());
            };
            await System.Threading.Tasks.Task.Delay(2500);
            IntPtr parent = form.Handle;
            RECT client;
            GetClientRect(parent, out client);
            Log("form handle=" + parent + " client=" + client.Right + "x" + client.Bottom);
            System.Collections.Generic.List<IntPtr> candidates = new System.Collections.Generic.List<IntPtr>();
            EnumChildWindows(parent, delegate (IntPtr h, IntPtr p)
            {
                StringBuilder cls = new StringBuilder(256);
                GetClassName(h, cls, 256);
                Log("child hwnd=" + h + " class=" + cls);
                string name = cls.ToString();
                if (name.IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) >= 0
                    || name.IndexOf("Chrome_RenderWidgetHostHWND", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    candidates.Add(h);
                }
                return true;
            }, IntPtr.Zero);

            int cx = 250, cy = 200; // inside the pad
            POINT screenPt = new POINT();
            screenPt.X = cx;
            screenPt.Y = cy;
            ClientToScreen(form.Handle, ref screenPt);
            Log("page point screen=" + screenPt.X + "," + screenPt.Y);

            int index = 0;
            foreach (IntPtr cand in candidates)
            {
                index++;
                POINT local = new POINT();
                local.X = screenPt.X;
                local.Y = screenPt.Y;
                ScreenToClient(cand, ref local);
                SetCursorPos(screenPt.X, screenPt.Y);
                System.Threading.Thread.Sleep(120);
                SendMessage(cand, WM_MOUSEMOVE, IntPtr.Zero, MakeLParam(local.X, local.Y));
                System.Threading.Thread.Sleep(80);
                SendMessage(cand, WM_LBUTTONDOWN, (IntPtr)MK_LBUTTON, MakeLParam(local.X, local.Y));
                System.Threading.Thread.Sleep(80);
                SendMessage(cand, WM_LBUTTONUP, IntPtr.Zero, MakeLParam(local.X, local.Y));
                System.Threading.Thread.Sleep(400);
                string mid = await webView.CoreWebView2.ExecuteScriptAsync("document.getElementById('count').textContent");
                Log("after candidate #" + index + " (" + cand + ") counter=" + mid);
            }
            await System.Threading.Tasks.Task.Delay(500);
            string result = await webView.CoreWebView2.ExecuteScriptAsync("document.getElementById('count').textContent");
            Log("page counter after synthetic clicks: " + result);
            if (hitCount >= 0) Log("hitCount=" + hitCount);
        }
        catch (Exception ex)
        {
            Log("probe error " + ex.GetType().Name + ": " + ex.Message);
        }
        finally
        {
            Log("done");
            try { form.Close(); } catch (Exception) { }
        }
    }
}
