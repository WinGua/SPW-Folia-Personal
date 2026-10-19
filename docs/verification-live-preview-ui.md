# 设置页大预览接入真实渲染器 — 验证记录（task-15）

日期：2026-10-19（最终复核：webview-spike 的 PreviewShim rAF gate 与 probe crop 补丁落地后）
范围：`poc/settings-ui/src/model/previewSong.ts`、`LivePreview.tsx`、`Stage.tsx`、`StylePreview.tsx`（保留为 fallback）、`useConfigPublisher.ts`（仅新增导出）；跨仓契约见 `docs/live-preview-iframe.md`。

结论先说：**v0.1.6 起设置页大预览改由同源 iframe 里的真实 Folia 渲染器绘制（v0.1.5 的静态 Ken Burns 帧只作 fallback）。最终验证全部通过** —— 宿主内 iframe 真渲染（3 个 canvas、frames 持续增长）、播放/暂停/恢复/切样式正常；`node poc/hook/probe-live-preview.mjs` **pass=True，11/11 checks PASS**（暂停时 wrapper∩iframe 可见区帧差 **ratio 0.00000 / mean 0**，暂停时钟 Δ=0ms，恢复时钟 +1775ms）；overlay 关闭时子帧被冻结；连续 5 轮开合不重建 iframe；两个占位封面在 iframe 内 fetch 200 且 decode 成功。

---

## 1. 改动清单

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `poc/settings-ui/src/model/previewSong.ts` | 166 | 手抄 Folia `PreviewPlaceholder.ts` 两首占位歌：`default`「神文之诗」loopDuration 14.4、封面 `placeholder_cover.jpg`；`reserved`「野芝麻」loopDuration 13.6、封面 `placeholder_cover-2.jpg`。每行 words 按字均分（复用 publisher 的 fallback 切字逻辑）。导出 `PREVIEW_PLACEHOLDERS`、`DEFAULT_PREVIEW_PLACEHOLDER_ID`、`previewTrackFor(id, coverBaseUrl)`、`previewStartOffsetFor(mode, loopDuration)`（fume = 4.0，其余 0）。 |
| `poc/settings-ui/src/model/LivePreview.tsx` | 227 | 同源 iframe `location.origin + '/preview.html?obs=1&preview=1'`；wrapper `absolute inset-0 overflow-hidden` + `data-spw-live-preview`；iframe 固定 1920×1080 CSS px、`translate(-50%,-50%) scale(k)`、`k = max(w/1920, h/1080) * 1.15`、`pointer-events:none`、`border:0`；`ResizeObserver` 算 k；message 校验 `__spwFoliaPreview===1` + `event.source`；`ready` 后发 `config`/`meta`/`paused`，之后 config ≤10 Hz（100 ms 尾沿）、paused/meta 即时；4 s 无 ready 或收到 `error` → `onError` 回退；overlay `display:none`（hidden）时发 `paused:true` 冻结子帧；卸载清定时器/监听。 |
| `poc/settings-ui/src/model/Stage.tsx` | 122 | 大预览优先 `<LivePreview>`；`onError` → `<StylePreview mode paused/>`（Ken Burns 静态帧，保留）。暂停按钮同时控制两者。config 由 `buildConfig({ settings: snapshotFromState(useSettingsStore.getState()), track: previewTrackFor(...), theme, subtitleTheme, isDaylight })` 构造，theme 取发布器实际使用的 `getLastPublishedTheme()`（回退 `PREVIEW_THEME`），封面 base = `${origin}/preview`。 |
| `poc/settings-ui/src/useConfigPublisher.ts` | 158 | 仅新增 `getLastPublishedTheme()` / `getLastPublishedSubtitleTheme()` 两个导出（记录最近一次发布使用的 theme），现有行为未改。 |
| `poc/settings-ui/src/model/StylePreview.tsx` | 66 | 未删，作为 iframe 缺失/超时的 fallback。 |

没有把 Folia 渲染器 import 进 settings-ui：渲染器只在 `preview.html` 子帧里跑，settings-ui 只发消息。

## 2. 构建产物

```
cd poc/settings-ui && pnpm build
✓ built in ~1.0s
dist/settings-ui.js  1,061,824 B   (v0.1.5 基线约 1.05 MB，+12 KB，无渲染器依赖)
dist/thumbs/*.jpg    14 张样式帧；dist/assets/cacheUsage.worker-*.js（Folia 自带 side worker）
```

CSS 仍由 `inlineCssIntoEntry` 内联进 `settings-ui.js`，宿主只注入一个 `<script>`。产物已由 `packaging/tools/stage-web.mjs` 同步到 `packaging/web/settings/settings-ui.js`（字节一致）；`packaging/web/preview.html` + `packaging/web/_host/preview-shim.js` 就位。

### 2.1 v0.1.5 → v0.1.6 的变化

- **大预览**：v0.1.5 是 `StylePreview`（宿主渲染的静态样式帧 + Ken Burns 轻微推拉）；v0.1.6 换成 `LivePreview` —— 同源 `preview.html` iframe 里跑 Folia 自己的 OBS 页面与真实样式渲染器，随设置实时变化（样式、调参、字体、背景、主题都即时生效），暂停按钮真正冻结画面。
- **数据通路**：settings-ui 用 `buildConfig()` 构造 `ObsBrowserSourceConfig`（与主发布器同一函数），经 `postMessage` 以 `{__spwFoliaPreview:1, kind:'config'|'meta'|'paused'}` 发给子帧；子帧 `PreviewShim.js` 把 config 作为 `config` SSE 事件喂给 Folia 的 `ObsBrowserSourceApp`，用合成时钟/音频驱动。settings-ui 不 import 渲染器代码。
- **fallback 策略**：LivePreview 4 s 内没收到子帧 `ready`，或子帧报 `error` / config 超时，`Stage` 回退到 `StylePreview`（静态帧）并继续可用；下次打开设置页会重新尝试。另有 `paused` 兜底：overlay 关闭时子帧收到 `paused:true`。
- **暂停语义**：`PreviewShim.js` 在 document_start 用 rAF gate 包装 `window.requestAnimationFrame` —— 暂停时回调只排队不调度（canvas 保留最后一帧），恢复时用原生 rAF flush；shim 自己的 tick 用 rawRaf，因此暂停期间仍以 4 Hz 发 PAUSED 冻结时钟。这是「暂停画面完全静止」的实现基础。

## 3. 宿主验证（最终，gate 补丁落地后）

真实 WebView2：`spw-folia-host.exe --bundle packaging/web --window 1600x1000 --force-dsf 1 --settings-dir packaging/web/settings --settings-entry settings-ui.js`；脚本 `poc/settings-ui/scripts/diag-preview-health.mjs`（全新 `--user-data` profile，逐阶段 eval + 截图 + fps 采样）。

| 检查 | 结果 |
| --- | --- |
| iframe 存在 | `[data-spw-live-preview] iframe` 定位成功，`iframeCount=1` |
| 子帧 shim / 渲染 | `__SPW_FOLIA_PREVIEW_SHIM__=true`、`__SPW_FOLIA_PREVIEW__` 存在、`canvases=3`、`frames` 持续增长 |
| config 送达 | `receivedConfig=true`、`ready=true` |
| 暂停 | 点暂停按钮后 `paused=true`；画面完全静止（见 §4） |
| 恢复 | 再点 → `paused=false`，时钟 +1775 ms，画面继续动 |
| 切样式 | 点「凝彩」→ 大预览立即变为 tempera 真实渲染（截图 `poc/webview/host/out/diag-preview-health/tempera-open.png`），右栏同步 TemperaSettingsPanel，`liveFailed=false` |
| 快速开合 | 连续 5 轮 open/close：`iframeCount` 恒为 1、`ready` 恒 true、标记后的 iframe 元素跨开关保持同一 DOM 节点（`sameIframe=true`），无重建/泄漏 |
| 页面错误 | 0（仅宿主启动期 2 条 `post-page` NRE，见 §8） |

截图：`poc/webview/host/out/live-preview-window.png`（大预览为真实渲染帧）、`poc/webview/host/out/diag-preview-health/tempera-open.png`（切样式后）。

## 4. probe 最终结果（rAF gate + crop 修复后）

命令：`node poc/hook/probe-live-preview.mjs`（默认模式，每次全新 `--user-data-dir`；报告 `tmp-verify/live-preview/probe-report.json`）。

```
pass = True
checks: iframePresent, iframeCanvases, receivedConfig, iframeTitle,
        pausedClockFrozen, pausedPlayerStatePaused, resumedClockAdvances,
        playingMoves, pausedFreezes, resumeMoves, noPageErrors   → 11/11 true
pausedClockDeltaMs = 0        resumedClockDeltaMs = 1775.1
frameDiffs.playing  ratio 0.3322  meanAbsDiff 44.53
frameDiffs.paused   ratio 0.0000  meanAbsDiff 0.00   blockRatio 0.0000
frameDiffs.resumed  ratio 0.5367  meanAbsDiff 60.52
crop = wrapper[data-spw-live-preview] ∩ iframe rect = (204,174) 772×451
```

「暂停完全冻结」在本机独立复现（`scripts/diag-pause-freeze.mjs --bundle packaging/web --profile-tag profile-final`）：可见区（204,174,772×451，87 236 采样点）paused 帧差 **ratio 0 / mean 0.00**；iframe rect 全框（922×519）仍有 0.0547，因为框内有 75 px 两侧是 dim 遮罩下**仍在播放的主 visualizer** —— 正是 probe 必须取 wrapper∩iframe 的原因（生产 bundle、未修 shim 时该可见区为 0.0089 / mean 2.47）。

## 5. 根因与受控实验（历史，已修复）

两处跨文件问题，均非 settings-ui 代码：

1. **probe 裁剪框包含主 visualizer**：iframe 是 1920×1080 按 `k=max(772/1920, 451/1080)*1.15≈0.48` 缩放，可见区被 wrapper `overflow-hidden` 裁到 772×451；crop 用 iframe rect 会比可见区左右各宽 ~75 px，那两条是 dim 遮罩 + 底下仍在播放的 Folia 主 visualizer。probe 已改为 wrapper∩iframe。
2. **子帧渲染器自身 rAF 未冻结**：旧 shim 暂停只停时钟/音频，Folia 渲染器/Pixi ticker 的 rAF 循环继续重绘 dither/grain。对照实验（可见区 paused 帧差 ratio / mean）：生产 shim 0.0089 / 2.47；paused 之后才把子帧 rAF 换 no-op 0.0308 / 1.75（无效）；向子帧 post `staticMode:true` config 0.1108 / 19.7（触发重建，更糟）；**document_start 装 rAF gate + applyPaused 冻结/恢复 → 0.0000 / 0.0000**。

最终 `poc/webview/host/PreviewShim.js` 在 IIFE 顶部（早于 Folia 模块）装 gate：`window.requestAnimationFrame` 暂停时入队、恢复时原生 flush；shim 自己的 tick 用 rawRaf 保持 4 Hz PAUSED 时钟。`packaging/web/_host/preview-shim.js` 已同步。

## 6. 健康检查：iframe 复用 / 占位封面 / 性能

数据来自 `scripts/diag-preview-health.mjs`（报告 `poc/webview/host/out/diag-preview-health/report.json`，按阶段：A 关闭 / B 打开（sonnet）/ C 切 tempera / D 关闭 / E 5 轮开合）。

| 项目 | 结果 |
| --- | --- |
| iframe 复用 | 5+ 轮开关每次 `iframeCount=1`；打标记后跨开关同一元素（`sameIframe=true`）；无 iframe 泄漏 |
| overlay 关闭冻结 | 关闭时子帧 `paused=true`；画面帧差 0（gate 生效后 rAF 停），不再空转渲染 |
| 占位封面 | iframe 内 `fetch('/preview/placeholder_cover.jpg')` **200**、`Image` decode ok 1244×1236；`placeholder_cover-2.jpg` **200**、decode ok 1254×1254（封面取色可用） |
| 宿主 fps | A 关闭 110.0（n=5）；B 打开 sonnet 112.2（n=6）；C 切 tempera 84.0（n=5，min 61.5）；D 关闭 108.5；E 开合期 91.7 |
| 内存 | 关闭段 heap 峰值 ~51 MB → 打开 sonnet 段 ~120 MB（<2.5 倍） |
| canvases | 3（主 visualizer + 大预览子帧 + 背景层） |

说明：fps 是宿主主页面 rAF 采样；大预览为 1920×1080 iframe 缩放渲染，常驻开销 **≈+70 MB heap**（sonnet），轻量样式（如 still）明显更低；重样式（tempera/sonnet 带后处理）会拉低 fps（本例 tempera 段 84）。overlay 关闭后帧差归零，仅保留子帧 iframe 与 Folia 页面自身的常驻内存。

## 7. 复跑命令

```bash
# 构建 + 同步到打包树
cd poc/settings-ui && pnpm build
cd ../.. && node packaging/tools/stage-web.mjs

# 宿主内联验证（真实 WebView2）
node poc/settings-ui/scripts/diag-preview-health.mjs            # 阶段化生命周期/封面/fps 报告
node poc/settings-ui/scripts/diag-pause-freeze.mjs --bundle packaging/web --profile-tag profile-final
node poc/settings-ui/scripts/diag-host-preview.mjs --fresh

# Lead 的 probe（自动用全新 user-data）
node poc/hook/probe-live-preview.mjs
node poc/hook/probe-live-preview.mjs --self-test

# 注意：WebView2 profile 残留旧 Folia PWA Service Worker 会让 /preview.html 拿回旧 index.html，
# 本地复跑一律用全新 --user-data-dir，不要复用旧 profile。
```

## 8. 已知限制与注意

- 大预览是 1920×1080 iframe 再缩放（与 VisPlayground 的 1.15 倍裁切一致），首帧就绪约 0.6–1.2 s；4 s 未 ready 回退静态帧。
- overlay 关闭（`display:none`）时子帧被 `paused:true` + rAF gate 完全冻结，避免隐藏 1080p 渲染器空转。
- 占位歌封面走 `/preview/placeholder_cover*.jpg`（由 stage-web 复制），不依赖网络。
- 宿主启动期噪声（已修复）：旧宿主在 WebView2 ready 之前收到 stdin `hello`/`settings` 会打 2 条 `post-page: NullReferenceException`（无害）。webview-spike 已修 `HostForm.PostToPage`（未就绪时记 debug `post-page-skip reason=not-ready` 后返回；`lyrics`/`track` 增加缓存并在导航完成后回放），新宿主 exe sha256 `d0961bb6…`；复跑 `diag-preview-health.mjs`（300 ms 早发 hello）后 `errors=[]`，`iframeCount=1` / `sameIframe=true` / 切 tempera 均正常。
