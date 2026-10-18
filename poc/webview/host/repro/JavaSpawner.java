import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Faithful reproduction of the SPW plugin spawning spw-folia-host.exe:
 *   - parent is a JVM (run via java.exe or javaw.exe)
 *   - child cwd = exe parent dir
 *   - child stdin/stdout are redirected pipes, stderr goes to a file
 *   - args exactly like FoliaHostBridge.kt: --bundle <abs web> --fullscreen --bundle-version X
 *     [--settings-dir <web>/settings --settings-entry settings-ui.js]
 *   - parent sends hello + settings, then 100ms state frames, optional config, screenshot, quit.
 *
 * Usage: java JavaSpawner <exe> <webDir> <outLog> [--config <jsonFile>] [--shot <png>] [--settings]
 *        [--no-fullscreen <WxH>] [--duration-ms N]
 */
public class JavaSpawner {
    static final List<String> outLines = Collections.synchronizedList(new ArrayList<>());
    static volatile boolean sawReady = false;

    public static void main(String[] argv) throws Exception {
        String exe = argv[0];
        String web = argv[1];
        String outLog = argv[2];
        String configFile = null, shot = null;
        boolean withSettings = false;
        boolean fullscreen = true;
        int windowW = 1600, windowH = 900;
        long durationMs = 12000;
        for (int i = 3; i < argv.length; i++) {
            String a = argv[i];
            switch (a) {
                case "--config": configFile = argv[++i]; break;
                case "--shot": shot = argv[++i]; break;
                case "--settings": withSettings = true; break;
                case "--duration-ms": durationMs = Long.parseLong(argv[++i]); break;
                case "--no-fullscreen": {
                    fullscreen = false;
                    String[] wh = argv[++i].split("[x,]");
                    windowW = Integer.parseInt(wh[0]);
                    windowH = Integer.parseInt(wh[1]);
                    break;
                }
                default: break;
            }
        }

        List<String> cmd = new ArrayList<String>(Arrays.asList(
                exe, "--bundle", web, "--fullscreen",
                "--bundle-version", "0.1.0-repro"));
        if (!fullscreen) {
            cmd.remove("--fullscreen");
            cmd.add("--window");
            cmd.add(windowW + "x" + windowH);
        }
        if (withSettings) {
            cmd.add("--settings-dir");
            cmd.add(Paths.get(web, "settings").toString());
            cmd.add("--settings-entry");
            cmd.add("settings-ui.js");
        }
        if (shot != null) {
            cmd.add("--screenshot");
            cmd.add(shot);
            cmd.add("--shot-at");
            cmd.add("6000");
        }

        File exeFile = new File(exe);
        File cwd = exeFile.getParentFile();
        File errLog = new File(cwd, "repro.stderr.log");
        if (errLog.exists()) errLog.delete();
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(cwd);
        pb.redirectError(ProcessBuilder.Redirect.appendTo(errLog));

        StringBuilder sb = new StringBuilder();
        sb.append("PARENT=").append(System.getProperty("java.home")).append(" parentProcess=")
          .append(new File("/proc").exists() ? "?" : ProcessHandle.current().pid()).append('\n');
        sb.append("JAVA_CMD=").append(fullscreen ? "fullscreen" : "windowed " + windowW + "x" + windowH)
          .append(withSettings ? " +settings" : " no-settings").append('\n');
        sb.append("CMD=").append(String.join(" ", cmd)).append('\n');
        sb.append("CWD=").append(cwd).append('\n');
        sb.append("PARENT_PID=").append(ProcessHandle.current().pid()).append('\n');

        long t0 = System.currentTimeMillis();
        Process p = pb.start();
        sb.append("CHILD_PID=").append(p.pid()).append('\n');

        Thread reader = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    synchronized (outLines) { outLines.add(line); }
                    if (line.contains("\"t\":\"ready\"")) sawReady = true;
                }
            } catch (IOException ignored) {
            }
        });
        reader.setDaemon(true);
        reader.start();

        BufferedWriter w = new BufferedWriter(new OutputStreamWriter(p.getOutputStream(), StandardCharsets.UTF_8));
        Thread.sleep(1500);
        w.write("{\"t\":\"hello\",\"protocol\":1,\"pluginVersion\":\"0.1.0-repro\",\"spwVersion\":\"1.19.0\"}\n");
        withSettings(w);
        w.flush();

        // wait for ready (or 6s)
        long deadline = System.currentTimeMillis() + 6000;
        while (!sawReady && System.currentTimeMillis() < deadline) Thread.sleep(50);
        sb.append("SAW_READY=").append(sawReady).append(" atMs=").append(System.currentTimeMillis() - t0).append('\n');

        if (configFile != null) {
            String cfg = new String(Files.readAllBytes(Paths.get(configFile)), StandardCharsets.UTF_8).trim();
            w.write("{\"t\":\"config\",\"config\":" + cfg + "}\n");
            w.flush();
        }

        int frames = 0;
        long end = System.currentTimeMillis() + durationMs;
        while (System.currentTimeMillis() < end) {
            long now = System.currentTimeMillis();
            long posMs = (now - t0) % 16000L;
            w.write("{\"t\":\"state\",\"posMs\":" + posMs + ",\"durationMs\":16000,\"playing\":true,\"rate\":1.0,\"tsMs\":" + now + "}\n");
            w.flush();
            frames++;
            Thread.sleep(100);
        }
        sb.append("FRAMES_SENT=").append(frames).append('\n');
        w.write("{\"t\":\"quit\"}\n");
        w.flush();
        boolean exited = p.waitFor(5, java.util.concurrent.TimeUnit.SECONDS);
        sb.append("EXITED=").append(exited).append(" EXIT_CODE=").append(exited ? p.exitValue() : -1).append('\n');
        if (!exited) p.destroyForcibly();

        sb.append("PARENT_PID_END=").append(System.currentTimeMillis() - t0).append('\n');
        sb.append("=== CHILD STDOUT (").append(outLines.size()).append(" lines) ===\n");
        for (String l : outLines) sb.append(l).append('\n');
        try {
            sb.append("=== CHILD STDERR ===\n");
            if (errLog.exists()) sb.append(new String(Files.readAllBytes(errLog.toPath()), StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
        Files.write(Paths.get(outLog), sb.toString().getBytes(StandardCharsets.UTF_8));
        System.out.println("WROTE " + outLog + " ready=" + sawReady + " lines=" + outLines.size());
        System.out.println(sb.length() > 4000 ? sb.substring(0, 4000) : sb.toString());
    }

    static void withSettings(BufferedWriter w) throws IOException {
        String settingsPath = System.getenv("REPRO_SETTINGS");
        String json = "{\"smartBeat\":{\"enabled\":true,\"effects\":{}}}";
        if (settingsPath != null && !settingsPath.isEmpty()) {
            try { json = new String(Files.readAllBytes(Paths.get(settingsPath)), StandardCharsets.UTF_8).trim(); } catch (Exception ignored) {}
        }
        w.write("{\"t\":\"settings\",\"settings\":" + json + "}\n");
    }
}
