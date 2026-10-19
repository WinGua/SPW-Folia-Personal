// Probe: can a WinForms + WebView2 window show the desktop through a transparent page?
// Two variants are compiled in and picked with a CLI arg:
//   key   -> Form.TransparencyKey = Magenta, BackColor = Magenta, WebView2 DefaultBackgroundColor = Transparent
//   plain -> no TransparencyKey, same transparent WebView2 background (control: expect black/white)
// The window is 900x560 at (80,80) over the desktop; after 4 s it grabs the screen area and exits.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TransparencyProbe
{
    public sealed class ProbeForm : Form
    {
        private readonly string mode;
        private readonly string outPath;
        private readonly WebView2 webView = new WebView2();
        private readonly System.Windows.Forms.Timer shot = new System.Windows.Forms.Timer();

        public ProbeForm(string variant, string png)
        {
            mode = variant;
            outPath = png;
            Text = "transparency probe " + mode;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = new Rectangle(80, 80, 900, 560);
            ShowInTaskbar = true;
            Color key = Color.FromArgb(255, 0, 255);
            BackColor = key;
            if (mode == "key") TransparencyKey = key;
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = Color.Transparent;
            Controls.Add(webView);
            Load += OnLoad;
            shot.Interval = 4000;
            shot.Tick += OnShot;
        }

        private async void OnLoad(object sender, EventArgs e)
        {
            try
            {
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(
                    null, Path.Combine(Path.GetTempPath(), "spw-folia-transparency-probe"), null);
                await webView.EnsureCoreWebView2Async(env);
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                string html = "<html style='background:transparent'><body style='margin:0;background:transparent;"
                    + "font:600 64px Segoe UI;color:#ffffff;text-shadow:0 2px 8px #000'>"
                    + "TRANSPARENT " + mode + "</body></html>";
                webView.CoreWebView2.NavigateToString(html);
                shot.Start();
            }
            catch (Exception ex)
            {
                File.WriteAllText(outPath + ".error.txt", ex.ToString());
                Close();
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
            string mode = args.Length > 0 ? args[0] : "key";
            string png = args.Length > 1 ? args[1] : Path.Combine(Path.GetTempPath(), "transparency-" + mode + ".png");
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
