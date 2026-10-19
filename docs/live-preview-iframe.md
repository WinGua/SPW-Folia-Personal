# 完整预览动画（Live Preview）实施契约 — iframe + OBS surface

目标（用户 m04495）：歌词样式设置页左侧大预览必须是 **Folia 真实动画渲染器**（真视觉、真动效、可暂停/播放），
取代 v0.1.5 的 Ken Burns 静态帧漂移。

## 架构

设置覆盖层（settings-ui.js）由宿主注入到 **顶层文档**，该顶层文档就是 Folia 的 OBS surface：
`https://spw-folia.local/index.html?obs=1&token=spike`（已挂载真实 `VisualizerRenderer`）。

预览 = 在同一顶层文档里放一个**同源 iframe**，加载 bundle 里新增的 `preview.html`（= dist index.html 的副本 + 子帧垫片），
URL：`https://spw-folia.local/preview.html?obs=1&preview=1`。
iframe 内跑 Folia 自己的 `ObsBrowserSourceApp`（真实渲染器），不需要任何 stubs / 不需要重建渲染器图。

数据流：
```
settings-ui (top doc)
   │  postMessage({__spwFoliaPreview:1, kind:'config'|'meta'|'paused'})   ← 同源，直接发
   ▼
iframe (preview.html)  PreviewShim.js（子帧垫片，classic script，在 module 入口前执行）
   │  覆盖 window.EventSource = FakeEventSource；把父页消息转成 SSE 事件
   │  本地 rAF 合成 clock / audio（逐行复刻 useVisPlaygroundPreviewPlayback）
   ▼
ObsBrowserSourceApp → VisualizerRenderer（14 样式全部可用，含 three/pixi 懒加载块）
```

为什么必须 iframe：iframe 内拿不到 WebView2 桥（`chrome.webview` 只在顶层），所以 clock/audio 在子帧本地合成；
config 由父页直传（同源 + `contentWindow.postMessage`），从而**自动镜像设置页的草稿状态**（样式/调参/背景/字体/字幕）。

## 尺寸与缩放（关键，保真度）

Folia 自己的 playground 是「按窗口大小排布，再整体缩放塞进预览框 + 1.15 倍放大裁切」。
OBS surface 只在 >1920 时放大；小 iframe 会排成“小窗口布局”（相对字号不对）。
因此：**iframe 元素固定 1920×1080 CSS px**，再用 CSS transform 缩放并居中裁切：

```
k = max(boxW / 1920, boxH / 1080) * 1.15          // 1.15 = Folia DEFAULT_SAMPLE_ZOOM
iframe { position:absolute; width:1920px; height:1080px; left:50%; top:50%;
         transform: translate(-50%,-50%) scale(k); transform-origin:center;
         pointer-events:none; border:0; }
wrapper { position:absolute; inset:0; overflow:hidden; }
```

这样 iframe 内 `documentElement.clientWidth = 1920` → OBS surface 的 resize 逻辑 `scale = max(1, 1920/1920) = 1`，
排布等同 1080p 全屏播放，视觉与全屏模式一致。

## 消息契约（父 ⇄ 子，同源 postMessage）

所有消息带 `__spwFoliaPreview: 1`。

父 → 子：
| kind | payload | 说明 |
| --- | --- | --- |
| `config` | `ObsBrowserSourceConfig` | 完整渲染配置（复用 `poc/settings-ui/src/publisher/config.ts` 的 `buildConfig`） |
| `meta` | `{ loopDuration: number, startOffset: number }` | 预览循环时长（14.4 / 13.6）与该样式起始偏移（秒） |
| `paused` | `boolean` | 暂停时子帧冻结时间轴（playerState=PAUSED，停 rAF） |

子 → 父：
| kind | payload | 说明 |
| --- | --- | --- |
| `ready` | `{}` | 子帧就绪；子帧在 0/100/300/1000/2000 ms 重试直到收到第一条 `config` |
| `error` | `{ message: string }` | 子帧初始化失败（父页据此回退静态图） |
| `stats` | `{ canvases: number, frames: number }` | 每秒一次，调试/验收用 |

父页在收到 `ready` 后立即发送 `config` + `meta` + `paused`，之后每次设置变更（≤10Hz 节流）重发 `config`。
4s 内未收到 `ready` 或收到 `error` → 预览回退为现有 `StylePreview`（Ken Burns）。

## 子帧垫片 `poc/webview/host/PreviewShim.js`（新增，webview-spike 负责）

classic script，由 `preview.html` 在 `<head>` 里以 `<script src="/_host/preview-shim.js"></script>` 引入
（**必须早于** module 入口；module 是 deferred，classic 先执行）。要求：

1. 幂等：`if (window.__SPW_FOLIA_PREVIEW_SHIM__) return;` 后置位。
2. `window.top === window` 时直接 `return;`（只在子帧生效）。
3. 实现 `FakeEventSource(url)`：`addEventListener(name, fn)` 按事件名记监听；`onopen` 立即（setTimeout 0）；
   `close()`；`readyState` 兼容。**事件对象 `data` 必须是 JSON 字符串**（ObsBrowserSourceApp 用 `JSON.parse(event.data)`）。
4. `window.EventSource = FakeEventSource`（覆盖宿主 Shim 可能已设的值）。
5. 监听 `window.addEventListener('message')`：`event.data.__spwFoliaPreview === 1` 时按 kind 处理；
   `config` → `dispatch('config', payload)`；`meta` → 记录 loopDuration/startOffset 并重置时间轴；
   `paused` → 冻结/恢复 rAF。
6. rAF 循环（未暂停时每帧）：
   - `elapsed = startOffset; elapsed = (elapsed + dt/1000) % loopDuration`
   - `dispatch('clock', { currentTime: elapsed, duration: loopDuration, playerState: 'PLAYING', sentAtMs: Date.now(), playbackRate: 1, lyricOffsetMs: 0 })`
   - `dispatch('audio', { audioPower, bands:{bass,lowMid,mid,vocal,treble}, spectrum: number[64] })`，
     算法逐行复刻 `work/folia/folia-major-main/src/components/visualizer/preview/useVisPlaygroundPreviewPlayback.ts`：
     ```
     wave(offset, speed, floor, amp) = floor + (sin(now*speed + offset) * 0.5 + 0.5) * amp
     audioPower = wave(0.2, 0.0024, 0.16, 0.18)
     bass    = wave(0.9, 0.0032, 0.14, 0.20)
     lowMid  = wave(1.7, 0.0028, 0.12, 0.16)
     mid     = wave(2.6, 0.0023, 0.10, 0.14)
     vocal   = wave(3.4, 0.0038, 0.16, 0.22)
     treble  = wave(4.2, 0.0046, 0.08, 0.14)
     spectrum[i] (64 bin)：ni = i/63
        lowShape = exp(-ni * 2.4)
        harmonic = sin(now*0.0027 + ni*PI*3.4)*0.18 + sin(now*0.0052 + ni*PI*11.5)*0.08
        shimmer  = sin(now*0.0018 + ni*PI*1.2)*0.12
        amp      = clamp(lowShape*0.8 + 0.08 + harmonic + shimmer, 0, 1)
        spectrum[i] = round(amp * 255)
     ```
   - paused 时不发 clock（或发 `playerState:'PAUSED'` + 冻结 currentTime），且停止推进；恢复后从冻结位置继续。
     注意 `resolveObsBrowserSourceClockTime` 对 PLAYING 会按 `(now - sentAtMs)` 外推，因此暂停时必须发 PAUSED。
7. 透传诊断：`window.onerror` / `unhandledrejection` → 父页 `{kind:'error'}`（父页转发到宿主 log）。
8. 暴露 `window.__SPW_FOLIA_PREVIEW__ = { receivedConfig, frames, canvases }` 供验收 eval。

## Bundle 组装 `packaging/tools/stage-web.mjs`（webview-spike 负责）

1. 复制 `poc/webview/host/PreviewShim.js` → `out/_host/preview-shim.js`。
2. 由 `out/index.html` 生成 `out/preview.html`：在 `<head>` 内**第一个 `<script`（或 `</head>`）之前**插入
   `<script src="/_host/preview-shim.js"></script>`；其余内容保持一致（`?obs=1` 会让内联脚本移除 splash）。
3. 把 dist 里的占位封面复制到稳定路径：`assets/placeholder_cover-CufMMif3.jpg` → `out/preview/placeholder_cover.jpg`，
   `assets/placeholder_cover-2-BuqqkGqf.jpg` → `out/preview/placeholder_cover-2.jpg`
   （缺失时用 glob 在 `out/assets/` 里按前缀 `placeholder_cover` 查找；找不到则打印 warning，预览封面退化为无封面）。
4. 报告里加 `previewHtml: true/false`、`previewShimCopied: true/false`。

## 顶层 `Shim.js` 改动（webview-spike 负责）

IIFE 开头加子帧守卫：`if (window.top !== window) return;`（避免宿主把顶层垫片注入 iframe 后与子帧垫片互相干扰）。

## settings-ui 侧（folia-spec 负责）

新增 `poc/settings-ui/src/model/previewSong.ts`：把 `PreviewPlaceholder.ts` 的两首占位歌数据手抄成
`PREVIEW_PLACEHOLDERS`（default: 神文之诗 / 14.4s / placeholder_cover.jpg；reserved: 野芝麻 / 13.6s / placeholder_cover-2.jpg），
行内 `words` 用秒 → `{text, startMs, endMs}`。**不要 import Folia 源码**（会拉渲染器图）。

新增 `poc/settings-ui/src/model/LivePreview.tsx`：
- props `{ paused, config, loopDuration, startOffset, onError? }`（config 由父组件用 `buildConfig` 生成）
- 渲染 `wrapper`（`absolute inset-0 overflow-hidden`，`data-spw-live-preview` 标记）+ iframe（见上尺寸规则）
- iframe `src = location.origin + '/preview.html?obs=1&preview=1'`
- 收到子帧 `ready` 后发 `config`/`meta`/`paused`；config 或 paused 变化时重发（≤10Hz）；4s 无 ready → `onError()`
- `ResizeObserver` 计算 k（`max(w/1920, h/1080) * 1.15`）

改 `Stage.tsx`：大预览内优先渲染 `LivePreview`，失败/超时回退现有 `StylePreview`；暂停按钮同时控制两者。
预览 config 用**占位歌**构造（不是真实曲目）：
`buildConfig({ settings: snapshotFromState(useSettingsStore.getState()), track: previewTrack, theme, subtitleTheme, isDaylight })`，
其中 `previewTrack = { id:'preview', title:'神文之诗', artist:null, album:null, coverUrl: location.origin + '/preview/placeholder_cover.jpg', lyrics: placeholderLines }`；
`theme`/`subtitleTheme` 取实时发布器使用的主题（在 `useConfigPublisher.ts` 里导出 `getLastPublishedTheme()`），
回退 `PREVIEW_THEME`。`loopDuration`/`startOffset` = 占位歌 loop；`startOffset`：fume = 4.0，其余 = 0。

## 验收（webview-spike 更新 `poc/hook/probe-live-preview.mjs`，Lead 执行集成验证）

1. `command open-settings` → eval `document.querySelector('[data-spw-live-preview] iframe').contentDocument.querySelectorAll('canvas').length` > 0；
   且 `contentWindow.__SPW_FOLIA_PREVIEW__.receivedConfig === true`。
2. 播放：间隔 1.2s 两张截图帧差 > 0（同 v0.1.5 判据）。
3. 点击暂停按钮 → 间隔 1.2s 帧差 ≈ 0；再点恢复 → 帧差 > 0。
4. 切样式（改成 tempera）→ 子帧 canvas 数变化 / 画面变化。
5. 0 page error（顶层与子帧）；真实 SPW 内同样流程再验一遍（Lead）。
