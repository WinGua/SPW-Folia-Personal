# Folia 歌词样式映射表（style-map）

> 交付物 1 / task-2。来源：`work/folia/folia-major-main`（v0.7.21 源码）与 `C:\Program Files\Folia\resources\app.asar`（解包于 `/c/tmp/asar`，内 `package.json` 同为 0.7.21）。
> 本文所有结论都带 `文件:行号` 证据。文档其余部分见 `settings-ui.md`、`runtime-contracts.md`、`fullscreen-shell.md`、`assets.md`。

## 0. 一句话结论

设置窗左侧「样式」是 14 个**实时绘制**的预览格（无图片资源），顺序 = 各 `entry.tsx` 的 `order` 升序；与截图 1 的 2 行 × 7 完全一致。第 13 个是 **镜台（diorama）**，不是「铭台」——见 §2。

网格布局常量：`SHELF_COLUMNS = { wide: 7, narrow: 4 }`（`src/components/visualizer/window/VisPlayground.tsx:110`），宽窗 7 列 × 2 行；`PictureGrid` 在 `VisPlayground.tsx:517`，标题 `t('options.lyricStyles')` =「样式」（`VisPlayground.tsx:514`，`src/i18n/locales/zh-CN.ts:2261`）。注册表按 `order` 排序（`src/components/visualizer/registry.tsx:36`、`:91`），成员由 `import.meta.glob('./*/entry.tsx', { eager: true })` 发现（`registry.tsx:15`）。

## 1. 14 样式主表（网格顺序 = order 升序）

| # | 中文名 | mode id（=目录名） | labelKey / zh 值 | order | entry.tsx:行 | 渲染技术 | tuning 存储键 | 背景 | 额外声明 |
|---|--------|------------------|------------------|-------|--------------|----------|----------------|------|----------|
| 1 | 商籁 | `sonnet` | `ui.visualizerSonnet` 商籁 | 10 | `sonnet/entry.tsx:25` | **pixi.js(WebGL) + @chenglou/pretext** | `sonnet_tuning` | props（默认 latent） | `usesWordSegmentation`、`ownFontSizeNoticeKey`、beatEffect 推镜裂光 |
| 2 | 凝彩 | `tempera` | `ui.visualizerTempera` 凝彩 | 20 | `tempera/entry.tsx:21` | **pixi.js(WebGL) + pretext** | `tempera_tuning` | props | `usesWordSegmentation`、`ownFontSizeNoticeKey`、图片图层池(IndexedDB) |
| 3 | 绘光 | `lumiere` | `ui.visualizerLumiere` 绘光 | 25 | `lumiere/entry.tsx:15` | **pixi.js(WebGL) + pretext** | `lumiere_tuning` | props | `usesWordSegmentation`、`ownFontSizeNoticeKey` |
| 4 | 流光 | `classic` | `ui.visualizerClassic` 流光（fallback 写 `Luminous`） | 30 | `classic/entry.tsx:14` | framer-motion（DOM/Canvas） | `classic_tuning` | props | `usesWordSegmentation`；逐词发光共用 `GlowWord.tsx` |
| 5 | 心象 | `cadenza` | `ui.visualizerCadenze` 心象（键名拼写就是 Cadenze） | 40 | `cadenza/entry.tsx:26` | framer-motion + pretext | `cadenza_tuning` | props | 无 |
| 6 | 云阶 | `partita` | `ui.visualizerPartita` 云阶 | 50 | `partita/entry.tsx:14` | framer-motion（DOM/inline SVG） | `partita_tuning` | props | `usesWordSegmentation`；`PartitaChunk.tsx` |
| 7 | 浮名 | `fume` | `ui.visualizerFume` 浮名 | 60 | `fume/entry.tsx:21` | Canvas2D + pretext | `fume_tuning` | **entry 覆盖**：`background: fumeBackgroundConfig`（`entry.tsx:39`，关掉几何图形） | `previewStartOffset: 18.4` |
| 8 | 倾诉 | `tilt` | `ui.visualizerTilt` 倾诉 | 70 | `tilt/entry.tsx:21` | framer-motion + pretext | `tilt_tuning` | props | 无 |
| 9 | 回环 | `claddagh` | `ui.visualizerCladdagh` 回环 | 80 | `claddagh/entry.tsx:14` | framer-motion + pretext | `claddagh_tuning` | props | 无 |
| 10 | 莫奈 | `monet` | `ui.visualizerMonet` 莫奈 | 90 | `monet/entry.tsx:14` | Canvas/Worker + pretext | `monet_tuning` | props | `seeksOnLineClick`、`followsSongHandoff`（唯一画混音交接） |
| 11 | 时计 | `pendolo` | `ui.visualizerPendolo` 时计 | 100 | `pendolo/entry.tsx:22` | WebGL(表盘)+Canvas2D 双实现 + pretext | `pendolo_tuning` | props | `seeksOnLineClick`、beatEffect 仿真鼓面 |
| 12 | 群唱 | `cappella` | `ui.visualizerCappella` 群唱 | 110 | `cappella/entry.tsx:23` | framer-motion + pretext | `cappella_tuning` | props | 头像/表情图（内置 + 自定义包） |
| 13 | **镜台** | `diorama` | `ui.visualizerDiorama` 镜台 | 120 | `diorama/entry.tsx:16` | **three.js(WebGL)** | `diorama_tuning` | props（场景自带雾带尘埃） | beatEffect 水镜涟漪 |
| 14 | 静止 | `still` | `ui.visualizerStill` 静止 | 130 | `still/entry.tsx:10` | 纯 DOM | 无（无 tuning.ts） | **`background: false`**（`still/entry.tsx:29`） | 无 |

补充事实：

- 14 个 id 的权威清单在 `src/types/visualizerModes.ts:17-32`（`BUILTIN_VISUALIZER_MODES`）；默认样式 `DEFAULT_VISUALIZER_MODE = 'classic'`（同文件 ~:49），默认背景 `DEFAULT_VISUALIZER_BACKGROUND_MODE = 'latent'`（~:50）。
- 每个样式必有 `previewSeed`（= 自身 id，除 fume 偏移 18.4s）与 `previewStartOffset`；预览图即用真渲染器画。
- `labelFallback` 只有部分样式是中文（商籁/绘光/云阶/镜台），其余是英文 id 风格名；**显示名以 zh-CN 的 `ui.visualizer*` 为准**（`zh-CN.ts:856-869`），不是 fallback。
- 每个样式声明了 `glyph`（24×24 线性图标，`modeGlyphs.tsx` 体系）与 `command`（命令面板 id `visualizer-<mode>`，keywords 含中文名与「切换到可视化：X」）。
- 13 个样式有 `tuning.ts`（`still` 除外）；全部遵循 `defineVisualizerTuning`：`settingsKey`、`settingsSetterKey`、`settingsResetterKey`、`storage.key`（`<mode>_tuning`），`defaults` 来自 `src/types.ts` 的 `DEFAULT_<MODE>_TUNING`。逐键默认值见 `settings-ui.md` §4。
- `usesWordSegmentation: true`：`classic/lumiere/partita/sonnet/tempera` 的布局原子来自整行分词（用户保存的分词会影响画面）。
- `ownFontSizeNoticeKey`：`sonnet/tempera/lumiere` 自己算字号，设置窗在字号开关处显示提示；通用字号对这些样式（部分）无效。

## 2. 命名纠错：第 13 个是「镜台」，不是「铭台」

- `src/i18n/locales/zh-CN.ts:865` → `"visualizerDiorama": "镜台"`；`:774` 命令「切换到可视化：镜台」；`:275` `"dioramaReset": "镜台参数已重置"`；`:2560` `"dioramaSettings": "镜台参数"`。
- `diorama/entry.tsx:18` `labelFallback: '镜台'`；全仓库 `grep 铭台` 无命中；解包后的 `C:\tmp\asar\dist\assets\*.js` 里 `镜台` 有、`铭台` 0 次。
- 结论：截图 1 / 原始需求里的「铭台」是 OCR/手误；实现 UI 与命令面板一律写 **镜台**。

## 3. 背景系统（与样式解耦，一次画在样式外）

- 6 个背景 mode（`src/types/visualizerModes.ts:34-41`）：`common` 通用、`latent` 隐现（默认）、`monet` 莫奈、`nomand` 漫游、`sora` 空、`url` 嵌入（zh 文案 `zh-CN.ts:2269-2274`）。
- 背景由 `VisualizerBackdrop.tsx` 在所有样式外层画一次，换样式时不重来（`src/components/visualizer/README.md` Runtime flow）。样式默认用用户选的背景；`entry.background` 可覆盖：`fume` 传 `fumeBackgroundConfig`（隐藏几何图形），`still` 传 `false`。
- 背景目录 `backgrounds/` 共 **39 个文件**（6 个 mode 子目录 + `common/ FluidBackground.tsx` 等共享件 + `registry.tsx`/`definition.ts`/`useBlendedColors.ts`/`VisualizerBackgroundRenderer.tsx`）。
- 背景有自己的 tuning（`backgrounds/<mode>/tuning.ts`）与设置卡；`url` 背景的设置不进 tuning，在 `backgrounds/url/settings.ts`。`monet` 背景在混音过渡中跟 `songHandoff` 走（`followsSongHandoff` 只有莫奈）。

## 4. 「缩略图」真相：没有图片资源

- 样式格是**活的**：`LyricStylePicture`（`src/components/visualizer/preview/LyricStylePicture.tsx:59`）按真模式以 `previewSeed` 画一帧冻结画面；`VisPlayground.tsx:119` 的 `drawStyle` 就是 `<LyricStylePicture mode={mode} {...state} />`。
- `src/components/visualizer/README.md:83`：「预览图由 `preview/LyricStylePicture.tsx` 用真的样式现画，不用准备图片。」
- 因此 webview 方案**不需要**提取任何 style thumbnail 资源；只要把 `registry` + `preview/` 一段带进 harness 即可（见 `assets.md` §3 的组件清单）。
- 参考截图（真实全屏画面）来自仓库 `img/`，已复制到 `research/assets/screenshots/`：`preview-{cad,cappella,diorama,fume,lumi,pat,pendolo,tilt}.*`、`visualizer.png`、`head2.png`（README 用于展示各样式，属 AGPL-3.0 资产，见 `assets.md` §1）。

## 5. webview 托管优先级 / 工作量估算

总体判断：**代码可原样托管时，样式本身的移植成本≈0**；成本在 harness（数据层、字体、资产、宿主桥）。按「第一次能画出来并稳定 60fps」的难度排序：

| 优先级 | 样式 | 预估工作量 | 主要依赖/阻塞 | 说明 |
|--------|------|-----------|---------------|------|
| P0 | 静止 still | ~0.5h | 无 | 129 行、纯 DOM，最适合作为通道验证 |
| P0 | 流光 classic | ~0.5h | framer-motion | 487 行；`GlowWord` 即共享逐词发光 |
| P0 | 云阶 partita | ~1h | framer-motion、分词数据 | 799 行，DOM/SVG |
| P0 | 倾诉 tilt | ~1h | framer-motion、pretext 测量 | 785 行 |
| P1 | 心象 cadenza | ~1-2h | pretext（文本测量/落点） | 1813 行、RAF 渲染 |
| P1 | 群唱 cappella | ~2h | 头像/表情 PNG 资产 + 自定义包(IndexedDB) | 2236 行；先内置图即可 |
| P1 | 回环 claddagh | ~2h | pretext | 1307 行 |
| P1 | 浮名 fume | ~2-3h | Canvas2D、pretext article 布局、缓存 | 4518 行；entry 覆盖背景 |
| P2 | 莫奈 monet | ~3h | **Web Worker**（`monetBackgroundPipeline.ts`）、立绘上传/IndexedDB、`followsSongHandoff` | 4094 行；立绘是用户状态，首版可只读内置空状态 |
| P2 | 时计 pendolo | ~4h | WebGL 表盘 + 2D 回退 + 鼓点模型(htdemucs) | 5431 行；无鼓点数据时 `isBeatFxReady()` 走原画面 |
| P2 | 镜台 diorama | ~4-6h | **three.js**（约 +500KB）+ beat 涟漪 | 7003 行；three 只在 diorama 的 lazy chunk 里 |
| P3 | 商籁 sonnet | ~1-2 天 | **pixi.js WebGL2**、pixi 滤镜/纹理池、pretext、beat_this(WebGPU) 模型 | 11613 行；最重的样式，也是截图与需求的主角 |
| P3 | 凝彩 tempera | ~1-2 天 | pixi WebGL2、图片图层池（IndexedDB）、上传/编辑 UI | 11626 行 |
| P3 | 绘光 lumiere | ~1-2 天 | pixi WebGL2、pretext、scene/rigs 体系 | 11695 行 |

共享阻塞项（所有样式通用，需 harness 提供 shim）：

1. **framer-motion `MotionValue`**：所有样式都从 props 拿 `currentTime: MotionValue<number>` 与 `audioPower: MotionValue<number>`；宿主必须提供同名对象（可直接用 framer-motion 本体，或实现 `get/set/on('change')` 的等价物）。
2. **pixi.js v8**（sonnet/tempera/lumiere）：`pixi/create*PixiRuntime.ts` 假定有 WebGL2 上下文与 `pixiRuntimeHost.ts` 的单例生命周期；WebView2 默认有 WebGL2，但要确认 GPU 黑名单与 `--disable-gpu` 不生效。
3. **three.js**（diorama）：只走标准 WebGL2，无 Electron/Node API。
4. **pretext 文本测量**（`@chenglou/pretext`）：需要真实字体文件（见 §6 与 `assets.md` §2），否则测量退化、布局错位。
5. **WebGPU 模型**（智能动感的 beat_this / htdemucs）：`services/analysis/beatThisGpu.ts` 等，**不属于样式**；首版可不跑，效果走 `isBeatFxReady()` 的「没就绪」分支，画面与关闭时逐像素一致（README「各自的读法」）。
6. **`new Worker`**（monet）：WebView2/浏览器都支持；若宿主是 OSR 需确认 worker 加载路径。用 Vite 打包即可解决。
7. **IndexedDB / localStorage**：样式读 tuning 走 store（`src/stores/visualizerSettings*`）；tempera 图片池、cappella 自定义包、monet 立绘用 IndexedDB。首版可用内存实现顶替。
8. **Electron/Node API**：**经核查，visualizer 目录内没有任何 `electron`/`fs`/`node:` import**（样式层是纯浏览器代码）；所有 Electron 依赖都在 `electron/*.cjs`、`src/services/*`（音频分析/模型/文件）层。→ webview 托管天然可行。

## 6. 字体与主题（样式画字依赖）

- 字族解析统一在 `src/utils/fontStacks.ts`：内置三档 `BUILTIN_FONT_STACKS.sans/serif/mono`；`serif` 的显示字体首选 **`"獅尾四季春加糖SC"`**，`sans` 首选 `"Inter"`。译文（字幕）另有 `TRANSLATION_FONT_STACKS`，serif 档含 `"Folia Noto Serif SC"`。
- `src/index.css:19-33` 用 `@font-face` 从 **CDN**（`cdn.jsdmirror.cn`，@fontsource/noto-serif-sc 5.2.9，400/500）加载 `Folia Noto Serif SC`；离线环境会退回系统字体 → webview 中需自带该 woff2 或接受回退。
- 用户可在设置里上传自定义字体（`.woff2/.woff/.ttf/.otf`，`src/services/customLyricsFont.ts`、`window/FontPicker.tsx`），主题里存 `fontFamily`/`fontFamilyStack`，并可选回退族（`FontFallbackStackControl.tsx`）。
- 字重范围 `MIN_FONT_WEIGHT=100 / MAX=900 / STEP=10`（`fontStacks.ts:4-6`），`Theme.fontWeight` 经 `normalizeFontWeight` 归一。
- 字号：样式普遍用 `lyricsFontScale`（0.85–1.4，`VisPlayground.tsx` `clampFontScale`）；字幕字号由 `subtitleFontSizes.ts` 的 `resolveSubtitleFontSizes(lyricsFontScale)` 单点决定（见 `runtime-contracts.md` §6）。
- 主题对象 `Theme` 提供 `fontStyle`、`fontFamily`、`fontFamilyStack`、`fontWeight` 等；颜色走 CSS 变量/theme 色板（`colorMix.ts`），背景与样式的明暗由 `isDaylight` 参与。

## 7. 证据索引

| 事实 | 证据 |
|------|------|
| 14 个 id 清单、默认 classic/latent | `src/types/visualizerModes.ts:17-50` |
| 注册表 glob 发现 + 按 order 排序 | `src/components/visualizer/registry.tsx:15,36,91` |
| 14 个中文显示名 | `src/i18n/locales/zh-CN.ts:856-869` |
| 7 列网格（2 行） | `window/VisPlayground.tsx:110`(`SHELF_COLUMNS`), `:514-517` |
| 预览格是实时渲染 | `preview/LyricStylePicture.tsx:59`, `VisPlayground.tsx:119`, `README.md:83` |
| 各样式 order/label/tuning/背景 | `<mode>/entry.tsx` 同名行（见 §1 表） |
| 13 个 tuning 存储键 | `<mode>/tuning.ts` 的 `storage.key` |
| 智能动感效果登记 | `sonnet/entry.tsx:44`、`diorama/entry.tsx:35`、`pendolo/entry.tsx:45`；id 在 `services/beatFx/beatEffects.ts:38-44` |
| 背景 6 mode | `src/types/visualizerModes.ts:34-41`、`backgrounds/*/entry.tsx` |
| 样式层无 Electron/Node API | `grep -rn "electron\|node:" src/components/visualizer/` 无命中（仅 browser API） |
