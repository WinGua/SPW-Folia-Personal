# 注入式设置 UI 实现说明（task-5 交付）

> 状态：v1 完成并可注入真实 Folia 页面运行（WebView2 宿主实测）。
> 产物：`poc/settings-ui/dist/settings-ui.js`（单文件、CSS 内联）+ `dist/thumbs/*.jpg`（14 张真实渲染帧）。
> 参考规格：`docs/folia-spec/settings-ui.md`（1:1 复刻依据）、`docs/protocol.md` §3–§5/§7.5（桥/配置/chrome 契约）。
> 上游：Folia v0.7.21（AGPL-3.0），`work/folia/folia-major-main`。

## 0. 结论

- **不是清洁室重写**：设置窗口直接复用 Folia 自己的 React 组件（`StudioWindow` / kit / `VisPlaygroundSettingsPanel` / 13 个样式设置面板 / 背景卡片 / zh-CN 文案），Vite 用别名 `@/` 指向 Folia 源码，只有一个 ~240 行的适配层（store、bridge、publisher、Stage 预览、14 个 registry entry 壳）。
- 在真实宿主里验证通过：注入后 0 页面错误，3320×2000 @DSF1.8 全屏下窗口为两栏布局（见 §8 证据）。
- §7.5 chrome 契约已实现并实测：`__SPW_FOLIA__.ui` 三个方法、⚙ 按钮（鼠标静止 2.5s 淡出）、覆盖层打开时 capture 阶段吞掉 ESC、关闭时 ESC 交还宿主。
- 差异（§7）集中在两类：**没有 electron/Node 能力（上传类控件降级）** 与 **预览用静态真实帧代替实时组件渲染**；视觉与文案与 Folia 一致。

## 1. 架构

```text
Folia dist/index.html（真实播放页，OBS 模式）
  ├─ Shim.js            ← webview-spike 提供：__SPW_FOLIA__ 桥 + 事件 + pushConfig
  └─ settings-ui.js     ← 本 bundle（宿主注入；CSS 已内联进 JS，仅一个 <script>）
        └─ React root → <App/>
              ├─ ⚙ chrome 按钮（overlay 关闭时可见）
              ├─ StudioWindow（Folia 原组件：1240×780 窗口、dim/blur 背板、header）
              │    ├─ Stage（预览帧 + 暂停钮 + 样式 14 PictureGrid）
              │    └─ VisPlaygroundSettingsPanel（Folia 原组件：4 个 tab + 默认重置）
              ├─ zustand store（model/settings.ts）：唯一设置真源
              ├─ bridge.ts：__SPW_FOLIA__ 适配 + settings 往返 + __SPW_FOLIA__.ui
              └─ useConfigPublisher → publisher/config.ts → pushConfig（≤10Hz、去重）
```

没有 iframe、没有第二个 WebView2、没有 HTTP 请求：bundle 通过宿主虚拟主机 `https://spw-folia-settings.local/` 注入，运行在 Folia 页面自己的 JS 上下文里。

## 2. 构建与注入

```bash
cd poc/settings-ui
npm install          # 或 pnpm install
npm run build        # = vite build，产物在 dist/
```

- 产物：`dist/settings-ui.js`（~1.19 MB，含内联 CSS 与全部 React 组件）、`dist/thumbs/`（14×jpg，由 `public/thumbs` 原样拷贝）、`dist/assets/cacheUsage.worker-*.js`（Folia 侧 worker chunk，浏览器按需加载，可忽略）。
- 入口配置（`vite.config.ts`）：`base: './'`、`rollupOptions.input.settings = src/main.tsx`、`entryFileNames: 'settings-ui.js'`、`cssCodeSplit: false`、`inlineCssIntoEntry()` 插件把 CSS 合并后以 `<style data-spw-settings-ui-css>` 注入，保证宿主只加一个 script 标签也能带样式。
- 宿主注入（webview-spike 的实现）：
  ```bash
  spw-folia-host.exe --bundle <folia-dist> \
      --settings-dir D:\输出目录\dsh2\poc\settings-ui\dist \
      --settings-entry settings-ui.js
  ```
  宿主把该目录映射为 `https://spw-folia-settings.local/`，在 Shim.js 之后注入 `<script type="module" src="…/settings-ui.js">`。
- 开发：`npm run dev` → `http://localhost:18090/dev.html`（假桥，窗口默认打开，便于截图/调试）；`index.html` 是同一 bundle 的注入入口壳。
- 脚本：`scripts/shot.mjs`（dev 4 tab + chrome 截图）、`scripts/host-inject.mjs`（真实宿主注入 + 截图；`--fullscreen` / `--no-open` / `--force-dsf` 可选）、`scripts/host-ui-check.mjs`（§7.5 契约实测）、`scripts/check-reset.mjs`（默认重置检查）。

### DSF / 视口注意

- 生产全屏：3200×2000@DSF1.8 机器的 CSS 视口约 **1778×1111**（>1024），Folia `StudioWindow` 的 `lg:` 两栏布局成立，与截图 1 一致。
- 1600×1000 窗口 @DSF1.8 的 CSS 视口只有 888×555，会退化成单栏——**这是 Folia 自身的响应式行为**，不是 bug。调试截屏可用 `--force-dsf 1`（仅 smoke test；生产不要强制）。
- 页面无 `devicePixelRatio` 特判；视觉器本身按 Folia 的 DPR 逻辑渲染。

## 3. 复用 vs 重写 vs 桩（Lead 要求的清单）

### 3.1 直接复用（未改一行 Folia 源码）

| 复用项 | 路径（相对 `work/folia/folia-major-main/`） |
| --- | --- |
| 窗口骨架 + dim/blur + header + 两栏 grid | `src/components/shared/StudioWindow.tsx`（含 `StudioColumnBody`、`settingsTokens()`） |
| 设置控件 kit（Group/Row/Slider/Toggle/Tabs/Segmented/PictureGrid/Select/Button/Reveal/Value/Tooltip…） | `src/components/modal/settings/kit/*` |
| 设置面板（4 tab、默认重置、样式面板装配） | `src/components/visualizer/window/VisPlaygroundSettingsPanel.tsx` |
| 行组件与格式化 `percent()`/`times()`、SliderRow 拖动提交语义 | `src/components/visualizer/panelRows.tsx` |
| 智能动感模式卡片 | `src/components/visualizer/SmartBeatSettingsCard.tsx` |
| 动感效果组（推镜裂光/水镜涟漪/仿真鼓面） | `src/components/visualizer/BeatEffectsGroup.tsx` + `src/services/beatFx/beatEffects.ts` |
| 13 个样式设置面板 | `settingsPanels.tsx`（classic/partita/fume/cappella/tilt/diorama/claddagh）+ `sonnet/`、`tempera/`、`lumiere/`、`monet/`、`pendolo/`（cadenza/still 无面板 → 空态“这个样式没有参数”） |
| 背景设置卡片（通用/隐现/莫奈/漫游/空） | `src/components/visualizer/backgrounds/{common,latent,monet,nomand,sora}/*SettingsCard.tsx` |
| 全部默认值（tuning、smartBeat、背景 tuning、阈值） | `src/types.ts` 的 `DEFAULT_*_TUNING` / `DEFAULT_SMART_BEAT_SETTINGS` 等 |
| 中文文案 | `src/i18n/locales/zh-CN.ts`（纯数据，直接进 i18next resources） |
| 字体栈/字重/预览文案 | `src/utils/fontStacks.ts`、`panelRows.tsx`、`PreviewPlaceholder` 文案键 |

### 3.2 本工程重写（适配层，~240 行）

- `src/model/settings.ts`：zustand store（Folia 持久化层替换为内存 + 桥），字段/默认值镜像 Folia 与 `packaging/testdata/default-settings.json`。
- `src/model/styles.tsx`：14 个样式 entry 壳（`mode/order/labelKey/labelFallback/thumb/renderSettingsPanel/beatEffects/ownFontSizeNoticeKey`），顺序与 `registry.order` 一致 → 2×7 网格。
- `src/model/Stage.tsx` / `StylePreview.tsx`：大预览（真实帧 `<img>` + 暂停钮）+ 样式货架 PictureGrid（16:10 tile、选中环、名称）。
- `src/model/theme.ts` / `assetBase.ts`：预览主题（深色 demo 主题）、`--text-primary`、控制卡底色、range thumb class、字体/字号/字重选项数组。
- `src/bridge.ts`：`__SPW_FOLIA__` 契约适配、假桥、settings 往返（getSettings/`settings` 事件/节流 setSettings）、`__SPW_FOLIA_UI__` 与 `__SPW_FOLIA__.ui`、ESC/键盘动作。
- `src/publisher/config.ts` + `deriveTheme.ts` + `useConfigPublisher.ts`：页面侧构建 `ObsBrowserSourceConfig` 并 `pushConfig`（见 §6）。
- `src/mount.tsx`：在 `body` 上创建 `#spw-settings-ui-root`（`position:fixed; inset:0; z-index:2147483000; pointer-events:none`），React root 挂进去；设置 overlay 打开时才接管 `pointer-events`。

### 3.3 桩模块（`src/stubs/`，按 Folia 源码形状实现、只实现被导入的 API）

| 桩 | 被谁导入 | 行为 |
| --- | --- | --- |
| `useVisualizerSettingsStore` | SmartBeatSettingsCard / BeatEffectsGroup | 转发到本地 store（`smartBeat`、`handleSetSmartBeat`），保证两个原卡片零改动可用 |
| `modelAvailability` | BeatEffectsGroup | `modelsPresent()` 返回 `{beat_this:false, htdemucs:false, htdemucs_gpu:false}`；订阅为 no-op（webview 里没有模型文件，等价于 Folia 缺模型时的降级表现） |
| `useSmartBeatAvailability` | SmartBeatSettingsCard | 返回 `'ready'`（截图 1 是桌面版开着模型的形态；注：网页内实际不跑模型，见 §7） |
| `usePlayerChromeSettingsStore` | VisPlaygroundSettingsPanel（原生模糊开关） | `{enablePlayerPageNativeBlur:false, playerChromeVisibilityMode:'auto'}` |
| `useVisualizerAssetStore` | monet/cappella 面板、（tempera 图层面板） | 空资产包（上传能力降级） |
| `useStatusMessageStore` | tempera 图层面板 | 无消息 |
| `backgrounds/registry` | 背景 tab | 6 个内置背景 entry 壳（common/monet/nomand/latent/url/sora），`renderSettingsPanel` 直接渲染 Folia 真卡片；`BackgroundPicture` 用 Folia glyph fallback（深色卡片 + 模式字形） |
| `preview/BackgroundPicture` | 背景 tab | 上述占位的绘制函数 |
| `folium{Visualizers,Tunings,Backgrounds,Runtime,MissingEntries}` | 设置面板的 mod 扩展点 | 空 registry（无 Folium mod） |
| `localMetadataWorkerClient`, `lyrics/workerClient`, `lyrics/parserCore`, `services/db`, `localCoverAssetService`, `localMusicService` | tempera/monet 面板的图片上传链路 | no-op（切断 worker/IndexedDB/music-metadata 依赖，避免把 Electron 侧能力带进 bundle） |
| `temperaImageArchive`, `TemperaImageLayerDialog` | tempera 面板 | 面板可渲染；添加图片弹出的是空实现（见 §7） |

> 说明：全部桩都按**被导入的真实导出签名**实现（例如 `modelsPresent` 是真函数而不是对象、`temperaImageArchive` 导出同名 class 与函数），否则 React/Three 侧会在运行时炸掉。

## 4. 设置树 schema（v1，与 `packaging/testdata/default-settings.json` 对齐）

`SettingsSnapshot`（`src/model/settings.ts:283`）是 UI 与宿主之间持久化的唯一结构，字段名 = Folia 存储键：

```jsonc
{
  "version": 1,
  "styleId": "sonnet",                 // visualizerMode；14 个之一
  "smartBeat": {                       // 必须始终是对象；写成 true 会让面板崩（smartBeat.effects[...]）
    "enabled": true,
    "effects": {}                      // { "<effectId>": { "on": true, "strength": 1.0 } }
  },
  "styleTunings": { "<mode>": { /* 该样式 tuning 全量默认值 + 改动 */ } },
  "backgroundMode": "latent",          // common|monet|nomand|latent|url|sora
  "backgroundTunings": { "monet": {}, "nomand": {}, "latent": {}, "sora": {} },
  "commonBackground": { "opacity": 0.75, "useCoverColorBg": false, "disableVignette": false, "disableGeometricBackground": false },
  "appearance": { "fontStyle": "sans", "fontScale": 1, "fontWeight": null, "visualizerOpacity": 1, "customFontFamily": null },
  "subtitle": {
    "hideTranslationSubtitle": false,
    "subtitleContentMode": "translation",   // translation|romanization|both|none
    "subtitleOverlayOpacity": 0.6,
    "subtitleOverlayBackground": true,
    "subtitleUpcomingLyricsBlur": true,
    "showHarmonySubtitle": true,
    "harmonySubtitleBackground": true,
    "subtitleFontInheritsLyrics": true,
    "subtitleFontStyle": "sans",
    "subtitleFontWeight": null,
    "subtitleFontScale": 1
  },
  "previewPlaceholderId": "default",    // default|reserved（预览示例歌词）
  "lyricMotion": 0.8,                  // 0.5–1.2（v1 树已有；本窗口暂无控件，见 §7）
  "textureResolution": 1.5             // 0.5–4.0，0.25 步进（样式面板内另有 per-style 同名值）
}
```

范围与语义（面板内实际控件）：

| 键 | 范围 / 步进 | 控件位置 |
| --- | --- | --- |
| `textureResolution`（sonnet/tempera/lumiere tuning 内） | 0.5–4.0，step 0.25，`times` 格式 | 渲染质量 → 纹理分辨率 |
| `cameraIntensity` / `textMomentum`（`typographyMotion`/`glyphMotion`） | 0–2，step 0.05，`times` | 动态与构图 |
| `smartBeat.effects[id].strength` | 0–2，step 0.05，`times`，默认 1 | 动感效果 → 强度 |
| `appearance.fontScale` / `subtitle.subtitleFontScale` | 0.85–1.4，step 0.05，`percent` | 字体/字幕 tab |
| `appearance.fontWeight` / `subtitle.subtitleFontWeight` | 100–900，step 10（null = 自动） | 字体/字幕 tab |
| `appearance.visualizerOpacity` / `subtitleOverlayOpacity` | 0.2–1，step 0.05，`percent` | 字体/字幕 tab |
| `lyricMotion` | 0.5–1.2 | v1 树字段，窗口暂无控件（后续接入全局动感滑杆） |

- 未知键透传：`applySnapshot` 只覆盖已知字段（`snapshot.styleTunings` 浅合并），插件侧未来加键不会丢。
- 远端写入：`bridge.on('settings')`/`getSettings()` → `applySnapshot`；本地改动 → 节流 `setSettings(snapshot)`（≤10Hz，值未变不发）。
- `reset` 语义与 Folia 一致：每个 tab 的“默认”按钮重置该 tab 范围内的一切（样式 tuning → `DEFAULT_*_TUNING`；字体/字幕 → Folia 默认值；背景 → 该背景 tuning 默认值），无内容可重置时按钮 disabled。

## 5. 元数据（tuning）与样式面板

- 样式面板拿到的 `settings` 是 Folia 的 `VisualizerTuningSettings` 袋：`{ sonnetTuning, temperaTuning, …, latentBackgroundTuning, monetBackgroundTuning, nomandBackgroundTuning, soraBackgroundTuning, smartBeat }`（由 `selectTuningSettings` 从快照的 `styleTunings`/`backgroundTunings` 组装）。
- `styleDraft = { tuning: styleTunings[styleId], change: setStyleTuning, reset: resetStyleTuning }`，与 Folia `useTuningDrafts` 的 `StyleDraft` 接口一致；拖动滑杆时 `onSliderPointerDown/Commit` 交给面板自己的提交逻辑（`panelRows.SliderRow` 只在 release 时提交）。
- 每个样式的默认值全部来自 `Folia src/types.ts`，见 `docs/folia-spec/tunings.md`；本工程 `model/settings.ts:STYLE_TUNING_DEFAULTS` 直接引用同一批常量。

## 6. 配置发布器（publisher）

文件：`src/publisher/config.ts`、`src/publisher/deriveTheme.ts`、`src/useConfigPublisher.ts`。

- 输入：本地 store 快照、`__SPW_FOLIA__.inputs.track/lyrics/state`（事件增量也在 `bridge.on('track'|'lyrics'|'state')` 里收）、`state` 的播放状态用于时钟换算、主题（封面派生，见下）。
- 输出：`ObsBrowserSourceConfig`（Folia `src/types/obsBrowserSource.ts:37-101`），经 `__SPW_FOLIA__.pushConfig(config)` → 宿主直接派发 Folia 的 `config` 事件，视觉器即时更新，不重载页面。**页面侧构建、宿主只转发**（protocol §4）。
- 字段映射（`publisher/config.ts:buildConfig`）：
  - `activePlaybackContext:'main'`、`stageSource:null`、`hasTrack`、`song{id,name}|null`、`songArtist/songAlbum/coverUrl`、`lyrics`（Folia `LyricData`）、`theme`/`subtitleTheme`、`isDaylight`、`seed`（曲目 id 兜底）。
  - `visualizerMode` ← `styleId`；`visualizerTunings` ← 除 `still` 外全部 `styleTunings`（渲染器按 `visualizerTunings[mode]` 应用）。
  - `background` ← `backgroundMode` + `commonBackground` + 各背景 tuning 合并默认值（结构同 Folia `VisualizerBackgroundConfig`）。
  - 外观：`lyricsFontScale`/`subtitleFontScale`（clamp 0.85–1.4）、`visualizerOpacity`/`subtitleOverlayOpacity`（clamp 0.2–1）、`staticMode:false`、`hideTranslationSubtitle`、`showSubtitleTranslation = !hide && contentMode!=='none'`、`subtitleContentMode`、`subtitleOverlayBackground` 等。
  - `updatedAt`：每次推送加时间戳；**去重签名**用去掉 `updatedAt` 的 JSON，签名不变不推。
- 歌词：插件给的每行 `{startMs,endMs,main,sub?,romanization?,id?,words?}` → Folia `Line{words,startTime,endTime,fullText,translation}`；没有逐字时间时按字符均分回退（视觉器逐字样式依赖 `words`）。
- 节流：`CONFIG_MIN_INTERVAL_MS=100`（≤10Hz），拖动过程中合并，释放后由 `flush()` 立即推一次；窗口/曲目变化 0.35s 跳变阈值与 Folia `useObsBrowserSourcePublisher` 一致（时钟插值仍由 Shim/宿主负责）。
- 主题派生（`deriveTheme.ts`）：封面 URL → `48×48` canvas 采样 → 像素均值做 `backgroundColor`/`primaryColor`、最饱和桶做 `accentColor`，亮度阈值（`luminance`）决定 `isDaylight` 与文字色；无封面/加载失败回退深色 demo 主题 `#09090b / #f4f4f5 / #71717a`。这是“页面内派生”，与 Folia 桌面版的取色链路同职责（宿主只给 bytes，见 protocol §4）。
- 兼容：下游仍兼容 v1 的宿主直推 `config`（webview-spike 的 `--demo` 路径），本 publisher 只负责 settings 驱动的 v2 路径；两者产出同一 `ObsBrowserSourceConfig` 形状。

## 7. 与 Folia 原版的差异（需在验收时知晓）

1. **预览是真实宿主渲染帧**（`poc/webview/host` 全屏运行 Folia dist 截屏，按 16:10 裁切 1440×900 JPEG q82），不是 Folia 的实时 `preview/LyricStylePicture` 小渲染；换样式/调参时大图与 14 格货架不会跟着实时重绘（Folia 会）。这是性能与依赖取舍，视觉上等价于截图 1。
2. **智能动感模式默认 ON**：与 `packaging/testdata/default-settings.json` 一致，也与截图 1 一致；Folia 应用自身的 stored default 是 `false`（`types.ts:609`），本工程按 v1 树 + 截图取 ON。
3. **模型/播放能力降级**：`useSmartBeatAvailability()` 桩返回 `'ready'`（为了不显示“仅桌面版可用”提示，与截图 1 一致）；实际 webview 内没有 `beat_this`/`htdemucs` 模型，节拍效果不会真正驱动动画（视觉器在 `isBeatFxReady()` 为假时像素不变）。开关/强度均照常保存进设置树。
4. **上传类控件降级**：自定义字体（`选择系统字体` 打开系统 picker）、tempera 画布图片、monet 封面/肖像、cappella 自定义表情/头像——按钮存在但为 no-op（对应桩）；文案与布局保持 Folia 原样。
5. **Folium mod 扩展卡片**不渲染（无 mod）；`背景类型 → 嵌入/空` 的动态图片列表为空。
6. **背景缩略图**是 Folia 无图时的 glyph fallback（深色卡片 + 模式字形，沿 `backgrounds/<mode>/entry.tsx` 的 `PictureFrame` 语义重绘；Folia 在有背景数据时画实时小画布）；`背景` tab 设置项行为完全一致。
7. **返回按钮**关闭注入覆盖层（不是回播放页）；顶部 header 的 `←` 与 §7.5 一致。
8. **纹理分辨率显示 1.50x**（Folia 默认 1.5）；截图 1 的 1.00x 是用户改过的状态。
9. 注入层全局 CSS（kit.css/Tailwind）会作用到整个页面，但每次打开前只在 head 注入一次 `<style data-spw-settings-ui-css>`，与 Folia 页面自身的 Tailwind 共存（选择器均为 kit 前缀 `st-` / CSS 变量，实测无冲突）。
10. 眼镜/英文字体：`Folia Noto Serif SC` 仍由 Folia 页面自己的 `@font-face`（CDN）提供；本 bundle 不额外拉字体，离线时回退系统衬线栈。
11. 与安装版 Folia 的 1:1 对比（task-11）见 `research/settings-ui/fidelity-diff.md`：已修复 `--text-primary` 未取配色主题、CJK 字体栈缺失、body/滚动条配色、背景格渐变占位四处可见偏差；剩余差异均为 v1 有意降级。

## 8. §7.5 chrome 契约实现（实测）

- `__SPW_FOLIA__.ui = { isSettingsOpen(), openSettings(), closeSettings() }`：`bridge.ts:registerSettingsUiController()` 在 Shim 建好的对象上**增补** `ui` 字段（不替换对象），同时保留 `__SPW_FOLIA_UI__` / `__SPW_FOLIA_SETTINGS_UI__` 兼容名。
- ⚙ 按钮：`.spw-chrome-btn`（`src/app.css`）固定右上 24/24，40×40 圆钮，`rgba(0,0,0,.28)` + `backdrop-filter:blur(12px)` + 1px 白 16% 描边 + 白色 lucide `Settings` 20px，hover 提亮；`pointermove/pointerdown/keydown` 重置 2.5s 空闲计时，超时与光标一起淡出（opacity/translate 过渡），关闭覆盖层后重新出现。
- **指针事件（必须显式开启）**：注入挂载根 `#spw-settings-ui-root`（`src/mount.tsx:16`）是 `pointer-events:none` 的点击穿透层，好让关闭状态下的点击落到下面的 Folia 视觉器；所以 ⚙ 必须在 CSS 里显式 `pointer-events:auto`，否则 `document.elementFromPoint()` 与真实鼠标命中都会被 Folia 页面元素截走——合成 `.click()` 能过、真实点击会失效（真实输入回归，见 §13/F5）；按钮隐藏态 `[data-visible='false']` 恢复 `pointer-events:none`，保证空闲时点穿透。覆盖层打开时其容器自身 `pointer-events:auto` 接管整屏。
- 覆盖层：打开时 `data-spw-settings-ui` 容器 `pointer-events:auto` 且 `display:block`；**组件不卸载**（隐藏时 `display:none`），再次打开不重挂载、预览帧不闪。
- ESC：打开时在 `window` **capture** 阶段监听，命中后 `preventDefault()+stopPropagation()+close()`；关闭时不注册该监听，ESC 直接落到宿主（宿主负责关窗）。
- 实测（`scripts/host-ui-check.mjs`，真实宿主 + 注入 bundle，无 `--force-dsf`；输出存 `poc/webview/host/out/ui-check/results.txt`）：
  ```text
  初始：uiApi=function, isOpen=false, gear=true
  指针命中（⚙ 中心 elementFromPoint，CSS 844,44）：可见态 pointerEvents=auto，命中 gear（该点最顶层元素为按钮内 svg，gear.contains 成立）
  空闲 2.5s 后：visible=false, pointerEvents=none，命中 HEADER（点击穿透视觉器，符合预期）
  ⚙ 点击 → isOpen=true, chrome 隐藏
  ESC（打开时）→ isOpen=false（事件被 preventDefault）
  ui.openSettings() → true；ui.closeSettings() → false
  ESC（关闭时）→ 未 preventDefault（交还宿主）
  重新打开 → 立即打开，.st-window 数量始终为 1（未重挂载）
  host/page errors = 0
  ```
- 宿主命令 `command open-settings` / `close-settings` 由 Shim 转成 `ui` / `settingsUI` 事件触达本页（`bridge.ts` 同时监听两种事件名），也可直接 `ExecuteScriptAsync("__SPW_FOLIA__.ui.openSettings()")`。

## 9. 截图与证据

| 文件 | 内容 |
| --- | --- |
| `research/settings-ui/ours-tab-歌词动画.png` / `-背景` / `-字体` / `-字幕` | 我们页面 4 tab 的 1600×1000 截图（`scripts/dev-capture.mjs`） |
| `research/settings-ui/ours-window*.png` | 我们窗口的 1240×780 精确裁切（用于逐像素对比） |
| `research/settings-ui/real-window.png` / `real-window-<tab>.png` | **安装版 Folia 原版**同状态、同视口的 1240×780 窗口裁切（`scripts/folia-drive.mjs shot-el`） |
| `research/settings-ui/fidelity-*.png` | 原版/我们左右并排的区域对比图 |
| `research/settings-ui/fidelity-diff.md` | task-11 逐区域 PASS/DIFF 报告 + 复跑命令 |
| `research/settings-ui/metrics-real2.json` / `metrics-ours.json` | 同口径 DOM/CSS 度量（窗口/标题/tab/下划线/行/开关/滑轨/货架 tile） |
| `research/settings-ui/window-style-tempera.png` | 切换凝彩：大预览与样式面板同步切换 |
| `research/settings-ui/window-tempera-texture-max.png` | 拖满纹理分辨率后的状态 |
| `research/settings-ui/chrome-fullscreen.png` | dev harness 下 ⚙ chrome（无底层画面） |
| `research/settings-ui/host-fullscreen-chrome.png` | **真实宿主全屏**：Folia 视觉器 + ⚙ |
| `research/settings-ui/host-fullscreen-overlay-open.png` | **真实宿主全屏**：覆盖层打开（3200×2000 @DSF1.8，两栏） |
| `research/settings-ui/host-packaged-fullscreen.png` | **打包树实测**：从 `packaging/web` 注入、覆盖层打开 |
| `research/settings-ui/pushed-config.json` | 一次实际 `pushConfig` 的完整 payload |
| `research/settings-ui/host-ui-check-results.txt` | 真实宿主 §7.5 契约 + ⚙ 指针命中（`elementFromPoint`）回归输出（含 `gearHit`/`gearHitHidden`） |
| `docs/images/settings-ui.jpg` | 真实宿主全屏、覆盖层打开（2200 宽 JPEG q88）；本文件 §9 引用 |
| `docs/images/fullscreen-chrome.jpg` | 公开 README 用：视觉器 + 右上 ⚙ chrome（JPEG q88） |
| `docs/images/style-grid.png` | 公开 README 用：样式 14 两行网格裁切（样式 14 / 商籁…静止） |
| `docs/images/transparent-background.jpg` | 公开 README 用：播放页透明背景（歌词叠加桌面，含开关面板） |
| `docs/images/menu-folia.png` | 公开 README 用：迷你播放器「更多」菜单里的 Folia 条目 |

## 10. 验收清单

- [x] `npm run build` 通过，产物单文件 `dist/settings-ui.js`（CSS 内联），无运行期网络请求。
- [x] 标题 `歌词样式`、右上 `默认`、4 tab `歌词动画/背景/字体/字幕`、14 样式 2×7（商籁…静止，末位 静止，13 位 镜台）。
- [x] 大预览 + 暂停钮 + 样式货架与 Folia 截图 1 同构；尺寸/间距来自 Folia 原组件（1240×780、右栏 420、tile 16:10）。
- [x] 智能动感模式/动感效果/渲染质量/动态与构图四组，值与范围来自 `DEFAULT_SONNET_TUNING`（纹理 1.5x、镜头 1.00x、文字动势 1.00x）。
- [x] 13 个样式面板全部可渲染（cadenza/still 为空态）。
- [x] 控件改动 → store → `setSettings`（≤10Hz）→ 宿主持久化；`pushConfig` 带 `visualizerTunings` 与 `visualizerMode`。
- [x] 真实宿主注入：0 页面错误，全屏两栏，⚙/ESC 契约通过。
- [x] 与安装版 Folia 1:1 对比：标题行/tab/四组卡片/字体/字幕区域 MAE 1.16–7.00（亚像素级），几何与 CSS 变量逐项一致；详见 `research/settings-ui/fidelity-diff.md`。
- [ ] `嵌入/空` 背景与上传类控件（§7.3/7.4）留给 v2——功能降级不影响 v1 视觉与设置树。

## 11. 风险与后续

- **DSF 视口**：生产若在 1080p 屏全屏（CSS 1920×1080）仍两栏；若窗口化到窄尺寸，Folia 会变单栏（接受）。
- **覆盖层遮住视觉器交互**：打开时 `pointer-events:auto` 覆盖全屏，播放器点击被挡住（Folia 自身设置窗口也如此），关闭即恢复。
- **模型缺失**：§7.3；后续若 webview-spike 的 beat 注入链路落地，可把 `useSmartBeatAvailability` 桩换成真实探测。
- **上传能力**：待宿主/插件提供文件选择与 asset 通道后，替换对应桩即可（接口已按 Folia 形状保留）。
- **AGPL-3.0**：本 bundle 编译了 Folia 的 React 组件（AGPL 代码），分发时必须随附相应源码/构建脚本与许可证声明（见 `docs/licensing.md`、`NOTICE`），且不得以专有条款再授权。截图源自 Folia 仓库 README（同许可证）。

## 12. v1 明确不含（v2 follow-ups）

公开版本有意识地只做到“设置窗口 + 配置下发 + 全屏 chrome”这一层，以下为 v2 待补，不是 bug：

- **上传类控件降级**：自定义字体（`选择系统字体` 系统 picker）、tempera 画布图片、monet 封面取色/肖像、cappella 自定义表情/头像——控件在、点击 no-op（对应 `src/stubs/` 桩）。需要宿主/插件提供文件选择与 asset 通道。
- **节拍效果只有 UI**：`beat_this` / `htdemucs` 模型不在 webview 内，开关与强度照常写进设置树，但视觉器不会真正随拍动画（`useSmartBeatAvailability` 桩返回 `'ready'` 仅为与截图 1 的桌面形态一致；缺失模型提示因此不显示）。
- **预览是真实宿主渲染帧**，不是 Folia 的实时 `LyricStylePicture` 小渲染：换样式/拖参数时大图与 14 格货架不跟着实时重绘（静态 jpg，来自 `poc/webview/host` 全屏截屏 16:10 裁切）。视觉等价、性能更好，但少了实时性。
- **背景缩略图**为 Folia glyph fallback（静态模式字形），不是实时小画布；`嵌入/空` 背景无动态图片列表。
- **Folium mod 扩展卡片**不渲染（无 mod 运行时）。
- **DSF/视口**：生产全屏两栏成立（如 3200×2000@1.8 → CSS 1778×1111）；窗口化到窄尺寸时 Folia 自身响应式会变单栏，属预期行为，不做特判。
- **全局动感强度 `lyricMotion`（0.5–1.2）** 已在设置树透传，但本窗口暂无对应控件（Folia 的全局外观页有）。

## 13. 与原版 1:1 还原度（task-11）

报告：`research/settings-ui/fidelity-diff.md`（方法、逐区域 MAE、修复记录、有意差异、复跑命令）。

| 区域 | MAE | 结论 |
| --- | --- | --- |
| 标题行（返回 / 歌词样式 20px 600） | 1.16 | PASS |
| Tab 栏文字 / 下划线 | 7.10 / 2.11 | PASS（文字差为 0.25px 亚像素） |
| 智能动感模式 / 动感效果 / 渲染质量 / 动态与构图 | 1.15 / 3.24 / 2.22 / 3.06 | PASS |
| 字体 tab / 字幕 tab / 背景「隐现背景」卡片 | 2.08 / 4.61 / 7.00 | PASS |
| 背景类型 6 格 / 样式货架 14 格 / 大预览 | 23.72 / 29.66 / 53.88 | 有意差异（实时渲染 vs 静态帧） |

修复的 4 处可见偏差：`--text-primary` 取配色主题（原为 kit fallback）、补齐 Folia `@theme` CJK 字体栈、body/滚动条配色对齐、背景格改为 Folia glyph fallback（原为渐变占位）。

另修复 1 处**真实输入回归（F5，非视觉差异）**：注入挂载根是 `pointer-events:none` 穿透层，⚙ 未显式开启命中测试，导致真实鼠标点不到 ⚙（合成 `.click()` 测不出来）；已在 `.spw-chrome-btn` 加 `pointer-events:auto`、隐藏态保持 `none`，并用真实宿主 `elementFromPoint` 命中测试 + 完整 chrome/ESC 契约回归验证（上方 §8 实测块）。细节与复跑命令见 `research/settings-ui/fidelity-diff.md` §3.5。


## 13. v0.1.2 变更（2026-10-19）

1. **封面取色修复**：`bridge.ts` 新增 `BridgeTrackMessage.coverDataUrl` 与
   `bridgeTrackCover(track) = track.coverUrl ?? track.coverDataUrl`；`useConfigPublisher.ts`
   的 `toPublisherTrack()` 改用 `bridgeTrackCover()`，因此宿主转发的 `coverDataUrl` 也能触发
   `deriveThemeFromCover()`。验证见 `docs/archive/verification-v0.1.2.md`（纯色封面实验：橙 RGB 165/105/66，
   黑 71/71/72）。
2. **移除「智能动感模式」卡片**：`vite.config.ts` 新增 `stripSmartBeatCard()`（`enforce:'pre'`）——
   构建时精确替换 `VisPlaygroundSettingsPanel.tsx` 里的 `<SmartBeatSettingsCard t={t} />`（找不到即抛错），
   不修改 Folia 上游源码；`SmartBeatSettingsCard` 不再进入 bundle。「动感效果」等其它卡片保持不变。
3. 失效开关清单：`docs/known-inert-settings.md`。

## 14. v0.1.3 变更（2026-10-19）

1. **A/B 组控件剥离**：`vite.config.ts` 的 `stripSmartBeatCard()` 升级为数据驱动的
   `foliaSettingsSurgery()`（`enforce:'pre'`，标记缺失即抛错），共 12 处编辑：VisPlaygroundSettingsPanel
   （智能动感卡片、动感效果、背景 url 项、罗马音/两者选项、自定义字体 Reveal、和声分组）、
   Tempera（图像图层分组）、Monet（自定义人像来源 + 上传行）、Cappella（自定义头像/表情包来源 +
   两条上传行）。Folia 上游源码不变。
2. **C 组映射修复**：新增 `src/publisher/themeFonts.ts` 的 `applyThemeFonts()`；`useConfigPublisher`
   的主题 = 封面派生主题 + 字体族/字重合成，字幕主题按「跟随歌词」继承或独立映射；`config.ts`
   归一化 `subtitleContentMode` 并固定和声字段为 false。此前字体族/字重/字幕字体从不进入 config。
3. **旧值迁移**：`App.tsx` 挂载时归一化持久化设置（custom→sans、romanization/both→translation、
   url→latent），并移除自定义字体磁贴。
4. 验证：`docs/archive/verification-v0.1.3.md`（DOM + pushConfig 断言 + 真实 SPW 截图）。
