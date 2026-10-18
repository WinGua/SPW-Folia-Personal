# Folia 视觉器运行时契约（WebView harness 实现规范）

> 目标：让 WebView2 里的 harness 以 **Folia 自己的 React 组件** 渲染任一歌词样式（fullscreen 与设置页大预览共用同一套）。
> 源：`work/folia/folia-major-main`（v0.7.21）。本文所有行号均指该仓库相对路径；"MV" = framer-motion `MotionValue`。
> 相关文档：`docs/folia-spec/style-map.md`（14 样式/技术栈）、`settings-ui.md`（设置页）、`fullscreen-shell.md`（全屏壳层）、`tunings.md`（各样式默认值）。

---

## 0. 结论先行：harness 最少要提供什么

渲染一个样式，只需 4 类输入，**不需要**播放器/Electron/文件系统：

1. **三个 MotionValue**（framer-motion，模块级单例或自建实例均可）：
   - `currentTime: MotionValue<number>`（秒，歌词时钟；harness 自己 rAF 推进）
   - `audioPower: MotionValue<number>`（**0..255 字节尺度**，非 0..1；暂停时 0..40 呼吸，见 §7.1）
   - `audioBands: { bass, lowMid, mid, vocal, treble }`（各 **0..255** MV）+ 可选 `spectrum: MotionValue<Uint8Array>`（元素 0..255；真机 1024 bin，长度 0/64/256 均可）
2. **离散 props**：`currentLineIndex: number`、`lines: Line[]`、`theme: Theme`（颜色/字体/动画强度）、`showText?`、`coverUrl?`、`seed?`、字号倍率等。
3. **一个样式 mode 字符串**（`'classic' | 'sonnet' | …`，见 style-map.md）→ `<VisualizerRenderer mode={mode} {...props} />`。
4. **i18n 与 CSS**：`i18next` 实例（部分样式用 `t('ui.waitingForMusic')` 等文案）+ Folia 构建出的 Tailwind/kit CSS（`C:\tmp\asar\dist\assets\src-C5rpGEdU.css`）+ `--text-primary` 等全局主题变量；字体按 style-map.md/字体节处理。

> 也就是说：**fullscreen 的全部"外壳"（播放页 chrome、背景层、字幕层、暂停按钮）都可以由插件宿主自己画**，WebView 内部只需 `VisualizerRenderer`。若要 1:1 复刻 Folia 播放页，再按 `fullscreen-shell.md` 补 shell 层。

---

## 1. MotionValue 契约（运行时心跳）

源码：`src/components/visualizer/definition.ts:64-74`、`src/stores/motionSignals.ts:21-64`。

- 应用内这些 MV 是**模块级单例**（`motionValue(0)`），进程生命周期内不变；组件**只读**，永不写入 store。
- 两种消费方式：
  - **词级/帧级**：`useMotionValueEvent(currentTime, 'change', cb)`（如 `GlowWord.tsx:52-60`）或 `useTransform`（如字幕 bottom 距离）。
  - **行级快照**：`useVisualizerRuntime` 直接 `currentTime.get()`（`runtime.ts:130`），**不订阅**；行/`currentLineIndex` 变化靠父组件重新渲染。
- harness 实现建议：
  ```ts
  import { motionValue } from 'framer-motion';
  const currentTime = motionValue(0);
  const audioPower = motionValue(0);          // 0..255
  const audioBands = { bass: mv(0), lowMid: mv(0), mid: mv(0), vocal: mv(0), treble: mv(0),
                       spectrum: motionValue(new Uint8Array(0)) };   // 元素 0..255
  // 每帧：currentTime.set(t); 音频按 §7.2 计算后 .set(v)（务必套 gamma）
  // 行号变化时：setCurrentLineIndex(i)（React state）
  ```
- `currentLineIndex === -1` 表示"当前没有活动行"（行间空隙/前奏）；这是合法且常见的状态，各样式据此显示等待文案或上一句余韵。

---

## 2. `VisualizerSharedProps` 全表（样式 renderer 的输入）

类型定义：`src/components/visualizer/definition.ts:64-131`。

| prop | 类型 | 必需 | 语义 / 来源 |
|---|---|---|---|
| `currentTime` | `MotionValue<number>` | ✅ | 歌词时钟（秒）。所有词/行动画的时间基准 |
| `duration` | `number?` | | 歌曲总时长秒；未知=0 |
| `currentLineIndex` | `number` | ✅ | 当前活动行下标；`-1`=无活动行 |
| `lines` | `Line[]` | ✅ | 全部歌词行（见 §3） |
| `theme` | `Theme` | ✅ | 当前歌曲主题（颜色/字体/动画强度/wordColors） |
| `subtitleTheme` | `Theme?` | | 字幕专用主题（缺省=theme） |
| `isDaylight` | `boolean?` | | 亮色主题（影响部分样式的配色/后处理） |
| `audioPower` | `MotionValue<number>` | ✅ | **0..255**（bass/lowMid 均值再 ^3），见 §7.2 |
| `audioBands` | `AudioBands` | ✅ | 5 频段各 **0..255** + 可选 spectrum（字节），见 §7 |
| `showText` | `boolean?` | | 是否显示歌词文本（隐藏时部分样式只留装饰）；缺省 true |
| `songTitle/Artist/Album` | `string?` | | 歌曲元数据（少数样式显示标题/封面） |
| `coverUrl` | `string?` | | 封面地址（背景/莫奈等用；可以是 blob/data URL） |
| `temperaLayerImageAssets` | `{id,name,url}[]?` | | 凝彩图层图片资产（可空） |
| `seed` | `string\|number?` | | 随机种子（同一歌同一布局；通常=歌曲 id） |
| `songHandoff` | `VisualizerSongHandoff?` | | automix 混音交接数据（见 §9.3；非交接场景=null） |
| `staticMode` | `boolean?` | | 静止模式：不跑持续动画，画静帧（OBS/省电） |
| `backgroundStaticMode` | `boolean?` | | 背景静止（背景不逐帧动，仍画内容） |
| `visualizerOpacity` | `number?` | | 0..1 整个可视化层不透明度（"整体透明度"设置） |
| `background` | `VisualizerBackgroundConfig?` | | 背景配置（见 §10） |
| `lyricsFontScale` | `number?` | | 字号倍率（0.85–1.4，默认 1） |
| `subtitleFontScale` | `number?` | | 字幕倍率（0.85–1.4，默认 1） |
| `subtitleOverlayOpacity` | `number?` | | 字幕层不透明度（默认 0.6） |
| `subtitleOverlayBackground` | `boolean?` | | 字幕光晕底（默认 true） |
| `subtitleUpcomingLyricsBlur` | `boolean?` | | 下一句预览加模糊（默认 true） |
| `showHarmonySubtitle` | `boolean?` | | 和声字幕层开关（默认 true） |
| `harmonySubtitleBackground` | `boolean?` | | 和声字幕光晕（默认 true） |
| `isPlayerChromeHidden` | `boolean?` | | 播放器 chrome 是否隐藏（影响字幕底距） |
| `hideTranslationSubtitle` | `boolean?` | | 隐藏底部字幕层 |
| `showSubtitleTranslation` | `boolean?` | | 是否显示译文（旧字段，配合 subtitleContentMode） |
| `subtitleContentMode` | `'translation'\|'romanization'\|'both'\|'none'?` | | 副字幕内容 |
| `paused` | `boolean?` | | 暂停（渲染器据此停 rAF/时钟；MV 不再推进） |
| `onBack` | `() => void?` | | 返回按钮回调（仅当 shell 画返回键） |
| `isPanelOpen` | `boolean?` | | 播放页面板打开（影响返回键/热区） |
| `alwaysShowBackButton` | `boolean?` | | 常显返回键 |
| `onPlayerPanelGuideHotspotChange` | `(active:boolean)=>void?` | | 触摸底部右侧热区时通知宿主显示引导 |
| `onLyricLineSeek` | `(lyricTimeSec:number)=>void?` | | 点击歌词行跳转（仅 `entry.seeksOnLineClick` 的样式拿到） |
| `isPreviewMode` | `boolean?` | | 设置页预览（部分样式简化/加速） |
| `visualizerTunings` | `VisualizerTuningBundle?` | | 全量 tuning 包（样式通常用自己的命名 prop） |
| `onVisualizerTuningChange` | `(patch:object)=>void?` | | 部分样式内快捷控件回写 tuning（monet） |
| `classicTuning…lumiereTuning` | 各 `XxxTuning?` | | 每样式命名 tuning prop（`applyVisualizerTuning` 注入；13 个） |
| `cappellaCustomEmojiImages/…AvatarImages` | 数组? | | 群唱自定义表情/头像（可空） |
| `monetPortraitImage` | `MonetPortraitImage?` | | 莫奈人像图（可空；为空用封面） |
| `onMonetTuningChange` | `(patch)=>void?` | | 莫奈快捷控件 |

> 只被少数样式用到的 prop（temperaLayerImageAssets/monetPortraitImage/cappella 资产）传 `null/[]` 即可，渲染器不校验。

### 2.1 样式入口（`VisualizerRegistryEntry`，`definition.ts:172-239`）

```ts
interface VisualizerRegistryEntry {
  mode: VisualizerMode; order: number; labelKey: string; labelFallback: string;
  previewSeed: string|number; previewStartOffset: number;
  glyph?: React.ReactNode;               // 24×24 描边 svg children（样式架图标）
  command?: { title; description; keywords };  // 命令面板关键词
  seeksOnLineClick?: boolean;
  followsSongHandoff?: boolean;
  background?: false | ((props) => VisualizerBackgroundConfig | undefined);
  render: (props: VisualizerSharedProps) => React.ReactElement;   // 必须 React.lazy 包装
  renderSettingsPanel?: (props: VisualizerSettingsPanelProps) => React.ReactNode;
  renderQuickControls?: (props: VisualizerQuickControlsProps) => React.ReactNode;
  ownFontSizeNoticeKey?: string;
  usesWordSegmentation?: boolean;
  foliumTunables?: Record<string, {min,max,identity}>;
  beatEffects?: readonly BeatEffectDef[];
}
```

- `render` **必须**是 `React.lazy(() => import('./Visualizer'))` 包装（`registry.tsx` 用 `import.meta.glob('./*/entry.tsx', {eager:true})` 只 eager 载 entry；renderer 本体懒加载，否则一进设置页就拉入 13 个渲染器 + three.js + pixi，约 183 个模块）。
- 宿主必须包 `Suspense`（`VisualizerRenderer` 内部已有 `fallback={null}`）。
- `entry.background === false`：该样式不想要背景层（仍有背景画布但样式自绘，如 fume 隐藏几何背景）。`VisualizerRenderer` 负责把 `props.background` 传给背景层，样式只读。

---

## 3. 歌词行模型（`Line` / `Word`）

定义：`src/types.ts:29-34`（Word）、`:57-81`（Line）。

```ts
interface Word { text: string; startTime: number /*秒*/; endTime: number; syllables?: LyricSyllable[]; }
interface Line {
  words: Word[]; startTime: number; endTime: number; fullText: string;
  translation?: string; romanization?: string; id?: string; agentId?: string; songPart?: string; blockIndex?: number;
  alternateTexts?: LyricAlternateText[]; backgroundVocal?: LyricBackgroundVocal; backgroundVocals?: LyricBackgroundVocal[];
  renderHints?: LineRenderHints; isChorus?: boolean; chorusEffect?: 'bars'|'circles'|'beams';
  wordSegments?: string[];       // 用户保存的词边界；join('')===fullText；优先于自动分词
  autoWordSegments?: string[];   // icu-folia 自动词边界（否则回退 Intl.Segmenter）
}
```

- **时间单位全部是秒**；`currentTime` 与 line/word 的 start/end 同一时钟。
- 词间空档：`words` 可连续也可有 gap；样式不得假设 `line.words[i].endTime === words[i+1].startTime`。
- 逐字词：`words` 每项一个 grapheme（中日文常见）；英文一行 5–12 个 token 词。
- 行渲染结束时间不是 `line.endTime`：
  - `src/utils/lyrics/renderHints.ts` 的 `getLineRenderHints(line)` / `getLineRenderEndTime(line)`；空行返回 **`-Infinity`**（必须保留该语义，`getRecentCompletedLine` 依赖它）。
  - 阈值：`MICRO_LINE_DURATION_THRESHOLD=0.10`、`SHORT_LINE_DURATION_THRESHOLD=0.18`、`MICRO_LINE_RENDER_FLOOR=0.067`（`renderHints.ts:33-35`）。
  - `timingClass`：micro(<0.10) / short(<0.18) / normal；`lineTransitionMode`：micro→`'none'`、short→`'fast'`、否则 `'normal'`；`wordRevealMode`：micro→`'instant'`、short→`'fast'`、否则 `'normal'`。
  - `renderEndTime`：`'none'` → `max(endTime, startTime+0.067)`；否则 `max(endTime, exitStart+exitDuration)`，其中 `linePassStart = max(lastWordEnd, startTime) + linePassHold`，exitStart 对 fast 取 `max(startTime+enter+0.01, linePassStart, endTime-exit)`。
  - 过渡时长：fast → enter `clamp(raw*0.45, 0.045, 0.06)`、exit `clamp(raw*0.22, 0.03, 0.04)`、hold 0.03；normal → enter `min(0.42, max(0.22, max(raw,0.12)*0.34))`、exit `min(0.32, max(0.18, max(raw,0.12)*0.18))`、hold 0.06。

### 3.1 行/词查询工具（`src/components/visualizer/runtime.ts`，157 行）

| 函数 | 语义 |
|---|---|
| `getRecentCompletedLine({lines,currentLineIndex,currentTime,getLineEndTime})` | **仅当 `currentLineIndex === -1`** 时生效；从尾向头找第一条 `currentTime > getLineEndTime(line)` 的行（行间空档继续显示上一句） |
| `getUpcomingLine(lines,currentLineIndex,currentTime)` | 有活动行→下一行；无→第一条 `startTime > currentTime` |
| `getUpcomingLines(lines,index,count=2)` | 无活动行→`[]`；用于"下一句预览" |
| `shouldPreheatLine(line,currentTime,{minLead,maxLead})` | `minLead <= line.startTime-currentTime <= maxLead`（按提前量） |
| `useVisualizerRuntime({currentTime,currentLineIndex,lines,getLineEndTime})` | `{currentTimeValue, activeLine, recentCompletedLine, upcomingLine, nextLines}`；`currentTimeValue = currentTime.get()` 快照 |

---

## 4. 词级动画系统（GlowWord：classic / partita 共用）

### 4.1 三态与时间窗

`src/components/visualizer/glowWordTiming.ts`：

- `resolveGlowWordRenderProfile(line)` → `{renderHints, lineRenderEndTime, lineTransitionMode, wordRevealMode, wordLookahead}`；`wordLookahead` = instant `0.03` / fast `0.08` / normal `0.15`（`:31`）。
- `getGlowWordActiveEndTime(word, profile)`：instant → 整行 renderEndTime；fast → `min(lineRenderEndTime, max(word.endTime, word.startTime+0.12))`；normal → `word.endTime`。
- `getGlowWordDisplayDuration` = `max(activeEnd - startTime, 0.08/0.12/0.1)`。
- `GlowWord.tsx:52-60`：`useMotionValueEvent(currentTime,'change')`；`status='active'` 当 `t >= startTime - lookahead && t <= activeEnd`；`'passed'` 当 `t > activeEnd`；**只在状态变化时 setState**。状态只影响动画，不控制单词显隐（词留在屏幕上直到行容器退出）。
- 行容器 motion：`getGlowWordLineContainerMotion(profile)`（`glowWordTiming.ts:58-91`）：
  - `'none'`：initial 全显；exit `{opacity:0, scale:1.02, filter:'blur(6px)'}` 0.12s。
  - `'fast'`：initial `{opacity:0.35, scale:0.96, blur(4px)}` → 0.16s easeOut；exit `{opacity:0, scale:1.04, blur(10px)}` 0.16s。
  - `'normal'`：initial `{opacity:0, scale:0.9, blur(10px)}` → spring；exit `{opacity:0, scale:1.1, blur(20px)}` 0.3s。
  - 三者 `animate.transitionEnd = {filter:'none'}`（避免常驻 filter 图层）。

### 4.2 三层 DOM（`GlowWord.tsx:63-142`）

1. 外壳 `<motion.div variants={layoutVariants} initial="waiting" animate={status} className="inline-block origin-center relative will-change-transform whitespace-nowrap">`，style `{fontSize, fontWeight: resolveThemeFontWeight(theme,700), lineHeight:1.22, ...layoutStyle}`。
2. **Glow 层** `<span className="absolute inset-0 select-none pointer-events-none block" aria-hidden>`：多 grapheme 时逐 grapheme 一个 `motion.span`（带 charStartTime/charEndTime/index/total），否则单 span。
3. **Body 层** `<motion.span variants={bodyVariants} className="relative z-10 block">{word.text}</motion.span>`。
4. 合唱涟漪（可选）：`isChorus && active` 时圆环，`scale 0.2→1.5+rand*2`、opacity 0.8→0、0.5s easeOut、`blur(1px)`。

### 4.3 variants 数值（`glowWordVariants.ts` / `wordGlow.ts`）

- **layout variants**（`glowWordVariants.ts:9-48`，函数式 variant 由 `config` 驱动）：
  - waiting：`opacity 0, scale 0.5, x=config.x+sin(config.y)*100, y=config.y+cos(config.x)*50, rotate=config.rotate+20`，0.4s。
  - active：`opacity 1, scale = isNaN(config.scale)?1.5:config.scale*1.4`，x/y/rotate=config.*，`spring(stiffness 200, damping 20)`，opacity 0.1s。
  - passed：`opacity=animationIntensity==='chaotic'?0.9:0.82, scale=config.scale||1, rotate=config.rotate+config.passedRotate`，0.5s（rotate 5s linear）。
- **body variants**：waiting `{color:baseColor, blur(10px)}` 0.4s；active `{color:activeColor, filter:none}` color 过渡 duration（默认 0.2 linear，可被 config.duration 覆盖）；passed `{color:baseColor, blur(0)}` color 0.12/0.24/0.8（按 wordRevealMode）。
- **glow variants**（`wordGlow.ts`，text-shadow 与 filter 双实现，见 §4.4）：
  - instant：半径 14/24，peaks `[0,1,0]`，duration `min(duration||0.08, 0.12)`，times `[0,0.35,1]` easeOut。
  - fast：18/32，peaks `[0,1,0]`，duration `min(max(duration||0.12,0.12),0.2)`，times `[0,0.4,1]` easeInOut。
  - normal 逐字扫光（total>1）：半径 20/40，peaks `[0,1,0]`，**`duration = charDuration*6`**，delay=`charStartTime-wordStartTime`，times `[0,0.3,1]`。
  - 单字/CJK 持续光：20/40，peaks `[0,1,1]`，duration `duration||0.1`，times `[0,0.9,1]`。
  - passed：duration 0.12/0.22/0.9；量化分支返回 `{color:activeColor, opacity:0}`（**必须重申 color**，否则透明字形不投 drop-shadow，辉光会瞬间消失）。
- **grapheme 时序**（`src/utils/lyrics/graphemeTiming.ts`）：`Intl.Segmenter('grapheme')`；有 `word.syllables` 时按音节均分，否则把 `[start,end]` 按 grapheme 数均分（末字精确 endTime）。
- **Linux/Chromium 坑**（`wordGlow.ts:8-26`，`docs/linux-glyph-cache-fd-leak.md`）：渐变 text-shadow 半径会令 glyph cache 每帧新建 strike → fd 泄漏、约 35 分钟后合成器停帧。`isGlowBlurQuantized()`（`src/utils/glowBlurQuantize.ts`，Linux 默认开）为真时改整层 `filter: drop-shadow(0 0 r*0.4px alpha0.7)` 链；glow 层必须自带字形颜色。**WebView2（Chromium/Windows）默认不触发**，但若目标机是 Linux（Kylin/Deepin，SPW 常见）必须开。

### 4.4 关键词着色（`wordColoring.ts`）

- `Theme.wordColors: {word,color}[]` → `resolveWordColor(wordText, wordColors, fallbackColor)`（逐词）；`prepareWordColorMatchers` / `buildWordColorRanges`（行内 range，按 priority 最长匹配，CJK `indexOf`，英文 `\w+` 归一化）；`resolveTokenColorMap` 只处理 `timed` token。
- classic 用法：`activeColor = resolveWordColor(word.text, theme.wordColors, theme.accentColor)`，`baseColor = theme.primaryColor`（`classic/Visualizer.tsx:332,343`）。

---

## 5. 主题（`Theme`）与字体

`src/types.ts:94-109`：

```ts
interface Theme {
  name: string; backgroundColor: string; primaryColor: string; accentColor: string; secondaryColor: string;
  fontStyle: 'sans'|'serif'|'mono'; fontFamily?: string; fontFamilyStack?: string[]; fontWeight?: number;
  animationIntensity: 'calm'|'normal'|'chaotic';
  wordColors?: {word:string;color:string}[]; lyricsIcons?: string[]; provider?: string; description?: string;
}
```

- 设置页预览用的 `PREVIEW_THEME`：`{backgroundColor:'#09090b', primaryColor:'#f4f4f5', accentColor:'#f4f4f5', secondaryColor:'#71717a', fontStyle:'sans', animationIntensity:'normal'}`。fullscreen 用当前歌曲主题（来自 Folia 主题设置；WebView 里 harness 可先固定暗色主题）。
- 字体解析：`src/utils/fontStacks.ts` —— `resolveThemeFontStack(theme)`（自定义 → 内置 sans/serif/mono 栈）、`resolveThemeTranslationFontStack(theme)`（字幕用独立栈）、`resolveThemeFontWeight(theme, fallback)`（clamp 100–900 / step 10）；内置 serif 首选 `"獅尾四季春加糖SC"`，sans 首选 `"Inter"`。
- `@font-face "Folia Noto Serif SC"` 400/500 从 CDN 加载（`src/index.css:19-33`）；仓库/asar 内**没有**字体文件。WebView 需联网或自带字体（见 `assets.md`）。
- 字号：`lyricsFontScale`（0.85–1.4，默认 1）由各样式乘进自己的 clamp；字幕字号公式见 §8.3。

---

## 6. 渲染生命周期（谁在什么时候被挂载）

### 6.1 应用层（生产环境，供参考；harness 可跳过）

`useVisualizerRendererModel.ts`（179 行）构造全部 props，hook 顺序（阅读=执行）：
1. store 标量：app view / chrome / settings modal / library player occlusion / theme settings / player chrome / visualizer settings / stage settings。
2. typography 9 项（`useTypographySettingsStore`）：`lyricsFontScale, subtitleFontScale, subtitleOverlayOpacity, subtitleOverlayBackground, subtitleUpcomingLyricsBlur, showHarmonySubtitle, harmonySubtitleBackground, showSubtitleTranslation, subtitleContentMode`。
3. `useVisualizerStyleAssets()`、`currentLineIndex`、播放显示选择器（blend 期间整段画面必须描述同一首歌）。
4. `useShownTheme`（屏幕上那首歌的主题）、`useVisualizerSongHandoff(entry.followsSongHandoff)`、`useVisualizerBackgroundConfig()`、`useVisualizerTunings()`。
5. 组装 props：`showText = resolveVisualizerShowText(...)`、`staticMode`、`paused`、`backgroundStaticMode`、`...typography`、`onLyricLineSeek`（仅 `seeksOnLineClick` 样式）、`onBack`、`alwaysShowBackButton` 等。

### 6.2 `VisualizerRenderer`（harness 真正要 mount 的组件，107 行）

顺序（`VisualizerRenderer.tsx`）：
1. `shownMode = useDeferredValue(mode)` —— 新样式模块未到时旧样式留场。
2. `entry = getVisualizerRegistryEntry(shownMode)`；补默认背景 `DEFAULT_VISUALIZER_BACKGROUND_MODE`。
3. `resolvedProps = applyVisualizerTuning(shownMode, sharedProps, props.visualizerTunings)`。
4. `transition = animateStyleSwitch && !staticMode && !reducedMotion ? softFocus : null`。
5. `songHandoff = transition ? props.songHandoff : null`；`backgroundTransition = transition && handoff.progress ? alongProgress(transition, handoff.progress) : transition`。
6. `backdropCover = useHandoffCover(...)`；`styleSwitch = useStyleSwitch(shownMode, transition)`；`switchAsked` 时 `useLayoutEffect(() => holdTurns())`（小图暂停）。
7. DOM：
   ```tsx
   <Suspense fallback={null}>
     <VisualizerBackdrop entry={entry} props={backdropProps} transition={backgroundTransition} waits={styleSwitch.waits}>
       <VisualizerStyleTransition styleSwitch={styleSwitch} transition={transition} renderStyle={renderStyle} />
     </VisualizerBackdrop>
   </Suspense>
   <VisualizerHarmonyOverlay ... />
   ```
   `renderStyle(styleMode)` 对当前样式用 `styleProps`，对离场样式用 `applyVisualizerTuning(styleMode, sharedProps, bundle)`。

### 6.3 `VisualizerShell`（样式内部的通用外壳，可选）

`VisualizerShell.tsx`（285 行）：所有样式 renderer 用它包内容。职责：
- 根节点 `w-full h-full flex flex-col items-center justify-center overflow-hidden relative` + 主题字体/字重/`visualizerOpacity`；背景透明。
- 返回按钮（左上 120×120 热区）：`absolute top-6 left-6 z-30 h-10 w-10 rounded-full backdrop-blur-md bg-black/20 text-white/60`，`ChevronLeft size 20`，framer 淡入淡出 0.2s；仅 `alwaysShowBackButton` 或指针进入热区时可见。
- 播放页面板引导热区（右下 120×120）：触摸时 `onPlayerPanelGuideHotspotChange(true)` 1400ms；`PLAYER_CHROME_HOTSPOT_SIZE=120`、`TOUCH_GUIDE_DISPLAY_MS=1400`。
- 背景层/视频层/舞台层插槽（`player.stage.back` / `player.stage.front`）、`renderBackground=false` 时样式直接画在空背景上。
- **harness 若自己画全屏 chrome（返回键/暂停），可让样式使用 shell 但隐藏它的返回键（不传 `onBack`/`alwaysShowBackButton`），避免重复按钮。**

---

## 7. 音频输入（audioPower / audioBands / 节拍）

> 细版：`research/folia/notes-audio.md`（532 行，含源码行号）。**这一节最容易做错，务必按数值照抄。**

### 7.1 尺度：**0..255，不是 0..1**（头号坑）

- 应用内所有音频 MV 的值都是 **AnalyserNode 字节尺度 0..255 的浮点**（`getByteFrequencyData` 后经 gamma 整形），样式自己 `/255`。
- 消费点证据：monet `AudioOverlay.tsx:224-228`（五带全 `/255`）、`:233` `clamp(audioPower.get()/255, 0,1)`；cadenza `VisualizerCadenza.tsx:287`；diorama `DioramaScene.tsx:435`；latent `LatentBackground.tsx:48,253`；`common/GeometricBackground.tsx:136-139` `useTransform(spring,[10,200],[0.95,1.45])`；claddagh 自适应（见过 `>1.0` 就永久锁 `power/255`）；lumiere `lumiereAudio.ts:77`；fume `fumeStage.ts:42`。
- **反例**：设置页 preview 的假数据是 0..1（`preview/usePreviewClock.ts:38-43`：audioPower 0.24、bass .18…；`useVisPlaygroundPreviewPlayback.ts:59-67` 峰值 0.34），因此在 preview 里 latent/monet/cadenza/diorama 的音频反应≈0、claddagh 的 >1.0 检测不到——**harness 不要复制 preview 的尺度**，要按 0..255 给。
- `spectrum`：`Uint8Array`，真机长度 1024（`frequencyBinCount`），元素 0..255，每帧替换；`new Uint8Array(0)` = 合法"没有 FFT"（暂停时真机就这样）。唯一严格消费者 monet：`MIN_RAW_SPECTRUM_BIN = 6`（长度 ≤6 静默退回五带插值）、`BAR_COUNT = 72`；给 64/256/1024 都能工作。
- `beatImpact` / `downbeatImpact`（智能动感节拍包络）是**模块级 MV**（`stores/motionSignals.ts:60-61`），不在 AudioBands 里；范围 0..1（已乘曲目动态范围 0.45..1 与用户强度）。harness 若要注入合成节拍，可 `import { beatImpact, downbeatImpact } from motionSignals` 直接 `.set()`。

### 7.2 真实播放管线（harness 照抄这段就能一致）

`src/components/app/playback/bridges/usePlaybackAudioBridge.ts` + `usePlaybackVisualizerBridge.ts`：

```ts
const ctx = new AudioContext();
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;                 // → 1024 bins
analyser.smoothingTimeConstant = 0.6;    // :140
// minDecibels / maxDecibels 不设置 → 浏览器默认 -100dBFS .. -30dBFS
```

每 **rAF**（无额外节流，且会被全局 FPS 上限一起限流）一次：

```ts
analyser.getByteFrequencyData(buf);            // Uint8Array(1024)
audioBands.spectrum?.set(buf);                 // 原始字节，未 gamma
const energy = (minHz, maxHz) => {             // 区间内 bin 的算术平均（不是 RMS/峰值）
    const s = Math.floor(minHz / 21.5), e = Math.floor(maxHz / 21.5);  // 21.5 硬编码 bin 宽
    let sum = 0; for (let i = s; i <= e; i++) sum += buf[i];
    return sum / (e - s + 1);
};
const shape = (v, boost) => Math.pow(v / 255, boost) * 255;
const bass = energy(20,150), lowMid = energy(150,400), mid = energy(400,1200),
      vocal = energy(1000,3500), treble = energy(3500,12000);   // vocal 与 mid 在 1000-1200 重叠
audioPower.set(shape((bass + lowMid) / 2, 3));   // 不是"总电平"，是 bass/lowMid 均值再 ^3
audioBands.bass.set(shape(bass, 1.8));
audioBands.lowMid.set(shape(lowMid, 2));
audioBands.mid.set(shape(mid, 2));
audioBands.vocal.set(shape(vocal, 1.5));
audioBands.treble.set(shape(treble, 2));
```

- **gamma 必须套**：不套的话幅度偏大约 2–3 倍。量级示例：audioPower 原始 40→8.9 / 80→71.7 / 120→243；bass（^1.8）100→46.9 / 150→96.5；mid（^2）100→39.2 / 150→88.2。
- bin 宽不是恒定 21.5：44.1kHz/2/1024 才是 21.53；**采样率不是 44.1k 时必须用 `sampleRate/2/1024`**，否则五带整体偏移。
- **无信号/暂停时不是 0，是"呼吸"**（`:187-197`）：`breath = (Math.sin(Date.now()/2000)+1)*20`（0..40）同时写 power + 五带，spectrum 给空数组；周期约 12.6s。
- `paused`（prop）与音频值语义独立：paused 由播放器状态决定，音频值由 `audioEl.paused/ended` 决定；harness 要分开给。

### 7.3 harness 合成方案（三选一）

1. **最忠实**：真 `<audio>` + WebAudio，照 §7.2 逐帧算（code 可直接用）。
2. **离线预计算**：OfflineAudioContext/任意 FFT 预先算好 `{t, power, bass…, spectrum[]}`，rAF 里按 `audioEl.currentTime` 二分查表 `.set()`；务必同样套 gamma（字节尺度换算 `(20*log10(mag)+100)/70*255`）；30Hz 输入足够（样式内部有 spring/lerp）。
3. **纯占位**：暂停态用 §7.2 呼吸值；"在放歌"态给常量示例 `power 60 / bass 80 / lowMid 55 / mid 45 / vocal 40 / treble 30`（0..255）或低频正弦摆动。

| 输入 | 类型 | 范围 | 备注 |
|---|---|---|---|
| `audioPower` | `MotionValue<number>` | 0..255 浮点 | 静止时 0..40 呼吸 |
| `bass/lowMid/mid/vocal/treble` | 各 `MotionValue<number>` | 0..255 浮点 | 同上 |
| `spectrum` | `MotionValue<Uint8Array>` | 元素 0..255 | 长度 0 或 7..1024；真机 1024 |
| `beatImpact`/`downbeatImpact` | 模块 MV | 0..1 | 仅智能动感开时非 0 |

### 7.4 节拍 / 智能动感模式

- 默认 **关闭**：`DEFAULT_SMART_BEAT_SETTINGS = {enabled:false, effects:{}}`（`types.ts:609-612`）；效果默认 `{on:true, strength:1}`、`BEAT_EFFECT_STRENGTH_MAX=2`（`services/beatFx/beatEffects.ts:32-33,55-56`）。
- 哪些模型会跑由画面声明决定（`beatClockTargets.ts:21-56`）：取当前样式 `entry.beatEffects`（`entry.background !== false` 时并上背景的）→ 有 `source:'beats'` 才跑 beat_this，有 `'drums'` 才跑 HTDemucs。没声明 = 一个模型都不跑。
- 关闭路径**不影响画面一致性**：不加载模型、节拍时钟不 tick、`beatImpact/downbeatImpact` 恒 0；样式只吃 audioPower/audioBands。**没有模型的 harness 在关闭状态下可像素级一致**（唯一差异：如果用户开了开关，sonnet.lensTear/diorama.ripple/pendolo.drumhead 会静默不动，不报错）。
- 开启时的样式可见信号 = 两个包络 MV：`BEAT_FX_BEAT_DECAY_MS=160`、`BEAT_FX_DOWNBEAT_DECAY_MS=200`、`BEAT_FX_WEAK_BEAT_FLOOR=0.35`、`READY_HOLD_MS=1500`（`services/beatFx/clock.ts:29,49-50`、`beatFxLive.ts:58`）；指数衰减 `exp(-dtMs/decay*2.3)`，命中的事件取 `max(current, gain*exp(-lateMs/decay*2.3))`；`trackScale` 曲目动态范围 0.45..1。
- 可用性：`useSmartBeatAvailability()` 返回 `'ready'|'desktopOnly'|'noGpu'`；**没有 `window.electron.getBeatThisGpuWeights` 的宿主（WebView harness）恒为 `'desktopOnly'`**，设置卡会显示"节拍效果仅在桌面版可用"。
- harness v1 建议：智能动感开关默认关、甚至不渲染该卡（见 settings-ui.md §9 产品决策）；若必须"看起来像开着"，可自己按 BPM 网格合成两个包络 MV 注入（峰值 1、弱拍上限 0.35、按 160/200ms 衰减）。
- 模型本体（可跳过）：beat_this（22050Hz、N_FFT 1024、HOP 441 → 50fps、128 mel、F_MIN 30/F_MAX 11000）；HTDemucs 鼓分离（ENERGY_HOP 441、kick/snare/hat 三带峰值检测）。权重随安装包发布（`electron/analysis/modelPaths.cjs`），浏览器构建 `modelsPresent()` 恒 false。

---

## 8. 字幕层（`VisualizerSubtitleOverlay`，221 行）

- Props：`showText, activeLine, recentCompletedLine, nextLines, theme, subtitleTheme?, translationFontSize, upcomingFontSize, subtitleFontScale=1, opacity=0.6, subtitleOverlayOpacity?, subtitleOverlayBackground=true, subtitleUpcomingLyricsBlur=true, isPlayerChromeHidden=false, hideTranslationSubtitle=false, showSubtitleTranslation=true, subtitleContentMode?`。
- 内容解析 `resolveVisualizerSubtitleOverlayContent`（`:48-80`）：
  - `!showText || hideTranslationSubtitle` → 不渲染。
  - 行选择：`[activeLine, recentCompletedLine]` 中第一条有可渲染 track 的行（`resolveLyricSubtitleTracks`，按 `subtitleContentMode` 选 translation/romanization/both/none）。
  - `subtitleText = tracks.map(t=>t.text).join(' / ')`。
  - 下一句预览：**只有 subtitleText 为空**且有 activeLine 时，取 `nextLines.filter(hasReadableText(fullText))`。
  - `hasReadableText = !!text && /[\p{L}\p{N}]/u.test(text)`（纯标点/符号行不显示）。
- DOM：`absolute left-0 right-0 text-center space-y-2 px-4 z-20 pointer-events-none`；**`bottom` 直接绑 MotionValue `subtitleBottomPx`，不能用 transform**（下方压着 blur 光晕，多一个合成层会变色）。
- 动效：外层 AnimatePresence，`opacity 0↔1 / y 20↔0`，0.24s easeOut。
- 光晕底（`subtitleOverlayBackground=true`）：`radial-gradient(ellipse 115% 130% at center, bg@0.96 0%, bg@0.78 62%, transparent 100%)`，`blur-2xl`，`translateZ(0)`。
- 文本阴影：`0 1px 2px ${colorWithAlpha(theme.backgroundColor,0.24)}`。
- 译文行：`color: theme.secondaryColor`；字号 `scaleFontSize(translationFontSize, 次级行?0.88:1)`；字体 `resolveThemeTranslationFontStack(subtitleTheme ?? theme)`；字重 `resolveThemeFontWeight(subtitleTheme ?? theme, 次级行?400:500)`；次级行 `opacity:0.82`、`marginTop:0.25em`（`src/utils/lyrics/subtitleTrackStyle.ts`：`SECONDARY_TRACK_SIZE_FACTOR=0.88`、`SECONDARY_TRACK_OPACITY=0.82`、`SECONDARY_TRACK_FONT_WEIGHT_FALLBACK=400`、`SECONDARY_TRACK_GAP_EM=0.25`）。
- 下一句预览：`truncate max-w-2xl mx-auto transition-all duration-500` + 可选 `blur-[1px]`；`color secondaryColor`、`fontWeight resolveThemeFontWeight(subtitleTheme??theme,400)`。
- 底距 `usePlayerSubtitleBottomPx(isPlayerChromeHidden)`（`src/hooks/usePlayerBottomBarBottomPx.ts:60-80`）：由底栏 presence spring + bottomBar 偏移 transform；**预览/OBS 不是 bottom-bar host，用固定 previewOffset**。harness 若自绘 chrome，可直接给常量 bottom（例如 64px）或自己的 MV。
- 字号公式（`subtitleFontSizes.ts:22-27`，全样式唯一来源，切换样式时字号必须一致）：
  ```ts
  clampSize(min, preferred, max) = `clamp(${(min*s).toFixed(3)}rem, ${(preferred*s).toFixed(3)}vw, ${(max*s).toFixed(3)}rem)`
  resolveSubtitleFontSizes(lyricsFontScale) = {
    translationFontSize: clampSize(1.125, 2.6, 1.25),
    upcomingFontSize:    clampSize(0.875, 2,   1),
  }
  ```
  最终字号 = 该 clamp 字符串再按 `subtitleFontScale`（及次级行 0.88）缩放（只处理 rem|vw|px）。

---

## 9. 三种"换"的机制（样式切换 / 背景变更 / 歌曲交接）

### 9.1 唯一过渡曲线 `softFocus`（`styleTransition/softFocus.ts:6-18`）

```ts
leave: { to: {opacity:0, filter:'blur(8px)', transform:'scale(1.02)'}, duration:360, easing:'cubic-bezier(0.4,0,1,1)' }
enter: { from:{opacity:0, filter:'blur(8px)', transform:'scale(1.02)'}, delay:80, duration:520, easing:'cubic-bezier(0.16,1,0.3,1)' }
```

### 9.2 图层状态机（`styleTransition/layerTransition.ts`，257 行）

- 最多同时挂两层；新层 `key=top.key+1`；`waits` 期间新层不可见、旧层不动；切回仍在离场的层会取消切换。
- `LEAVE_FALLBACK_MARGIN_MS = 1000`：离场动画 finish 事件可能不来（窗口隐藏），用 duration+1000ms 兜底移除，防 WebGL 上下文泄漏。
- 用 Web Animations API `element.animate()`（不是 framer）；enter timing 在 mount 时用 `useState` 固定。
- 首帧门（`firstFrame.ts` + `VisualizerStyleTransition.tsx`）：新样式先挂载但不可见，样式可 `claim()` 承诺上报首帧、练完调 `drawn()`；**`FIRST_FRAME_LIMIT_MS = 1500`** 兜底（浮名首次布局实测 2.9s，见注释）；不 claim 的样式在其 layout effect 后视为就绪。
- `alongProgress(transition, progress)`：把 leave/enter 改 `delay:0`、duration=(enter.delay+enter.duration)、`easing:'linear'`，挂 progress，用于混音交接（§9.3）。
- 背景样式切换（`VisualizerBackgroundTransition.tsx`，200 行）：`BACKGROUND_READY_LIMIT_MS=1000`；`shownBackground` 的 key = `JSON.stringify([mode, ...entry.song(inputs)])`；`underNext` 让离场背景保持不透明直到新背景入完（否则同时淡出会透出、暗 15%）；`useDeferredValue(now)` 让背景变化滞后一帧，与样式切换合并。

### 9.3 歌曲交接（automix；v1 可跳过）

- `VisualizerSongHandoff`（`definition.ts:46-62`）：`progress: MotionValue<number>`（0..1，0 直到 blend 宣告）、`seed, songTitle/Artist/Album, coverUrl, theme, subtitleTheme, lines, currentTime, currentLineIndex`。
- 只有 `entry.followsSongHandoff === true` 的样式拿到 `songHandoff`；`VisualizerRenderer` 决定何时置空。
- 歌曲真正切换要过 `songHandover.ts` 的 `decideSongCommit`：按 `getLyricsSignature(lines) = lines.length + '|' + lines[0].fullText + '|' + FNV1a(wordSegments 边界)`，**按内容而非数组身份**；纯音乐需 `(sawPlaybackReset && playbackTime>=2) || 8000ms grace` 才确认；`EMPTY_COMMITTED_LINES` 用稳定空数组。
- `useShownTheme`：blend 期间画面仍是上一首 → 保留上一首主题，下一首主题随 handoff 走。
- `useHandoffCover`：同一封面网络地址会变（network→cache），按地址 key 会抖动；blob URL 被 revoke 后重挂会解码为空 → 同 seed 时保留旧 URL。
- **WebView v1 不必实现**：样式代码对 `songHandoff=null` 是正常路径；直接切歌（无过渡）即可。

---

## 10. 背景系统（`backgrounds/`，6 个 mode）

`src/components/visualizer/backgrounds/`（39 个文件）。注册表 `backgrounds/registry.tsx`；definition 见 `backgrounds/definition.ts`。

| mode | 中文名 | 默认 | 说明 |
|---|---|---|---|
| `common` | 通用 | | 纯色/几何背景；`common: {useCoverColorBg, opacity, disableGeometricBackground, disableVignette}` |
| `latent` | 潜像 | **默认** `DEFAULT_VISUALIZER_BACKGROUND_MODE` | 专辑封面扩散/模糊；有 tuning（含 `dynamicOnlyInPlayer`，非播放页时 `backgroundStaticMode`） |
| `monet` | 莫奈 | | 封面→印象派色块；有 tuning |
| `nomand` | 诺曼德 | | 有 tuning |
| `sora` | 空 | | 有 tuning |
| `url` | 网络图片 | | `url: {items, selectedId}`，用户图列表 |

- `VisualizerBackgroundConfig`：`{mode?, transparent?, common?, customImage?/*monet uploaded*/, url?, <每个背景 tuning 槽>}`；`transparent` 用于播放页透明化。
- `VisualizerBackgroundRenderProps`（`definition.ts`）：`{config, theme, isDaylight, coverUrl, audioPower, audioBands, seed, staticMode, paused, blendMs?, blendProgress?}`。
- 每个背景 entry：`render(props)`；`background` 画布由 `VisualizerBackdrop` 统一挂载；样式 `entry.background` 可以覆盖/关闭（fume 关闭几何背景），still 用 `background: false`。
- 设置页背景 tab 的渲染面板：`VisualizerBackgroundSettingsProps = {config, actions, t, isDaylight, theme, controlCardBg, rangeInputClass, onSliderPointerDown, onSliderCommit}`。
- **harness 最小实现**：只读 `config.mode`，画一个纯色/封面模糊层即可；样式层不依赖背景正确性。`latent` 背景需要封面 + canvas 模糊，可后置。

---

## 11. 最小 harness 代码（可直接复制）

```tsx
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { motionValue } from 'framer-motion';
import { VisualizerRenderer } from './folia/components/visualizer/VisualizerRenderer';
import { useVisualizerClock } from './useVisualizerClock'; // 见下

const currentTime = motionValue(0);
const audioPower = motionValue(0);            // 0..255；无真实音频先用 0..40 呼吸值
const audioBands = {                          // 各 0..255（见 §7）
    bass: motionValue(0), lowMid: motionValue(0), mid: motionValue(0),
    vocal: motionValue(0), treble: motionValue(0),
    spectrum: motionValue(new Uint8Array(0)),
};

export function FoliaVisualizer({ mode, lines, theme, onBack }) {
    const [lineIndex, setLineIndex] = useState(-1);
    useVisualizerClock({ currentTime, setLineIndex, lines }); // rAF：推进秒数 + 计算行号；音频 MV 由宿主/audio-probe 写入

    return (
        <Suspense fallback={null}>
            <VisualizerRenderer
                mode={mode}
                currentTime={currentTime}
                currentLineIndex={lineIndex}
                lines={lines}
                theme={theme}
                audioPower={audioPower}
                audioBands={audioBands}
                showText
                onBack={onBack}
                subtitleOverlayOpacity={0.6}
                subtitleOverlayBackground
                subtitleUpcomingLyricsBlur
                showHarmonySubtitle
                harmonySubtitleBackground
                subtitleContentMode="translation"
                lyricsFontScale={1}
                subtitleFontScale={1}
                background={{ mode: 'latent' }}
                animateStyleSwitch={false} /* 单样式播放可省过渡 */
            />
        </Suspense>
    );
}
```

`useVisualizerClock` 要点（参考 `preview/usePreviewClock.ts` + `runtime.ts`）：
- rAF 每帧：`currentTime.set(t)`；用 `findPreviewPlaceholderLineIndex` 同款逻辑（`t >= start && t <= getLineRenderEndTime(line)`，从尾向头）更新 `setLineIndex`，只在变化时 setState。
- 暂停：`paused` 时不推进 currentTime（或停止 rAF）。
- 若没有真实音频：见 §7.3 三方案。注意设置页 preview 的假数据是 0..1（`preview/usePreviewClock.ts:38-43`：audioPower 0.24 等），**照抄会让 latent/monet/cadenza/diorama 几乎不动**；正确做法是用 §7.2 的 0..255 公式（呼吸值或常量），或接 audio-probe 的 WASAPI 数据。

---

## 12. 性能开关（DPR / 纹理 / 静止）

| 开关 | 来源 | 作用 |
|---|---|---|
| `textureResolution`（sonnet/tempera/lumiere） | 各样式 tuning（默认 1.5，范围 0.5–4） | pixi 渲染纹理倍率；越高越清晰，显存/负载越高 |
| `staticMode` | prop | 不跑持续动画（OBS/省电）；样式用静态布局画一帧 |
| `backgroundStaticMode` | prop | 背景不逐帧；如 latent 的 `dynamicOnlyInPlayer` 非播放页 |
| `paused` | prop | 暂停时钟 |
| reducedMotion | `useReducedMotionFor('uiMicroMotion')` | 系统减少动效时禁用样式切换过渡 |
| `isPreviewMode` | prop | 设置页预览，部分样式降载 |
| `holdTurns`（小图） | `preview/pictureTurns.ts` | 样式切换期间暂停所有小图 rAF |
| `frameRateLimiter` | `src/utils/frameRateLimiter.ts` | 播放器动画帧率上限（60/90/120/off） |
| DPR | 浏览器/宿主 | WebView2 建议 `deviceScaleFactor` 跟随屏幕；pixi 样式按 `devicePixelRatio*textureResolution` 建纹理 |
| 背景质量 | 设置（`visualizerBackgroundMode`） | 背景比样式便宜/贵差异大；v1 可先固定 latent 或 common |

---

## 13. 证据索引（本文件全部结论）

- 契约：`src/components/visualizer/definition.ts`（64-155 页 shared/panel props；172-239 registry entry）、`src/types.ts`（29-109 Word/Line/Theme；1437-1444 AudioBands；609-612 smartBeat 默认）
- 运行时：`src/components/visualizer/runtime.ts`、`glowWordTiming.ts`、`GlowWord.tsx`、`glowWordVariants.ts`、`wordGlow.ts`、`wordColoring.ts`
- 字幕：`VisualizerSubtitleOverlay.tsx`、`subtitleFontSizes.ts`、`utils/lyrics/subtitleTrackStyle.ts`、`hooks/usePlayerBottomBarBottomPx.ts`
- 切换：`styleTransition/{softFocus,layerTransition,VisualizerStyleTransition,VisualizerBackgroundTransition,firstFrame}`、`songHandover.ts`、`useShownTheme.ts`、`useHandoffCover.ts`
- 渲染：`VisualizerRenderer.tsx`、`VisualizerShell.tsx`、`VisualizerBackdrop.tsx`、`VisualizerHarmonyOverlay.tsx`、`useVisualizerRendererModel.ts`、`useVisualizerTunings.ts`、`useVisualizerBackgroundConfig.ts`、`backgrounds/definition.ts`
- 预览：`preview/usePreviewClock.ts`、`preview/useVisPlaygroundPreviewPlayback.ts`、`PreviewPlaceholder.ts`
- 字体：`src/utils/fontStacks.ts`、`src/index.css`
- 渲染 hint：`src/utils/lyrics/renderHints.ts`、`graphemeTiming.ts`
- 参考实现：`src/components/obs/ObsBrowserSourceApp.tsx`（纯浏览器挂载 VisualizerRenderer 的现成范例，含自建 MV 与 SSE 配置）、`ObsWebSourceApp.tsx`
- 原始调研：`research/folia/notes-runtime.md`（471 行）、`notes-audio.md`、`notes-shell.md`
