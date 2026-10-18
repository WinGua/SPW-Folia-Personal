# Folia「歌词样式」设置窗口 —— 实现级规范

> 源：`work/folia/folia-major-main`（Folia v0.7.21，GitHub 上游 folia-major-main）+ 已安装应用 `C:\Program Files\Folia`（asar 已解包到 `C:\tmp\asar`，`dist/` 为 v0.7.21 构建产物）。
> 目标：在 spw-folia 的 WebView2 里 **复用 Folia 自己的 Web 技术栈** 复刻截图 1 的设置页（并在同一 webview 里承载 fullscreen 可视化）。
> 本文所有中文 UI 文案均取自 `src/i18n/locales/zh-CN.ts`（v0.7.21），与截图逐字一致；所有默认值/范围/步进均取自源码，标注行号。

---

## 0. 一页速查：截图 1 控件 → 代码

截图 1 = 设置 → 歌词样式（窗口标题 **歌词样式**）→ 右侧栏 tab **歌词动画**，当前样式 = **商籁（sonnet）**，智能动感模式开启。

| 屏幕上的控件（自上而下） | 类型 | 默认值（源码） | 范围/步进 | 运行时作用 | 代码位置 |
|---|---|---|---|---|---|
| 窗口标题「歌词样式」 | h2 | — | — | StudioWindow title | `src/components/visualizer/window/VisPlayground.tsx`（`<StudioWindow title={t('options.lyricsStyleSettings')}>`） |
| 大预览（暂停的歌词画面） | 活渲染 | — | — | 抽主题曲片段循环渲染当前样式，暂停按钮悬停出现 | 同上 stage 区；缩放规则见 §2.5 |
| 右栏 tabs：**歌词动画 / 背景 / 字体 / 字幕** | Tabs | 打开时=歌词动画（`initialEditSection='visualizer'`） | — | 切换右栏内容；点击预览画面热区也会切 tab | `VisPlaygroundSettingsPanel.tsx`（SECTION_OPTIONS） |
| tabs 右端「默认」 | 文字按钮 quiet | 无效 tab 时 disabled | — | 重置当前 tab（语义见 §1.3） | 同上（`action={<Button variant="quiet">{t('ui.default')}</Button>}`） |
| **智能动感模式** 标题（组） | Group | — | — | 整幅画面的节拍驱动总开关；该 card 不属于任何样式 | `SmartBeatSettingsCard.tsx` |
| └ 行 **开关** + ⓘ | ToggleRow（note=长说明，点 ⓘ 在行下展开） | **`enabled: false`**（`src/types.ts:609` DEFAULT_SMART_BEAT_SETTINGS） | — | 关＝所有画面保持原频谱响应；开＝样式的「动感效果」按节拍/鼓点驱动。**截图里是 ON，是用户自己开过**（见 §9） | `SmartBeatSettingsCard.tsx` |
| **动感效果** 标题（组） | Group | — | — | 当前样式 `entry.beatEffects` 声明的效果，每个一组开关+强度 | `BeatEffectsGroup.tsx` |
| └ 行 **推镜裂光** + ⓘ + 开关 | ToggleRow | `on: true`（`BEAT_EFFECT_DEFAULT`，未存过即为开） | — | sonnet 的 `sonnet.lensTear`：每拍镜头推近，小节第一拍撕裂并泛起辉光 | `services/beatFx/beatEffects.ts` |
| └ 行 **强度** | SliderRow `sub` | `1` | **0 – 2**，step **0.05**，格式 `${v.toFixed(2)}x`，mark 在 1 | 1x = 调校时的原始外观，2x 加倍 | 同上 `BEAT_EFFECT_STRENGTH_MAX=2` |
| **渲染质量** 标题（组） | Group | — | — | sonnet 专属 | `sonnet/SonnetSettingsPanel.tsx` QUALITY_GROUP |
| └ **纹理分辨率** | SliderRow | **1.5**（`DEFAULT_SONNET_TUNING.textureResolution`，`src/types.ts:577`） | **0.5 – 4**，step **0.25**，格式 `x` | pixi 渲染纹理倍率，越高越清晰、显存/负载越高 | 同上 |
| └ 警示文案（无标题行） | Row notice（橙色小圆点） | — | — | 文案：「提高纹理分辨率会增加 GPU 显存占用和渲染负载，可能影响性能。」 | 同上 |
| **动态与构图** 标题（组） | Group | — | — | sonnet 专属 | MOTION_GROUP |
| └ **镜头运动强度** | SliderRow | 1 | 0 – 2，step 0.05，`x` | 镜头推/摇/移幅度 | `cameraIntensity` |
| └ **文字动势** | SliderRow | 1 | 0 – 2，step 0.05，`x` | 文字入场/跟随运动的幅度 | `typographyMotion` |
| └ **背景短线密度** | SliderRow | 1 | 0 – 2，step 0.05，`x` | 主场景短线 MG 的密度 | `mgDensity` |
| （继续向下，截图外）后处理 / 显示内容组 | — | — | — | 见 §3.3 全表 | — |
| 预览下方 **样式 14** | h3 + 计数 | — | — | 样式架标题 | `VisPlayground.tsx`（`t('options.lyricStyles')` + `modeOptions.length`） |
| 2×7 样式格 | PictureGrid columns=7 | 当前样式=商籁 | maxHeight 250 | 每个格是 **实时 mini 渲染**（16:10），无图片资源；选中环 2px 主题色 | `../preview/LyricStylePicture.tsx` + `PictureGrid` |

**重要**：截图里的滑块数值排版是「标签在左、数值在标签行右端（tabular-nums）、滑轨在下占满整行」——这是 kit `Slider stacked` 形态（`panelRows.tsx` 的 `SliderRow`），不是普通横排滑块。

---

## 1. 窗口骨架（必须先复刻的部分）

### 1.1 StudioWindow

`src/components/shared/StudioWindow.tsx`（226 行）。歌词样式窗口是它的两个使用者之一（另一个是 Theme Park）。

- 全屏遮罩：`fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-5`；背景层 `absolute inset-0 backdrop-blur-xl`，暗色 `bg-[rgba(0,0,0,0.52)]` / 亮色 `bg-[rgba(24,18,12,0.36)]`。
- 窗口本体：`st-window relative grid h-[780px] max-h-full w-[1240px] max-w-full grid-rows-[64px_minmax(0,1fr)] overflow-hidden rounded-2xl bg-[var(--st-win)] text-[color:var(--st-t1)] shadow-[0_36px_90px_rgba(0,0,0,0.5),0_0_0_1px_var(--st-line2)]`，圆角 16px，最大 1240×780。
- 头部（64px）：返回按钮（`ChevronLeft` 18px，`h-8 w-8 rounded-lg`，`text-[var(--st-t2)]`，hover 变 `--st-fill` 底）＋标题 `text-xl font-semibold leading-8`（歌词样式）＋ `slot`（本窗口为空）＋ `actions`（本窗口为空）。
- 主体：`flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_420px]`；左 stage（`gap-4 px-4 pb-6 sm:px-6`），右栏固定 **420px**，`lg:border-l border-[var(--st-line)]`；窄于 1024px 时上下堆叠、整体滚动。
- 动画：入场 `opacity 0→1, y 12→0, scale .985→1`（kit `unfold`），退场 `y 8, scale .99`（kit `move`）；`AnimatePresence` 由调用方提供。
- 遮罩点击关闭、Esc 关闭（owner 处理）、Tab 限制在窗口内、焦点归还 opener——WebView 里可按需简化，但「点遮罩关闭 / 返回按钮关闭」建议保留。
- **色彩令牌**：窗口根节点 style 上设置 `settingsTokens(isDaylight, theme)`（`kit/kitTheme.ts`），kit 所有组件只读这些 CSS 变量：

| 变量 | 暗色 | 亮色 | 用途 |
|---|---|---|---|
| `--st-win` | `#1a1a1d` | `#f3f3f4` | 窗口底 |
| `--st-side` | `#141416` | `#e9e9eb` | 侧栏 |
| `--st-card` | `#232327` | `#ffffff` | 卡片 |
| `--st-menu` | `#2b2b30` | `#ffffff` | 弹出菜单 |
| `--st-raise` | `#45454c` | `#ffffff` | Segmented 选中块 |
| `--st-knob` | `#ececee` | `#ffffff` | 开关圆点（关） |
| `--st-pv` | `#151517` | `#ececef` | 预览格底 |
| `--st-ok/--st-warn/--st-err` | `#56c98d/#e3a949/#ef6f6f` | `#1e9a5c/#b97a10/#d04444` | 状态色/警示点 |
| `--st-t1` | `var(--text-primary)` | 同 | 主文字 |
| `--st-t2` | `color-mix(in srgb, var(--text-primary) 62%, transparent)` | 同 | 次级文字 |
| `--st-t3` | `…42%…` | 同 | 三级文字/占位 |
| `--st-line` / `--st-line2` | `…8%… / …16%…` | 同 | 分隔线/描边 |
| `--st-fill` / `--st-fill2` | `…7%… / …12%…` | 同 | 填充/hover |
| `--st-track` | `…17%…` | 同 | 滑轨未填充 |
| `--st-accent` | 取自主题 `accentColor`；缺省暗 `#f4f4f5` 亮 `#18181b` | | 强调色（选中环/下划线/开关开） |
| `--st-on-accent` | 对比度自动取 `#17171a` 或 `#ffffff` | | 强调色上的文字 |

> 复刻注意：`--text-primary` 是 Folia 全局主题变量（暗色主题约 `#e4e4e7`）。WebView 里必须定义它，否则 kit 文字含 `color-mix` 都会失效。

### 1.2 右栏结构

`VisPlaygroundSettingsPanel.tsx`：右栏 = `<Tabs …/>` + `<StudioColumnBody>`（`st-scroll px-4 pb-10 sm:pl-6 sm:pr-3 lg:min-h-0 lg:flex-1 lg:overflow-y-scroll`）。tab 内容外层 `key={activeSection}` + `st-page-in`（页内淡入动画）。

### 1.3 四个 tab 与「默认」按钮语义

```ts
const SECTION_OPTIONS = ['visualizer', 'background', 'common', 'subtitle'];
labels: options.previewVisualizerSettings 歌词动画
        options.previewBackgroundSettings 背景
        options.previewCommonSettings     字体
        options.previewSubtitleSettings   字幕
```

「默认」按钮：`Button variant="quiet"`，文案 `ui.default` = **默认**；`disabled` 当且仅当当前 tab「没有可重置项」：

| tab | 可重置？ | 点击后行为 |
|---|---|---|
| 歌词动画 | 仅当 `visualizerEntry.renderSettingsPanel` 存在 | `styleDraft.reset()` → 恢复该样式 tuning 的 `DEFAULT_*_TUNING`（写回 localStorage `<mode>_tuning`，弹 toast `notifications.<mode>Reset`） |
| 背景 | 仅当背景 entry 有 `resetSettings` | `backgroundEntry.resetSettings(backgroundActions)` |
| 字体 | 恒可 | 预览文本改回 `default`（神文之诗）；`onResetCommonSettings()`：fontScale→1、fontWeight→null（自动）、visualizerOpacity→1、fontStyle→sans、自定义字体→null、fallback families→[] |
| 字幕 | 恒可 | `handleResetSubtitleSettings()`：subtitleOverlayOpacity→0.6、subtitleFontScale→1、hideTranslationSubtitle→false、contentMode→translation、overlayBackground→true、upcomingBlur→true、showHarmony→true、harmonyBg→true、字幕字体继承歌词→true、fontStyle→sans、weight→null、family→null、fallback→[] |

「默认」不是全局重置：它只重置当前 tab；重置前若滑块正被按住，会先丢弃该滑块的待保存值（`gate.forget`），避免松手后又覆盖默认值。

---

## 2. 大预览（stage）

### 2.1 结构（`VisPlayground.tsx`）

```
<div stage>  ← flex-col gap-4
  <div 预览框>  relative min-h-[160px] flex-1 overflow-hidden rounded-xl shadow-[0_0_0_1px_var(--st-line)]
                style backgroundColor = 预览主题背景色（默认 #09090b）
      <VisPlaygroundSampleStage>          // 按“应用窗口尺寸”渲染再等比缩放
          <motion.div key={previewPlaceholderId}> // 换示例曲时淡入
              <VisualizerRenderer ... isPreviewMode />
          </motion.div>
      </VisPlaygroundSampleStage>
      <VisPlaygroundPreviewHotspots/>     // 透明点击热区：上 20% → 背景；中部 → 歌词动画；底部 → 字幕
      <Tooltip>暂停/继续按钮</Tooltip>      // 右上角 right-3 top-3 z-40
  </div>
  <div 样式架>  shrink-0 flex-col
      <h3>样式 <span>{14}</span></h3>     // 13px semibold t2；计数 font-normal t3，ml-1.5
      <PictureGrid columns={7} maxHeight={250} className="-mx-4" />
  </div>
</div>
```

- 暂停按钮：`h-8 w-8 rounded-full bg-black/45 hover:bg-black/65 text-white`，图标 `Pause/Play` 14px（`fill="currentColor"`），tooltip 文案 `options.pausePreview` / `options.resumePreview`。
- 大预览**始终**用预览主题（`PREVIEW_THEME = { backgroundColor:'#09090b', primaryColor:'#f4f4f5', accentColor:'#f4f4f5', secondaryColor:'#71717a', fontStyle:'sans', animationIntensity:'normal' }`），与窗口明暗无关；字体/字重/字族取右栏草稿值（`previewTheme`）。
- 示例曲数据：`preview/usePreviewClock.ts` + `PreviewPlaceholder.ts`；两种示例文本：`previewTextDefault` = **神文之诗**、`previewTextReserved` = **野芝麻**（字体 tab「预览文本」Segmented 切换）。
- 拖动滑块时：**大预览实时跟着草稿值变**，样式架小图用「已保存值」，松手才落盘（`useTuningDrafts` 的 gate 机制）；实现时若不追这段细节，至少保证松手持久化。

### 2.2 缩放规则（复刻大预览清晰度的关键）

`VisPlaygroundSampleStage.tsx`：样式按 **应用窗口尺寸**（`window.innerWidth/innerHeight`、vw/vh）布局，所以预览是把整窗尺寸的舞台缩放塞进预览框，再放大一点让人看清歌词：

- `DEFAULT_SAMPLE_ZOOM = 1.15`；`SAMPLE_ZOOM = { monet: 1.3 }`（Monet 歌词在中间窄带，需要更大裁切）；
- 只缩放画布内容，预览自己的按钮浮在缩放层之外。

### 2.3 样式架 PictureGrid

`kit/PictureGrid.tsx`（262 行）：

- 每格：`button`，`flex flex-col rounded-lg text-xs leading-[18px]`；画面 `span.relative block aspect-[16/10] w-full`，内层 `rounded-lg bg-[var(--st-pv)]`，有 `group-active:scale-[0.97]`；画面内容由 `picture(value,state)` 即 **`LyricStylePicture`** 实时绘制（`preview/LyricStylePicture.tsx` 把该样式真渲染器以 mini 尺寸挂载）；
- 选中环：`absolute -inset-[3px] rounded-[11px] shadow-[inset_0_0_0_2px_var(--st-accent)]`，framer-motion `layoutId` 滑动；
- 名字：`mt-1.5 block truncate text-center`；选中 `font-semibold text-[var(--st-t1)]`，未选中 `text-[var(--st-t2)] group-hover:text-[var(--st-t1)]`；
- 网格：`grid` 内边距左右各 16px（环与滚动条空间）；`maxHeight` 超出时内部滚动，底部 40px 渐隐 `linear-gradient(#000 calc(100% - 40px), transparent)`；用 IntersectionObserver 通知每格 `visible`（离屏的 mini 渲染可暂停）；
- 键盘：Tab 只到当前格；方向键移动选择；Home/End 首尾；
- 本窗口参数：`columns=7`（宽窗）/`4`（窄窗）、`maxHeight=250`、`className="-mx-4"`、`label=t('ui.animationMode')`。

### 2.4 预览热区（可选）

`VisPlaygroundPreviewHotspots.tsx`：画面上叠透明按钮，hover 显示半透明标签——顶部 20% 高度→「背景」，中部→「歌词动画」，底部→「字幕」；点击切右栏 tab。复刻时可省略，但截图/交互验收若包含 hover 提示则需保留。

---

## 3. Tab 1「歌词动画」

### 3.1 渲染顺序（`VisPlaygroundSettingsPanel.tsx`）

1. 可选 `missingStyleNotice`（mod 样式缺失时 Row notice）
2. **`<SmartBeatSettingsCard t={t}/>`**（整幅画面的总开关，永远第一个）
3. `key={visualizerMode}` 包裹：
   1. **`<BeatEffectsGroup effects={visualizerEntry.beatEffects} .../>`**（该样式的动感效果；无效果则不渲染，例如 classic/cadenza/partita/tilt 等）
   2. **`stylePanel = visualizerEntry.renderSettingsPanel({ t, isDaylight, theme, controlCardBg, rangeInputClass, tuning: styleDraft.tuning, onTuningChange: styleDraft.change, settings, onSliderPointerDown, onSliderCommit })`**（样式自己的面板；still 与 cadenza **没有**面板）
   3. `FoliumTuningCards`（mod 注册的 tuning，本项目忽略）
   4. 若既无样式面板也无 mod tuning：居中提示 `这个样式没有参数`（`options.lyricStyleNoOptions`，`py-14 text-center text-[13px] text-[var(--st-t3)]`）

### 3.2 智能动感模式卡（`SmartBeatSettingsCard.tsx`，38 行）

- `Group { id:'vis-smart-beat', titleKey:'options.smartBeat' }` → 标题 **智能动感模式**。
- 一行 `ToggleRow`：label = `options.smartBeatEnabled` = **开关**；note = `options.smartBeatDesc`（长说明，经 Row 的 ⓘ 展开）：
  > 总开关。开启后，各歌词动画自己设置里的「动感效果」按音乐驱动画面，每个效果可以单独开关、调强度；关闭时所有画面保持原来的频谱响应。按节拍的效果用 beat_this 识别节拍，按鼓点的效果用 HTDemucs 分离鼓声，画面上有效果用到时才分析。本地歌曲第一次播放时分析几秒；在线歌曲第一次播放时读取音频流来分析。分析过的歌会被记住。
- 可用性提示：`useSmartBeatAvailability(enabled)` 非 `'ready'` 时追加 Row notice，文案取 `options.beatFxUnavailable_${availability}`：
  - `noGpu`：此设备没有可用的 WebGPU，节拍效果不会生效。
  - `desktopOnly`：节拍效果仅在桌面版可用。
- 读写 store 字段 `smartBeat`，动作 `handleSetSmartBeat({ enabled })`，persist key `visualizer_smart_beat`。

### 3.3 动感效果组（`BeatEffectsGroup.tsx`，72 行）

- `Group { id:'vis-beat-effects', titleKey:'options.beatEffects' }` → 标题 **动感效果**；样式的 `beatEffects` 为空 → 整个组不渲染。
- 当 `smartBeat.enabled === false`：组内第一行 Row notice = **在上方打开智能动感模式后，这些效果才会生效。**（`options.beatEffectsNeedSmartBeat`）
- 每个效果（按 `entry.beatEffects` 顺序，`retired` 的跳过）：
  - `ToggleRow` label=`t(effect.nameKey)`，note=`t(effect.descKey)`，checked=`resolveBeatEffectSetting(smartBeat,id).on`（未存过 = 默认 `{on:true,strength:1}`），onChange 写 `{effects:{[id]:{on}}}`
  - 若 `enabled && on && effect.source==='drums' && !htdemucs_gpu 已安装`：Row notice = **这次安装缺少 HTDemucs 模型，请重新安装 Folia。没有鼓的歌也不出效果。**
  - 若 `enabled && on`：`SliderRow sub` label=**强度**（`options.beatEffectStrength`），value=strength，min 0，max **2**，step **0.05**，format `${v.toFixed(2)}x`，marks `[{value:1}]`，sub 缩进 40px
- 效果注册表（`src/services/beatFx/beatEffects.ts`）：
  - `sonnet.lensTear` 推镜裂光（`beatEffect_sonnetLensTear`，「每拍镜头推近，小节第一拍撕裂并泛起辉光」，source=beats）
  - `diorama.ripple` 水镜涟漪（source=beats）
  - `pendolo.drumhead` 仿真鼓面（source=drums，需要 HTDemucs 模型）
  - 已停用（`retired`，界面不显示）：`pendolo.gearBeats` 齿轮随拍、`latent.pulse` 潮汐脉动
- 常量：`BEAT_EFFECT_STRENGTH_MAX = 2`、`BEAT_EFFECT_DEFAULT = { on:true, strength:1 }`、`LEGACY_BEAT_LIST_EFFECT_IDS = [sonnet.lensTear, diorama.ripple]`。

### 3.4 商籁（sonnet）面板（截图 1 的样式专属部分，`sonnet/SonnetSettingsPanel.tsx`，135 行）

四个 `Group`，顺序固定：

**A. 渲染质量（`options.sonnetQualitySection`）**
| 控件 | key | 类型 | 默认 | 范围/步进 | 格式 | 备注 |
|---|---|---|---|---|---|---|
| 纹理分辨率 | `textureResolution` | Slider | 1.5 | 0.5–4 / 0.25 | `x` | |
| 警示 | — | Row notice | — | — | — | 提高纹理分辨率会增加 GPU 显存占用和渲染负载，可能影响性能。 |

**B. 动态与构图（`options.sonnetMotionSection`）** 三个 Slider 均为 0–2 / 0.05 / `x` / 默认 1：
- 镜头运动强度 `cameraIntensity`
- 文字动势 `typographyMotion`
- 背景短线密度 `mgDensity`

**C. 后处理（`options.sonnetPostProcessSection`）**
- Toggle **整体后处理滤镜** `postProcessEnabled`（默认 **false**）
- Reveal 展开后 7 个 Slider（sub 缩进；step 0.05；`x`）：胶片颗粒 `postProcessGrain` 0–1（默认 0.2）、对比度增强 `postProcessContrast` 0–1（0）、RGB 色差 `postProcessRgbShift` 0–1（0）、透镜扭曲 `postProcessLensDistortion` 0–2（0.3）、透镜色散 `postProcessLensDispersion` 0–1（0.6）、半调网点 `postProcessHalftone` 0–1（0）、暗角 `postProcessVignette` 0–2（0.85）

**D. 显示内容（`options.sonnetDisplaySection`）**
- Row **外层边框** `outerFrameMode` → Segmented：完全隐藏 `none` / 仅显示框架 `frame` / **完全显示 `full`（默认）**
- 7 个 ToggleRow：仅显示文字 `showOnlyText`(false)、轨迹线 `showGuide`(true)、主场景 `showBackgroundMg`(true)、文字浮标 `showFixedGeo`(true)、巨型装饰镂空文字 `showGiantDecorativeText`(true)、背景装饰 `showBackgroundDecor`(true)、场景转场 `enableTransitions`(true)

### 3.5 其它样式的面板归属（要在 歌词动画 tab 复刻时按样式切换）

| 样式 | 面板组件 | 位置 | 动感效果 | 字号自动提示 `ownFontSizeNoticeKey` |
|---|---|---|---|---|
| 商籁 sonnet | `SonnetSettingsPanel` | `sonnet/SonnetSettingsPanel.tsx` | `sonnet.lensTear` 推镜裂光 | sonnetFontSizeAutoNotice |
| 凝彩 tempera | `TemperaSettingsPanel` | `tempera/TemperaSettingsPanel.tsx` | 无 | temperaFontSizeAutoNotice |
| 绘光 lumiere | `LumiereSettingsPanel` | `lumiere/LumiereSettingsPanel.tsx` | 无 | lumiereFontSizeAutoNotice |
| 流光 classic | `ClassicSettingsPanel` | `visualizer/settingsPanels.tsx:31` | 无 | — |
| 心象 cadenza | **无面板** | — | 无 | — |
| 云阶 partita | `PartitaSettingsPanel` | `settingsPanels.tsx:93` | 无 | — |
| 浮名 fume | `FumeSettingsPanel` | `settingsPanels.tsx:171` | 无 | — |
| 倾诉 tilt | `TiltSettingsPanel` | `settingsPanels.tsx:514` | 无 | — |
| 回环 claddagh | `CladdaghSettingsPanel` | `settingsPanels.tsx:762` | 无 | — |
| 莫奈 monet | `MonetSettingsPanel` | `monet/MonetSettingsPanel.tsx` | 无 | — |
| 时计 pendolo | `PendoloSettingsPanel` | `pendolo/PendoloSettingsPanel.tsx` | `pendolo.drumhead` 仿真鼓面（drums） | — |
| 群唱 cappella | `CappellaSettingsPanel` | `settingsPanels.tsx:309` | 无 | — |
| 镜台 diorama | `DioramaSettingsPanel` | `settingsPanels.tsx:591` | `diorama.ripple` 水镜涟漪 | — |
| 静止 still | **无面板** → 显示「这个样式没有参数」 | — | 无 | — |

> 每个面板的完整控件/默认值见 `docs/folia-spec/tunings.md`（按 `DEFAULT_*_TUNING` 自动抽取）与各面板源文件；截图 1 只涉及 sonnet，故 §3.4 给全。

---

## 4. Tab 2「背景」

`VisPlaygroundSettingsPanel.tsx` background 分支：

1. 可选两条 notice：`options.nativeBlurBackgroundNotice`（启用播放页原生模糊背景时）、`options.foliumMissingSelection`（mod 背景缺失）
2. `Group { id:'vis-background-kind', titleKey:'options.visualizerBackgroundMode' }` → 标题 **背景类型**；内部 `div.py-3` 包 `PictureGrid columns={3}`（`BackgroundPicture` 实时绘制），6 个选项按注册表顺序：
   | mode | 中文（`getVisualizerBackgroundModeLabel`） | 说明 |
   |---|---|---|
   | `common` | 通用 | 纯色/几何背景（默认） |
   | `latent` | **潜像（默认 `DEFAULT_VISUALIZER_BACKGROUND_MODE='latent'`）** | 专辑封面扩散 |
   | `monet` | 莫奈 | 从专辑封面生成印象派色块 |
   | `nomand` | 诺曼德 | |
   | `sora` | 空 | |
   | `url` | 网络图片 | 用户 URL，列表管理 |
3. `key={resolvedBackgroundMode}` 包裹 `backgroundEntry.renderSettingsPanel({ config, actions, t, isDaylight, theme, controlCardBg, rangeInputClass, onSliderPointerDown, onSliderCommit })`——各背景自己的选项（含 `common` 的不透明度 0.75 默认等；详见 `research/folia/notes-shell.md`）

> 背景 tab 的「默认」= 调背景 entry 的 reset；`common` 背景没有 reset 时按钮 disabled。

---

## 5. Tab 3「字体」（`common`）

单卡片 `Group { id:'vis-common', titleKey:'options.previewCommonSettings' }`（`bare` → 不画组标题）：

| 行 | 控件 | 默认 | 说明 |
|---|---|---|---|
| 样式字号自动提示 | Row notice | — | 仅当样式声明 `ownFontSizeNoticeKey`；例如 sonnet：「商籁模式会根据画面尺寸、歌词量和布局自动计算字号；通用字体尺寸设置在此模式下无效。」→ 同时**禁用字号行** |
| **预览文本** | Segmented | `default`=神文之诗 | 选项：神文之诗 / 野芝麻 |
| **字体** | Row + below=`FontTiles`（PictureGrid 4 列，每格显示 **永Aa**） | `sans` | 选项：无衬线 `fontSans` / 衬线 `fontSerif` / 等宽 `fontMono` / 自定义 `customFont`（选了已自定义字体时标签=字体名；选「自定义」=打开系统字体选择器） |
| 当前字体（Reveal：自定义时） | Value + Button「选择自定义字体」 | — | `options.currentFont` / `options.chooseSystemFont` |
| **字号** | SliderRow | 1 | 0.85–1.4 / 0.05，`percent`（`Math.round(v*100)+'%'`），marks 90%/100%/110%/125%；`ownFontSizeNoticeKey` 存在时整行 disabled |
| **自动字重** | ToggleRow（note：使用当前可视化模式设计的默认字重。） | **开**（`fontWeight === null`） | 关掉后 Reveal 出字重滑块 |
| └ **字重**（Reveal） | SliderRow sub | 400（null 时的初值） | 100–900 / 10，格式纯数字，marks 300 纤细/400 常规/700 粗体 |
| **整体透明度** | SliderRow | 1 | 0.2–1 / 0.05，`percent` |

对应存储（`src/stores/useTypographySettingsStore.ts` + `visualizerSettingsPersistence.ts`）：`lyrics_font_style`（sans 默认）、`lyrics_font_scale`（1，clamp 0.85–1.4）、`lyrics_font_weight`（空=自动/100–900）、`lyrics_custom_font`、`lyrics_font_fallback_families`、`visualizer_opacity`（1，clamp 0.2–1）。字体 tab 重置目标见 §1.3。

字体栈：`src/utils/fontStacks.ts`；内置 sans=`Inter, …`、serif=`"獅尾四季春加糖SC", …`、mono=`IBM Plex Mono, …`；`@font-face "Folia Noto Serif SC"` 400/500 从 CDN `cdn.jsdmirror.cn` 加载（`src/index.css:19-33`），**仓库不含字体文件**。WebView 需联网或自带该字体。

---

## 6. Tab 4「字幕」

三个 Group（顺序固定）：

### 6.1 字幕（`Group { id:'vis-subtitle', bare }`，无组标题）
| 行 | 控件 | 默认 | 文案 | 说明 |
|---|---|---|---|---|
| 隐藏底部字幕层 | ToggleRow（note：不影响使用独立字幕的动画模式。） | false | `hidePlayerTranslationSubtitle` | 隐藏播放器底部译文层 |
| 副字幕内容 | Select | `translation` 翻译 | `subtitleContentMode` | 翻译 / 罗马音 / 罗马音 + 翻译 / 不显示 |
| 字幕透明度 | SliderRow | **0.6** | `subtitleOverlayOpacity` | 0.2–1 / 0.05，`percent` |
| 字幕背景 | ToggleRow（note：为底部字幕添加主题自适应的柔和扩散光晕，提高复杂画面中的可读性。） | true | `subtitleOverlayBackground` | |
| 非翻译歌词添加模糊效果 | ToggleRow | true | `subtitleUpcomingLyricsBlur` | |

### 6.2 和声字幕（`Group { id:'vis-harmony', titleKey:'options.harmonySubtitleSettings' }`）
- **显示和声字幕** `showHarmonySubtitle`（默认 true；note：显示或隐藏顶部的和声歌词层。）
- Reveal：sub **和声字幕背景** `harmonySubtitleBackground`（默认 true；note：为和声字幕添加柔和扩散的光晕背景。）

### 6.3 字幕字体（`Group { id:'vis-subtitle-font', titleKey:'options.subtitleFontFamily' }` → 标题 **字幕字体**）
- **字幕继承歌词字体** `subtitleFontInheritsLyrics`（默认 **true**；note：关闭后可为字幕单独设置字体。）
- Reveal（不继承时）：sub Row **字幕字体** + FontTiles；Reveal（有自定义字体时）当前字体 + 按钮；sub 自动字重 toggle；Reveal 字幕字重滑块 100–900/10
- 最后一行 **字幕缩放** `subtitleFontScale`：0.85–1.4 / 0.05，`percent`，默认 1

存储 keys：`subtitle_overlay_opacity`(0.6)、`subtitle_overlay_background`(true)、`subtitle_upcoming_lyrics_blur`(true)、`show_harmony_subtitle`(true)、`harmony_subtitle_background`(true)、`show_subtitle_translation`(true)、`subtitle_content_mode`(translation)、`hide_player_translation_subtitle`(false)、`subtitle_font_inherits_lyrics`(true)、`subtitle_font_scale`(1)、`subtitle_font_style`(sans)、`subtitle_font_family`、`subtitle_font_weight`(null)、`subtitle_font_fallback_families`。

---

## 7. Kit 组件规格（复刻视觉的最小集）

来源 `src/components/modal/settings/kit/`。所有尺寸为 CSS px；颜色一律引用 §1.1 变量。

### 7.1 Group（`Group.tsx`，54 行）
- 组标题：`mb-2 flex min-h-6 items-center justify-between gap-3 px-1`；`h3`：`text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]`（即「渲染质量」「动态与构图」这类小标题，13px 半粗、62% 白）
- 卡片：`st-card overflow-hidden rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]` → 圆角 12px、1px 描边
- 组间距：`mt-7 first:mt-5`（28px；首组 20px）
- `bare` = 不画标题；`preview` = 卡片顶部 136px 预览条；`foot` = 卡片下一行 12px 说明

### 7.2 Row（`Row.tsx`，160 行）
- 行高：`flex min-h-14 flex-wrap items-center gap-x-6 py-2.5`，左内边距 16px（sub 行 40px），右 16px；
- 行间分隔线：`.st-row::before` 绝对定位 1px `var(--st-line)`，从 `left:16px`（sub 行 40px），卡片首行隐藏见 `kit.css`；
- 标签：`text-sm leading-5 text-[color:var(--st-t1)]`（14px）；short hint 在标签下 `mt-0.5 text-xs leading-[18px] text-[var(--st-t2)]`；
- **note（长说明）= 标签右侧 `Info` 图标按钮**（15px，`h-[18px] w-[18px]`，默认 `text-[var(--st-t3)]`，展开时 t1），点击在行下 `Unfold` 展开 `max-w-[540px] text-xs leading-[19px]`——截图里的 ⓘ 就是它；
- **notice = 橙色圆点 + 文字**：`text-[13px] leading-5`，圆点 `h-1.5 w-1.5 rounded-full bg-[var(--st-warn)]`（「提高纹理分辨率…」那行）；
- 右侧控件容器 `ml-auto flex flex-wrap items-center justify-end gap-2`；`below` 跨整行；
- `disabled`：整行 40% 透明（说明仍可读）。

### 7.3 Slider（`Slider.tsx`，175 行）+ SliderRow
- 轨道：`h-1`（4px）圆角满，填充 `linear-gradient(to right, var(--st-accent) var(--st-p), var(--st-track) var(--st-p))`；
- 滑块：16×16 白圆，阴影 `0 0 0 1px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.35)`，拖动时 `scale(1.15)`；按下时轨道两端内缩 8px（`inset-x-2`）；
- stacked 形态：`<span class="st-slider-stacked">` 里先 `output`（数值，`ml-auto text-[13px] text-[var(--st-t2)] tabular-nums`），再 `basis-full` 的轨道（`relative mb-1 mt-1.5`）；
- 刻度 tick：`absolute top-3.5 h-1 w-px bg-[var(--st-t3)]`；带名字的刻度文字 `11px leading-[14px]`，当前值 t1、其它 t3；拖到离刻度 6px 内吸附（只有拖拽时）；
- 数值格式由调用方传入；本文所有 `x` = `v.toFixed(2)+'x'`，`%` = `Math.round(v*100)+'%'`（`panelRows.tsx:9-10`，仅此两个公共格式化函数）。

### 7.4 Toggle（`Toggle.tsx`，33 行）
- 按钮 `role="switch"`，`h-6 w-10 rounded-full`（40×24）；开=`bg-[var(--st-accent)]`，关=`bg-[var(--st-track)]`；
- 圆点 18px（`left/top 3px`），开=`translate-x-4`，按下时加宽到 22px；
- 颜色：开=`var(--st-on-accent)`，关=`var(--st-knob)`。

### 7.5 Tabs（`Tabs.tsx`，121 行）
- 底边 1px `var(--st-line)`；tab 高 36px（`h-9`），`text-[13px]`，间距 18px（md 22px）；当前 t1 + 2px 强调色下划线（framer-motion layoutId 滑动，圆角 2px 上缘）；未选 t2，hover t1；
- 右侧 action 容器 `flex h-9 items-center self-end pl-3` → 「默认」按钮在此；不换行，溢出横向滚动。

### 7.6 Segmented（`Segmented.tsx`）与 Button
- Segmented：容器 `min-h-8 rounded-lg bg-[var(--st-fill)] p-0.5`；选项 `h-7 px-3 text-[13px]`；选中块 `bg-[var(--st-raise)]` + `0 1px 2px rgba(0,0,0,0.2)`，圆角 6px，layoutId 滑动；
- Button quiet（「默认」）：`h-6 rounded-md px-1.5 text-xs text-[var(--st-t2)]`，hover `bg-[var(--st-fill)] text-[var(--st-t1)]`；disabled 40% 透明。

### 7.7 PictureGrid
见 §2.3。

### 7.8 FontTiles（`window/FontTiles.tsx`）
- `PictureGrid columns={4}`，每格画面正中 `永Aa`（`text-lg leading-none`，用该字体栈渲染），名字在格下；`arrowKeys="focus"`（方向键只移焦点，Enter/空格选中）。

### 7.9 Select（`Select.tsx`）
- 基于 `src/components/shared/CustomSelect.tsx`，`compact` 触发器；菜单渲染在窗口之外（portal），主题随 `useSettingsKitTheme()` 传入。字幕「副字幕内容」用它。

---

## 8. 复用方案（Vue 宿主 + Folia 代码）

### 8.1 推荐：React 岛（ReactDOM root）

设置页 90% 是 React + kit；**不要用 Vue 重画**，在 Vue 组件里挂一个 React island：

```ts
// Web 侧（打包进 spw-folia 的 WebView2 资源）
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import i18n from './folia-i18n';            // 引入 Folia 的 zh-CN 资源
import VisPlayground from '@/components/visualizer/window/VisPlayground';

createRoot(document.getElementById('vis-settings')!).render(
  <I18nextProvider i18n={i18n}>
    <VisPlayground
      theme={hostTheme} isDaylight={false}
      visualizerMode={state.mode} onVisualizerModeChange={...}
      visualizerOpacity={state.opacity} onVisualizerOpacityChange={...}
      backgroundConfig={...} backgroundActions={...}
      fontStyle={...} fontScale={...} fontWeight={...} customFontFamily={null} customFontLabel={null}
      subtitleFontScale={...} subtitleOverlayOpacity={...} hideTranslationSubtitle={...}
      subtitleContentMode={...} subtitleOverlayBackground={...} subtitleUpcomingLyricsBlur={...}
      showHarmonySubtitle={...} harmonySubtitleBackground={...}
      subtitleFontInheritsLyrics={...} subtitleFontStyle={...} subtitleFontWeight={...} subtitleFontFamily={null}
      onFontStyleChange={...} onFontScaleChange={...} onFontWeightChange={...} onCustomFontChange={...}
      onVisualizerModeChange={...} onToggleHideTranslationSubtitle={...} ...
      onClose={() => host.close()}
    />
  </I18nextProvider>
);
```

宿主与 Web 之间的状态：最省事的是 **让 Web 侧自己持久化**（Folia 的 store 都直接读写 `localStorage`，key 已列在 §5/§6/§9），宿主只负责把「打开设置窗口/选中的样式」传进来，并在关闭时把最终值回传（也可宿主用 `localStorage` 快照回读）。设置值本来就要跨窗口保留，localStorage 在 WebView2 用户数据目录下可持久化。

要使它跑起来，只需补齐三样：
1. **i18next**：`src/i18n/locales/zh-CN.ts` 的 resources + 默认语言 zh-CN（kit 的 Row/Group 内部 `useTranslation` 取 label/note 文案；`options.*` 与 `ui.*` 命名空间）。
2. **CSS**：Folia 的 Tailwind 产物（`C:\tmp\asar\dist\assets\src-C5rpGEdU.css` 214KB 已含全部工具类与 `kit.css`；或按源码重建 Tailwind）+ `--text-primary` 等全局主题变量 + `@font-face "Folia Noto Serif SC"`（CDN，见 §5）。
3. **依赖**：`react`, `react-dom`, `react-i18next`, `i18next`, `framer-motion`, `lucide-react`, `zustand`（stores），以及 `three`/`pixi.js` 仅当样式需要（14 星样式见 style-map.md 的 P0–P3 表）。

### 8.2 可以直接 import 的文件（无需改代码）

| 用途 | 文件 |
|---|---|
| 窗口骨架 | `src/components/shared/StudioWindow.tsx`（含 `StudioColumnBody`） |
| 设置面板 | `src/components/visualizer/window/VisPlaygroundSettingsPanel.tsx` |
| 设置窗口总装 | `src/components/visualizer/window/VisPlayground.tsx` |
| 智能动感/动效 | `src/components/visualizer/SmartBeatSettingsCard.tsx`、`BeatEffectsGroup.tsx`、`panelRows.tsx` |
| 样式面板 | `sonnet/SonnetSettingsPanel.tsx`、`tempera/TemperaSettingsPanel.tsx`、`lumiere/LumiereSettingsPanel.tsx`、`monet/MonetSettingsPanel.tsx`、`pendolo/PendoloSettingsPanel.tsx`、`settingsPanels.tsx`（classic/partita/fume/cappella/tilt/diorama/claddagh） |
| 动效注册 | `src/services/beatFx/beatEffects.ts` |
| tuning 体系 | `visualizer/tuningDefinition.ts`、`tuningRegistry.ts` |
| kit | `src/components/modal/settings/kit/*`（index.ts 统一导出） |
| 色彩/运动令牌 | `kit/kitTheme.ts`、`kit/motion.ts`、`kit/kit.css` |
| 样式注册与标签 | `visualizer/registry.tsx`、`visualizer/modeGlyphs.tsx`、`types/visualizerModes.ts` |
| i18n | `src/i18n/locales/zh-CN.ts`（另 en/zh-TW 可同步带） |
| 样式架小图 | `visualizer/preview/LyricStylePicture.tsx`、`LivePicture.tsx`、`previewScale.ts` |
| 大预览 | `visualizer/window/VisPlaygroundSampleStage.tsx`、`preview/usePreviewClock.ts`、`PreviewPlaceholder.ts` |

### 8.3 依赖注入 / 必须提供的 Provider

- `SettingsKitThemeContext`：`StudioWindow` 自带 Provider（`{isDaylight, theme}`）；单独挂 kit 组件时才需要。
- `SettingsAnchorContext`：`Group` 内用 `SettingsAnchor`，**无 Provider 也能渲染**（store null 时跳过注册），无需补。
- `LyricPreviewProvider`：只有样式架/大预览需要（`usePreviewClock` 的 clock/theme/background）。若只做右栏，可省大预览与样式架；但截图 1 要大预览+样式架，需一并引入。
- zustand stores：`useVisualizerSettingsStore`（样式/tuning/smartBeat/背景/opacity）、`useTypographySettingsStore`（字体/字幕）、`usePlayerChromeSettingsStore`（原生模糊，可选）；它们只在浏览器 localStorage 上工作，无需 Electron。
- 播放器侧：`VisualizerRenderer`/`VisualizerShell` 的 fullscreen 契约见 `docs/folia-spec/runtime-contracts.md` 与 `fullscreen-shell.md`。

### 8.4 若坚持用 Vue 重画（不推荐）

按 §7 的类名/尺寸/颜色令牌 1:1 复刻即可，注意三点：13px 组件文字与 14px 行标签的两级字号、`--st-t2/t3` 的 62%/42% 透明度、滑块 stacked 布局；字体与 i18n 文案照 §5/§6 表。工作量约 1–2 人日，且后续样式专属面板（13 个）会持续漂移，不如 React 岛。

---

## 9. 与截图 1 的差异 / 必须知道的坑

1. **智能动感模式默认是关的**：源码 `DEFAULT_SMART_BEAT_SETTINGS = { enabled:false, effects:{} }`（`src/types.ts:609-612`），安装版 v0.7.21 亦然。截图 1 显示开，是用户开启后的状态。若产品要求「一打开就像截图」，可在 host 首次启动时写入 `localStorage.visualizer_smart_beat = {"enabled":true,"effects":{}}`——但需产品确认，否则默认应与 Folia 一致。
2. **纹理分辨率默认 1.5x**，不是 1.00x；截图上的数值若显示 1.50x 则以源码为准（0.5–4 / 0.25）。
3. **第 13 个样式名是「镜台」（diorama）**，不是「铭台」；源码与 asar 中 `铭台` 出现 0 次（详见 `style-map.md`）。
4. **动感效果的开关默认 ON、强度默认 1.00x**；强度行只在「智能动感模式开 && 该效果开」时出现。
5. **动画 tab 的第一个 card 永远是智能动感模式**，与当前样式无关；动感效果 card 只在样式声明了 beatEffects 时出现。
6. 「默认」按钮的 disabled 状态随 tab 变化（§1.3），不要做成永远可点。
7. 样式独占字号的情况（sonnet/tempera/lumiere）：字体 tab 的字号滑块 **disabled** 并显示对应提示；这是截图 1 选商籁时字体 tab 的样子。
8. 滑块数值文案：`x` 两位小数（1.00x、1.50x），`%` 取整（60%、100%）；不要混用。
9. 通知/警示不是 toast，是行内橙色圆点文案（`Row notice`）；ⓘ 展开是行下长文本，不是 hover tooltip。
10. 大预览的样式按窗口尺寸缩放（zoom 1.15，monet 1.3），不是简单 `transform: scale(container)`；直接重画容易字太小。

---

## 10. 验收清单（复刻完成判据）

- [ ] 窗口 1240×780、右栏 420px、暗色卡片圆角 12px、组标题 13px/62% 白、行高 ≥56px、行间 1px 分隔线（首行无）。
- [ ] tabs 顺序 歌词动画/背景/字体/字幕，当前项 2px 强调色下划线 + 「默认」在右端。
- [ ] 歌词动画 tab：智能动感模式（开关+ⓘ）→ 动感效果（推镜裂光 + 开关 + ⓘ；开启时出现「强度」滑块 1.00x，mark 在中间）→ 渲染质量（纹理分辨率 + 橙色警示）→ 动态与构图（3 个 1.00x 滑块）。
- [ ] 14 样式 2×7 网格，名称与顺序同 style-map.md，选中环滑动、名字选中加粗，实时小图在滚动时暂停。
- [ ] 「默认」语义与 §1.3 一致（含 disabled）。
- [ ] 字体 tab 在商籁下字号行 disabled + 「商籁模式会根据画面尺寸…」提示。
- [ ] 字幕 tab 三组、默认值同 §6（透明度 60%、内容 翻译、继承字体 开）。
- [ ] 所有滑块 range/step/format 与 §0、§3、§5、§6 表一致。
- [ ] localStorage key 与 Folia 同名（若要与桌面 Folia 共享/迁移配置）：`sonnet_tuning`、`visualizer_smart_beat`、`lyrics_font_scale`、`subtitle_overlay_opacity` …

## 11. 证据索引

- `src/components/shared/StudioWindow.tsx`（窗口骨架/令牌）
- `src/components/visualizer/window/VisPlayground.tsx`、`VisPlaygroundSettingsPanel.tsx`、`VisPlaygroundSampleStage.tsx`、`VisPlaygroundPreviewHotspots.tsx`、`FontTiles.tsx`、`useTuningDrafts.ts`
- `src/components/visualizer/SmartBeatSettingsCard.tsx`、`BeatEffectsGroup.tsx`、`panelRows.tsx`、`definition.ts`
- `src/components/visualizer/sonnet/SonnetSettingsPanel.tsx`、`tempera/…`、`lumiere/…`、`monet/…`、`pendolo/…`、`settingsPanels.tsx`
- `src/components/modal/settings/kit/{Tabs,Row,Group,Slider,Toggle,Segmented,Select,Button,PictureGrid,Reveal,Value,Tooltip}.tsx`、`kitTheme.ts`、`kit.css`
- `src/components/visualizer/tuningDefinition.ts`、`tuningRegistry.ts`、各 `*/tuning.ts`
- `src/components/visualizer/preview/{LyricStylePicture,LivePicture,previewScale,usePreviewClock}.tsx`、`PreviewPlaceholder.ts`
- `src/stores/{useVisualizerSettingsStore,useTypographySettingsStore,visualizerSettingsPersistence}.ts`
- `src/types.ts`（`DEFAULT_*_TUNING`、`DEFAULT_SMART_BEAT_SETTINGS`）
- `src/services/beatFx/beatEffects.ts`、`src/hooks/useSmartBeatAvailability.ts`
- `src/i18n/locales/zh-CN.ts`（本文所有中文文案；关键区段：2260-2310、2385-2436、2591-2640）
- 构建产物：`C:\tmp\asar\dist\assets\src-C5rpGEdU.css`（含 kit.css）、`dist/assets/**`（无样式缩略图、无字体）
- 真实截图（Folia 仓库 README）：`research/assets/screenshots/*`
