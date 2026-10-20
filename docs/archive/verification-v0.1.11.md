# spw-folia v0.1.11 — 修复：辅助进程 stdin 泵跨线程访问 WebView2 必崩，连带 SPW 卡死

用户报告：装上插件后打开 更多 → Folia，全屏窗口**几秒内闪退**；有时整个 SPW 变成
「未响应」被强制关闭。事件查看器里有三条 `spw-folia-host.exe` 的 **Application Hang
(1002)** 记录，插件日志 `spw-folia.log` 里每次都先出现同一行错误：

```
host[error] stdin: InvalidOperationException: CoreWebView2 can only be accessed from the UI thread.
```

随后 stdout EOF、进程退出码 `0`（正常路径）或 `-805306369`（`0xCFFFFFFF`，被 WER 以
「挂起」为由终止），Java 侧则连续出现 `stdin write failed: java.io.IOException: 管道已结束`。

## 根因 1（宿主）：stdin 线程直接摸了 `webView.CoreWebView2`

`HostForm.HandleStdinLine` 跑在 `spw-folia-stdin` 后台线程上，但三个分支最终调用了
`PostToPage` 而没有封送到 UI 线程：

- `{"t":"lyrics"}` → `SendLyricsToPage` → `PostToPage`
- `{"t":"track"}` → `SendTrackToPage` → `PostToPage`
- `{"t":"command","command":"settings|open-settings|close-settings"}` → `PostToPage`

`PostToPage` 的第一行是

```csharp
if (!webviewReady || webView == null || webView.CoreWebView2 == null)   // <- 在 try 之外
```

WebView2 的 WinForms 控件只允许创建线程访问，**连读 `CoreWebView2` 属性都会**抛
`InvalidOperationException: CoreWebView2 can only be accessed from the UI thread.`，
而这一行在 `try` 之外，异常直接冲出 `HandleStdinLine`，被 `StdinLoop` 最外层的
`catch` 接住 —— **整个 stdin 读取线程就此终止**。`StdinLoop` 的 catch 又会
`BeginInvoke(ScheduleExitFromStdinEof)`，2 秒后 `exitTimer`（`Interval = 2000`）关掉
整个窗口。时间线与日志完全吻合：

```
08:51:47.514 lyrics -> helper (10433 bytes, replay)      <- 触发点
08:51:47.522 host[error] stdin: InvalidOperationException
08:51:49.581 host-exit ... statesReceived=32 ... atMs=4361   <- 2 s 后自杀
```

SPW 播放中歌词随切歌推送，所以「点开 Folia → 2–3 秒内消失」每次必现；负载高时
（3200x2000 @175% DPI、3 canvas、110-120 fps）关闭路径卡住，Windows 判定为
AppHang 并杀死进程 —— 即三次 `Application Hang (1002)` 记录。

## 根因 2（插件）：管道写卡死会冻结 SPW UI 线程

`FoliaHostBridge.sendLine` 在 **`synchronized(this)` 内**做阻塞式管道写：

```kotlin
private fun sendLine(line: String) {
    val out = writer ?: return
    synchronized(this) {
        out.write(line); out.write("\n"); out.flush()   // <- 阻塞点
    }
}
```

根因 1 发生后辅助进程不再读 stdin，操作系统管道缓冲区（数十 KB）被 155 KB 的
`track`（含封面 data URL）与 100 ms 一条的 `state` 填满，`flush()` **永久阻塞**，
并且一直握着 `this` 这把锁。而 `open()` / `stop()` / `cleanup()` / `mirrorStdout()`
全部需要同一把锁；`open()` 由注入菜单项的 onClick 直接在 **Compose UI 线程**上调用
（`FoliaPlugin.openFolia` → `bridge.open()`）。用户再次点击 更多 → Folia 时，
SPW 主线程在 `synchronized` 上排队等一把永远不释放的锁 → **SPW 未响应/闪退**。

## 修复

宿主（`poc/webview/host/HostForm.cs`）：

1. `PostToPage` 拆成「按需封送 + `PostCore`」：`InvokeRequired` 时 `SafeBeginInvoke`，
   并把 `webView.CoreWebView2` 的就绪检查移进 `try`，任何线程调用都不再抛出、不再中断泵。
2. `StdinLoop` 的 `while` 循环体加**逐行** `try/catch`（`log.Error("stdin-line", ...)`）：
   单条坏行只丢该行，泵继续运转；只有真正的管道 EOF/IO 错误才走退出流程。

插件（`spw-folia/.../FoliaHostBridge.kt`）：

3. 新增专职 stdin 写线程 + **有界队列**（容量 256）：队列满时丢最旧一行
   （正常负载下丢的是可弃的 `state` 行；极端持续溢出时 `settings` 也可能被丢，重开窗口会重发）。
   SPW 的 UI/生命周期线程不再因管道写而阻塞，专职写线程自行承受背压（`open/stop` 最多 `join` 500 ms）；
   写失败置 `stdinBroken` 并排空队列。`open()`/`stop()` 的生命周期锁与管道写彻底解耦，
   `mirrorStdout` 的日志文件锁也改用独立的 `stdoutLogLock`。

## 验证

> **环境与证据来源**：下面 1/2 两节的数字来自**崩溃机**（Windows 11 x64，SPW 1.19.0 +
> WebView2 **155.0.4283.62**），由未入库的临时脚本 `repro_stdin_crash.py` 以协议 v1 直接驱动 helper 产生；
> 脚本与原始 stdout 未提交到仓库（所以这组数字在本仓库不可一键复现）。
> 开发机（WebView2 **150.0.4078.83**）上 WebView2 对跨线程读 `CoreWebView2` 较宽容，无法直接复现该异常，
> 本机只用 fixed-version 155 运行时验证过（浏览器进程自身 `BrowserProcessExited` 退出，见
> `docs/archive/verification-v0.2.0.md` §2.3）。§3 的现场证据来自用户机器。

### 1. 修复前：必现（崩溃机，Windows 11 x64，SPW 1.19.0 + WebView2 155.0.4283.62）

`repro_stdin_crash.py` 直接以协议 v1 驱动已安装的 `spw-folia-host.exe`
（`--windowed 900x560 --no-topmost`），`ready` 后按序发 `state → lyrics → state →
track → state → quit`。旧二进制在 `lyrics` 后 30 ms 内输出：

```
host> {"t":"log","level":"error","msg":"stdin: InvalidOperationException: CoreWebView2 can only be accessed from the UI thread."}
host> {"t":"closed","reason":"plugin"}
host> {"t":"log","level":"info","msg":"host-exit code=0 reason=plugin framesPosted=192 statesReceived=32 lastFps=120 atMs=5343"}
```

窗口 2 秒后自行关闭；后续 `state`/`track` 全部未被消费（`statesReceived` 停在 32）。

### 2. 修复后：同一脚本、同一 bundle，仅替换重建的 exe

```
--- sending lyrics (the offending message) ---
（无 error 行）
--- sending state again: must still be forwarded ---
--- sending track ---
--- sending quit ---
host> {"t":"closed","reason":"plugin"}
host> {"t":"log","level":"info","msg":"host-exit code=0 reason=plugin framesPosted=493 statesReceived=96 lastFps=120 atMs=10025"}

======== RESULT ========
exit code: 0
error lines: 0
stdin pump survived: True
```

- 0 条 error 日志（旧版 1 条 InvalidOperationException）；
- `statesReceived` 从 32 增至 96：`lyrics` 之后的所有 `state` 都被继续消费；
- `quit` 真正送达（`closed,reason=plugin` 由 quit 触发），退出码 0；
- 编译仅剩 4 条原有告警、无新增（该数字来自崩溃机的构建输出，仓库未保存对应构建日志）。

### 3. 现场证据链（崩溃机）

| 证据 | 位置 |
| --- | --- |
| 3 × `Application Hang (1002)` `spw-folia-host.exe` | 事件查看器 / WER `AppHang_spw-folia-host.e_*` |
| `stdin: InvalidOperationException` | `spw-folia.log`（08:51:47.522、08:52:12.866） |
| 退出码 `-805306369`（`0xCFFFFFFF`，WER 终止挂起进程） | `spw-folia.log`（08:52:12.873） |
| `stdin write failed: 管道已结束/管道正在被关闭` | `spw-folia.log`（管道反压后断开） |
| 2 秒自杀延迟与 `exitTimer.Interval = 2000` 一致 | `HostForm.cs`（修复前） |
