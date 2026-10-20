# spw-folia v0.2.0 — 透明窗口样式兼容 + 崩溃/卡死修复

v0.2.0 把两件事合在一起发布：**透明窗口现在能按样式正确显示**（新特性），以及**四条崩溃/卡死路径的修复**
（v0.1.11 两项 + v0.2.0 两项）。如果你用过 v0.1.10 或更早版本，建议直接升级。

## 更新内容

- **透明窗口样式兼容（新特性）** — 透明窗口是色键合成，页面画出的每个半透明像素都会和纯洋红键色混合，
  在真实窗口里变成粉雾。v0.2.0 把 Folia 的 14 种样式按「透明下能否干净显示」分成三级：
  - `native`（11 种：sonnet / classic / cadenza / partita / fume / tilt / claddagh / cappella / diorama 等）
    去掉背景层后只剩不透明字形/线稿，透明下原样可用；
  - `tuned`（tempera / 暗色 lumiere / pendolo / still）在透明期间自动精简其大面积半透明底板 ——
    tempera 关纸纹/颗粒/暗角，lumiere 关暗场只留文字，pendolo 关中心光盘，still 用作用域 CSS 隐藏
    radial-gradient 底板并保留歌词。**覆盖只作用于发布的配置，不写回设置存储**，关掉透明后原样恢复；
  - `unsupported`（monet 的人像底板、浅色主题下的 lumiere 94% 暗场）在选中时自动关闭透明背景并回写
    设置，播放页面板给出提示；透明状态下热键也无法强行开启。
- **修复：关窗后再打开 Folia，歌词/状态被静默丢弃** — 插件 stdin 写线程在窗口关闭后不会回收，
  `FoliaHostBridge` 实例却会被复用；旧写线程停等在队列上，一旦写失败会在 `finally` 里置
  `stdinBroken=true` 并清空共享队列，第二次打开 Folia 后 `state`/`lyrics` 全部丢失。v0.2.0 改为
  「每会话队列 + `stopStdinWriter()`（interrupt + join(500)）+ 仅当前线程可改状态」；`cleanup()` 另外
  带**会话身份校验**（只清理自己那个 helper 进程）并与 `open()`/`stop()` 共用生命周期锁，旧会话迟到的
  退出清理不会误清刚重开的窗口。
- **修复：宿主 stdout 阻塞会拖死 SPW（未响应/闪退）** — v0.1.10 及更早的宿主在每次写日志时同步写
  stdout 并持有锁；插件短暂不读 stdout（或卡住）时管道反压，stdin 读取线程和 UI 线程一起卡死。
  v0.2.0 改为专职泵线程 + 非阻塞有界队列（8192 行，满则丢最旧并在 `host-exit` 行输出 `dropped=`），
  任何线程都不再阻塞在日志上。实测旧宿主在 stdout 暂停 6 秒后第 51 秒仍无响应（hard-timeout），
  新宿主同一场景 0 error、`dropped=0`、正常 `quit` → exit 0。
- **修复（v0.1.11，PR #3）：stdin 泵跨线程访问 WebView2 必崩** — 宿主 `PostToPage` 运行在 stdin 线程上
  直接读 `webView.CoreWebView2`，在 WebView2 155+ 抛
  `InvalidOperationException: CoreWebView2 can only be accessed from the UI thread.`，读取线程终止、
  2 秒后窗口自关（用户看到「打开 Folia 几秒内闪退」）。现在按需封送到 UI 线程（`PostToPage`/`PostCore`），
  `StdinLoop` 每行单独 `try/catch`，单条坏行不再杀死泵。
- **修复（v0.1.11，PR #3）：插件管道写阻塞冻结 SPW** — 旧 `sendLine` 在 `synchronized(this)` 内做阻塞
  `flush()`，宿主不读 stdin 时永久持有生命周期锁，而 `open()` 由 Compose UI 线程调用 → SPW 无响应。
  现在专职写线程 + 容量 256 的有界队列（丢最旧状态行），管道写与生命周期锁彻底解耦。
- **新增运行时依赖文档** — [runtime-requirements.md](../runtime-requirements.md)：WebView2 / .NET Framework 4.8
  依赖矩阵、退出码、用户侧三步排查，以及已知真实崩溃案例。

## 验证

- **宿主加固**（`work/verify/host-thread-fix.mjs`，重建后连跑 3 次）：`exit 0`、`errors=[]`、6 s stdout 暂停
  洪泛中消费 194 行（`floodMs=6013`）、恢复后存活并继续出帧、`quit` → `closed` → exit 0，
  `host-exit ... framesPosted=657 statesReceived=657 lastFps=81.3 dropped=0`。
- **旧宿主对照**：同一场景旧 v0.1.10 二进制 51 s 仍无 fps/无退出（`hard-timeout`，仅 13 行输出）。
- **透明兼容回归**（`poc/webview/server/compat-regression.mjs`，构建产物）：16 项布尔断言全过
  （tuning 覆盖、monet 自动关透明/关穿透、sonnet 保持透明、still CSS 隐藏底板且文字保留、面板提示、
  热键在 monet 被拒/在 sonnet 允许；另有 3 组 tuning 覆盖参数比对），`consoleErrors=[]`、`pageErrors=[]`。
- **真实宿主样式探针**：6 种代表样式在真实 WebView2 里 3200x2000 渲染，合成到色键后洋红像素 **0.0%**
  （不出现粉雾）；`monet` 在透明下选中自动 `off`，其余 `on` 且歌词文字保留。
- **打包布局验收**（`packaging/tools/verify-layout.mjs`）：PASS（真实启动包内宿主，settings/桥/ESC 均正常，
  `consoleErrors=0`）。
- 完整记录见 [verification-v0.2.0.md](verification-v0.2.0.md)（v0.1.11 两项修复的现场证据与修复前后对比见
  [verification-v0.1.11.md](verification-v0.1.11.md)）。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.2.0.spmod` | 13,149,053 B（1941 entries） | `d3bc76163dc1fa5598455b48e5fc4674b5a6f588cca5e84fa9951a72160c2fbb` |
| `spw-folia-0.2.0.spmod.json` | 488 B | `2b8e67d9e573180bc4ffe4ea67b93dee6bd813552c89ec481bcbef5c8956a2f4` |
| `SHA256SUMS.txt` | 88 B | `40f9e7023f57dae3b76e329553c910ed9c7de430cedc85d51c413139ae2bd80d` |

包内构成：插件 classes `plugin-dev.spw.folia-0.2.0.spmod`（90,812 B，sha256
`aeaec79ac2d8199a880979dfc1e7f2c28f19f78bc2be22c36868ad5a43290b48`）＋ native 辅助进程
`spw-folia-host.exe` 130,560 B（sha256 `2aa1f6c2284754a59718c5a399f8ee2103444e4f58fb94c539e3fff8ae763ea8`）
＋ 完整 Folia 0.7.21 web bundle 与设置岛（`settings-ui.js` 1,071,968 B，
sha256 `eeb8a128359531fa3f1d68d6ce6db5e808c3128f92c5f933e040ae7bae95ad34`）＋ 许可证。

## 安装 / 升级

1. 关闭 Salt Player for Windows。
2. 打开 mod 管理器，删除旧版 `spw-folia`，导入 `spw-folia-0.2.0.spmod`。
3. 授予 `class-transform` 与 `library-read` 两项权限。
4. 重启 SPW，`更多 → Folia`。

从 v0.1.10 升级时注意：v0.1.10 在 WebView2 155+ 上打开 Folia 会闪退（v0.1.11 起修复）；v0.1.9 及更早在
「透明背景 + 鼠标穿透」下滚轮向下必崩。系统依赖（WebView2 Runtime / .NET Framework 4.8）见
[runtime-requirements.md](../runtime-requirements.md)。

## 已知限制

- 透明窗口下 `monet` 与浅色主题的 `lumiere` 不可用（样式本体含无法去除的大面积半透明层），
  选中会自动关闭透明背景；`tempera`/`lumiere`(暗色)/`pendolo`/`still` 在透明期间会自动精简，
  视觉与不透明时略有差异。
- 键色透明仍是 `rgb(255,0,255)` 色键方案：页面若恰好绘制该纯色会被挖空（当前主题不会）。
- 仅主屏全屏；多屏选择未实现。
- 桥重开修复暂无真实 SPW「关窗 → 再打开」循环压力测试（跟踪项）；B1 与 `cleanup()` 身份/锁保护
  （F1/F2）已由独立代码复审与宿主级压力验证覆盖，插件代码级实现自洽。
- WebView2 浏览器进程偶发退出（`BrowserProcessExited reason=Unexpected`）仍是已知问题，暂无自动重试；
  用户侧重新打开一次即可。
