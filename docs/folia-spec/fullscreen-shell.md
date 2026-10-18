# Folia 0.7.21 全屏歌词外壳规格（fullscreen shell）

用途：Lead 决策「设置页 + 全屏模式外壳跑在 WebView2 里的 Vue/React harness」后，这份文档给出 **1:1 复刻播放页全屏歌词** 所需的层、控件、行为、默认值。事实来源：源仓库 `work/folia/folia-major-main`（下文路径均相对它）+ 解包产物 `C:\tmp\asar`。配套：`runtime-contracts.md`（渲染输入）、`settings-ui.md`（设置页）、`assets.md`（截图/素材）。

---

## 0. 一句话结论

**「全屏歌词」不是独立窗口、也不是独立路由：它就是播放页 `currentView === 'player'`。** `VisualizerRenderer` 挂在一个 `absolute inset-0 z-0` 的 `div[data-testid="player-visual-surface"]` 里铺满窗口（`src/App.tsx:2790-2801`），标题栏、底部浮动控制胶囊、右侧面板、`app.overlay` 都是它的**兄弟节点**浮在上面。

所以插件要做的是：一个全屏 surface 承载 `<VisualizerRenderer>` + 少量浮层（字幕/和声在 renderer 内部；底部胶囊/返回键/面板由宿主画），**不需要复刻 Folia 的整个 App**。

---

## 1. 整窗层级（z-index 表）

| 层 | z | 位置/尺寸 | 源码 |
|---|---|---|---|
| 标题栏条（自定义窗口 chrome） | `z-[9999]` | 顶部 32px，`pointer-events-none`（只有自绘 chrome 才画按钮） | `src/components/app/AppShell.tsx:166`；`:144-155` |
| 首页墙 / Lattice | `z-10` | 播放页时 `visibility:hidden` + `pointer-events:none` | `src/App.tsx:2689-2699`、`:2726` |
| **视觉层 `player-visual-surface`** | **`z-0`** | `absolute inset-0`，整窗 | `src/App.tsx:2790-2801` |
| 和声 overlay（renderer 内） | `z-30` | top 76px 起 | `src/components/visualizer/VisualizerHarmonyOverlay.tsx:39,227` |
| 逐字歌词本体 | 样式内部（通常 z-10 上） | 由样式自己布局 | 各样式 |
| 翻译字幕 overlay（renderer 内） | `z-20` | 底部 | `src/components/visualizer/VisualizerSubtitleOverlay.tsx:146` |
| 底部浮动控制胶囊 | `z-60` | 水平居中，默认 bottom 32px | `src/components/FloatingPlayerControls.tsx:334` |
| 右侧面板 | `z-[60]` | 右贴边 360px 玻璃卡 | `src/components/panelTab/shell/PanelShell.tsx:100,155` |
| 弹窗 / 命令面板等 overlays | 高 z | | `AppOverlays`（App.tsx:2803+） |
| `app.overlay` stage 层 | `z-[1000]` | 全屏但 `pointer-events-none` | `src/App.tsx`（`FoliumStageLayerSlot`） |

- `AppShell` 根：`fixed inset-0 w-full h-full flex flex-col overflow-hidden font-sans transition-colors duration-500`（`AppShell.tsx:158`）。
- 视觉层容器本身**就是点击目标**（`onClick={handleContainerClick}`），点画面空白处通常用于收 chrome/开关面板。

---

## 2. 视觉层内部结构（renderer → backdrop → shell）

### 2.1 `VisualizerRenderer`（`src/components/visualizer/VisualizerRenderer.tsx:84-102`）

```
<Suspense fallback={null}>
  <VisualizerBackdrop …>
    <VisualizerStyleTransition … />   ← 当前样式 / 切换中的旧+新样式
  </VisualizerBackdrop>
</Suspense>
<VisualizerHarmonyOverlay … />          ← 永远在 Suspense 外面，切样式不闪
```

- 样式模块 `React.lazy` 加载，fallback 故意为 `null`（闪占位比空白更突兀）。
- 和声与翻译字幕的 DOM 在 **renderer 层**，不在样式内部；所以样式切换时它们不卸载。

### 2.2 `VisualizerBackdrop`（`src/components/visualizer/VisualizerBackdrop.tsx:124`）

根：`relative w-full h-full overflow-hidden`，`opacity = visualizerOpacity ?? 1`。内部顺序（`:125-140`）：

1. **背景 + 视频**（`VisualizerBackdropLayers`）：`VisualizerBackgroundTransition` → `VideoLayer`
2. `FoliumStageLayerSlot slot="player.stage.back"`（mod 舞台层，样式之下）
3. **样式本体**（`VisualizerStyleTransition`）
4. `FoliumStageLayerSlot slot="player.stage.front"`：`absolute inset-0 z-20 pointer-events-none`

- 背景 cover 尺寸固定 **1024**：`getSizedCoverUrl(coverUrl, 1024)`（`VisualizerBackdrop.tsx:78`）。
- `VideoLayer`（`src/components/visualizer/videoLayer/VideoLayer.tsx:97-110`）：`<video muted loop playsInline preload="auto" className="absolute inset-0 h-full w-full pointer-events-none" style={{opacity, objectFit}}/>`，位置 = 歌曲时间对视频时长取模；修正常量 `DRIFT_CHECK_MS=2000`、`DRIFT_TOLERANCE_SEC=0.35`、`CLOCK_JUMP_SEC=1`。**层级：背景之上、歌词之下**；仅主界面播放页画（`!isPreviewMode && !staticMode && isMainAppSurface`）。
- 背景模式自己再套 `absolute inset-0 z-0`（如 `backgrounds/common/entry.tsx:52`、`backgrounds/sora/entry.tsx:33`）。

### 2.3 `VisualizerShell`（`src/components/visualizer/VisualizerShell.tsx`）

样式外壳（每个样式 render 都包一层或等价实现）：

- 根：`w-full h-full flex flex-col items-center justify-center overflow-hidden relative` + 主题字体类 + `transition-colors duration-1000`；`backgroundColor: 'transparent'`；`fontFamily: resolveThemeFontStack(theme)`；`opacity = visualizerOpacity`（在 backdrop 内不设）；backdrop 内 `pointerEvents: none`。
- **返回键**（`:224-242`）：`motion.button`，`absolute top-6 left-6 z-30 h-10 w-10 rounded-full flex items-center justify-center backdrop-blur-md bg-black/20 hover:bg-white/10 text-white/60`，`<ChevronLeft size={20}/>`，进/出 `opacity/scale(.92)/x(-6)` 0.2s easeOut。
- **两个热点区（关键行为）**：`PLAYER_CHROME_HOTSPOT_SIZE = 120`（`:50`）
  - 左上 120×120（`backRevealArea`）：鼠标进入才显示返回键；离开立即隐藏。
  - 右下 120×120（`panelRevealArea`）：鼠标进入 → 面板引导线；**触摸** pointerdown 落在热点 → 显示引导 `TOUCH_GUIDE_DISPLAY_MS = 1400` 后自动收起（`:51,126-168`）。
  - `alwaysShowBackButton = alwaysShowPlayerBackButton || isPanelOpen`（`useVisualizerRendererModel.ts:176`）：设置「总是显示返回按钮」或面板打开时常显。
- 视觉层指针隐藏：`cursor-auto-hidden` class 只加在 `player-visual-surface` 上（App.tsx:2791），弹窗/标题栏不受影响。

---

## 3. 播放页 chrome（浮层控件）

### 3.1 底部浮动控制胶囊

- 定位层 `src/components/FloatingPlayerControls.tsx:334`：`absolute left-1/2 -translate-x-1/2 z-60 w-full flex justify-center pointer-events-none`；胶囊 `:381` `backdrop-blur-xl shadow-2xl overflow-hidden rounded-full`；bottom 由共享 MotionValue 驱动，默认 **32px**。
- 进度条：`<ProgressBar>`（`:577` 展开态 / `:613` 收起态），可被设置 `hidePlayerProgressBar` 隐藏。
- 播放/暂停、上一首/下一首、模式、音量、打开面板等按钮都在胶囊里；面板打开时胶囊布局让位（`PlayerBottomBarLayoutContext`）。
- 隐藏生效：`src/components/app/overlays/buildAppOverlaysModel.ts:293-294`，`isHidden = currentView==='player' && isPlayerChromeHidden`。

### 3.2 右侧面板

- `PanelShell.tsx:100`：`w-[360px] max-w-[calc(100vw-2rem)] rounded-[20px] bg-[var(--pn-glass)] backdrop-blur-[40px]`；容器 `absolute right-0 z-[60]`（`:155`）。
- 右下 `PanelHandle`（`src/components/panelTab/shell/PanelHandle.tsx`）：圆形把手，拖动可开命令面板；与 shell 右下热点共享状态（`isGuideLineVisible` `:53`、`TOUCH_GUIDE_DISPLAY_MS=1400` `:15`）。

### 3.3 chrome 自动隐藏（`src/hooks/usePlayerChromeAutoHide.ts`）

三档 `PlayerChromeVisibilityMode = 'always-hidden' | 'always-visible' | 'auto-hide'`，持久键 `player_chrome_visibility_mode`（`:7`）。

auto-hide 行为（`:98-197`）：

| 事件 | 行为 |
|---|---|
| 显示后 | `scheduleAutoHide(3000)`，3s 后隐藏 |
| `mousemove` | rAF 节流，显示并重置 3s |
| `mouseout` 离开窗口边界 | 300ms 后隐藏 |
| `pointerdown` | 保持显示、不排隐藏；`pointerup/cancel` 重置 3s |
| `wheel` | 重置 3s |
| 窗口 `blur` | 300ms 后隐藏 |
| 点击穿透（桌面宠物） | 强制隐藏且完全不监听 |

- 档位循环：`cyclePlayerChromeVisibilityMode`（`:69-71`）`always-hidden → always-visible → auto-hide`；与设置 `autoHidePlayerChrome` 双向同步。
- 快捷键：`KeyH` 循环三档（仅播放页、面板未开、无阻塞弹窗），`KeyP` 开合面板（`usePlaybackInteractionBridge.ts:345-359`）。
- 光标：`shouldHidePlayerCursor`（跟随 chrome，`App.tsx:1607-1611`）或独立 `useIdleCursorHide`（`CURSOR_IDLE_HIDE_MS = 3000`，`src/hooks/useIdleCursorHide.ts:14`）；任一命中 → 视觉层加 `cursor-auto-hidden`。
- 播放页外观设置（`src/stores/usePlayerChromeSettingsStore.ts:40-76`）：`hidePlayerProgressBar`、`playerBottomBarOffset`、`playerControlSlotPrimary/Secondary`、`hidePlayerRightPanelButton`、`alwaysShowPlayerBackButton`、`alwaysShowTrackSwitchButtons`、`alwaysShowMainWindowTitlebar`、`hideFullscreenButton`、`useNativeMacFullscreenButton`、`transparentPlayerBackground`、`enablePlayerPageNativeBlur`、`autoHidePlayerChrome`、`autoHideCursorWithPlayerChrome`、`hideCursorWhenIdle`、`showOpenPanelCloseButton`。

### 3.4 背景透明 / 原生模糊 / 首页墙后模糊

- `isPlayerPageTransparent = transparentPlayerBackground || enablePlayerPageNativeBlur`（`App.tsx:1525`）→ 写进 `background.transparent`（`useVisualizerRendererModel.ts:124-133`）；`VisualizerBackgroundRenderer` 见 `transparent` 直接 `return null`（`backgrounds/VisualizerBackgroundRenderer.tsx:9-11`）。
- Electron 侧把文档背景设透明：`src/hooks/useElectronWindowChrome.ts:21-46`（WebView harness 里对应「窗口透明 + 宿主画自己的背景」）。
- 首页墙后透出的模糊：`LIBRARY_BACKDROP_BLUR_PX = 24`，`filter: blur(24px)`、`transition: 300ms ease`（`src/components/app/presentation/playerVisualizerBackdrop.ts:16,43-47`），作用于 `player-visual-surface`。
- 是否画歌词：`resolveVisualizerShowText = (player && !settingsModalOpen) || (home && !isPanelOpen && backdropLyrics)`（同文件 `:19-32`）。

---

## 4. 字幕 / 和声显示规则（renderer 内部两个 overlay）

### 4.1 翻译字幕 `VisualizerSubtitleOverlay.tsx`

- 根 `absolute left-0 right-0 text-center space-y-2 px-4 z-20 pointer-events-none`（`:146`）；发光底 `absolute -inset-x-10 -inset-y-6 z-0 blur-2xl`（`:153`）；正文 `relative z-10 max-w-4xl`（`:162`）；文本阴影 `0 1px 2px ${colorWithAlpha(theme.backgroundColor,0.24)}`。
- 内容解析优先级（与设置项联动）：
  - `subtitleContentMode`: `translation`（默认）| `romanization` | `both` | `none`；
  - `hideTranslationSubtitle` 完全隐藏；`showSubtitleTranslation=false` 时不显示译文；
  - `hideTranslationSubtitle` / `showSubtitleTranslation` 在播放页由设置与内容模式共同决定。
- 上/下两条（主字幕 + 下一句预览）字号：主 `clamp(1.125rem, 2.6vw, 1.25rem)`、次 `clamp(0.875rem, 2vw, 1rem)`，再乘 `subtitleFontScale`（次行额外 ×0.88）；见 `subtitleFontSizes.ts`、`runtime-contracts.md §8`。
- 底距：`bottom` 直接绑 MotionValue（不能改 transform，否则会和动画冲突）。
- 相关设置默认（`settings-ui.md §6`）：`subtitleOverlayOpacity=0.6`、`subtitleOverlayBackground=true`、`subtitleUpcomingLyricsBlur=true`、`subtitleContentMode='translation'`、`subtitleFontScale=1`。

### 4.2 和声字幕 `VisualizerHarmonyOverlay.tsx`

- `HARMONY_TOP_PX = 76`（`:39`），可用 `HarmonyTopContext` 覆盖（小图裁切用）。
- 根 `pointer-events-none absolute left-0 right-0 z-30 flex flex-col items-center gap-1.5 px-5 text-center`，`top: 76px`（`:227-228`）。
- 字号 `clamp(0.95rem, 1.8vw, 1.3rem) × subtitleFontScale`（`:149`）；发光底同字幕。
- 开关：`showHarmonySubtitle`（默认 true）、`harmonySubtitleBackground`（默认 true）；数据来自 `Line.backgroundVocal/backgroundVocals`（TTML 和声）。

> 两者都在 visualizer 层内（z-20/z-30），返回键（z-30，shell 内）与面板（z-60，层外）互不遮挡。

---

## 5. 进入 / 退出全屏歌词（以及「大预览」）

- 进入：`navigateToPlayer`（`src/hooks/useAppNavigation.ts:348`）把 `currentView` 切到 `'player'`；OS 全屏是另一码事（`hideFullscreenButton` / `useNativeMacFullscreenButton`，`src/components/modal/settings/pages/DesktopPage.tsx:87-94`）。
- 退出视觉页：shell 返回键 → `onBack`（回首页/上一视图）。
- 挂载条件：`shouldMountPlayerVisualizer`（`src/components/app/presentation/playerVisualizerMount.ts:25-36`）——首页墙遮住播放页且遮挡结算、或 Lattice 未退场时不挂。harness 里=「页面切到全屏歌词才 mount，退出即 unmount（或保留 currentTime 停表）」。
- 竖屏/横屏：**主播放页没有单独规则**，全部按窗口实际尺寸布局；只有 OBS 源按 `isPortrait` 选 1080/1920 基准（`ObsBrowserSourceApp.tsx:76-77`）。

### 5.1 设置页的「大预览」（Lead 需求 (b) 的另一半）

设置窗口（1240×780）左侧是**样品舞台**，不是播放页：

- `VisPlayground.tsx:457` 同样挂 `<VisualizerRenderer>`，但 props 来自样品时钟（`usePreviewClock`）、`isPreviewMode`、样本歌词；舞台按窗口尺寸画再 `SAMPLE_ZOOM` 缩放（默认 **1.15**；monet 1.3）。
- 右上角 **播放/暂停按钮**：32px 圆形、`bg-black/45` 半透明白图标（`VisPlayground.tsx` 内 sample stage 控件），点击切换样片时钟；`pause` 时停表但保留当前帧。
- 无返回键、无字幕/和声（`subtitleContentMode:'none'`、`showSubtitleTranslation:false`、`showHarmonySubtitle:false`）。
- 样式切换：点样式网格立即换样片样式，走 soft-focus 过渡（`animateStyleSwitch`）。
- 具体布局与尺寸见 `settings-ui.md §2`。

---

## 6. 截图 / 视觉参考

- 官方 README 截图已抽取到 `research/assets/screenshots/`（见 `assets.md §1.1`）：`visualizer.png` 是宽幅拼贴，`preview-*.png` 是各样式单帧；**没有** sonnet/tempera/lumiere/monet/claddagh/still 的官方图。
- 需要新增参照时：直接跑安装版 `C:\Program Files\Folia\Folia.exe` → 进播放页 → `Win+Shift+S`/系统截图；建议每样式截 1 张全屏 + 1 张设置页（用来对齐我们的复刻）。注意 Folia 默认开启 chrome 自动隐藏（3s），截图前动一下鼠标。

---

## 7. Vue harness 复刻清单

### 7.1 必须复刻（否则不像全屏歌词）

| # | 元素 | 复用/自写 | 备注 |
|---|---|---|---|
| 1 | 全屏 visualizer surface（`absolute inset-0`，无背景色） | 复用 React island | 见 `runtime-contracts.md §11` |
| 2 | 样式本体 + 背景 + 视频层 | **直接复用** `VisualizerRenderer` | 插件无需重画 |
| 3 | 翻译字幕 + 和声 | **直接复用**（renderer 内） | 默认值见 §4 |
| 4 | 返回键（左上 120px 热点） | 自写（简单）或复用 `VisualizerShell` | 触屏：点左上也该出 |
| 5 | 暂停/播放控制 | 自写底部胶囊（见 `settings-ui.md §7` 的按钮样式） | 也可先只做点击画面播放/暂停 |
| 6 | 光标/ chrome 自动隐藏 | 自写（3s auto-hide） | 提升「沉浸感」的关键 |
| 7 | 背景透明/窗口模糊 | 宿主设置（WebView2 透明背景） | 插件按需 |

### 7.2 可后置

- 右侧 360px 面板、`PanelHandle`、app.overlay 舞台层、首页墙/Lattice 衔接、自动隐藏三档设置、进度条展开态。
- 视频层（需要用户视频文件句柄，WebView 里可以不做）。
- 原生模糊（Electron 专属；WebView 里用 CSS backdrop-filter 或直接纯色背景代替）。

### 7.3 外壳需要向 renderer 传的 props（最小集）

`mode`、`currentTime`、`currentLineIndex`、`lines`、`theme`、`audioPower`、`audioBands`、`showText`、`coverUrl`、`seed`、`paused`、`onBack`、`subtitleContentMode`、`subtitleOverlayOpacity`、`subtitleOverlayBackground`、`subtitleUpcomingLyricsBlur`、`showHarmonySubtitle`、`harmonySubtitleBackground`、`lyricsFontScale`、`subtitleFontScale`、`background={{mode:'latent'}}`、`isPlayerChromeHidden`（可选，影响样式内文字避让）。完整表见 `runtime-contracts.md §2`。

### 7.4 验收（肉眼可判）

1. 全屏只有歌词+背景，无播放器外框；鼠标 3s 不动后光标与控件消失。
2. 鼠标移到左上角出现半透明圆形返回键；移开消失。
3. 拖到左下/中间：底部出现胶囊（播放/暂停、进度）。
4. 字幕在底部居中，带发光底与半透明遮罩；下一句模糊。
5. 切样式时旧样式淡出、新样式入（soft focus），字幕不闪。
6. 窗口拉成竖屏/超宽，歌词仍居中排版（无横竖两套逻辑）。

---

## 8. 证据索引

| 事实 | 证据 |
|---|---|
| 播放页 = 全屏歌词，视觉层 z-0 | `src/App.tsx:2790-2801` |
| 视觉层内部顺序（背景→视频→stage.back→样式→stage.front） | `src/components/visualizer/VisualizerBackdrop.tsx:124-140` |
| 返回键样式与 120px 热点 | `src/components/visualizer/VisualizerShell.tsx:50-101,126-168,224-242` |
| chrome 三档/自动隐藏/光标 | `src/hooks/usePlayerChromeAutoHide.ts:7,69-197`；`src/hooks/useIdleCursorHide.ts:14`；`src/App.tsx:1607-1613` |
| 底部胶囊 / 右面板 | `src/components/FloatingPlayerControls.tsx:334,381,577`；`src/components/panelTab/shell/PanelShell.tsx:100,155` |
| 字幕/和声 overlay | `src/components/visualizer/VisualizerSubtitleOverlay.tsx:146-162`；`VisualizerHarmonyOverlay.tsx:39,149,227-261` |
| 视频层 | `src/components/visualizer/videoLayer/VideoLayer.tsx:97-110` |
| 透明背景 / 原生模糊 | `src/App.tsx:1525`；`backgrounds/VisualizerBackgroundRenderer.tsx:9-11`；`src/hooks/useElectronWindowChrome.ts:21-46` |
| 设置页大预览 | `src/components/visualizer/window/VisPlayground.tsx:119,457,517`；`settings-ui.md §2` |
| 背景系统（6 模式/默认值） | `notes-shell.md §B`；`runtime-contracts.md §10`；`settings-ui.md §4` |
