// Probe 2: can TransparencyKey be toggled at runtime on a live WinForms + WebView2 window?
//   on   -> start opaque (black), after 1.5 s switch to keyed transparency, screenshot at 4 s
//   off  -> start keyed transparency, after 1.5 s switch back to opaque, screenshot at 4 s
// Screenshot = CopyFromScreen over the window bounds: if the desktop (browser window) shows
// through where the page is transparent, runtime toggling works without recreating the form.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TransparencyRuntimeProbe
{
    public sealed class ProbeForm : Form
    {
        private readonly string mode;
        private readonly string outPath;
        private readonly WebView2 webView = new WebView2();
        private readonly System.Windows.Forms.Timer flip = new System.Windows.Forms.Timer();
        private readonly System.Windows.Forms.Timer shot = new System.Windows.Forms.Timer();

        public ProbeForm(string variant, string png)
        {
            mode = variant;
            outPath = png;
            Text = "transparency runtime probe " + mode;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = new Rectangle(80, 80, 900, 560);
            ShowInTaskbar = true;
            bool startOn = mode == "off";
            ApplyTransparency(startOn);
            webView.Dock = DockStyle.Fill;
            Controls.Add(webView);
            Load += OnLoad;
            flip.Interval = 1500;
            flip.Tick += OnFlip;
            shot.Interval = 4000;
            shot.Tick += OnShot;
        }

        private void ApplyTransparency(bool on)
        {
            Color key = Color.FromArgb(255, 0, 255);
            if (on)
            {
                TransparencyKey = Color.Empty;
                BackColor = key;
                TransparencyKey = key;
                webView.DefaultBackgroundColor = Color.Transparent;
            }
            else
            {
                BackColor = Color.Black;
                TransparencyKey = Color.Empty;
                webView.DefaultBackgroundColor = Color.Black;
            }
        }

        private async void OnLoad(object sender, EventArgs e)
        {
            try
            {
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(
                    null, Path.Combine(Path.GetTempPath(), "spw-folia-transparency-runtime"), null);
                await webView.EnsureCoreWebView2Async(env);
                string html = "<html style='background:transparent'><body style='margin:0;background:transparent;"
                    + "font:600 64px Segoe UI;color:#ffffff;text-shadow:0 2px 8px #000'>"
                    + "RUNTIME " + mode + "</body></html>";
                webView.CoreWebView2.NavigateToString(html);
                flip.Start();
                shot.Start();
            }
            catch (Exception ex)
            {
                File.WriteAllText(outPath + ".error.txt", ex.ToString());
                Close();
            }
        }

        private void OnFlip(object sender, EventArgs e)
        {
            flip.Stop();
            try
            {
                File.WriteAllText(outPath + ".flip.txt", "flip at " + DateTime.Now.ToString("O")
                    + " mode=" + mode + " webviewNull=" + (webView.CoreWebView2 == null));
                ApplyTransparency(mode != "off");
                File.WriteAllText(outPath + ".after.txt", "after flip: TransparencyKey=" + TransparencyKey
                    + " back=" + BackColor + " handle=" + Handle + " webviewHandle=" + webView.IsHandleCreated
                    + " webviewNull=" + (webView.CoreWebView2 == null));
            }
            catch (Exception ex)
            {
                File.WriteAllText(outPath + ".error.txt", ex.ToString());
            }
        }

        private void OnShot(object sender, EventArgs e)
        {
            shot.Stop();
            try
            {
                Rectangle b = Bounds;
                using (Bitmap bmp = new Bitmap(b.Width, b.Height))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size);
                    bmp.Save(outPath, ImageFormat.Png);
                }
            }
            catch (Exception ex)
            {
                File.WriteAllText(outPath + ".error.txt", ex.ToString());
            }
            Close();
        }
    }

    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            string mode = args.Length > 0 ? args[0] : "on";
            string png = args.Length > 1 ? args[1] : Path.Combine(Path.GetTempPath(), "transparency-runtime-" + mode + ".png");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (ProbeForm form = new ProbeForm(mode, png))
            {
                Application.Run(form);
            }
            return 0;
        }
    }
}
