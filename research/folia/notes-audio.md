# Folia 0.7.21 音频 / 节拍 / 性能输入事实表（给 webview harness）

只读调研，仓库未改动（唯一写入是本文件）。仓库根：`D:\输出目录\dsh2\work\folia\folia-major-main`。下文所有路径均为绝对路径。

---

## 0. 结论先行

- harness 必须提供的音频输入只有两样：`audioPower: MotionValue<number>` 和 `audioBands: AudioBands`（5 个 `MotionValue<number>` + 可选 `spectrum: MotionValue<Uint8Array>`）。都在 `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\definition.ts:73-74`。
- **统一尺度是 0..255**（AnalyserNode 字节尺度），不是 0..1。样式自己 `/255`（见 §3 清单）。给 0..1 会让 latent / monet / cadenza / diorama 的音频反应≈0。
- `audioPower` 不是"总电平"，是 **bass 与 lowMid 的均值再取 3 次方**，输出仍在 0..255 但被强烈压扁（§2.3）。照抄这个 gamma，harness 的画面才和真机一致。
- 更新频率：**每个 rAF**（≈显示器刷新率），不是固定 20/30 Hz；且会被全局 FPS 上限补丁一起限流（§5.1）。暂停时不是 0，而是 0..40 的"呼吸"值（§2.5）。
- 智能动感模式**默认关闭**（`DEFAULT_SMART_BEAT_SETTINGS.enabled = false`，`src\types.ts:609-612`）。关闭时 beat_this / htdemucs 一个都不加载，节拍时钟不 tick，样式只吃 audioPower/audioBands —— **没有模型的 harness 在关闭状态下可以渲染得完全一致**（§4.6）。

---

## 1. Props 契约：音频相关字段

`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\definition.ts`

- `:64` `export interface VisualizerSharedProps`
- `:65` `currentTime: MotionValue<number>`
- `:67` `duration?: number`
- `:68` `currentLineIndex: number`
- `:73` `audioPower: MotionValue<number>`
- `:74` `audioBands: AudioBands`
- `:88` `songHandoff?: VisualizerSongHandoff | null`
- `:89` `staticMode?: boolean`
- `:90` `backgroundStaticMode?: boolean`
- `:104` `paused?: boolean`
- `:110` `isPreviewMode?: boolean`

`AudioBands` 的权威定义在 `D:\输出目录\dsh2\work\folia\folia-major-main\src\types.ts:1437-1445`（注释把频段写死了）：

```ts
export interface AudioBands {
    bass: MotionValue<number>;    // 20-150Hz (Circles)
    lowMid: MotionValue<number>;  // 150-400Hz (Squares)
    mid: MotionValue<number>;     // 400-1200Hz (Triangles)
    vocal: MotionValue<number>;   // 1000-3500Hz (Icons)
    treble: MotionValue<number>;  // 3500Hz+ (Crosses)
    spectrum?: MotionValue<Uint8Array<ArrayBuffer>>; // Raw analyser FFT magnitude bins
}
```

应用内的实例是**模块级单例**，`D:\输出目录\dsh2\work\folia\folia-major-main\src\stores\motionSignals.ts`：

- `:22-28` `AudioBandSignals`（含 `spectrum: MotionValue<Uint8Array<ArrayBuffer>>`）
- `:45` `export const audioPower = motionValue(0);`
- `:47-52` `bass/lowMid/mid/vocal/treble = motionValue(0)`，`spectrum = motionValue(new Uint8Array(0))`
- `:60-61` `beatImpact`、`downbeatImpact`（智能动感模式的两个包络，见 §4.4）
- `:64` `export const audioBands: AudioBandSignals = { bass, lowMid, mid, vocal, treble, spectrum };`

harness 不需要 framer 的动画树：自己 `motionValue()` 造同签名对象即可；消费者只用 `useTransform` / `useMotionValueEvent` / 自己 rAF 里 `.get()`。

---

## 2. 真实播放管线（HTMLAudioElement → AnalyserNode → 频段 → MotionValue）

### 2.1 建图

`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\app\playback\bridges\usePlaybackAudioBridge.ts`

- `:129` `setupAudioAnalyzer()`
- `:135-136` `new AudioContext()`（存 `audioContextRef`）
- `:138-141`
  ```ts
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  analyserRef.current = analyser;
  ```
- `:143-149` 真正的源节点在 `buildPlaybackGraph({ context, analyser, connectDecks, equalizerNodesRef, settings })` 里（`src\services\playbackGraph.ts`），`createMediaElementSource` 只调一次（`:130-132` 注释：二次调用会抛）。
- **未设置** `minDecibels` / `maxDecibels` → 用浏览器默认 `-100 dBFS .. -30 dBFS`。`getByteFrequencyData` 就是把该区间线性映射到 0..255。

### 2.2 每帧采样

`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\app\playback\bridges\usePlaybackVisualizerBridge.ts`

- `:143` `const updateLoop = useCallback(() => { ... })`，`:314` `animationFrameRef.current = requestAnimationFrame(updateLoop);`，`:345-352` 启动/取消。**没有额外节流** → 每显示帧一次。
- `:153` 条件 `hasAudibleSignal && analyserRef.current`；`:151` `hasAudibleSignal = isActuallyPlaying || isTransitionAudible()`（`:147` `isActuallyPlaying = audioEl && !paused && !ended`）。
- `:154-157`
  ```ts
  const bufferLength = analyserRef.current.frequencyBinCount;   // fftSize/2 = 1024
  const dataArray = new Uint8Array(bufferLength);
  analyserRef.current.getByteFrequencyData(dataArray);
  audioBands.spectrum?.set(dataArray);
  ```
- `:159-168` 频段能量 = **区间内 bin 的算术平均**（不是 RMS、不是峰值）：
  ```ts
  const start = Math.floor(minHz / 21.5);
  const end   = Math.floor(maxHz / 21.5);
  ```
  `21.5` 是**硬编码 bin 宽**（44.1 kHz / 2 / 1024 = 21.53 Hz）。harness 若采样率不是 44.1k，必须改成 `sampleRate / 2 / 1024`，否则五个频段全偏。
- `:170-174` 五个区间：
  - `bass    = getEnergy(20, 150)`
  - `lowMid  = getEnergy(150, 400)`
  - `mid     = getEnergy(400, 1200)`
  - `vocal   = getEnergy(1000, 3500)` ← 与 mid 在 1000–1200 Hz **重叠**
  - `treble  = getEnergy(3500, 12000)` ← 12 kHz 以上直接丢弃（1024 bin 覆盖到 22.05 kHz）

### 2.3 动态整形（gamma）— 最容易被漏掉的一步

同文件 `:176-186`：

```ts
const process = (value: number, boost = 2) => {
    const normalized = value / 255;
    return Math.pow(normalized, boost) * 255;
};
audioPower.set(process((bass + lowMid) / 2, 3));
audioBands.bass.set(process(bass, 1.8));
audioBands.lowMid.set(process(lowMid, 2));
audioBands.mid.set(process(mid, 2));
audioBands.vocal.set(process(vocal, 1.5));
audioBands.treble.set(process(treble, 2));
```

- 输出仍是 **0..255**，但低端被压到接近 0。量级示例（原始字节 → 整形后）：
  - `audioPower`：40 → 8.9；80 → 71.7；120 → 243（3 次方非常陡）
  - `bass`（^1.8）：100 → 46.9；150 → 96.5；200 → 163
  - `mid/treble/lowMid`（^2）：100 → 39.2；150 → 88.2
- 含义：如果把 analyser 的**未整形**字节直接塞给样式，画面会比真机明显更"猛"（尤其是 latent 背景、monet 频谱、diorama 的 audioK）。要一致就照抄上表。

### 2.4 更新语义

- 同一帧内 6 个 MV 各 `.set()` 一次；`spectrum` 每帧 `new Uint8Array(1024)` —— harness 若在意 GC，可复用同一个 buffer（消费者只在同一帧内读）。
- MV 的 `.set()` 是同步的，framer-motion 会在下一帧统一跑派生链（`useTransform`/`useSpring`）。样式内部还有各自的 spring/lerp（如 `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\backgrounds\common\GeometricBackground.tsx:138` `useSpring(source, {stiffness:300, damping:30})`），所以 **30 Hz 输入也不会显得卡**。

### 2.5 无信号时不是 0，而是"呼吸"

同文件 `:187-197`：

```ts
const time = Date.now() / 2000;
const breath = (Math.sin(time) + 1) * 20;   // 0..40
audioPower.set(breath); bass/lowMid/mid/vocal/treble.set(breath);
audioBands.spectrum?.set(new Uint8Array(0));
```

五个值相同、周期 2π×2000 ms ≈ 12.6 s。harness 想复现"暂停中的 Folia"就照这个给。

---

## 3. 数值尺度（harness 最关键的一条）

### 3.1 规范：0..255，消费方自己除 255

| 消费点 | 行号 | 用法 |
|---|---|---|
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\monet\AudioOverlay.tsx` | `:224-228` | 五带全部 `/255` |
| 同上 | `:233` | `Math.min(1, Math.max(0.08, audioPower.get() / 255))` |
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\cadenza\VisualizerCadenza.tsx` | `:287` | `clamp(audioPower.get() / 255, 0, 1)` |
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\diorama\DioramaScene.tsx` | `:435` | `Math.min(1, audioPower.get() / 255) * audioK` |
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\backgrounds\latent\LatentBackground.tsx` | `:48` / `:253` | `normalizeAudio = v => clamp(v/255, 0, 1)`，`normalizeAudio(audioPower.get())` |
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\backgrounds\common\GeometricBackground.tsx` | `:136-139` | `useTransform(spring, [10, 200], [0.95, 1.45])`（按 0..255 设计） |
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\claddagh\CladdaghRingLine.tsx` | `:133-139` | 自适应：见过 `>1.0` 就永久锁 `power/255` |
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\claddagh\VisualizerCladdagh.tsx` | `:45-51` | 同上（另一份拷贝） |
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\lumiere\lumiereAudio.ts` | `:33-37`, `:48-54` | 自适应：`rawScale` 一旦见到 `raw > 1` 就置 true，`min(1, raw ? v/255 : v)`；`:63` 回零时复位 |
| `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\fume\FumeBackground.ts` | `:484-488` | `mix(0.95, 1.45, clamp((bandValue - 10) / 190, 0, 1))`（0..255 窗口 10..200） |

⇒ **harness 一律给 0..255 的浮点数**（可以带小数，真机 `process()` 的输出就是浮点）。

⇒ 额外平滑：lumiere 自己再套一层一阶低通，`lumiereAudio.ts:30-31` `ATTACK_SECONDS = 0.06`、`RELEASE_SECONDS = 0.25`（`:40-43` `1 - exp(-dt/tau)`，上冲用 attack、回落用 release）。所以给 lumiere 的原始值略"跳"一点更接近真机。

### 3.2 反例：preview 的假数据是 0..1（别照抄）

- `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\preview\usePreviewClock.ts:38-43`
  ```ts
  audioPower = useMotionValue(0.24); bass = 0.18; lowMid = 0.15; mid = 0.12; vocal = 0.2; treble = 0.1;
  spectrum = useMotionValue(new Uint8Array(64));
  ```
- `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\preview\useVisPlaygroundPreviewPlayback.ts:59-67` 的 `wave(offset, speed, floor, amplitude)` 峰值也只有 **0.34**；而 `:69-80` 的 spectrum 却是 **0..255 字节、长度 64**。
- 这是仓库里已存在的不一致：preview 里 `0.24/255 ≈ 0.00094`，latent / monet / cadenza / diorama 的音频反应几乎为零，claddagh 的自适应也检测不到 `>1.0`。**harness 不要复制 preview 的 0..1 尺度。**

### 3.3 spectrum 语义

- 真机：`Uint8Array`，长度 `frequencyBinCount = 1024`，原始字节 0..255（未做 gamma、未做频段聚合），每帧替换。
- 唯一消费者要求 **length > 6**：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\monet\AudioOverlay.tsx:17` `MIN_RAW_SPECTRUM_BIN = 6`，`:56-59` `length <= 6` 直接返回 0；`:232-233` 与 `:243-248` 在"有原始频谱"时走 `sampleRawSpectrumProfile`（对数映射 `:62-64`），否则退回五带插值 `sampleSpectrumProfile`（`:36-46`）。
- `new Uint8Array(0)` 是合法的"没有 FFT"（暂停时真机就这么给），样式会退回五带轮廓。
- `monet` 画 `BAR_COUNT = 72` 根（`:16`）。给 64 或 256 个 bin 都能工作，只要 > 6。
- 其他样式目前不读 spectrum（grep 结果只有 monet + 背景 shader 的 `u_resolution` 之类无关项）；OBS 链路会降到 ≤256 bins（§7.2）。

---

## 4. 节拍 / 智能动感模式（智能动感模式）

### 4.1 开关与默认值

- `D:\输出目录\dsh2\work\folia\folia-major-main\src\types.ts:609-612`
  ```ts
  export const DEFAULT_SMART_BEAT_SETTINGS: SmartBeatSettings = { enabled: false, effects: {} };
  ```
  ⇒ **默认关闭**，效果表为空。
- `D:\输出目录\dsh2\work\folia\folia-major-main\src\services\beatFx\beatEffects.ts:32-33`
  ```ts
  export const BEAT_EFFECT_STRENGTH_MAX = 2;                    // 强度滑杆 0..2，1 = 调好的样子
  export const BEAT_EFFECT_DEFAULT: BeatEffectSetting = { on: true, strength: 1 };
  ```
- `:17` `export type BeatEffectSource = 'beats' | 'drums';`
- `:36-42` 全部效果 id：
  - `sonnet.lensTear`、`diorama.ripple`、`pendolo.gearBeats`（retired）、`latent.pulse`（retired）→ source `'beats'`
  - `pendolo.drumhead`（时计「仿真鼓面」）→ source `'drums'`
- `:55-56` `isBeatEffectLive = settings.enabled && !effect.retired && resolveBeatEffectSetting(settings, id).on`
- `:48` `LEGACY_BEAT_LIST_EFFECT_IDS = [sonnet.lensTear, diorama.ripple]`（旧的"轻拍/重拍"一对值会折算进这两个）

### 4.2 哪些画面会跑模型

`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\beatClockTargets.ts`

- `:21-27` `effectsOnScreen()`：取当前 mode 的 `beatEffects`，`entry.background !== false` 时再并上背景的（默认背景是 Latent）。
- `:40-41` `liveBeatEffects = effectsOnScreen(...).filter(isBeatEffectLive)`
- `:44-45` `visualizerWantsBeats = liveBeatEffects.some(e => e.source === 'beats')` → 跑 beat_this
- `:49-50` `visualizerWantsDrumHits = liveBeatEffects.some(e => e.source === 'drums')` → 跑 htdemucs
- `:55-56` `visualizerWantsBeatClock = wantsBeats || wantsDrumHits`
- `:62-66` `liveBeatEffectStrength(settings, source)`

⇒ 画面（`entry.tsx` 的 `beatEffects`）不声明效果，就**一个模型都不会跑**。

### 4.3 关 / 开两种路径

`D:\输出目录\dsh2\work\folia\folia-major-main\src\hooks\useBeatFxTrack.ts`

- `:31-33`
  ```ts
  const staticMode = useThemeSettingsStore(state => state.staticMode);
  const beatsWanted = useVisualizerSettingsStore(state => visualizerWantsBeats(state)) && !staticMode;
  const drumsWanted = useVisualizerSettingsStore(state => visualizerWantsDrumHits(state)) && !staticMode;
  ```
  **`staticMode === true` 也会强制走关闭路径**（与用户开关无关）。
- `:44` `drumModel = useSyncExternalStore(subscribeModelAvailability, modelsPresent).htdemucs_gpu`（权重是否在盘上）
- `:150` `smartBeatOn = ...smartBeat.enabled && !staticMode`
- 关闭时：不读缓存、不跑模型、时钟不 tick；`beatImpact` / `downbeatImpact` 停留在 `motionSignals.ts:60-61` 的 `motionValue(0)`。

开启时（每帧）：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\app\playback\bridges\usePlaybackVisualizerBridge.ts:296-298`
```ts
if (beatFxWantedRef.current) {
    tickBeatFx(isActuallyPlaying ? audioElement : null, analyserRef.current?.context);
}
```
（`beatFxWantedRef` 由 `useBeatFxTrack()` 的返回值在 `:98-99` 每渲染刷新，所以切开关不重建帧循环。）

### 4.4 节拍时钟包络（样式真正消费的东西）

`D:\输出目录\dsh2\work\folia\folia-major-main\src\services\beatFx\clock.ts`

- `:49-50`
  ```ts
  export const BEAT_FX_BEAT_DECAY_MS = 160;
  export const BEAT_FX_DOWNBEAT_DECAY_MS = 200;
  ```
- `:29` `export const BEAT_FX_WEAK_BEAT_FLOOR = 0.35;`
- `:36-45` `resolveBeatFxAccentGain(event, trackScale)`：`rhythmic === false` → 0；无 `impact` → `trackScale`；否则 `(0.35 + 0.65 * impact) * trackScale`。`trackScale` 是曲目动态范围 0.45..1（见 `src\services\beatFx\beatFxSource.ts:52-53`）。
- `:52` `export const BEAT_FX_SEEK_THRESHOLD_SEC = 0.3;`（前跳超过 0.3 s 或任何后退 = seek，重新定位 cursor）
- `:162-215` `stepBeatFxClock(state, heardTime, dtSec)`：先按 `exp(-dtMs / DECAY * 2.3)` 衰减，再消费 `event.t <= heardTime` 的事件，命中时 `beatImpact = max(beatImpact, gain * exp(-lateMs / 160 * 2.3))`（下拍用 200 ms），并翻转 `rotationSign`。
- 写出的 MV：`D:\输出目录\dsh2\work\folia\folia-major-main\src\services\beatFx\beatFxLive.ts:1-2`（`beatImpact` / `downbeatImpact`），已乘用户强度；`:52` `const READY_HOLD_MS = 1500;`——切歌时旧结论多保留 1.5 s，避免闪回非节拍帧（`:139` 用它延长 `holdUntil`）。
- 诊断：dev 构建或 `localStorage['folia.dev.beatFxDebug'] = '1'` 时暴露 `window.__foliaBeatFx`（`beatFxLive.ts:24` 接口、`:62-77` 实例）。

### 4.5 模型是什么

- `D:\输出目录\dsh2\work\folia\folia-major-main\src\services\analysis\modelAvailability.ts`
  - `:29` `export type AutomixModelName = 'beat_this' | 'htdemucs' | 'htdemucs_gpu';`
  - `:38` `const ABSENT = Object.freeze({ beat_this: false, htdemucs: false, htdemucs_gpu: false });`（每个构建的初始答案；浏览器构建永远是这个）
  - `:56` `modelsPresent()`；`:46-49` `subscribeModelAvailability`（`useSyncExternalStore` 形状）
  - `:20-23` 说明：权重随安装包发布（`electron/analysis/modelPaths.cjs`），false = 文件缺失或非 Electron 构建
- beat_this（Beat This! final0，与 automix 共用）：`D:\输出目录\dsh2\work\folia\folia-major-main\src\services\analysis\beatThis.ts`
  - `:22` `BEAT_THIS_SAMPLE_RATE = 22050`
  - `:23-26` `N_FFT = 1024`，`HOP = 441`，`BEAT_THIS_FPS = 22050 / 441 = 50`
  - `:27-32` `N_MELS = 128`，`F_MIN = 30`，`F_MAX = 11000`，`LOG_MULTIPLIER = 1000`，`AMIN = 1e-10`
  - `:287` `MODEL_CHUNK_FRAMES = 1500`；`:371-373` `OUTRO_WINDOW_SEC = 30`、`MIN_BEATS = 8`
- htdemucs（鼓分离）：`D:\输出目录\dsh2\work\folia\folia-major-main\src\services\analysis\drumHits.ts`
  - `:86` `const ENERGY_HOP = 441;`（10 ms @ 44.1 kHz）
  - `:20-22` 判据：局部最大 + 左右 `PEAK_HALF` 帧 + 最小间隔 `MIN_HIT_GAP`
  - `:175-182` `pickDrumHits(mel)` / `pickBandHits(tracks, frames)`：三个鼓带（kick/snare/hat）
- 可用性提示：`D:\输出目录\dsh2\work\folia\folia-major-main\src\hooks\useSmartBeatAvailability.ts:22-43`
  - 返回 `'ready' | 'desktopOnly' | 'noGpu'`；无 `window.electron.getBeatThisGpuWeights` 的宿主（web / harness）恒为 `'desktopOnly'`；开关关时不探测（返回 `'ready'`）。

### 4.6 没有模型的 harness 能不能渲染一致？

**能，条件是智能动感模式关（默认）**。此时：
- 不加载任何模型（`useBeatFxTrack.ts:31-33` → `wanted === false`）
- `tickBeatFx` 不被调用（`usePlaybackVisualizerBridge.ts:296`）
- 样式只有两个音频输入：`audioPower` / `audioBands`（+ spectrum）
- 唯一差异是"若用户打开了开关且画面声明了 `beatEffects`"：`sonnet.lensTear`、`diorama.ripple`、`pendolo.drumhead` 会**静默不动**（不是报错）。

若 harness 需要"看起来像开着"，两条路：
1. 只把 `smartBeat.effects[id].on` 置 false（开关可以留着）——效果消失但画面其余一致；
2. 自己合成 `beatImpact` / `downbeatImpact` 两个 MV（照 §4.4 的 160/200 ms 指数包络，峰值 1、弱拍地板上限 0.35），把 BPM 网格当事件表喂进去。注意真路径里这两个 MV 是模块级单例，harness 得自己造并注入。

---

## 5. 性能旋钮

### 5.1 帧率上限（会连音频采样一起限流）

`D:\输出目录\dsh2\work\folia\folia-major-main\src\utils\frameRateLimiter.ts`

- `:24` `export const VISUALIZER_FRAME_RATE_OPTIONS = [60, 90, 120] as const`
- `:25` `export const VISUALIZER_FRAME_RATE_STORAGE_KEY = 'visualizer_frame_rate';`
- `:26` `const FRAME_INTERVAL_TOLERANCE_MS = 1;`
- `:27-32` `isVisualizerFrameRate` 合法值：`'off' | 120 | 90 | 60`
- `:34-46` `parseVisualizerFrameRate`：`null` / `'auto'` / 非法 → `'off'`
- `:48-58` `shouldProcessFrameAtRate(ts, lastTs, rate)`：`intervalMs = 1000 / frameRate - 1`
- `:64-138` `createFrameRateLimitedRaf(...)`：所有回调排队、在允许的帧一起 flush
- `:188-217` `installGlobalVisualizerFrameRateLimiter(override?)`：**直接替换 `window.requestAnimationFrame` / `cancelAnimationFrame`**，原生实现存到 `__foliaNativeRequestAnimationFrame` / `__foliaNativeCancelAnimationFrame`
- `:163-172` `requestUncappedAnimationFrame(cb)` / `:175-179` `cancelUncappedAnimationFrame`：绕过上限；注释（`:157-162`）说明 framer-motion 在模块加载时就抓走了 rAF，所以它仍按显示帧跑
- `:140-153` `setGlobalVisualizerFrameRate(rate)`：`'off'` 时 `restoreGlobalVisualizerFrameRateLimiter()`

⇒ 因为补丁是**全局**替换 rAF，`usePlaybackVisualizerBridge` 的音频采样循环也一起被限流。harness 若自己驱动帧循环，等价行为是"以 min(显示刷新率, 上限) 更新 MV"。

### 5.2 glow 模糊量化（Linux 默认开）

`D:\输出目录\dsh2\work\folia\folia-major-main\src\utils\glowBlurQuantize.ts`

- `:19` `export const GLOW_BLUR_QUANTIZE_STORAGE_KEY = 'visualizer_glow_blur_quantize';`
- `:22-30` `isLinuxRuntime()`：`window.electron?.platform === 'linux'` 或 UA 含 Linux 且不含 Android
- `:31-40` `readStoredGlowBlurQuantize()`：有存储用存储，否则 **`isLinuxRuntime()`**
- `:43` 模块级 `glowBlurQuantized` + `:45-53` `isGlowBlurQuantized()` / `setGlowBlurQuantized()`
- `:55-59` `quantizeShadowBlur(px)`：开时 `Math.max(0, Math.round(px))`，关时原值（`!Number.isFinite` → 0）
- `:1-18` 影响面：glow 从 `text-shadow`/canvas shadow 改成 `drop-shadow()`（classic/partita 的 `wordGlow.ts`、claddagh、fume 的 `setCanvasTextGlow`）；canvas blur 取整；cadenza 文字加独立合成层；fume 相机缩放下分段栅格化。

⇒ 追求像素级一致的 harness 要复刻这个开关（Linux 上默认 `true`，其它平台默认 `false`）。

### 5.3 DPR / 分辨率

没有全局决策，各样式自己读 `window.devicePixelRatio`：

- lumiere：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\lumiere\lumiereRuntimeTuning.ts:39` `LUMIERE_MAX_RENDER_RESOLUTION = 2;`；`:42-45` `resolveLumiereRenderResolution(dpr) = min(2, max(1, dpr))`；`createLumierePixiRuntime.ts:138-145` `app.init({ width, height, autoDensity: true, resolution })`，`:207-212` resize 判断 `(width, height, resolution)` 三者变化。
- fume：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\fume\fumeCanvasText.ts:77` 与 `useFumeCanvasStage.ts:207` `clamp(window.devicePixelRatio || 1, 1, 2)`；`useFumeCanvasStage.ts:75, 100, 214` 用 dpr 定 canvas 像素尺寸。
- cadenza：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\cadenza\VisualizerCadenza.tsx:258` `const dpr = window.devicePixelRatio || 1;`
- lumiere 另有 `lumiereScaleMask = globalThis.devicePixelRatio | 0`（如 `lumiere\catalog.ts:15`、`lumiere\color.ts:5`、`lumiere\light\bloomFilter.ts:6`），用于按整数 DPR 选噪声/图案。
- OBS 页面会**改写** DPR 与窗口尺寸，把逻辑分辨率锁到 1920×1080 而保持 4K 栅格化：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\obs\ObsBrowserSourceApp.tsx:94-110`
  ```ts
  Object.defineProperty(window, 'devicePixelRatio', { get: () => scale, configurable: true });
  Object.defineProperty(window, 'innerWidth',  { get: () => realWidth / scale,  configurable: true });
  Object.defineProperty(window, 'innerHeight', { get: () => realHeight / scale, configurable: true });
  ```
  然后 `:109-111` 在 `scale > 1` 时派发 `resize`。harness 固定画布尺寸可以照这套做。

### 5.4 staticMode（设置项「静态模式」）

- 存储：`D:\输出目录\dsh2\work\folia\folia-major-main\src\stores\useThemeSettingsStore.ts:52` 字段、`:66` `getStoredBoolean('static_mode', false)`（键 `static_mode`）、`:78-85` `handleToggleStaticMode` 写入。
- 组装：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\useVisualizerRendererModel.ts:80` 订阅、`:155` 透传。
- 渲染影响：
  - `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\VisualizerShell.tsx:89` `resolvedStaticMode = sharedProps?.staticMode ?? false`；`:95` `showStageLayers = !isInBackdrop && !sharedProps?.isPreviewMode && !resolvedStaticMode`；`:97` `publishLayout = isPlayerPage && !isPreviewMode && isMainAppSurface`
  - `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\VisualizerBackdrop.tsx:95` `<VideoLayer paused={paused} />` 被 `!isPreviewMode && !staticMode && isMainAppSurface` 门控；`:120` `showStageLayers = !props.isPreviewMode && !props.staticMode`
  - 样式内部冻结：`lumiere\createLumierePixiRuntime.ts:443-445` `setStaticMode`、`:295` `resolveLumiereSceneFrames(program, time, !this.options.staticMode)`；`fume\useFumeCanvasStage.ts:118, 163` `if (!staticMode)`；`backgrounds\latent\LatentBackground.tsx:361, 389` `speed={staticMode ? 0 : ...}`；`backgrounds\sora\entry.tsx:35` `paused={paused || staticMode}`
  - 节拍时钟停：`useBeatFxTrack.ts:31-33`
  - 样式切换转场取消：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\VisualizerRenderer.tsx:44-45`
    ```ts
    const reducedMotion = useReducedMotionFor('uiMicroMotion');   // 应用自己的设置，不是系统
    const transition = animateStyleSwitch && !resolvedProps.staticMode && !reducedMotion ? softFocus : null;
    ```
  - **不动 audio 值**：staticMode 不改变 audioPower/audioBands 的写入路径，只冻动画/停节拍。

### 5.5 backgroundStaticMode

`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\visualizer\useVisualizerRendererModel.ts:156-161`

```ts
backgroundStaticMode: shouldPauseVisualizerBackground
    || (background.mode === 'latent'
        && background.latent?.tuning?.dynamicOnlyInPlayer
        && currentView !== 'player'),
```

其中 `shouldPauseVisualizerBackground` 来自 `D:\输出目录\dsh2\work\folia\folia-major-main\src\components\app\presentation\buildPlayerViewFlags.ts:30`
```ts
shouldPauseVisualizerBackground: currentView !== 'player' && disableHomeDynamicBackground,
```
只影响背景层（`definition.ts:90`），不冻文字。

### 5.6 isPreviewMode

- 定义 `definition.ts:110`；宿主传 `true` 的地方：`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\modal\theme-park\ThemeParkPreview.tsx:140`、`src\components\visualizer\preview\LyricStylePicture.tsx:41`、`src\components\visualizer\window\VisPlayground.tsx:472`。
- 效果：不画舞台层（`VisualizerShell.tsx:95`）、不发布布局（`:97`）、不画视频背景（`VisualizerBackdrop.tsx:95`）、monet 只画静态帧（`monet\AudioOverlay.tsx:303, 311` `staticMode || isPreviewMode` → 单帧绘制后 return）、cappella 文案走 preview 变体（`cappella\VisualizerCappella.tsx:86`）、monet 禁 seek（`monet\VisualizerMonet.tsx:327`）。

### 5.7 paused

- 定义 `definition.ts:104`；组装 `useVisualizerRendererModel.ts:162` `paused: displayPlayerState !== PlayerState.PLAYING`。
- 注意 paused **不冻 audioPower**：audio 值由 `usePlaybackVisualizerBridge.ts:147, 153` 的 `audioEl.paused/ended` 决定；两者语义不同，harness 要分开给。

---

## 6. harness 怎么合成 audioPower / audioBands

### 方案 1（最忠实，推荐）：真 `<audio>` + WebAudio，逐帧照抄

```ts
const ctx = new AudioContext();
const el  = document.querySelector('audio')!;
const src = ctx.createMediaElementSource(el);
const an  = ctx.createAnalyser();
an.fftSize = 2048;                    // 1024 bins
an.smoothingTimeConstant = 0.6;       // 同 usePlaybackAudioBridge.ts:140
// minDecibels/maxDecibels 保持默认 -100 / -30
src.connect(an); an.connect(ctx.destination);

const BIN_HZ = ctx.sampleRate / 2 / 1024;   // 44.1k 时 21.53；源码硬编码 21.5
const buf = new Uint8Array(an.frequencyBinCount);

const tick = () => {
    an.getByteFrequencyData(buf);
    const energy = (minHz: number, maxHz: number) => {
        const s = Math.floor(minHz / BIN_HZ), e = Math.floor(maxHz / BIN_HZ);
        let sum = 0; for (let i = s; i <= e; i++) sum += buf[i];
        return sum / (e - s + 1);
    };
    const shape = (v: number, boost: number) => Math.pow(v / 255, boost) * 255;
    const bass = energy(20, 150), lowMid = energy(150, 400), mid = energy(400, 1200),
          vocal = energy(1000, 3500), treble = energy(3500, 12000);
    audioPower.set(shape((bass + lowMid) / 2, 3));
    audioBands.bass.set(shape(bass, 1.8));
    audioBands.lowMid.set(shape(lowMid, 2));
    audioBands.mid.set(shape(mid, 2));
    audioBands.vocal.set(shape(vocal, 1.5));
    audioBands.treble.set(shape(treble, 2));
    audioBands.spectrum!.set(buf.slice());   // 1024，0..255
    requestAnimationFrame(tick);
};
```

### 方案 2：离线预计算（没有 WebAudio / 音频文件在别处）

- 用 OfflineAudioContext 或任意 FFT（22050 或 44100，窗 1024/2048）算好后，按帧存 `{t, power, bass, lowMid, mid, vocal, treble, spectrum}`；播放时 rAF 里按 `audioEl.currentTime` 二分查表并 `.set()`。
- **必须**套用 §2.3 的 gamma，否则幅度不匹配：真机给样式的是整形后的值，不是 analyser 原始字节。
- 自己算 FFT 时，字节尺度的换算是 `(20*log10(mag) + 100) / 70 * 255`（minDecibels −100 dBFS，maxDecibels −30 dBFS），再 clamp 到 0..255。
- 30 Hz 的输入足够（样式内部有 spring/lerp，见 §2.4）。

### 方案 3：纯占位（无音频源）

- 复现"暂停中的 Folia"：`breath = (Math.sin(Date.now()/2000) + 1) * 20` 给六个值（0..40），`spectrum` 给 `new Uint8Array(0)`（§2.5）。
- 想更像"在放歌"：给常量（例如 power 60、bass 80、lowMid 55、mid 45、vocal 40、treble 30）或低频正弦摆动；注意都按 0..255，且别超过 255。
- 任何情况下都不要给 0..1（§3.2）。

### 尺度速查

| 输入 | 类型 | 范围 | 备注 |
|---|---|---|---|
| `audioPower` | `MotionValue<number>` | 0..255（浮点） | 静止时 0..40 呼吸 |
| `bass/lowMid/mid/vocal/treble` | `MotionValue<number>` | 0..255（浮点） | 同上 |
| `spectrum` | `MotionValue<Uint8Array>` | 每元素 0..255 | 长度 0 或 7..1024；真机 1024 |
| `beatImpact` / `downbeatImpact` | `MotionValue<number>` | 0..1（× trackScale×强度） | 仅智能动感模式开时非 0 |

---

## 7. 现成参考实现：OBS 浏览器源（等于一个跨进程 harness）

这是仓库里已存在的"另一进程合成音频输入"的完整先例，协议可直接照搬。

### 7.1 发送端

`D:\输出目录\dsh2\work\folia\folia-major-main\src\hooks\useObsBrowserSourcePublisher.ts`

- `:61` `const OBS_CLOCK_INTERVAL_MS = 250;`
- `:62` `const OBS_AUDIO_INTERVAL_MS = 50;`  → **20 Hz**
- `:64` `const OBS_CLOCK_JUMP_MIN_INTERVAL_MS = 80;`
- `:329-338`
  ```ts
  const buildAudio = useCallback((): ObsBrowserSourceAudio => ({
      audioPower: audioPower.get(),
      bands: { bass: audioBands.bass.get(), lowMid: ..., mid: ..., vocal: ..., treble: ... },
      spectrum: downsampleObsSpectrum(audioBands.spectrum?.get()),
      sentAtMs: Date.now(),
  }), [audioBands, audioPower]);
  ```
- `:422` `setInterval(publishAudio, OBS_AUDIO_INTERVAL_MS)`（不是 rAF；`:382` 时钟同理 250 ms）

### 7.2 频谱降采样

`D:\输出目录\dsh2\work\folia\folia-major-main\src\utils\obsBrowserSource.ts`

- `:15` `export const OBS_SPECTRUM_BIN_LIMIT = 256;`
- `:197-221` `downsampleObsSpectrum(value, limit = 256)`：`length <= limit` 直接 `Array.from`；否则按桶求均值 `Math.round(sum / count)`。

### 7.3 接收端

`D:\输出目录\dsh2\work\folia\folia-major-main\src\components\obs\ObsBrowserSourceApp.tsx`

- `:136-144`
  ```ts
  eventSource.addEventListener('audio', event => {
      const nextAudio = JSON.parse(event.data) as ObsBrowserSourceAudio;
      audioPower.set(nextAudio.audioPower);
      bass.set(nextAudio.bands.bass); /* lowMid mid vocal treble 同 */ 
      spectrum.set(new Uint8Array(nextAudio.spectrum));
  });
  ```
- `:146-170` 另一条 rAF 循环只写 `currentTime`（`resolveObsBrowserSourceClockTime(clockRef.current)`）+ 行号，音频/时间彻底解耦。
- `:94-97` 改写 `devicePixelRatio`，`:95-96` 同时改写 `innerWidth` / `innerHeight`，`:103` 在 `scale > 1` 时派发 `resize`（§5.3）。

### 7.4 时钟外推

`D:\输出目录\dsh2\work\folia\folia-major-main\src\utils\obsBrowserSource.ts:166-186`
```ts
export const resolveObsBrowserSourceClockTime = (clock, nowMs = Date.now()) => {
    if (!clock) return 0;
    const offsetSec = (clock.lyricOffsetMs || 0) / 1000;
    if (clock.playerState !== PlayerState.PLAYING) return clock.currentTime - offsetSec;
    const elapsed = Math.max(0, (nowMs - clock.sentAtMs) / 1000);
    const nextTime = clock.currentTime + elapsed * (clock.playbackRate || 1);
    return (clock.duration > 0 ? Math.min(clock.duration, nextTime) : nextTime) - offsetSec;
};
```

### 7.5 线协议类型

`D:\输出目录\dsh2\work\folia\folia-major-main\src\types\obsBrowserSource.ts:112-123`
```ts
export interface ObsBrowserSourceAudio {
    audioPower: number;
    bands: { bass: number; lowMid: number; mid: number; vocal: number; treble: number };
    spectrum: number[];
    sentAtMs: number;
}
```
（JSON 传数组，接收端再转 `Uint8Array`。）

补充：`D:\输出目录\dsh2\work\folia\folia-major-main\src\utils\obsBrowserSource.ts:189-196` 的 `resolveMainWindowVisualizerMode` —— OBS 正在渲染且用户没勾"保留主窗口动画"时，主窗口降到 `'still'` 模式。

---

## 8. 坑清单（按踩中概率排序）

1. **给 0..1 而不是 0..255**：latent/monet/cadenza/diorama 的音频反应≈0（§3.1、§3.2）。preview 的假数据是 0..1，别当范本。
2. **漏掉 gamma**：直接塞 analyser 原始字节，幅度偏大约 2–3 倍（§2.3）。
3. **bin 宽不是 21.5**：非 44.1 kHz 的 AnalyserNode 会整体偏移，必须 `sampleRate/2/1024`（§2.2）。
4. **暂停时给全 0**：真机是 0..40 的 12.6 s 呼吸；给 0 会让背景/文字"死"得比真机更彻底（§2.5）。
5. **spectrum 长度 ≤ 6**：monet 会静默退回五带轮廓（§3.3）。给 64 或 1024。
6. **以为 staticMode 会停音频**：不停，只冻画面与节拍（§5.4）。反过来，想让画面"完全静止"必须自己把 MV 冻结。
7. **忘了 staticMode 会关掉智能动感模式**（`useBeatFxTrack.ts:31-33`），哪怕用户开关是开的。
8. **只给五带、不给 `paused`**：`paused` 是独立 prop（`definition.ts:104`），样式多用它走自己的暂停分支。
9. **FPS 上限装在 rAF 上**：harness 若自己数帧，注意 60/90/120 的 `-1 ms` 容差（§5.1）。
10. **`AudioBands.spectrum` 是可选的**：类型是 `spectrum?: MotionValue<...>`（`types.ts:1444`），全部消费点都写了 `?.`；不给也能跑。
