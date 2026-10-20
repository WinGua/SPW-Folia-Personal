# spw-folia v0.2.0 — 验证记录：透明窗口样式兼容 + 宿主/桥健壮性

v0.2.0 包含三组改动：

1. **透明窗口样式兼容**（新特性）— 播放页透明（色键）时按样式分类处理：11 种 `native` 样式原样可用；
   `tempera` / `lumiere` / `pendolo` / `still` 在透明期间用「仅发布用的 tuning 覆盖」或作用域 CSS 去掉
   大面积半透明层（用户存储的设置不动，关透明后原样恢复）；`monet`（人像底板）与浅色主题下的
   `lumiere`（94% 暗场）归为 `unsupported`，选中时自动关闭透明背景并回写设置、面板给出提示，
   透明状态下也不能用热键强行打开。透明页里再次选择不兼容样式同样自动关闭。
2. **宿主健壮性** — `PostToPage` 封送 UI 线程（`PostToPage` / `PostCore` 拆分，就绪检查移进 `try`）、
   `StdinLoop` 逐行 `try/catch`、`OnFormClosing` 幂等（`closing` 标志 + 全量 try/catch）、
   `ScheduleExitOnUiThread`、以及 **stdout 非阻塞有界队列**（`JsonStdout`：泵线程 + 8192 行队列，
   队列满丢最旧并在 `host-exit` 行输出 `dropped=`）。这些改动同时包含 v0.1.11 的两项修复，
   v0.1.11 的崩溃现场复现与修复前后对比见 [verification-v0.1.11.md](verification-v0.1.11.md)。
3. **桥写线程生命周期** — PR #3 引入的专职 stdin 写线程在「关窗后再次打开 Folia」时会把旧 writer
   留在 `take()` 上；旧线程一旦写失败会在 `finally` 里置 `stdinBroken = true` 并清空共享队列，
   使第二次打开 Folia 后 `state`/`lyrics` 被静默丢弃。v0.2.0 改为每会话队列 + `stopStdinWriter()`
   （interrupt + join(500)）+ 只有 `writerThread === Thread.currentThread()` 时才改状态。

## 1. 透明窗口样式兼容

### 1.1 真实宿主 + 真实 WebView2 样式探针

`tmp-inspect/compat/` 的探针把构建好的 `settings-ui.js` 注入真实 Folia 播放页，在真实
`spw-folia-host.exe`（WebView2 150.0.4078.83）里以 3200x2000 渲染，逐样式检查透明开关的最终状态、
合成到色键后是否出现洋红像素（`magenta` / `strongMagenta`，色键窗口出现「粉雾」的直接指标）以及中心区
文字像素占比（`textPixelsPct`，去掉底板后歌词是否还在）。报告：`tmp-inspect/compat/report.json`
（2026-10-20 01:02）。

| 样式 | 期望 | 实际 `finalMode` | `modeOk` | 洋红占比 | 文字像素占比 | 截图 |
| --- | --- | --- | --- | --- | --- | --- |
| sonnet | on（native） | on | ✅ | 0.0 / 0.0 | 3.487% | `tmp-inspect/compat/sonnet.png` |
| tempera | on（tuned） | on | ✅ | 0.0 / 0.0 | 0.147% | `tmp-inspect/compat/tempera.png` |
| lumiere | on（tuned） | on | ✅ | 0.0 / 0.0 | 3.393% | `tmp-inspect/compat/lumiere.png` |
| pendolo | on（tuned） | on | ✅ | 0.0 / 0.0 | 1.876% | `tmp-inspect/compat/pendolo.png` |
| still | on（tuned） | on | ✅ | 0.0 / 0.0 | 2.024% | `tmp-inspect/compat/still.png` |
| monet | **off**（unsupported） | off | ✅ | 0.0 / 0.0 | 0.348% | `tmp-inspect/compat/monet.png` |

`monet` 的 `modes` 序列为 `on → off → on → off`：透明下选中该样式 / 该样式下开透明都自动关闭，
且没有洋红残留；所有样式 `settingsInject` / `configSent` / `webviewReady` / `navDone` 均为 `true`。

规则表实现见 `poc/settings-ui/src/model/transparencyCompat.ts:29-85`：`native` = sonnet、classic、cadenza、
partita、fume、tilt、claddagh、cappella、diorama；`tuned` = tempera（`showBlocks:false, postProcessGrain:0,
postProcessVignette:0`）、lumiere（`darkField:0, textOnly:true`）、pendolo（`showCenterGradient:false`）、
still（作用域 CSS 隐藏 `.visualizer-still` 的 radial-gradient 底板）；`unsupported` = monet、浅色主题 lumiere。
覆盖只进入发布的 `visualizerTunings`（`publisher/config.ts` 的 `buildTuningBundle(settings, {transparent})`），
从不写回设置存储。

### 1.2 构建产物回归（16 项布尔断言全过）

`node poc/webview/server/compat-regression.mjs --entry settings-ui.js --out out/`：真实 Folia OBS 页面 +
Shim 形状的桥 stub + 构建好的 `settings-ui.js`（Edge/Playwright 驱动），断言设置面板与页面实际发布行为。
本次发布前复跑（2026-10-20 09:40，`work/verify-0.2.0/compat-regression.json`）：

| 断言 | 结果 |
| --- | --- |
| `temperaPatched` / `lumierePatched` / `pendoloPatched`（配置里带上了透明 tuning 覆盖） | ✅ ✅ ✅ |
| `monetAutoCleared` / `monetPassthroughCleared` / `monetDisabled`（自动关透明 + 关穿透 + 控件禁用） | ✅ |
| `sonnetKeepsTransparent`（native 样式不受影响） | ✅ |
| `stillVignetteHidden` / `stillTextPreserved` / `stillRuleInCss` / `stillOpaqueVignetteVisible` / `stillDatasetFlag` | ✅ |
| `tunedNote` / `unsupportedNote`（「已简化」/「不支持」面板提示） | ✅ |
| `hotkeyRefusedOnMonet` / `hotkeyAllowedOnSonnet`（热键在 unsupported 样式上被拒） | ✅ |

`consoleErrors` 与 `pageErrors` 均为空。截图：`work/verify-0.2.0/compat-regression-panel.png`
（面板提示 + 禁用态）、`work/verify-0.2.0/compat-regression-still-transparent.png`（still 透明后文字保留、
底板消失）。

## 2. 宿主健壮性

### 2.1 stdout 反压：旧宿主冻结 vs 新宿主存活

场景（`work/verify/host-thread-fix.mjs`）：`ready` 后按插件重放顺序发 `state/track/lyrics`，然后**暂停读取
宿主 stdout 6 秒**、期间继续向 stdin 灌 `state`（193 行 / 97 次 eval），再恢复读取、发 `quit`。

| 宿主二进制 | 结果 | 关键数字 |
| --- | --- | --- |
| 旧 v0.1.10（`work/repro-155/pkg-0.1.10/native/spw-folia-host.exe`，128,000 B） | ❌ `hard-timeout`（第 51 s），无 fps、无 `host-exit` | 仅 13 行输出（`work/verify/report-old.json`，09:04） |
| 新 v0.2.0（`poc/webview/host/build/spw-folia-host.exe`） | ✅ `exit 0`，stdin 泵存活 | 反压 `floodMs=6017`，恢复后 `alive=true`、`fpsCount=10`、`closed`+`host-exit code=0`（`work/verify/report-new.json`，09:05） |

根因：v0.1.10 的 `JsonStdout` 每次 `Console.Out.WriteLine` 都在锁内同步写；插件暂停读 stdout 后管道写阻塞，
stdin 读取线程又因逐条 debug 日志被同一把锁卡住 → 宿主整体冻结（用户的「SPW 未响应/闪退」）。v0.2.0 改为
专用泵线程 + 非阻塞入队，任何线程都不会卡在日志上。

### 2.2 终版二进制三连跑（重建后）

`bash poc/webview/host/build.sh` 重建（09:41，130,560 B）后，在同一份 bundle / 同一台机器（WebView2
150.0.4078.83）连续跑三次，全部 PASS：

| 报告 | `lineCount` | `errors` | `fps` | `hostExitLine` | 退出码 |
| --- | --- | --- | --- | --- | --- |
| `work/verify-0.2.0/host-thread-fix.json`（label 0.2.0） | 146 | `[]` | 5 | `code=0 reason=user framesPosted=365 statesReceived=365 lastFps=28 dropped=0 atMs=6396` | 0 |
| `work/verify-0.2.0/host-thread-fix-run2.json`（0.2.0-rerun） | 200 | `[]` | 10 | `code=0 reason=plugin framesPosted=654 statesReceived=653 lastFps=74.7 dropped=0 atMs=11392` | 0 |
| `work/verify-0.2.0/host-thread-fix-final.json`（**0.2.0-final**） | 210 | `[]` | 10 | `code=0 reason=plugin framesPosted=657 statesReceived=657 lastFps=81.3 dropped=0 atMs=11057` | 0 |

终版事件链：`replay-done` → `pause-stdout-end sent=194 evals=97 floodMs=6028` → `after-resume alive=true
fpsCount=10 lastFpsAtMs=10812` → `quit-sent` → `closed` → `host-exit` → `exit code=0`。

### 2.3 stdin 跨线程封送（v0.1.11 修复，v0.2.0 一并发布）

`PostToPage` 现在按需 `SafeBeginInvoke(PostCore)`，`PostCore` 内部才读 `webView.CoreWebView2`；
`StdinLoop` 每行单独 `try/catch`（`log.Error("stdin-line")`），单条坏行不再杀死整个泵。真机
（Windows 11 x64 + SPW 1.19.0 + WebView2 **155.0.4283.62**）修复前后对比、日志时序与事件查看器证据见
[verification-v0.1.11.md](verification-v0.1.11.md)：旧二进制 `lyrics` 后 30 ms 报
`InvalidOperationException: CoreWebView2 can only be accessed from the UI thread.`，`statesReceived` 停在 32、
窗口 2 秒后自关；新二进制 0 条 error、`statesReceived=96`、`quit` 送达、exit 0。

**本机限制**：参考机 WebView2 是 150.0.4078.83，读取跨线程 `CoreWebView2` 属性不抛错，因此本机无法直接
复现该异常；下载 fixed-version 155.0.4283.62 运行时后 WebView2 浏览器进程自身以
`BrowserProcessExited reason=Unexpected` 退出（exit 1、0 帧，`work/repro-155/runs/wv2155-window-1280x800-d0/`），
不能作为该 bug 的判据。因此本机对这项修复的覆盖是：代码审查（独立复审记录
`work/reviews/pr3-review.md`）+ 2.1/2.2 的高负载泵存活/`dropped=0` 压力证据。

## 3. 桥写线程生命周期（重开窗口旧 writer 泄漏）

PR #3 的 `startStdinWriter` 每次 `open()` 都新建 writer，但不回收上一个；`FoliaHostBridge` 实例在窗口关闭后
仍然复用（`bridge.stop()` 只在插件 `onDisable` / `delete` 时调用，`FoliaPlugin.kt:97/119/128`），旧线程可能：

* 停在 `pendingLines.take()` 上，永远等不到行（线程泄漏）；
* 若它写过一行失败，`finally` 会 `stdinBroken = true` 并清空**共享**队列 —— 第二次打开 Folia 后
  `state` / `lyrics` 全部被静默丢弃。

v0.2.0 修复（`FoliaHostBridge.kt`）：

* `pendingLines` 改为 `@Volatile` 的**每会话** `LinkedBlockingQueue<String>?`；
* `startStdinWriter()` 先调 `stopStdinWriter()`：`writerThread = null`、`pendingLines = null`、
  `stdinBroken = true`、`old?.interrupt()`、`join(500)`（捕获 `InterruptedException` 并恢复中断标志）；
* writer 线程的 `finally` 与 `catch` 只在 `writerThread === Thread.currentThread()` 时改
  `stdinBroken` / 清队列（旧线程不可能污染新会话）；
* `cleanup()` 改为 `stopPump(); stopStdinWriter(); droppedLines.getAndSet(0L)`，`stdoutLogLock` 与
  会话队列彻底解耦。

**验证方式**：Kotlin 侧没有单元测试源码集（`spw-folia/src` 只有 `main`），该修复由静态审查 + 独立复审
（`work/reviews/pr3-review.md`）+ 代码路径推理覆盖；宿主级 2.1/2.2 证明写路径在高负载与阻塞场景下不再
卡住、`quit` 一定能送达。独立复审（2026-10-20 09:48）确认：每会话队列 + `finally` 身份守卫已消除 PR #3 的
blocking 回归（B1，关窗后共享队列被旧 writer 抢行）；`interrupt` 不能中断 native pipe 写，旧线程最多多写一行
到**旧**管道，`join(500)` 超时只泄漏一个 daemon 线程，不会污染新会话，poison/interrupt/stop-open 无死锁。

复审同时留下两处 major（F1/F2），已在最终发布物中修掉：

* **F1：`cleanup()` 无会话身份。** 旧 helper 关窗后若滞留（`webView.Dispose` 卡住等），其迟到的 exit watcher
  会把刚重开的新会话 `process`/writer 清掉。现在 `cleanup(reason, expectedProcess)` 只在
  `process === expectedProcess` 时生效；旧会话迟到的 `exited`/`closed` 直接返回，`closed` 也不再触发
  `onClosed` 回调。
* **F2：`cleanup()` 与 `open()` 非互斥。** 现在 `cleanup()` 加 `@Synchronized`，与 `open()`/`stop()` 共用
  生命周期锁（从已持锁的 `open/stop` 调用可重入），迟到清理与新会话建立不会交错。

F1/F2 修复后重建插件（`plugin-dev.spw.folia-0.2.0.spmod` 90,812 B）并重新打包、重跑
`packaging/tools/verify-layout.mjs`（PASS），见 §4。**未覆盖**：真机 SPW「关窗 → 再打开 Folia」反复循环
压力测试（需要真实 SPW 注入环境，发布后列入跟踪项）。

## 4. 版本与构建产物

* 版本号：`spw-folia/build.gradle.kts:15` `version = "0.2.0"`、`:72` `PluginVersion = "0.2.0"`；
  `spw-folia/src/main/kotlin/dev/spw/folia/FoliaPlugin.kt:349` `PLUGIN_VERSION = "0.2.0"`。
* 构建（2026-10-20 09:41；插件在 F1/F2 复审修复后 09:49 重建，宿主/settings island 未变）：

| 产物 | 大小 | sha256 |
| --- | --- | --- |
| `poc/webview/host/build/spw-folia-host.exe` | 130,560 B | `2aa1f6c2284754a59718c5a399f8ee2103444e4f58fb94c539e3fff8ae763ea8` |
| `poc/settings-ui/dist/settings-ui.js` | 1,071,968 B | `eeb8a128359531fa3f1d68d6ce6db5e808c3128f92c5f933e040ae7bae95ad34` |
| `spw-folia/build/libs/plugin-dev.spw.folia-0.2.0.spmod` | 90,812 B | `aeaec79ac2d8199a880979dfc1e7f2c28f19f78bc2be22c36868ad5a43290b48` |

最终发布 `.spmod`：13,149,053 B / 1,941 entries / sha256
`d3bc76163dc1fa5598455b48e5fc4674b5a6f588cca5e84fa9951a72160c2fbb`，打包后
`node packaging/tools/verify-layout.mjs` PASS（`"pass": true`、`consoleErrors: 0`）。完整产物表见
[release-notes-v0.2.0.md](release-notes-v0.2.0.md) 与 [release.md](../release.md) 的 v0.2.0 artifact 段。

## 5. 复现命令

```bash
bash poc/webview/host/build.sh                       # 宿主（csc）
cd poc/settings-ui && pnpm build                     # settings island -> dist/settings-ui.js
cd spw-folia && ./gradlew.bat plugin                 # 插件 jar
node work/verify/host-thread-fix.mjs \
  --exe poc/webview/host/build/spw-folia-host.exe \
  --bundle work/repro-155/pkg-0.1.10/web --pause-ms 6000 \
  --label 0.2.0-final --report work/verify-0.2.0/host-thread-fix-final.json
node poc/webview/server/compat-regression.mjs --entry settings-ui.js --out out/
```

`work/`、`tmp-*` 均被 `.gitignore` 忽略；本文件引用的证据文件属于本机验证材料，不随 `.spmod` 分发。

## 6. 未覆盖 / 已知限制

* 桥 writer 生命周期修复无自动化测试（无 Kotlin 测试源集），且未做真机 SPW 反复开关窗压力测试；
  B1/F1/F2 三项由独立代码复审（`work/reviews/pr3-review.md`）与代码路径推理确认，发布后把真机
  「开→关→再开」循环验收列为跟踪项。
* `compat-regression.mjs` 跑在 Edge（`channel: 'msedge'`）里，不是 SPW 内置 WebView2；页面与 settings bundle
  相同的真实 Folia 产物，另由 §1.1 的真实宿主探针与历史真机验收互补。
* §1.1 的 11 种 `native` 样式分类来自 `transparency.mjs` / `tuned.mjs` / `tuned2.mjs` 的 alpha 探针测量
  （任务记录见这些脚本头部），本次发布门禁只对 6 种代表样式（含 4 种 tuned/unsupported）复跑真机探针。
* fixed-version WebView2 155 在本机会出现 `BrowserProcessExited reason=Unexpected`（§2.3），属环境问题，
  与本版本改动无关。
