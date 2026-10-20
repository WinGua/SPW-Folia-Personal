# spw-folia 运行环境依赖清单与闪退排查

Status: 依赖矩阵已按 **v0.2.0 发布产物** 逐项核对（代码 + 二进制 + 本机实测 + 微软官方文档）。
适用对象：遇到「闪退 / 打不开 / 黑窗」的用户，以及维护者做支持回复。
日期：2026-10-20 · 核对机：Windows 11 x64（build 26300）、WebView2 150.0.4078.83、.NET Framework 4.8.1。

一句话结论：**插件自己不携带浏览器与 .NET，它把渲染交给系统里的 WebView2 Runtime、把窗口交给
.NET Framework 4.8 编写的辅助进程。这两样系统组件任一缺失，都会表现为「用户点了没反应 / 窗口闪一下就消失」。**
另外 v0.1.9 及更早版本有一个必定触发的滚轮崩溃（v0.1.10 已修），v0.1.10 在 WebView2 155+ 上还有一个
歌词重放时的 stdin 泵跨线程崩溃（v0.1.11 起修复，v0.2.0 包含），仍在旧版本上的用户会继续闪退。

---

## 1. 硬依赖（缺失 = 崩溃 / 完全不可用）

| # | 依赖 | 最低要求 | 参考机（已验证可运行） | 缺失时的表现 |
| --- | --- | --- | --- | --- |
| H1 | Windows + 架构 | Windows 10 x64，**1809 (17763) 起**（这是 SPW 自身 MSIX 的 MinVersion）；建议 1903+ | Windows 11 x64 build 26300 | 装不上 SPW / 辅助进程无法运行（x64-only PE） |
| H2 | .NET Framework | **4.8**（`spw-folia-host.exe.config` 的 `supportedRuntime sku=net48`） | 4.8.1（`Release=534296`） | 系统弹「此应用需要安装 .NET Framework 4.8」类对话框，辅助进程起不来 → 用户视角=闪退 |
| H3 | WebView2 Runtime | **Evergreen Runtime，≥ 86.0.616.0**（GA API 下限）；建议 120+ | 150.0.4078.83 | 窗口闪一下消失；辅助进程 **exit code 3** |
| H4 | 随包的 4 个原生文件 | 与 `spw-folia-host.exe` **同目录**：`Microsoft.Web.WebView2.Core.dll`、`Microsoft.Web.WebView2.WinForms.dll`、`WebView2Loader.dll`、`spw-folia-host.exe.config` | 打包在 `.spmod/native/`（5 文件） | 缺托管 dll → `FileNotFoundException` → exit 1；缺/错位 Loader → WebView2 初始化失败 → exit 1 |
| H5 | WebView2Loader 架构 | 必须 **x64**（发布包里就是 x64，`machine=0x8664`） | x64 | 误用 x86/arm64 Loader → `BadImageFormatException` → exit 1 |
| H6 | Salt Player for Windows | **严格 1.19.0**（菜单 hook 目标是该版本 R8 混淆名） | 1.19.0 | 不崩：日志 `unsupported SPW version …; hook not installed`，菜单里没有 Folia |
| H7 | Java 运行时 | **JVM 25**（插件 class 为 Java 25 / major 69） | SPW 自带 JVM 25.0.4.1 | 用户无需另装 Java；低于 25 的 JVM 无法加载插件 |
| H8 | 插件权限 | `class-transform`（钩子，必需）；`library-read`（封面/歌词，可选） | 已授予 class-transform | 缺 class-transform：不崩，吐司提示 + 菜单无 Folia；缺 library-read：封面取不到、仅日志报错 |
| H9 | 可写路径 | 插件安装目录可写（日志、`spw-folia.log`）；`%LOCALAPPDATA%\spw-folia\webview` 可创建/可写（WebView2 用户数据目录） | 27 MB 安装 + 121 MB 缓存 | 插件目录不可写：`spawn failed: …` → 退回 Swing「Folia (fallback)」黑窗；UDF 不可写 → exit 1 |
| H10 | 页面资源完整 | `.spmod/web/index.html` 存在（解包不完整/被杀软删文件） | 1898 个文件 | `bundle has no index.html` → exit 2 |

参考机磁盘现状：插件安装目录 **27 MB**，WebView2 用户数据目录 **121 MB**（首次运行后增长）。
建议给用户留 **≥ 300 MB** 可用空间，并避免把 `%LOCALAPPDATA%` 放到网络盘/同步盘。

---

## 2. 软依赖（缺失 = 降级 / 黑屏，一般不影响进程存活）

| # | 依赖 | 说明 |
| --- | --- | --- |
| S1 | 可用的 GPU / D3D / WebGL | 页面用 WebGL 渲染（bundle 内 18 个 chunk、553 处 `webgl` 引用，含 11 处 `WebGL2`）。辅助进程**没有**传 `--disable-gpu`，也没有软件渲染兜底开关。RDP 会话、虚拟机、很老的显卡驱动下可能黑屏/降级（**未见**因此直接崩溃），建议更新显卡驱动、退出远程桌面后重试。 |
| S2 | 音频设备 | WASAPI 回环采集失败会被吞掉，自动回落合成信号（`wasapi-loopback-failed`），**只是不再有音频响应**，不崩。 |
| S3 | 多显示器 | 全屏窗口固定开在**主屏**（`Screen.PrimaryScreen`）。副屏用户会觉得「窗口没出现」，不是崩溃。 |
| S4 | 网络 | **完全不需要**。页面全部走本地虚拟主机（`https://spw-folia.local/`），发布产物实测 99 个请求全本地、0 外部。 |
| S5 | 管理员权限 | **不需要**（辅助进程 manifest 无 `requestedExecutionLevel`，asInvoker）。 |
| S6 | VC++ 运行库 | **不需要单独装**。辅助进程是纯托管（零 native 导入）；WebView2 Runtime 目录自带 `msvcp140/vcruntime140` 等。 |
| S7 | 代码签名 | 辅助进程 exe **未签名**（WebView2Loader.dll 有微软签名）。极端情况下可能被 AppLocker/SmartScreen/杀软拦（`spawn failed: … error=5`）。 |
| S8 | 内存 | WebView2 + Folia 渲染吃内存，低内存机可能被系统杀进程（WebView2 `OUT_OF_MEMORY`）。 |

---

## 3. 判定方法：退出码 + 日志关键字

辅助进程退出码（`docs/host-app.md` §2）：

| code | 含义 |
| --- | --- |
| 0 | 正常关闭（用户 ESC / 热键 / 插件关窗） |
| 1 | 其它错误：窗口/WebView2 初始化失败、WebView2 浏览器进程崩溃、未处理异常 |
| 2 | 参数错误 / bundle 目录不存在 / 没有 `index.html` |
| 3 | **WebView2 Runtime 未安装**（或无法启动） |
| **-2146232576** | **CLR 激活失败 `0x80131700` (CLR_E_SHIM_RUNTIMELOAD)**：系统弹「This application could not be started」对话框，托管代码一行都没跑（stdout/stderr 全空）。见 §5 案例 5 —— **不是 .NET 没装**，Store/MSIX 渠道下是辅助进程的 `.config` 路径虚拟化问题 |

日志位置（都在插件安装目录 `%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-<ver>\`）：

* `spw-folia.log` — 插件侧：启动、hook、spawn 命令行、**`host process exited code=N`**、`host closed reason=…`
* `spw-folia-host.stdout.log` — 辅助进程协议日志：`webview-ready`、`webview2 runtime=…`、`webview process-failed kind=… reason=…`、`fps`
* `spw-folia-host.stderr.log` — 辅助进程 stderr（正常应为 0 字节）
* `%APPDATA%\Salt Player for Windows\logs.txt` — SPW 宿主侧（插件加载失败、权限异常）

常见关键字对照：

| 日志/现象 | 结论 |
| --- | --- |
| `WebView2 Runtime not found:`（stdout）+ `exited code=3` | 装 WebView2 Runtime |
| 系统弹 .NET Framework 安装提示 / 辅助进程完全没日志 | 装 .NET Framework 4.8 |
| `exited code=-2146232576` + 弹「This application could not be started」+ stdout 空 | MSIX 虚拟路径导致 CLR 找不到 `.config`（案例 5），**重装 .NET 无效** |
| `spawn failed: java.io.IOException: CreateProcess error=…` | 杀软拦截 / 文件缺失 / 目录不可写 |
| `host helper not found` 或 `web bundle not found` | 安装不完整（native/ 或 web/ 缺文件） |
| `bundle has no index.html` + `exited code=2` | web 目录损坏，重装插件 |
| `unsupported SPW version …; hook not installed` | SPW 不是 1.19.0 |
| `CLASS_TRANSFORM not granted; hook not installed` | 未授予 class-transform 权限 |
| `webview process-failed kind=… reason=Unexpected` + `exited code=1` | WebView2 浏览器进程意外退出（已知偶发，见 §5） |
| `helper unavailable, opening Swing fallback window` | 打开的是黑色占位窗，不是真 Folia |
| `cover load failed: … PluginPermissionDeniedException: … 'library-read'` | 缺 library-read 权限（非致命） |

> 注意：当前版本的插件**只把退出码写进日志**，没有把 exit 3 翻译成「请安装 WebView2 Runtime」的
> 提示（`docs/host-app.md` §2 原本要求这样做）。所以用户侧最直观的反馈是「窗口闪一下」，支持时需要
> 让用户把上述三个日志发来。

---

## 4. 环境自检（让用户跑一条 PowerShell）

```powershell
# 1) WebView2 Runtime（两个位置任一 pv 非空/非 0.0.0.0 即可）
Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -Name pv -EA SilentlyContinue |
  Select-Object @{n='WebView2';e={$_.pv}}
Get-ItemProperty 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -Name pv -EA SilentlyContinue |
  Select-Object @{n='WebView2';e={$_.pv}}

# 2) .NET Framework 4.x Release（>=528040 即 4.8；533320/533325/533509 为 4.8.1）
(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release

# 3) 架构与系统
[Environment]::Is64BitOperatingSystem; [Environment]::OSVersion.Version
```

用户侧三步修复：

1. **装 WebView2 Runtime**：<https://developer.microsoft.com/microsoft-edge/webview2/consumer/>
   （Win11 自带，一般不用装；Win10/精简版系统/企业离线机是重灾区）。
2. **装 .NET Framework 4.8**：<https://dotnet.microsoft.com/download/dotnet-framework/net48>（Win10 1903+ 已内置）。
3. **升级到 v0.2.0**：v0.1.9 及更早在「透明背景 + 鼠标穿透」下滚轮向下**必定**崩溃；v0.1.10 在
   WebView2 155+ 上打开 Folia 会因 stdin 泵跨线程访问在 2–3 秒内闪退（见 §5）。
4. 仍然闪退：收集 §3 的三个日志 + `logs.txt`。

---

## 5. 已知真实崩溃案例

1. **v0.1.9 滚轮向下必崩（已修）** — 透明页 + 鼠标穿透时把滚轮消息转给页面，`IntPtr.ToInt32()`
   在 x64 上对 `0xFF880000`（滚轮向下 delta=-120）抛 `OverflowException: 算术运算导致溢出`，
   异常从 `WndProc` 逃出 → WinForms 弹「Microsoft .NET Framework」未处理异常对话框 → 辅助进程退出。
   v0.1.10 改为 `unchecked((int)…ToInt64())` 并注册 `Application.ThreadException` /
   `AppDomain.UnhandledException` 输出协议错误行。**仍在 0.1.9 及更早的用户是最可能的「有些用户会闪退」来源。**
   详见 `docs/verification-v0.1.10.md`、`docs/release-notes-v0.1.10.md`。
2. **v0.1.10 在 WebView2 155+ 的 stdin 泵崩溃（已修）** — 打开 Folia 后歌词重放时，插件 stdin 线程
   直接读 `webView.CoreWebView2` 抛 `InvalidOperationException: CoreWebView2 can only be accessed from
   the UI thread.`，读取线程终止 → 2 秒后窗口自关；同一故障还会让插件管道写阻塞、拖死 SPW UI 线程
   （「未响应」）。旧版 WebView2（如参考机 150.0.4078.83）对跨线程属性读取更宽容，所以只在 155+
   用户机器上必现。v0.1.11 改为线程封送 + 专职写线程，v0.2.0 一并发布；详见
   `docs/verification-v0.1.11.md`、`docs/release-notes-v0.2.0.md`。
3. **WebView2 浏览器进程偶发退出（未修）** — `BrowserProcessExited reason=Unexpected`，
   症状为窗口用着用着消失、日志出现 `webview process-failed` + `closed reason=error` + exit 1。
   发布产物上出现过 1 次、开发期另 1 次，15 分钟压测未复现；当前没有自动重试（属后续任务），
   用户侧处理是重新打开一次。
4. **环境缺失类**（不是代码 bug）：缺 WebView2 Runtime → exit 3；缺 .NET Framework 4.8 →
   .NET 安装提示后退出；这两个占「打不开/闪退」报告的绝大多数。
5. **MSIX 虚拟路径导致 CLR 激活失败（已修，v0.2.1 起）** — **只在 Microsoft Store / MSIX 渠道出现**。
   症状：点 Folia 后系统弹「`spw-folia-host.exe` - This application could not be started」，
   插件日志 `host process exited code=-2146232576`，`spw-folia-host.stdout.log` 为 0 字节；
   但**手动双击同一个 exe 却完全正常**，于是很容易被误判成「.NET Framework 坏了」而反复重装/修复 .NET（无效）。

   根因（CLR 激活日志 `COMPLUS_CLRLoadLogDir` 实测）：

   ```
   Parsing config file: C:\Users\<u>\AppData\Roaming\Salt Player for Windows\...\native\spw-folia-host.exe.config
   Config File (Open). Result:80070003        ← ERROR_PATH_NOT_FOUND
   ERROR: Unable to find a version of the runtime to use.
   ```

   Store 版 SPW 是 MSIX 打包应用，插件数据真实存放在
   `%LOCALAPPDATA%\Packages\Sakawish.SaltPlayerforWindows_<hash>\LocalCache\Roaming\...`，
   而传给子进程的是**虚拟路径** `C:\Users\<u>\AppData\Roaming\Salt Player for Windows\...`（只对带包身份的
   进程存在，真实磁盘上不存在）。.NET 加载器（mscoree）是用原生 NT 路径打开 `<exe>.config` 的，
   **不走 MSIX 文件系统重定向** → 找不到目录 → 判定没有可用运行时 → `0x80131700`。

   修复：插件在 spawn 前把 exe / web / settings / cwd 全部解析成物理路径
   （`FoliaHostBridge.physicalFile()`：`toRealPath()` + `Packages\*\LocalCache\Roaming` 兜底映射）。

   用户侧临时绕过（不想升级插件时）：建一个目录联接让虚拟路径在真实磁盘上可见——

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:APPDATA\Salt Player for Windows" `
     -Target "$env:LOCALAPPDATA\Packages\Sakawish.SaltPlayerforWindows_q65q631pyh094\LocalCache\Roaming\Salt Player for Windows"
   ```

---

## 6. 明确不需要的东西

.NET SDK / JDK / Node / pnpm / Python（仅源码构建需要，见 README「从源码构建」）· VC++ 运行库 ·
管理员权限 · 网络连接 · 单独安装的浏览器（Edge Stable **不能**代替 WebView2 Runtime，微软明确禁止生产应用依赖浏览器）·
Android 模拟器 · Folia 桌面版（bundle 已内置 Folia 0.7.21 网页产物）。

---

## 7. 证据与相关文档

* 宿主程序与退出码：`docs/host-app.md` §2，`poc/webview/host/Program.cs:444/452/489`、`poc/webview/host/HostForm.cs:798/824/887/939`
* WebView2 调用起点与失败分支：`poc/webview/host/HostForm.cs:790-890`、`OnLoad` 在 `:732-752`
* 插件侧 spawn / 退出码消费：`spw-folia/src/main/kotlin/dev/spw/folia/FoliaHostBridge.kt:107-152`、`:266-278`
* 版本与权限 gate：`spw-folia/src/main/kotlin/dev/spw/folia/FoliaPlugin.kt:100-111`、`:348`
* 打包内容与体积：`docs/release.md`、`packaging/size-report.json`
* 许可与不随包分发的组件：`packaging/licenses/THIRD-PARTY.md`
* 微软官方：WebView2 分发（Runtime 检测/安装、不能依赖 Edge Stable）、WebView2 版本（实例化最低 86.0.616.0）、
  .NET Framework 部署指南（4.8 内置于 Win10 1903+）、`supportedRuntime` 元素（sku 高于已装版本时提示安装）
