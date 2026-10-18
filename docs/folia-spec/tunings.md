# Folia 各歌词样式 tuning 键与默认值

> 自动抽取自 `src/types.ts` 的 `DEFAULT_<MODE>_TUNING`（v0.7.21）与各 `src/components/visualizer/<mode>/tuning.ts` 的声明。所有值持久化在 localStorage；「默认」按钮（歌词动画 tab）写回 defaults 并弹 `notifications.<mode>Reset` toast。
> 配套文档：`docs/folia-spec/settings-ui.md`（设置窗口/控件/默认值）、`docs/folia-spec/style-map.md`（14 样式映射）。

## 1. 样式 tuning 一览（13 个样式有 tuning；still 没有）

| 样式 dir | 中文名 | tuning mode | settingsKey | setter | resetter | localStorage key | 设置面板 | 动感效果 |
|---|---|---|---|---|---|---|---|---|
| sonnet | 商籁 | `sonnet` | `sonnetTuning` | `handleSetSonnetTuning` | `handleResetSonnetTuning` | `sonnet_tuning` | SonnetSettingsPanel (sonnet/SonnetSettingsPanel.tsx) | sonnet.lensTear 推镜裂光 |
| tempera | 凝彩 | `tempera` | `temperaTuning` | `handleSetTemperaTuning` | `handleResetTemperaTuning` | `tempera_tuning` | TemperaSettingsPanel (tempera/) | — |
| lumiere | 绘光 | `lumiere` | `lumiereTuning` | `handleSetLumiereTuning` | `handleResetLumiereTuning` | `lumiere_tuning` | LumiereSettingsPanel (lumiere/) | — |
| classic | 流光 | `classic` | `classicTuning` | `handleSetClassicTuning` | `handleResetClassicTuning` | `classic_tuning` | ClassicSettingsPanel (settingsPanels.tsx:31) | — |
| cadenza | 心象 | `cadenza` | `cadenzaTuning` | `handleSetCadenzaTuning` | `handleResetCadenzaTuning` | `cadenza_tuning` | 无面板（歌词动画 tab 显示「这个样式没有参数」） | — |
| partita | 云阶 | `partita` | `partitaTuning` | `handleSetPartitaTuning` | `handleResetPartitaTuning` | `partita_tuning` | PartitaSettingsPanel (settingsPanels.tsx:93) | — |
| fume | 浮名 | `fume` | `fumeTuning` | `handleSetFumeTuning` | `handleResetFumeTuning` | `fume_tuning` | FumeSettingsPanel (settingsPanels.tsx:171) | — |
| tilt | 倾诉 | `tilt` | `tiltTuning` | `handleSetTiltTuning` | `handleResetTiltTuning` | `tilt_tuning` | TiltSettingsPanel (settingsPanels.tsx:514) | — |
| claddagh | 回环 | `claddagh` | `claddaghTuning` | `handleSetCladdaghTuning` | `handleResetCladdaghTuning` | `claddagh_tuning` | CladdaghSettingsPanel (settingsPanels.tsx:762) | — |
| monet | 莫奈 | `monet` | `monetTuning` | `handleSetMonetTuning` | `handleResetMonetTuning` | `monet_tuning` | MonetSettingsPanel (monet/) | — |
| pendolo | 时计 | `pendolo` | `pendoloTuning` | `handleSetPendoloTuning` | `handleResetPendoloTuning` | `pendolo_tuning` | PendoloSettingsPanel (pendolo/) | pendolo.drumhead 仿真鼓面（drums） |
| cappella | 群唱 | `cappella` | `cappellaTuning` | `handleSetCappellaTuning` | `handleResetCappellaTuning` | `cappella_tuning` | CappellaSettingsPanel (settingsPanels.tsx:309) | — |
| diorama | 镜台 | `diorama` | `dioramaTuning` | `handleSetDioramaTuning` | `handleResetDioramaTuning` | `diorama_tuning` | DioramaSettingsPanel (settingsPanels.tsx:591) | diorama.ripple 水镜涟漪 |
| still | 静止 | —（无 tuning.ts） | — | — | — | — | 无 | — |

- tuning.ts 位置：`src/components/visualizer/<mode>/tuning.ts`（`sonnet/tuning.ts`、`tempera/tuning.ts`、`lumiere/tuning.ts`、`classic/tuning.ts`、`cadenza/tuning.ts`、`partita/tuning.ts`、`fume/tuning.ts`、`tilt/tuning.ts`、`claddagh/tuning.ts`、`monet/tuning.ts`、`pendolo/tuning.ts`、`cappella/tuning.ts`、`diorama/tuning.ts`）。
- 唯一带 `olderKeys` 的是 cadenza（旧键 `cadenze_tuning`，`cadenza/tuning.ts:21`）。
- `applyVisualizerTuning(mode, props, bundle)` 把 tuning 以命名 prop（如 `sonnetTuning`）传给样式 renderer，同时 `props.visualizerTunings` 带整包 bundle（`tuningRegistry.ts`）。
- 每个 `tuning.ts` 可声明 `preview(draft, saved)`（拖动滑块时预览画什么）、`apply(props, tuning)`、`storage: {key, olderKeys, read, merge, onChange, resetNotice, actions}`（`tuningDefinition.ts`）。
- 默认 `preview` 行为：预览画 draft；`apply` 一律 `{...props, <mode>Tuning: tuning}`（monet 额外设 `onMonetTuningChange`）。

## 2. 各样式默认值（`DEFAULT_<MODE>_TUNING` 原文）

### Classic —— ClassicTuning
```ts
enableWordRotation: true,
breathingFloatMultiplier: 1,
useLegacyLayout: false,
wordSpacing: 0.7,
```

### Cadenza —— CadenzaTuning
```ts
fontScale: 1.12,
widthRatio: 0.72,
motionAmount: 1,
glowIntensity: 1,
beamIntensity: 0,
```

### Partita —— PartitaTuning
```ts
showGuideLines: true,
useSemanticLayout: true,
staggerMin: 20,
staggerMax: 100,
```

### Fume —— FumeTuning
```ts
hidePrintSymbols: false,
disableGeometricBackground: true,
backgroundObjectOpacity: 0.5,
textHoldRatio: 1,
cameraTrackingMode: 'smooth',
cameraSpeed: 1,
glowIntensity: 1,
heroScale: 1,
```

### Claddagh —— CladdaghTuning
```ts
focusScaleRatio: 0.65,
radiusScale: 1.0,
ellipseTiltDeg: 45,
showAxisLine: true,
letterSpacingOffset: 0,
```

### Cappella —— CappellaTuning
```ts
showEmoMessages: true,
emojiPackSource: 'builtin',
avatarSource: 'cover',
```

### Tilt —— TiltTuning
```ts
splitProbability: 0.75,
tiltStyleProbability: 0.35,
colorScheme: 'default',
```

### Pendolo —— PendoloTuning
```ts
arcRadius: 0.42,
arcAngleDeg: 100,
wheelCenterX: 0.0,
wheelCenterY: 0.50,
tickSnappiness: 2.0,
activeScale: 1.25,
showGearDecor: 'subtle',
showCenterGradient: true,
showCoverOnWatchFace: false,
enableLineGlow: false,
```

### Sonnet —— SonnetTuning
```ts
cameraIntensity: 1,
typographyMotion: 1,
mgDensity: 1,
showOnlyText: false,
showGuide: true,
showBackgroundMg: true,
showFixedGeo: true,
showGiantDecorativeText: true,
showBackgroundDecor: true,
enableTransitions: true,
outerFrameMode: 'full',
textureResolution: 1.5,
postProcessEnabled: false,
postProcessGrain: 0.2,
postProcessContrast: 0,
postProcessRgbShift: 0,
postProcessHalftone: 0,
postProcessVignette: 0.85,
postProcessLensDistortion: 0.3,
postProcessLensDispersion: 0.6,
```

### Tempera —— TemperaTuning
```ts
cameraIntensity: 1,
glyphMotion: 1,
wholeLineLyrics: false,
glyphSettleStretch: 0.5,
colorMode: 'duo',
showBlocks: true,
showDecor: true,
showCornerMarks: true,
textInversion: true,
layerImages: [],
layerImageDepth: 'back',
layerImageFrequency: 0.6,
enableTransitions: true,
textureResolution: 1.5,
postProcessEnabled: true,
postProcessTextureCompression: false,
postProcessGrain: 0.2,
postProcessContrast: 0,
postProcessRgbShift: 0,
postProcessVignette: 0.85,
postProcessLensDistortion: 0.3,
```

### Lumiere —— LumiereTuning
```ts
lightIntensity: 1,
audioResponse: 1,
fogDensity: 1,
darkField: 0.75,
moteAmount: 1,
bloom: 1,
textBloom: 1,
unlitOpacity: 0.22,
windowNeighbors: 2,
decay: 1,
echo: 1,
fogOctaves: 5,
lineArt: true,
frontBokeh: true,
trails: true,
hideTrails: false,
seamlessTransitions: true,
overlayFrame: true,
textOnly: false,
keywordColors: true,
themeIcons: true,
themeColorMix: 0.3,
renderQuality: 'full',
```

### Diorama —— DioramaTuning
```ts
cameraSpeed: 1,
motionAmount: 1,
audioReactivity: 1,
geometryVisibility: DEFAULT_DIORAMA_GEOMETRY_VISIBILITY,
particleDensity: 576,
particleScale: 1,
particleGlowEnabled: true,
particleGlowIntensity: 0.65,
showParticles: true,
backgroundParticleCircumference: 28,
backgroundParticleRadial: 2,
glowEnabled: true,
glowIntensity: 1,
soulEnabled: true,
soulIntensity: 1,
soulActiveEnabled: false,
gradientEnabled: false,
gradientIntensity: 1,
keywordColoringEnabled: true,
```

### Monet —— MonetTuning
```ts
keywordColoringEnabled: true,
showDescription: true,
showAudioVisualization: true,
audioStyle: 'bar',
fontScale: 1.2,
portraitSource: 'cover',
portraitOffsetX: 0,
portraitStyle: 'square',
showPortraitDragHanger: true,
```

## 3. 背景 tuning 默认值（`backgrounds/<mode>/tuning.ts` 用）

背景 mode：`common`、`latent`（默认）、`monet`、`nomand`、`sora`、`url`；下述为有 tuning 对象的背景。

### Monet_background —— MonetBackgroundTuning
```ts
backgroundSource: 'cover-derived',
backgroundLayout: 'full-overlay',
backgroundBlurPx: 6,
backgroundOverlayOpacity: 0.74,
backgroundGrayscale: 0,
backgroundSaturation: 1.05,
backgroundWash: 0.34,
backgroundHalfPaneOffsetX: 0,
backgroundWashColorMode: 'theme',
backgroundWashCustomColor: '#8fb7ff',
backgroundDriftEnabled: true,
backgroundDriftStrength: 0.5,
backgroundStreaksEnabled: true,
```

### Nomand_background —— NomandBackgroundTuning
```ts
imageSource: 'cover-derived',
effect: 'dithering',
ditheringType: '8x8',
size: 3,
colorSteps: 4,
originalColors: false,
inverted: false,
flutedGlassSize: 0.5,
flutedGlassDistortion: 0.5,
flutedGlassBlur: 0.08,
paperTextureContrast: 0.32,
paperTextureRoughness: 0.42,
paperTextureFiber: 0.3,
halftoneDotsSize: 0.5,
halftoneDotsRadius: 1.25,
halftoneDotsContrast: 0.4,
halftoneDotsOriginalColors: false,
halftoneDotsInverted: false,
lensDistortionSpread: 0.45,
lensDistortionBulge: 0.3,
lensDistortionDispersion: 0.65,
overlayEnabled: true,
overlayOpacity: 0.35,
```

### Latent_background —— LatentBackgroundTuning
```ts
displayMode: 'both',
colorSource: 'cover-theme',
dynamicOnlyInPlayer: true,
enhancedBeatResponse: true,
ditheringSpeed: 0.1,
ditheringAudioSpeed: 1.2,
ditheringSize: 2.5,
ditheringOpacity: 0.55,
meshSpeed: 0.3,
meshAudioSpeed: 2,
meshDistortion: 0.8,
meshSwirl: 0.1,
overlayEnabled: true,
overlayOpacity: 0.35,
```

### Sora_background —— SoraBackgroundTuning
```ts
blank: false,
```

## 4. 与设置 UI 的关系

- 每个样式的设置面板把 tuning 字段渲染成 kit 控件；字段的 label 文案在各样式面板文件里（如 sonnet 见 `docs/folia-spec/settings-ui.md` §3.4）。
- 所有数值区间不在 types 里，而在面板组件里（SliderRow 的 min/max/step）。WebView 复刻时以面板源文件为准。
- 13 个 tuning 的默认值随 Folia 版本变化；迁移桌面 Folia 配置时按 `DEFAULT_*_TUNING` 做 merge（`readStoredTuning` 会把缺字段补默认）。
