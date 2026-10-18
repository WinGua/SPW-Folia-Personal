# Folia 全屏歌词外壳 / 背景系统 / 样式网格预览 — 源码事实笔记

仓库：`D:\输出目录\dsh2\work\folia\folia-major-main`（Folia v0.7.21，React + TS + Electron）。
所有行号以本仓库当前工作区为准。

## 0. 结论（先给实施 spec 用）

- **「全屏歌词」不是一个独立窗口，也不是独立路由**：它就是播放页（`currentView === 'player'`）。`VisualizerRenderer` 挂在 AppShell 的一个 `absolute inset-0 z-0` 图层里，铺满整个窗口；标题栏、底部浮动控制胶囊、右侧面板、`app.overlay` 全部是它的兄弟节点、浮在它上面。
- 全屏感来自四件事：视觉层独占 z-0；播放页 chrome 可被隐藏（`isPlayerChromeHidden`）；返回键只在上左 120px 热点内出现；光标可随 chrome 或独立空闲隐藏。
- 背景是 visualizer 内部的一层（`VisualizerBackdropLayers`），六个可注册模式；视频层夹在背景和歌词之间。
- 设置里的样式网格**不挂完整 renderer**：每个 16:10 小格调用样式的 registry `render`，把它画在与窗口等大的「舞台」上再整体缩小，多数时候只显示一张冻结截图。

---

# A. 全屏歌词外壳

## A1 挂载点与整窗层级

- 视觉层：`D:\输出目录\dsh2\work\folia\folia-major-main\src\App.tsx:2790-2801`（`data-testid` 在 :2792，Provider 在 :2797-2799，`VisualizerRenderer` 在 :2798）

  ```tsx
  <div
      className={`absolute inset-0 z-0${(shouldHidePlayerCursor || idleCursorHidden) ? ' cursor-auto-hidden' : ''}${visualizerAroundWall.fadesIn ? ' visualizer-comes-up' : ''}`}
      data-testid="player-visual-surface"
      data-library-backdrop-blur={blursVisualizerBackdrop || undefined}
      style={visualizerBackdropStyle(blursVisualizerBackdrop)}
      onClick={handleContainerClick}
  >
      <PlayerBottomBarLayoutContext.Provider value={currentView === 'player'}>
          {shouldMountVisualizer && <VisualizerRenderer {...visualizerRendererModel} animateStyleSwitch />}
      </PlayerBottomBarLayoutContext.Provider>
  </div>
  ```

  - 整个 visualizer（含背景、样式、和声）都在这一层里；容器本身就是点击目标（`handleContainerClick`）。
  - `cursor-auto-hidden` 类只挂在这一个 div 上：弹窗、命令面板、浮动控件、标题栏按钮都是兄弟节点，不在作用域内（App.tsx:2783-2789 注释）。
- 挂载条件：`shouldMountVisualizer` 来自 `shouldMountPlayerVisualizer`（`src/components/app/presentation/playerVisualizerMount.ts:25-36`）：首页墙把播放页遮住且遮挡已结算、或 Lattice 还没退场时，visualizer 会被卸载/不挂。
- 同层兄弟（App.tsx:2803-2902 顺序）：`StageSessionEmptyState` → `AppOverlays` → `FoliumStageLayerSlot slot="app.overlay"`（`fixed inset-0 pointer-events-none z-[1000]`）→ `PlayerPanel`（App.tsx:2841-2843，`currentView === 'player'` 且没有歌词匹配弹窗时）→ `ThemeQuickEditorHost` / `AddToPlaylistHost` / `CommandPalette` 等。
- 首页层 `absolute inset-0 z-10`（App.tsx:2689-2699）；Lattice 层同样 z-10（App.tsx:2726 附近）。播放页时它们 `visibility: hidden` + `pointer-events: none`，只是**数值上**仍高于视觉层 z-0。
- AppShell 根：`src/components/app/AppShell.tsx:158` `fixed inset-0 w-full h-full flex flex-col overflow-hidden font-sans transition-colors duration-500`；标题栏条 `:166` `absolute top-0 left-0 right-0 z-[9999] h-8 pointer-events-none`，只有自定义窗口 chrome 时才渲染按钮/背景（`:144-155`）。
- 底部浮动控制胶囊：`src/components/FloatingPlayerControls.tsx:334` 定位层 `absolute left-1/2 -translate-x-1/2 z-60 w-full flex justify-center pointer-events-none`（H 居中靠 Tailwind，动画层用 framer-motion 写 y/scale，两层分开；bottom 走共享 MotionValue，默认 32px）；胶囊 `:381` `backdrop-blur-xl shadow-2xl overflow-hidden rounded-full`；进度条 `<ProgressBar>` 在 `:577`（展开态）/`:613`。
- chrome 隐藏如何生效：`src/components/app/overlays/buildAppOverlaysModel.ts:293-294`
  `isHidden: currentView === 'player' && isPlayerChromeHidden`、`hideControlBar: shouldHidePlayerProgressBar`（后者来自设置 `hidePlayerProgressBar`）。
- 右侧面板：`src/components/panelTab/shell/PanelShell.tsx:100` 卡片 `w-[360px] max-w-[calc(100vw-2rem)] rounded-[20px] bg-[var(--pn-glass)] backdrop-blur-[40px]`，容器 `:155` `absolute right-0 z-[60]`；右下圆形把手 `PanelHandle`（`src/components/panelTab/shell/PanelHandle.tsx`：右下角圆按钮，拖动可开命令面板，`isGuideLineVisible` 在 `:53`，`TOUCH_GUIDE_DISPLAY_MS = 1400` 在 `:15`）。

## A2 VisualizerRenderer / Backdrop 的内部分层

- `src/components/visualizer/VisualizerRenderer.tsx:84-102`
  - `<Suspense fallback={null}><VisualizerBackdrop entry props transition waits><VisualizerStyleTransition …/></VisualizerBackdrop></Suspense>`：样式模块懒加载，fallback 故意为 null（视觉层闪占位比空更明显）。
  - `<VisualizerHarmonyOverlay …/>` 永远在 Suspense **外面**：切样式时不跟着卸载，和声/翻译字幕不闪。
- `src/components/visualizer/VisualizerBackdrop.tsx:124`：`<div ref={setPointerArea} className="relative w-full h-full overflow-hidden" style={{ opacity: props.visualizerOpacity ?? 1 }}>`。
  内部顺序（同文件 `:125-140`）：
  1. `VisualizerBackdropLayers`（背景 + 视频）
  2. `FoliumStageLayerSlot slot="player.stage.back"`（样式之下）
  3. 样式（children，`VisualizerStyleTransition`）
  4. `FoliumStageLayerSlot slot="player.stage.front"`，`absolute inset-0 pointer-events-none z-20`
- 背景/视频层：`VisualizerBackdrop.tsx:71-97`
  - `VisualizerBackgroundTransition`：`config: sharedProps.background`、`coverUrl: getSizedCoverUrl(sharedProps.coverUrl, 1024)`、`staticMode: staticMode || backgroundStaticMode`、`paused`、`blendMs`（取自样式过渡的 enter delay+duration）、`blendProgress`。
  - `VideoLayer`：仅 `!isPreviewMode && !staticMode && isMainAppSurface`（OBS 源不画，打不开主窗口的本地文件句柄）。
- `VideoLayer`（`src/components/visualizer/videoLayer/VideoLayer.tsx:97-110`）：`<video muted loop playsInline preload="auto" className="absolute inset-0 h-full w-full pointer-events-none" style={{ opacity, objectFit: fit }} />`，位置 = 歌曲位置对视频时长取模，`DRIFT_CHECK_MS = 2000`、`DRIFT_TOLERANCE_SEC = 0.35`、`CLOCK_JUMP_SEC = 1`。层级：背景之上、歌词之下。
- 背景各模式自己再套 `absolute inset-0 z-0`（如 `backgrounds/common/entry.tsx:52`、`backgrounds/sora/entry.tsx:33`）。
- 样式层：`src/components/visualizer/styleTransition/VisualizerStyleTransition.tsx`（soft focus 过渡，`softFocus.ts`、`layerTransition.ts`、`firstFrame.ts`）。

## A3 VisualizerShell：返回键、两个热点、触摸提示

文件 `src/components/visualizer/VisualizerShell.tsx`：

- 常量：`PLAYER_CHROME_HOTSPOT_SIZE = 120`（:50）、`TOUCH_GUIDE_DISPLAY_MS = 1400`（:51）。
- 热点矩形：`backRevealArea` 左上 120×120（:52-55）；`panelRevealArea` 右下 120×120（:56-60）；命中判断 `isNearPlayerPanelHotspot` 直接用 `window.innerWidth/innerHeight`（:62-66）。
- 布局预留（供 Folium 舞台层避让）：`usePlayerOverlayReservation('back-reveal', 'navigation', backRevealArea, publishLayout && hasBackAction)`、`('panel-reveal', 'panel', panelRevealArea, publishLayout && !resolvedIsPanelOpen)`（:100-101）；`publishLayout = isPlayerPage && !isPreviewMode && isMainAppSurface`（:96-97）。
- 返回键（:224-242，`className` 在 :238）：`motion.button`，`absolute top-6 left-6 z-30 h-10 w-10 rounded-full flex items-center justify-center backdrop-blur-md bg-black/20 hover:bg-white/10 text-white/60`，`<ChevronLeft size={20}/>`；进入动画 opacity/scale(.92)/x(-6) 0.2s easeOut；`style={{ pointerEvents: isBackButtonVisible ? 'auto' : 'none' }}`。
  - 可见性 `isBackButtonVisible = sharedProps?.alwaysShowBackButton || showBackButton`（:94）。
  - `alwaysShowBackButton = alwaysShowPlayerBackButton || isPanelOpen`（`src/components/visualizer/useVisualizerRendererModel.ts:176`）。
- 鼠标移动：`move` 时只在 `clientX <= 120 && clientY <= 120` 才显示返回键（:146-150），同时更新右下热点是否为「面板引导」（`!isPanelOpen && isNearPlayerPanelHotspot`）。
- 触摸：`pointerdown` 且 `pointerType === 'touch'` 且落在右下热点 → `showTouchPanelGuide()`（定义 :126），显示引导 1400ms 后自动收起（:155-162、:126-136）。
- 离开/取消：`mouseleave`、`pointercancel` 立即隐藏返回键与引导（:152-168）。
- 根节点（:210-223）：`w-full h-full flex flex-col items-center justify-center overflow-hidden relative ${fontClassName} transition-colors duration-1000`；`backgroundColor: 'transparent'`；`fontFamily: resolveThemeFontStack(theme)`；`opacity` 取 `visualizerOpacity`（在 backdrop 内不设）；backdrop 内 `pointerEvents: 'none'`。
- 在 backdrop（样式切换中的新/旧样式）里：shell 不再自己监听指针，而是监听 `VisualizerBackdropContext.pointerArea` 上的 capture 阶段 `mousemove`/`mouseleave`/`pointerdown`/`pointercancel`（:177-194），因为 shell 的盒子让指针穿过去给舞台层。
- 舞台槽同样在 shell 里再挂一次（`player.stage.back` / `player.stage.front` z-20，:265-280），`showStageLayers = !isInBackdrop && !isPreviewMode && !staticMode`。

## A4 字幕 / 和声（浮在样式之上）

- 翻译字幕：`src/components/visualizer/VisualizerSubtitleOverlay.tsx:146` 根 `absolute left-0 right-0 text-center space-y-2 px-4 z-20 pointer-events-none`；发光底 `:153` `absolute -inset-x-10 -inset-y-6 z-0 blur-2xl`；正文 `:162` `relative z-10 max-w-4xl`。
- 和声（TTML background vocal）：`src/components/visualizer/VisualizerHarmonyOverlay.tsx`
  - `HARMONY_TOP_PX = 76`（:39）、`HarmonyTopContext` 可覆盖（:44，预览裁切用）。
  - 根 `:227-228` `pointer-events-none absolute left-0 right-0 z-30 flex flex-col items-center gap-1.5 px-5 text-center`，`style={{ top: harmonyTopPx }}`。
  - 发光底 `:237` `absolute -inset-x-10 -inset-y-6 z-0 blur-2xl`；文字 `:261` `relative z-10 max-w-4xl`；字号 `clamp(0.95rem, 1.8vw, 1.3rem) × subtitleFontScale`（:149）。
- 两者都在 visualizer 层内部（z-20 / z-30），所以「返回键（z-30，shell 内）+ 和声（z-30）+ 面板（z-60，层外）」互不覆盖。

## A5 封面 / 背景 / 原生模糊

- 播放页**不单独画大封面**：封面只作为 `coverUrl` 喂给背景与样式（背景取 1024 尺寸：`VisualizerBackdrop.tsx:78`）。切歌交接期间由 `useHandoffCover` 固定首个 cover 地址（`src/components/visualizer/useHandoffCover.ts:25-47`），避免同一张图两个地址导致背景重建。
- 透明与原生模糊：
  - `isPlayerPageTransparent = transparentPlayerBackground || enablePlayerPageNativeBlur`（`src/App.tsx:1525`）。
  - 运行时把它塞进背景配置：`useVisualizerRendererModel.ts:124-133`，`transparent: isPlayerPageTransparent`，并 `disableGeometricBackground ||= isSettingsSubviewOpen`。
  - `VisualizerBackgroundRenderer` 在 `config.transparent` 时直接 `return null`（`src/components/visualizer/backgrounds/VisualizerBackgroundRenderer.tsx:9-11`）——整层背景不画，只剩样式/歌词。
  - Electron 侧据此把文档背景设为透明：`src/hooks/useElectronWindowChrome.ts:21-46`。
- 首页墙后透出的模糊：`LIBRARY_BACKDROP_BLUR_PX = 24`，`filter: blur(24px)` + `transition: filter 300ms ease`（`src/components/app/presentation/playerVisualizerBackdrop.ts:16,43-47`），作用于 `player-visual-surface`（App.tsx:2794，`style` 行）。
- 是否画歌词文字：`resolveVisualizerShowText` = `(player && !settingsModalOpen) || (home && !isPanelOpen && backdropLyrics)`（同文件 `:19-32`）。

## A6 播放页 chrome 自动隐藏与光标

文件 `src/hooks/usePlayerChromeAutoHide.ts`：

- 三档 `PlayerChromeVisibilityMode`：`'always-hidden' | 'always-visible' | 'auto-hide'`，持久键 `player_chrome_visibility_mode`（:7）。初始值：存过就用存的，否则 `autoHidePlayerChrome ? 'auto-hide' : (initialHidden ? 'always-hidden' : 'always-visible')`（:27-35）。
- auto-hide 的实现（:98-197）：
  - 显示后 `scheduleAutoHide(3000)`（:116-119）；
  - `mouseout` 离开窗口边界（relatedTarget 为空或坐标越界）→ 300ms 后隐藏（:121-127）；
  - `mousemove` 经 `requestAnimationFrame` 节流（每帧最多一次）→ 显示并重置 3s（:129-141）；
  - `pointerdown` 期间保持显示、不排隐藏（:142-146）；`pointerup`/`pointercancel` 重置 3s（:147-150）；
  - `wheel` 重置（:180）；窗口 `blur` → 300ms 隐藏（:151-154）；
  - 点击穿透（桌面宠物）时 `suppressPointerReveal` 强制隐藏且完全不监听（:166-172）。
- 档位切换：`cyclePlayerChromeVisibilityMode`（:69-71）按 always-hidden → always-visible → auto-hide → always-hidden 循环；与设置 `autoHidePlayerChrome` 双向同步（:55-96）。
- 光标：
  - 跟随 chrome：`shouldHidePlayerCursor = isPlayerView && autoHideCursorWithPlayerChrome && playerChromeVisibilityMode === 'auto-hide' && !isMainWindowClickThroughEnabled && isPlayerChromeHidden`（`src/App.tsx:1607-1611`）。
  - 独立空闲：`useIdleCursorHide`，`CURSOR_IDLE_HIDE_MS = 3000`（`src/hooks/useIdleCursorHide.ts:14`），与 chrome 互不依赖（App.tsx:1612-1613）。
  - 两者任一 → 给视觉层加 `cursor-auto-hidden`（App.tsx:2791）。
- 播放页外观设置（`src/stores/usePlayerChromeSettingsStore.ts:40-76`）：`hidePlayerProgressBar`、`playerBottomBarOffset`、`playerControlSlotPrimary/Secondary`、`hidePlayerRightPanelButton`、`alwaysShowPlayerBackButton`、`alwaysShowTrackSwitchButtons`、`alwaysShowMainWindowTitlebar`、`hideFullscreenButton`、`useNativeMacFullscreenButton`、`transparentPlayerBackground`、`enablePlayerPageNativeBlur`、`autoHidePlayerChrome`、`autoHideCursorWithPlayerChrome`、`hideCursorWhenIdle`、`showOpenPanelCloseButton`。
- 接线：`src/App.tsx:497-508` 把 `autoHidePlayerChrome / initialPlayerChromeHidden / suppressPointerReveal(=点击穿透) / setIsPlayerChromeHidden / handleToggleAutoHidePlayerChrome` 交给 `usePlayerChromeAutoHide`，并弹状态条（`status.playerChromeAutoHide` 等，`src/i18n/locales/en.ts:331-333`）。

## A7 进入 / 退出全屏歌词

- 进入：`navigateToPlayer`（`src/hooks/useAppNavigation.ts:348`）把 `currentView` 切到 `'player'`。没有独立的全屏歌词窗口；OS 全屏是另一码事（`hideFullscreenButton` / `useNativeMacFullscreenButton`，`src/components/modal/settings/pages/DesktopPage.tsx:87-94`）。
- 退出视觉页面：shell 的返回键 → `onBack`（回到首页/上一视图）。
- 隐藏/唤回 chrome 的入口：
  - 快捷键 `KeyH`：仅播放页、面板未开、无阻塞窗口时循环三档，并弹状态条（`src/components/app/playback/bridges/usePlaybackInteractionBridge.ts:345-351`）；`KeyP` 开合面板（:352-359）。
  - 遥控窗三档：`src/components/remote/RemoteSheet.tsx:171-183`，`sendRemoteCommand({ type: 'set-player-chrome-visibility-mode', mode })`。
  - 设置页：`src/components/modal/settings/pages/PlayerPage.tsx`（`autoHide` 定义 :40 / 行 :218、`hideProgressBar` :55、`alwaysBackButton` :58 / 行 :367）；`DesktopPage.tsx:63-68`（全屏按钮、native mac 全屏）；`GraphicsPage.tsx:32,65,94`（native blur）。
- 鼠标停住不动 → 3s 后胶囊/返回键/进度条一起隐藏；任何 mousemove/点击/滚轮 → 立刻回来并重新计时（见 A6）。

## A8 竖屏 / 横屏

- 主播放页**没有**竖/横两套规则：样式与外壳都按窗口实际尺寸布局（小图预览也是拿窗口尺寸当舞台，见 C3）。
- 只有 OBS 浏览器源按横竖选基准分辨率：`isPortrait = innerHeight > innerWidth` → `baseWidth = 1080 : 1920`（`src/components/obs/ObsBrowserSourceApp.tsx:76-77`、`src/components/obs/ObsWebSourceApp.tsx:105-106`）。

---

# B. 背景系统

## B1 文件清单（`src/components/visualizer/backgrounds/`，39 个文件）

- 顶层：`VisualizerBackgroundRenderer.tsx`(17)、`definition.ts`(145)、`registry.tsx`(95)、`useBlendedColors.ts`(67)
- `common/`：`entry.tsx`(111)、`CommonBackgroundSettingsCard.tsx`(66)、`FluidBackground.tsx`(607)、`GeometricBackground.tsx`(352)、`GeometricBackground.css`
- `latent/`：`entry.tsx`(107)、`LatentBackground.tsx`(410)、`LatentBackgroundSettingsCard.tsx`(183)、`tuning.ts`(72)
- `monet/`：`entry.tsx`(107)、`MonetBackgroundLayer.tsx`(289)、`MonetBackgroundSettingsCard.tsx`(294)、`imageUpload.ts`(47)、`monetBackgroundDrift.ts`(97)、`tuning.ts`(125)
- `nomand/`：`entry.tsx`(95)、`NomandBackgroundLayer.tsx`(206)、`NomandBackgroundSettingsCard.tsx`(130)、`NomandBackgroundEffectPanel.tsx`(15)、`NomandBackgroundEffectSettings.tsx`(85)、`NomandDitheringSettings.tsx`(64)、`NomandFlutedGlassSettings.tsx`(53)、`NomandHalftoneDotsSettings.tsx`(63)、`NomandLensDistortionSettings.tsx`(53)、`NomandPaperTextureSettings.tsx`(53)、`nomandShaderAdjustments.ts`(122)、`tuning.ts`(140)
- `sora/`：`entry.tsx`(59)、`SoraBackground.tsx`(236)、`SoraBackgroundSettingsCard.tsx`(31)、`tuning.ts`(38)
- `url/`：`entry.tsx`(43)、`UrlBackgroundLayer.tsx`(89)、`UrlBackgroundSettingsCard.tsx`(142)、`settings.ts`(110)

## B2 契约与注册

`src/components/visualizer/backgrounds/definition.ts`：

- `VisualizerBackgroundConfig`（:27-43）：`mode?`、`transparent?`、`common?: { useCoverColorBg?, opacity?, disableGeometricBackground?, disableVignette? }`、`customImage?: MonetBackgroundImage | null`、`url?: { items?, selectedId? }`。各模式自己的调参用 `declare module` 挂到 `config[<mode>].tuning`（`BackgroundTuningSlot<T>`，:17-25）。
- `VisualizerBackgroundActions`（:45-66）：`onModeChange`、`common.*`、`customImage.onUpload/onClear/isLoading`、`url.onAdd/onUpdate/onDelete/onSelect`，各模式 `onTuningChange/onResetTuning`。
- `VisualizerBackgroundRenderProps`（:68-86）：`config, theme, isDaylight, coverUrl, audioPower, audioBands, seed, staticMode, paused, blendMs?, blendProgress?`。
- 设置面板 / 快捷控件 props（:88-107）。
- `VisualizerBackgroundRegistryEntry`（:109-139）：`mode, order, labelKey, labelFallback, glyph?, command?, song?, render, renderSettingsPanel?, renderQuickControls?, resetSettings?, beatEffects?`。
  - `song`：返回该模式「随歌变化」的输入数组；有 `song` 的模式换歌时挂新副本并走 soft-focus 过渡，无 `song` 的原地 blend（`blendMs/blendProgress`）。
  - `command`：命令面板里的 `background-<mode>` 切换命令。
  - `beatEffects`：智能动感模式下该背景可用的节拍效果。
- `defineVisualizerBackground`（:145）。

`registry.tsx`：

- `import.meta.glob<…>('./*/entry.tsx', { eager: true })` 自动发现（:11），按 `order` 排序（:30），重复 mode 抛错；`assertBuiltinModeList` 对齐 `BUILTIN_VISUALIZER_BACKGROUND_MODES`（:42-46）。
- `getVisualizerBackgroundRegistryEntry` 找不到时回落到 `DEFAULT_VISUALIZER_BACKGROUND_MODE`（:54-57）；`getVisualizerBackgroundModeLabel`（:59-66）。
- 模组运行时注册：`appendVisualizerBackgroundEntry` / `removeVisualizerBackgroundEntry`，id 前缀 `mod:<modId>:<id>`（:68-95）。

`VisualizerBackgroundRenderer.tsx`：`transparent` → null；否则 `mode ?? DEFAULT` 取注册项并 `render(props)`（:8-15）。

## B3 六个模式逐一

| mode | order | 画什么 | 关键文件 |
| --- | --- | --- | --- |
| `common` | 10 | 主题底色 +（可选）封面取色流体 + 几何图形层/暗角 | `backgrounds/common/entry.tsx` |
| `monet` | 20 | worker 烘焙的封面/上传图 poster（模糊、overlay、灰度、饱和、wash、1px 竖纹、缓慢漂移） | `backgrounds/monet/*` + `visualizer/monet/monetBackgroundPipeline.ts` |
| `nomand` | 30 | `@paper-design/shaders-react` 的五种图像处理（抖动 / 凹槽玻璃 / 纸纹 / 半调网点 / 镜头畸变） | `backgrounds/nomand/*` |
| `latent` | 35 | 两层 Paper shader：上层 `Dithering`、下层 `MeshGradient`，颜色取自封面 | `backgrounds/latent/*` |
| `url` | 40 | iframe 嵌网页 | `backgrounds/url/*` |
| `sora` | 50 | WebGL `GL_POINTS` 星空（150 粒子） | `backgrounds/sora/*` |

细节：

- **common**（`common/entry.tsx`）
  - `useCoverColorBg` 为真时先画 `<FluidBackground coverUrl theme/>`（`absolute inset-0 z-0`，:52-56）；
  - 再盖一层主题底色 div，`opacity = useCoverColorBg ? common.opacity ?? 0.75 : 1`，`transition-all duration-1000`（:57-63）；
  - `!staticMode` 时画 `<GeometricBackground … hideShapes={disableGeometricBackground} disableVignette={disableVignette} paused/>`（:64-76）。
  - 形状类型 `circle | square | triangle | cross`，按 bass/lowMid/mid/vocal/treble 缩放，可换成主题图标（`GeometricBackground.tsx:19-32,49-83`）。
  - `FluidBackground` 用两个 2D canvas（source/output）采样封面做软焦流体；iOS Safari 专用小尺寸采样 `IOS_SOFT_FOCUS_SAMPLE_SIZE=24 / OUTPUT=96`（`FluidBackground.tsx:10-11,42-50,127-147`）。
  - 快捷控件：封面取色开关 + 暗角开关（:81-104）；`resetSettings` → opacity 0.75、coverColor false、vignette 不关、几何不关（:105-110）。
- **latent**（`latent/entry.tsx`）
  - 直接渲染 `<LatentBackground tuning={config?.latent?.tuning} blendMs blendProgress/>`（:59-71）。
  - 无 `song`：换歌颜色原地过渡。
  - `beatEffects: [{ id: BEAT_EFFECT_IDS.latentPulse, retired: true }]`——智能动感用 beat_this 节拍替代频段 onset，2026-10-17 用户搁置，代码保留（:51-57；`LatentBackground.tsx` 顶部注释）。
  - 快捷控件：`displayMode` 循环（dithering/mesh/both）、`colorSource` 循环（cover-theme/cover-only）、`overlayEnabled`（:79-105）。
- **monet**（`monet/entry.tsx`）
  - `song: [resolveMonetSourceUrl(coverUrl, customImage, tuning)]`（:31-33）：来源切 `cover-derived` / `uploaded-global`。
  - `MonetBackgroundLayer.tsx` 顶部注释：图在 worker 里烘焙，`PIPELINE_DEBOUNCE_MS = 180`（:17）；管线 `src/components/visualizer/monet/monetBackgroundPipeline.ts`（模块级缓存 Map，加载图片→交给 worker `monetBackground.worker.ts` 画）。
  - 快捷控件：layout（full-overlay ↔ half-pane-gradient）、source、streaks、drift（:64-105）。
  - 亮度/漂移：`monetBackgroundDrift.ts`。
- **nomand**（`nomand/entry.tsx`）
  - `song: [resolveNomandSourceUrl(...)]`（:39-41）：shader 一次画一张图、不能交叉淡入，换图=换副本。
  - 用 `@paper-design/shaders-react` 的 `ImageDithering / FlutedGlass / PaperTexture / HalftoneDots / LensDistortion`（`NomandBackgroundLayer.tsx:2-9`），`useShaderDrawn` 等第一帧（:35-45）。
  - 五种效果的参数分组面板在 `Nomand*Settings.tsx`；`nomandShaderAdjustments.ts` 处理 overscan/日光反相。
  - 快捷控件：source、effect 循环、overlay（:62-93）。
- **sora**（`sora/entry.tsx`）
  - 外壳 `absolute inset-0 z-0`，底色 `isDaylight ? '#ffffff' : '#000000'`；`tuning.blank` 时不挂 WebGL，只留纯色（:32-38）。
  - `SoraBackground.tsx`：`PARTICLE_COUNT = 150`（:22），顶点着色器 GL_POINTS（:24 起）；`paused || staticMode` 冻结；无 `song`，主题色 blend。
- **url**（`url/entry.tsx`）
  - `<UrlBackgroundLayer urlBackgroundList={config?.url?.items} urlBackgroundSelectedId={config?.url?.selectedId}/>`（:26-31）。
  - `UrlBackgroundLayer.tsx`：iframe，`key={url}` 强制重建避开 `chrome-error://chromewebdata`；等容器有尺寸再建 iframe；URL 经 `sanitizeUrlBackgroundItem` 清洗。
  - 设置卡支持增/改/删/选中（`UrlBackgroundSettingsCard.tsx`，`settings.ts`）。

## B4 调参键与默认值

类型/默认值集中在 `src/types.ts:955-1095`。

- `MonetBackgroundTuning`（:955-972）+ `DEFAULT_MONET_BACKGROUND_TUNING`（:1034-1048）：
  `backgroundSource: 'cover-derived'`、`backgroundLayout: 'full-overlay'`、`backgroundBlurPx: 6`、`backgroundOverlayOpacity: 0.74`、`backgroundGrayscale: 0`、`backgroundSaturation: 1.05`、`backgroundWash: 0.34`、`backgroundHalfPaneOffsetX: 0`、`backgroundWashColorMode: 'theme'`、`backgroundWashCustomColor: '#8fb7ff'`、`backgroundDriftEnabled: true`、`backgroundDriftStrength: 0.5`、`backgroundStreaksEnabled: true`。
- `NomandBackgroundTuning`（:974-998）+ 默认（:1050-1074）：
  `imageSource: 'cover-derived'`、`effect: 'dithering'`、`ditheringType: '8x8'`、`size: 3`、`colorSteps: 4`、`originalColors: false`、`inverted: false`、`flutedGlassSize: 0.5`、`flutedGlassDistortion: 0.5`、`flutedGlassBlur: 0.08`、`paperTextureContrast: 0.32`、`paperTextureRoughness: 0.42`、`paperTextureFiber: 0.3`、`halftoneDotsSize: 0.5`、`halftoneDotsRadius: 1.25`、`halftoneDotsContrast: 0.4`、`halftoneDotsOriginalColors: false`、`halftoneDotsInverted: false`、`lensDistortionSpread: 0.45`、`lensDistortionBulge: 0.3`、`lensDistortionDispersion: 0.65`、`overlayEnabled: true`、`overlayOpacity: 0.35`。
- `LatentBackgroundTuning`（:1000-1015）+ 默认（:1076-1091）：
  `displayMode: 'both'`、`colorSource: 'cover-theme'`、`dynamicOnlyInPlayer: true`、`enhancedBeatResponse: true`、`ditheringSpeed: 0.1`、`ditheringAudioSpeed: 1.2`、`ditheringSize: 2.5`、`ditheringOpacity: 0.55`、`meshSpeed: 0.3`、`meshAudioSpeed: 2`、`meshDistortion: 0.8`、`meshSwirl: 0.1`、`overlayEnabled: true`、`overlayOpacity: 0.35`。
- `SoraBackgroundTuning`（:1017-1020）+ 默认（:1093-1095）：`blank: false`（true 时跳过 WebGL，只画纯黑/纯白）。
- 每个模式的 `tuning.ts` 用 `defineBackgroundTuning` 声明：`mode`、`defaults`、`settingsKey`（如 `latentBackgroundTuning`）、`settingsSetterKey`、`settingsResetterKey`、`storage.key`（如 `'latent_background_tuning'`）、`read/merge` 里的 clamp 范围、`resetNotice`（`notifications.latentBgReset`）。见 `backgrounds/latent/tuning.ts:60-72`。
  - latent clamp：speed 0–2、ditheringSize 0.5–8、distortion 0–2、swirl 0–1、opacity 0–1（:46-57）。
- `common.opacity` 默认 **0.75**（`backgrounds/common/entry.tsx:61`、reset 在 :105）。
- `useCoverColorBg` 存在主题设置里而非视觉设置（`src/stores/useThemeSettingsStore.ts:65`，键 `use_cover_color_bg`）。

## B5 配置如何装配到 renderer

`src/components/visualizer/useVisualizerBackgroundConfig.ts:15-47`：

- `mode` = `useVisualizerSettingsStore.visualizerBackgroundMode`
- `common.opacity` = `backgroundOpacity`；`disableGeometricBackground` / `disableVignette` 同名设置
- `customImage` = `useVisualizerAssetStore.monetBackgroundImage`（monet/nomand 共用）
- 各模式 tuning = `getBackgroundTunings()` 的 `settingsKey` → `backgroundTuningConfig(tunings)`
- `url.items / selectedId`
- `useCoverColorBg` 来自 `useThemeSettingsStore`

渲染时再覆盖（`useVisualizerRendererModel.ts:124-133`）：`transparent = isPlayerPageTransparent`；`common.disableGeometricBackground ||= isSettingsSubviewOpen`（设置子页盖住几何图形，不白花电）。

同一份 config 也被 OBS 源复用：`src/hooks/useObsBrowserSourcePublisher.ts:124-132`。

## B6 通用旋钮 / 性能开关

- `transparent`（背景全不画）、`common.opacity`（仅封面取色时生效，0–1，默认 0.75）、`common.disableGeometricBackground`、`common.disableVignette`。
- 全局静态：`enableStaticMode`（`src/components/modal/settings/pages/GraphicsPage.tsx:30`，行 :87），传进 render props 的 `staticMode`；背景另有 `backgroundStaticMode`（`VisualizerBackdrop.tsx:82`）。
- 帧率限制：`visualizerFrameRate` / `visualizerFrameRateValue`（`GraphicsPage.tsx:33-34`，选项来自 `src/utils/frameRateLimiter.ts` 的 `VISUALIZER_FRAME_RATE_OPTIONS`）。
- 层不透明度：`visualizerOpacity`（renderer model → Backdrop 的 style opacity，`VisualizerBackdrop.tsx:124`；shell 里非 backdrop 时也用它，`VisualizerShell.tsx:92,215`）。
- 原生模糊 `enablePlayerPageNativeBlur`（`GraphicsPage.tsx:32,65,94`；`src/hooks/useElectronWindowChrome.ts:21-46`）。
- 背景切换过渡：`VisualizerBackgroundTransition`（`src/components/visualizer/styleTransition/VisualizerBackgroundTransition.tsx`），新背景等样式切换的 first frame（`waits`）。

## B7 资源 / worker 依赖

| 模式 | 资源 | worker / GPU |
| --- | --- | --- |
| common | 封面（`coverUrl`，1024 尺寸）、`GeometricBackground.css` | `FluidBackground` 两个 2D canvas（主线程） |
| latent | 封面取色 | 两个 Paper shader（WebGL，`@paper-design/shaders-react` 的 `Dithering` + `MeshGradient`） |
| monet | 封面或用户上传图（`useVisualizerAssetStore`） | **Worker**：`src/components/visualizer/monet/monetBackground.worker.ts`（`monetBackgroundPipeline.ts` 调度，`monetBackgroundPaint.ts`）；画布缓存按图片 URL 复用 |
| nomand | 封面或同一张上传图 | `@paper-design/shaders-react`：`ImageDithering / FlutedGlass / PaperTexture / HalftoneDots / LensDistortion`（WebGL） |
| sora | 无图 | 自写 WebGL 星空（`PARTICLE_COUNT=150`，GL_POINTS） |
| url | iframe 内网页 | 无 |

---

# C. 样式网格的 16:10 小图（设置界面用）

## C1 网格本身

`src/components/modal/settings/kit/PictureGrid.tsx`：

- 每格（`Tile`，:68-96）：
  ```tsx
  <button role="radio" aria-checked={chosen} className="group flex min-w-0 flex-col rounded-lg text-xs leading-[18px]">
      <span className="relative block aspect-[16/10] w-full">
          <span className="… absolute inset-0 overflow-hidden rounded-lg bg-[var(--st-pv)] …">{picture(value, state)}</span>
  ```
  ——**16:10 由 `aspect-[16/10]` 定**（:77），底色 `var(--st-pv)`，内描边 `shadow-[inset_0_0_0_1px_var(--st-line)]`（:80），选中环 `motion.span layoutId` 在格子外 3px（:82-90），名字在下方（:92）。
- 常量：`RING_ROOM = 4`（:22）、`FADE = 40`（:24，底部渐隐）。
- `PictureState = { visible, chosen, active }`（:28-34）：`visible` 由 `IntersectionObserver` 实时给出（:116-130，不可用时全部当可见）；`active` 是「指针在这一格上」；`chosen` 是当前选中。网格只在状态变化时重画该格（`memo`）。
- 键盘：Tab 只到选中格，方向键/Home/End 选择或只移焦点（`arrowKeys: 'choose' | 'focus'`，:16-19）。
- 列数与最大高度由调用方给（`columns`、`maxHeight`）：`AppearanceSection` 用 `ModeStepperRow` 里嵌的网格，`VisPlayground` 用 `PictureGrid`（`src/components/visualizer/window/VisPlayground.tsx:517`）。

## C2 一个格子画什么（LyricStylePicture）

`src/components/visualizer/preview/LyricStylePicture.tsx`：

- 不挂 `VisualizerRenderer`，只调用**真样式**的 registry `render`，并把参数按预览改写（:24-49）：
  ```tsx
  getVisualizerRegistryEntry(mode).render(applyVisualizerTuning(mode, {
      ...look,
      currentTime: tap.currentTime,
      duration: clock.placeholder.loopDuration,
      currentLineIndex: tap.currentLineIndex,
      lines: clock.placeholder.lines,
      theme, isDaylight,
      audioPower: tap.audioPower,
      audioBands: tap.audioBands,
      songTitle: clock.placeholder.title,
      coverUrl: clock.placeholder.coverUrl,
      showText: true,
      isPreviewMode: true,
      background: NO_BACKGROUND,          // { mode: DEFAULT, transparent: true }
      subtitleContentMode: 'none',
      showSubtitleTranslation: false,
      showHarmonySubtitle: false,
      hideTranslationSubtitle: true,
      seed: getVisualizerScopedSeed(mode, 'style-picture'),
  }, look.visualizerTunings));
  ```
- `NO_BACKGROUND`（:21）：小图**不画背景、不画字幕**，只画样式本身，底色是主题背景色（`PictureFrame` 的 `theme.backgroundColor`）。
- 采样歌曲 = `PreviewPlaceholder` 的样本（不是当前播放的歌），当前播放的歌不影响小图。
- 模组影响也进图片键：`useFoliumVisualizerSettings(mode)`、`useFoliumTunings(mode)`（:62-63）。
- `imageKey = stylePictureKey({ mode, stage, theme, isDaylight, sample: clock.placeholder.id, fontScale, tuning, modSettings, modTunings }, cappellaCustomEmojiImages, cappellaCustomAvatarImages, monetPortraitImage)`（:64-79）：任一变化即重做图。
- 出不了图（WebGL 不可用/样式抛错）→ 显示 `VisualizerModeGlyph size={22}`（:82）。

## C3 LivePicture：小尺寸怎么「真的跑」

`src/components/visualizer/preview/LivePicture.tsx`：

- **舞台 = 窗口大小**，不是小框大小：`const onStage = stageStyle(stage, coverStage(stage, box))`（:159），`stageStyle` = `left/top + width/height = stage + transform: scale(place.scale) + contain: 'strict'`（:69-77）。原因见 `previewScale.ts:1-7`：不少样式按窗口尺寸排版，Pixi 画布最小 320×240，直接塞进小框会错。
- `coverStage` 取两个方向比例的**较大者**并居中（`previewScale.ts:31`），所以小框是「窗口的裁切」而不是等比缩小全景。
- 每张图只真画两次（:13-19 注释）：
  1. **出图**：轮到自己时，在屏幕外挂舞台、用**停住的时钟**画一帧 → `freezeStage` 拷成 DOM/画布副本 → 卸载舞台（`making`，:213-221）；
  2. **指针停留**：`active && !chosen` 时真跑（`live`），跑出第一帧后替换图片（:245-256）。
  其余时刻显示缓存的图片副本（`ImageOnStage` 用 `copyImage` 手工搬节点，:131-137）。
- 排队与时机：
  - 全局同一时刻只允许一张图出图/跑（`pictureTurns.ts` 的 `takeTurn / claimRun / whenFree`）；
  - 出图前 `requestIdleCallback(timeout 500)`（:35-42）；
  - 指针停留 `LIVE_REST_MS = 280ms` 才真跑（`pictureRule.ts:25`）；
  - 首次出图等 `FIRST_IMAGE_REST_MS = round(KIT_MOTION.unfold*1000)+150`（:35）；内容变了等 `NEW_IMAGE_REST_MS = 1200ms`（:37）；
  - `chosen` 的格子**不跑也不重做图**（大图/播放页已经在展示它的实时效果，`pictureRule.ts:6-8,59-64`）；
  - 空舞台最多试 `IMAGE_TRIES = 2` 次，之后永久显示 glyph（:74-87）。
- 安全：`PictureStageBoundary` 捕获样式抛错/模块加载失败，只毁这一格，日志 `'[LivePicture] A style threw on the stage of a picture:'`（:113-128）；`Suspense fallback={<i WAIT_MARK/>}` 让冻结逻辑知道「模块还在加载」；卸载时 `followCanvases` 释放 WebGL 上下文（:261-264）。
- 性能依据（`pictureRule.ts:10-19`，生产构建 + RTX 4090 + 160Hz）：14 张图同时真跑 18.7–37.6 ms/帧；4 个纯 DOM 样式「暂停」也占 9–18% 主线程；首次绘制 WebGL/canvas 样式 0.1–0.6 s。这就是「默认只显示截图」的原因。

## C4 时钟与样本数据

- `LyricPreviewContext.tsx`：`LyricPreview { clock, theme, isDaylight, look, background?, stage, making }`（:23-39）；`LyricPreviewLook = Pick<VisualizerSharedProps, 'visualizerTunings' | 'lyricsFontScale' | 'cappellaCustomEmojiImages' | 'cappellaCustomAvatarImages' | 'monetPortraitImage'>`（:18-21）；`stage` = `useWindowSize()`（:44-56,61）；Provider 把 theme 换成 `themeForPictures(theme)`（:63）；无 Provider 直接抛 `'[LyricPreview] A picture was drawn outside a LyricPreviewProvider'`（:69-74）。
- `usePreviewClock.ts`：**一个 rAF 循环**驱动 `currentTime / audioPower / 6 段 audioBands`（`useVisPlaygroundPreviewPlayback`，:57-70），`PreviewClock` 定义在 :19-27；起点按样式错开 `getPreviewPlaceholderStartOffset(mode, loopDuration)`（:72-75）；`currentLineIndex` 由 `useMotionValueEvent(currentTime)` 求（:77-80）。
- 每格 `useClockTap(clock, running)`（:116-164）：
  - 不跑时停在 `posterTime`（第二行 60% 处，:89-92），并**每帧把时间 ±0.0001 抖动**（`HELD_TIME_STEP`，:95），因为有些样式只在收到时间变化时才画当前行（:133-146）；
  - 跑时把 tap 的 motion value 逐个接到时钟的 `on('change')` 上（:147-153）。
- 样本：`src/components/visualizer/PreviewPlaceholder.ts` 的 `DEFAULT_PREVIEW_PLACEHOLDER_LINES`——日文/英文/法文三行主歌词，各带 `translation`、`romanization`、逐字 `words`、`backgroundVocal`（和声）；封面用 `assets/placeholder_cover.jpg` 与 `assets/placeholder_cover-2.jpg`（:1-6 导入）。
- 尺寸工具：`previewScale.ts` 另有 `fitStage`（:37）、`frameStage`（:56-100，边缘取整避免合成层亮线）、`placeOnStage`（:106）、`stageAboveBox/stageBelowBox`（:113-120）。

## C5 背景模式的格子（对照）

`src/components/visualizer/preview/BackgroundPicture.tsx`：`config = { ...background, mode, transparent: false }`（:23），`coverUrl` 用样本封面，`seed = 'background-picture-' + mode`，`staticMode=false / paused=false`；`url` 模式**永不加载**（`NEVER_DRAWN = new Set(['url'])`，:17），只显示 glyph。其余机制与样式格子共用 `LivePicture`。

## C6 谁在用这两个格子

- 播放页右侧面板「外观」：`src/components/panelTab/controls/AppearanceSection.tsx` —— `drawStyle`（:59）、`drawBackground`（:60）、`openPicker`（:109）、`previewClock` 只在选择器打开时才走（:126）、`LyricPreviewProvider` 包住两行 `ModeStepperRow`（:200-250），`making={panelMakesImages({ playing, pickerOpen })}`；打开面板设置走 `openSettings('options','visualizer','background')`（:147-150）。
- 歌词样式工作台 `src/components/visualizer/window/VisPlayground.tsx:119,517`；其设置面板 `VisPlaygroundSettingsPanel.tsx:129,321`（背景格）。
- 字体网格 `src/components/visualizer/window/FontTiles.tsx:38` 也用 `PictureGrid`（但只画字形，不用 LivePicture）。

---

# 附：实施时最容易踩的点

1. `player-visual-surface` 的 class 只有 `absolute inset-0 z-0`（加条件类），**不要**再加 `relative` 或背景色；背景由内部图层负责，透明/原生模糊靠 `background.transparent`（`backgrounds/VisualizerBackgroundRenderer.tsx:9-11`）。
2. 返回键的命中区是 120×120，不是按钮本身；`alwaysShowPlayerBackButton` 或面板打开时才常显（`useVisualizerRendererModel.ts:176`）。触摸只能靠右下热点显示 1.4s 的引导（`VisualizerShell.tsx:151-160`）。
3. 右下热点同时驱动 `PanelHandle` 的引导线（`useAppChromeStore.isPlayerPanelGuideHotspotActive` → `PanelHandle.tsx:53`），所以改热点尺寸会同时影响两处。
4. 小图默认只显示冻结截图；改样式参数后要等 1.2s 才重做图，`chosen` 的格子不会重做——调试时别把它当实时预览（`pictureRule.ts:37,59-64`）。
5. 背景换歌行为由 entry 的 `song` 决定：有 `song` 的模式（common/monet/nomand）换歌=新副本 + soft focus，无 `song`（latent/sora）原地 blend；`url` 两者都不是，靠 `config.url` 变化重建 iframe。
