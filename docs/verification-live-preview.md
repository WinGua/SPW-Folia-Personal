# 设置页大预览（真实 Folia 渲染器）验证报告 — task-14

日期：2026-10-19 16:3x（Asia/Shanghai）
任务：docs/live-preview-iframe.md 契约实现 + 验收（子帧垫片 / preview.html / stage-web 组装 / probe）。
结论：**PASS**。设置页大预览已在同源 iframe 内跑 Folia 真实动画渲染器；播放推进、暂停冻结（含渲染器 grain 噪声）、恢复推进、无 page error 全部验证通过。

## 1. 交付物与组装结果

| 文件 | 说明 |
| --- | --- |
| `poc/webview/host/PreviewShim.js` | 子帧垫片（classic script，document_start）：FakeEventSource + 合成 clock/audio + `paused`/rAF gate + `__SPW_FOLIA_PREVIEW__` 诊断 |
| `poc/webview/host/Shim.js` | 顶部子帧守卫 `if (window.top !== window) return;`；顶层另清理旧 bundle 遗留的 Service Worker / Cache Storage（见 §5） |
| `packaging/tools/stage-web.mjs` | 复制 `PreviewShim.js → web/_host/preview-shim.js`；生成 `web/preview.html`（在首个 `<script>` 前插入垫片）；复制占位封面到 `web/preview/…` |
| `poc/hook/probe-live-preview.mjs` | 三段帧差探针；默认模式驱动真实设置覆盖层，`--self-test` 模式自注入 iframe 验证垫片 |
| `poc/webview/host/HostForm.cs`、`Overlay.js` | 注入脚本的子帧守卫（Lead 追加要求） |

`node packaging/tools/stage-web.mjs` 输出（`packaging/web-stage-report.json`）：

- webFiles **1877**，webBytes **20,546,706**；settingsFiles 15（settingsBytes 2,280,850）；totalBytes 22,827,556
- `previewHtml: true`，`previewShimCopied: true`，`indexHtmlPatched: true`
- 占位封面：`assets/placeholder_cover-CufMMif3.jpg`、`assets/placeholder_cover-2-BuqqkGqf.jpg`（另复制到 `web/preview/`）
- `_host/preview-shim.js` sha256 `d2721b9f4727a63fff380228b9116dd10c61aab7b4f8397ac3675896428f7a36`
- 宿主 exe（含 Shim.js 子帧守卫/旧 SW 清理，packaging/native）：`spw-folia-host.exe` 117,248 B sha256 `408c9e3531b4eb162006e1331c2ab2d7548f6a82938754cd1baafe1b1fb708f4` → Lead 重打 `.spmod` 时需带上该 exe 与新的 `web/_host/preview-shim.js`。

## 2. 验收判据（最终版）

probe 每轮：播放帧差（S1/S2，间隔 1200 ms）→ 暂停（真实覆盖层「暂停预览」按钮 / self-test 消息）→ 暂停帧差（S3/S4）→ 恢复帧差（S4/S5），并额外做时钟硬判据：

| 判据 | 含义 | 结果 |
| --- | --- | --- |
| `iframePresent` / `iframeCanvases` / `receivedConfig` | 同源 iframe 挂载、渲染器 canvas 存在、收到 config | PASS |
| `iframeTitle` | 子文档标题 `Folia OBS` | PASS |
| `playingMoves` | 播放时 crop 区域有空间位移 | PASS |
| `pausedClockFrozen` | 暂停后 800 ms 内子帧合成 clock `|ΔclockMs| < 10 ms` | PASS（Δ=0） |
| `pausedPlayerStatePaused` | 暂停时子帧 clock 事件 playerState=`PAUSED` | PASS |
| `pausedFreezes` | 可见区暂停帧差 ratio **< 0.01**（或 blockRatio < playing*0.15） | PASS（**0.00000**） |
| `resumedClockAdvances` | 恢复后 clock 推进 > 300 ms | PASS（+1775 / +1783 ms） |
| `resumeMoves` / `noPageErrors` | 恢复有位移、无 page error | PASS |

## 3. 实测数据（干净报告）

### 3.1 默认模式：真实设置覆盖层 + task-15 LivePreview

报告：`tmp-verify/live-preview/probe-report-ui.json`（源 `tmp-verify/live-preview-ui/`）；截图 `s1-playing.png … s5-resumed.png`。

- rect：iframe `x=128.98 y=140.17 w=922.04 h=518.65`；wrapper `[data-spw-live-preview]` `x=204 y=174 w=772 h=451`；**crop = wrapper ∩ iframe** = `(204,174)-(976,625)`
- 暂停/恢复：真实按钮点击成功（`clicked:暂停预览` / `clicked:继续预览`）
- 帧差 ratio（逐像素，阈值 24）：
  - playing **0.35105**（blockRatio 0.6414，meanAbsDiff 40.00）
  - paused **0.00000**（blockRatio 0.0000，meanAbsDiff 0.00）
  - resumed **0.39415**（blockRatio 0.7794，meanAbsDiff 43.16）
- 子帧合成 clock：暂停 `clockMs=5108.4`（PAUSED，两次采样 Δ=0）→ 恢复 `clockMs=6891.7`（PLAYING，Δ=+1783.3 ms）
- exit code 0，无 page error

### 3.2 self-test 模式（不依赖 settings-ui，直接验证垫片）

报告：`tmp-verify/live-preview/probe-report.json`；截图同目录。

- rect：iframe 1920×1080 缩放 0.72 → `108.80,111.20 1382.40×777.60`；wrapper 全屏；crop = 可见区 `(109,111)-(1491,889)`
- 帧差 ratio：playing **0.33223** / paused **0.00000** / resumed **0.53670**
- 子帧 clock：暂停 Δ=0；恢复 Δ=+1775.1 ms
- 全部 12 项检查 PASS，exit code 0

## 4. 修复过程与 crop 口径（含修正前后对比）

1. **crop 误用 iframe rect**：settings-ui 的 iframe 是 1920×1080 内容按 `k=max(w/1920,h/1080)*1.15` 缩放，被 `[data-spw-live-preview]`（overflow-hidden）裁剪；旧 crop 比可见区左右各宽 75 px，把设置窗 dim 遮罩下**仍在播放的主 visualizer** 算进暂停帧差。
   - 修正：crop = wrapper ∩ iframe rect 再乘截图缩放（`report.rects` 记录 iframe/wrapper/visible/crop 四个矩形）。
   - 效果（folia-spec 对照实验）：生产 bundle paused 帧差 0.064 → **0.0089**（可见区 mean 2.47）。
2. **子帧渲染器自身 rAF 未冻结**：垫片的 paused 只停合成 clock/audio，Folia 渲染器自己的 rAF 循环继续重绘 grain/dither，暂停帧差仍有 ~0.9%。
   - 修正：`PreviewShim.js` 在 **document_start（IIFE 顶部，早于任何 Folia 模块）** 包装 `window.requestAnimationFrame`：暂停时把回调排入队列（不调度），恢复时用原生 rAF 重投并清空；垫片自己的合成 tick 用原生 rAF，保证暂停时仍以 ~4 Hz 发 `PAUSED` 冻结时钟。
   - 效果：可见区暂停帧差 0.0089 → **0.00000**；`testRaf` 计数器验证 gate 生效（暂停时 1→1，恢复后 1→98）。
3. **self-test 覆盖层遮挡**：默认 probe 会打开设置覆盖层，其 z-index 高于自注入 wrapper，帧差 crop 内混入覆盖层里仍在播放的预览 → self-test wrapper 提到 `z-index:2147483600`（高于覆盖层）后暂停帧差归零。

## 5. 关键坑：WebView2 profile 里的旧 Service Worker

调试中发现：iframe 导航到 `/preview.html` 时可能拿回**旧版 index.html**（含 `registerSW.js`、无 preview shim），而同一页内 `XMLHttpRequest` 拿到的却是正确的 preview.html。根因是旧 Folia bundle 在同一虚拟主机 origin 注册过的 PWA Service Worker 残留在 WebView2 profile 中，对导航请求做 app-shell 回退。

处理：

- probe 每次运行使用**全新 `--user-data-dir`**（`<out>/_webview2-profile`，运行前删除），保证结果确定；
- 生产宿主 `Shim.js` 在顶层文档 document_start 清理本 origin 的 Service Worker 注册与 Cache Storage（虚拟主机文件不需要 SW）；fps/页面功能验证不受影响；
- 该现象也是“同一 URL fetch 与 iframe 内容不一致”的排查入口，记入本报告备查。

## 6. 复现命令

```bash
cd D:/输出目录/dsh2
node packaging/tools/stage-web.mjs                      # 组装 web/（含 preview.html + preview-shim）
taskkill //F //IM spw-folia-host.exe 2>/dev/null        # 清掉旧宿主实例（会锁 exe）
node poc/hook/probe-live-preview.mjs --out tmp-verify/live-preview-ui   # 默认：真实设置覆盖层
node poc/hook/probe-live-preview.mjs --self-test --out tmp-verify/live-preview  # 垫片自测
```

环境：WebView2 Runtime 150.0.4078.83；窗口 1600×1000（`--force-dsf 1`，仅为让设置窗进入两栏布局）；每次运行全新 WebView2 profile。

## 7. 复验（host early-stdin 修复之后，2026-10-19 16:4x）

宿主 exe：`poc/webview/host/build/spw-folia-host.exe`（117,248 B，sha256 `d0961bb65acc4fb1e4883c71594fbd004054c37bed9dd5a584a7fad81e717542`），`packaging/native/` 同步更新。本次修复与本功能无关（folia-spec 的 `diag-preview-health` 发现早期 stdin 会触发 `post-page: NullReferenceException`），修复后两种 probe 模式全 PASS：

| 模式 | 报告 | playing ratio / block / mean | paused ratio / block / mean | resumed ratio | clock（暂停→恢复） |
| --- | --- | --- | --- | --- | --- |
| 默认（真实设置覆盖层） | `tmp-verify/live-preview-ui-regression/probe-report.json` | 0.36112 / 0.65327 / 42.42 | **0.00000** / 0 / 0.00 | 0.38138 | 暂停 5166.7 ms 冻结，恢复后 +591.7 ms（两样本差） |
| `--self-test` | `tmp-verify/live-preview-selftest-regression2/probe-report.json` | 0.31950 / 0.56935 / 44.08 | **0.00000** / 0 / 0.00 | 0.37203 | pausedClockDelta 0，恢复后 +599.8 ms（两样本差） |

判据健壮性调整：`resumedClockAdvances` 改为**恢复后两次采样（间隔 500 ms）的时钟差 > 300 ms**。原因是冷启动 iframe 可能在收到首份 config 时已处于暂停态，冻结时钟合法地停在 0 附近，此时“paused→resumed”差值很小会产生假失败；`resumedFromPausedDeltaMs` 仍保留在报告里作参考。

早期 stdin 回归：`tmp-verify/early-stdin-test.mjs`（spawn 后 250 ms 即发 hello/settings/lyrics/track/config）→ **0 条 NullReferenceException**、3 次 `post-page-skip reason=not-ready`、ready 514 ms、页面 3 canvases + settings root 已挂载、`closed{reason:"plugin"}` 正常退出。
