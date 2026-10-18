# 音频分析与播放时间线（audio / timeline）v1 — 冻结

> 归属：task-4（audio-probe）。本文是音频链路与时间线的**实现说明 + 冻结契约 + 实测数据 + 集成配方 + 风险**。
> 字段级协议见 `docs/protocol.md` §5（宿主 ↔ 页面）与 §1（插件 → 宿主 `state`）；本文不重复改协议，只解释实现与集成。
> 状态（2026-10-18）：
> - 原生分析器：**冻结**（API 不再改；webview-spike 的宿主 exe 已按本文 §2 的文件集编译链接）。
> - Kotlin 时间线：**冻结**（单文件 `poc/audio/kotlin/dev/spw/folia/PlaybackTimeline.kt`，hook-poc 的插件直接复制该文件）。
> - 实测数据：见 §4（48 kHz / 单核 CPU / 延迟 / 标定 / 节拍）。
> - v1 决策：**只启用 1 Hz 插值时钟**；`HostPlaybackProbe`（宿主真实位置探测）实现并测试，但默认 **OFF**、失败自禁用（§6）。

---

## 1. 职责划分与数据流

```
SPW 进程 (Kotlin 插件)
  ├─ TimelineController（本文 §5）: 1 Hz onPositionUpdated → 60 FPS 平滑 currentTime
  │     └─ 每 ~100 ms 向宿主 stdin 写 {"t":"state", posMs, durationMs, playing, rate, tsMs}
  │        （protocol.md §1；页面按 tsMs + (now-tsMs)*rate 二次插值）
  └─ spawn → spw-folia-host.exe (C#, WinForms + WebView2)
        ├─ LoopbackAnalyzer（本文 §2，进程内）: WASAPI loopback → FFT → AudioFrame 30–60 Hz
        │     └─ 60 Hz tick: TryGetLatest/TryDequeueBeat → PostWebMessageAsJson
        │        {"type":"audio", power,bass,lowMid,mid,vocal,treble,spectrum:[1024]}
        │        无信号/暂停 → FoliaAudioMapper.PausedPayload（breath，spectrum=[]）
        └─ WebView2 页面（Folia dist + Shim）：把 audio 事件喂给 Folia 视觉器
```

**为什么音频分析在原生进程而不是 JVM / 页面**
- 页面（WebView2 里的 Folia dist）不播放音频：音频来自系统播放器（SPW/Salt Player 或用户其他播放器），页面没有 `HTMLMediaElement` 可接 `AnalyserNode`；因此必须在宿主 exe 里用 WASAPI loopback 采集，再由 JS 侧构造 `Uint8Array(1024)` 等价频谱。
- 在 C# 里用系统 loopback 一次 FFT 的成本 ~0.1 ms / 帧（实测，§4），JVM 侧做同样事需要 JNA/JNI 且无法直接拿 mix format；放宿主进程还能让插件保持零原生依赖。
- 页面只消费结果：`audioPower` / `audioBands.{bass,lowMid,mid,vocal,treble,spectrum}`，尺度 **0..255 float**（页面自己 `/255`），与 Folia Web Audio 生产路径一致（见 `docs/folia-spec/runtime-contracts.md` §7 与 Folia 源码 `usePlaybackVisualizerBridge.ts`）。

**为何插件仍需要 `PlaybackTimeline`**：Workshop API 只给 1 Hz `onPositionUpdated`，而 Folia 的歌词/动效以 60 FPS 消费时间，直接用 1 Hz 会阶梯卡顿。时间线在插件侧插值 → 以 100 ms 节奏喂给宿主，页面侧再插值一次（OBS 源模式本来就这么做）。插件侧精度是页面观感的上限，实测 1 Hz 输入下 **平均 2.95 ms**（§4/§5）。

---

## 2. 原生分析器（C#，冻结 API）

### 2.1 文件与编译

目录 `poc/audio/native/`，命名空间 `SpwFolia.Audio`，C# 5 语法（in-box csc 4.0.30319 / .NET Framework 4.8），无外部包（**未使用 NAudio**，COM interop 手写）。

| 文件 | 作用 | 是否进宿主 exe |
|---|---|---|
| `AudioInterop.cs` | IMMDeviceEnumerator / IMMDevice / IAudioClient / IAudioCaptureClient / IAudioClock COM 声明；`WasapiLoopbackCapture`（打开默认渲染端点、`AUDCLNT_STREAMFLAGS_LOOPBACK`、轮询 `GetNextPacketSize`）；`CaptureFormat.FromMixFormat`（float32/int16/int24/int32 与 WAVEFORMATEXTENSIBLE） | ✅ |
| `SpectrumAnalyzer.cs` | 2048 点 Hann FFT；`AudioFrame` 契约；1024 个 AnalyserNode 等价字节；五带与 gamma；节拍/重拍检测；自检 | ✅ |
| `FoliaAudioMapper.cs` | `Shape()`、`Breath()`、`PausedPayload()`（页面契约的 gamma/呼吸实现） | ✅ |
| `LoopbackAnalyzer.cs` | 采集线程、帧调度、静音帧、设备切换/恢复、节拍队列、`ISpectrumSink`、统计 | ✅ |
| `SharedAudioRing.cs` | 可选 file-backed MMF 环形缓冲（v2 布局）；JVM `SpectrumReader` 对端 | ✅（可选路径） |
| `Program.cs` | 独立测量 harness（JSONL/CSV/stats/selftest/describe）；**有 Main，不进行宿主 exe** | ❌ |

编译（本机 in-box 编译器）：

```bash
cd poc/audio/native && ./build.sh          # 产出 spw-folia-spectrum.exe（~59 KB）
# 等价 Windows:
build.bat
```

宿主 exe 的编译集 = `AudioInterop.cs + SpectrumAnalyzer.cs + FoliaAudioMapper.cs + SharedAudioRing.cs + LoopbackAnalyzer.cs`（**不含 Program.cs**；webview-spike 的 `poc/webview/host` 已按此集链接）。要求不变：C# 5、无 Main、无 WPF/UI 依赖。

### 2.2 公共 API（冻结）

```csharp
// 一帧分析结果（推送/拉取单位）
public sealed class AudioFrame {
    public long   Seq;            // 单调递增序号（每帧 +1，静音帧也 +1）
    public long   TsEpochMs;      // 墙钟（Unix ms）
    public double TsMonoMs;       // 单调时钟（ms，进程内比较用）
    public long   SamplePos;      // 本帧窗口首样本的流位置（QPC 折算）
    public int    SampleRate;     // = mix format 采样率（48k 常见；44100 也支持）
    // —— 原始 0..255（等价 getByteFrequencyData；标定见 §3）——
    public byte[] Spectrum;       // 1024 个字节；静音/暂停帧为空数组
    public float  RawBass, RawLowMid, RawMid, RawVocal, RawTreble; // 对应 bin 区间的算术平均
    // —— 页面直接消费的形状值（0..255，已 gamma；见 §3.3）——
    public float  Power, Bass, LowMid, Mid, Vocal, Treble;
    public float  Rms;            // 0..1 线性 RMS（已乘 AGC，默认 AGC off → 原始值）
    public float  AgcGain;        // 1.0 = 关闭
    public bool   Silent;         // 无数据超时（见 §2.4）
    public bool   Beat;           // 本帧触发节拍事件
    public bool   BeatDownbeat;   // 启发式重拍（每 4 拍）
    public float  BeatStrength;   // 0..1
    public float  LatencyMs;      // 采集→发射服务延迟（≠ 设备延迟；见 §4.3）
    public static AudioFrame SilentFrame();
    public float[] GetShapedBands(); // [Power, Bass, LowMid, Mid, Vocal, Treble] 顺序按实现
}

public struct BeatEvent {
    public long Seq, TsEpochMs; public double TsMonoMs;
    public float Strength;        // 0..1
    public bool  IsDownbeat;
    public double IbiMs;          // 与上一拍间隔（EMA 观测值）
}

public interface ISpectrumSink {            // 可选推模式；宿主用拉模式即可
    void OnAudioFrame(AudioFrame frame);
    void OnBeat(BeatEvent beat);
}

public sealed class LoopbackOptions {
    public int    TargetFps = 60;
    public int    PollIntervalMs = 3;       // WASAPI 轮询粒度（内部 timeBeginPeriod(1)）
    public int    DeviceRole = 0;           // eConsole；eMultimedia=1 可切
    public long   BufferDurationHns = 10_000_000L; // 1 s
    public bool   EnableSmoothing = true;   // AnalyserNode smoothingTimeConstant=0.6
    public bool   EnableAgc = false;        // v1 默认关（保持 AnalyserNode 标定；见 §7.5）
    public bool   EmitSilentFrames = true;
    public string SharedMemoryPath = null;  // 非空 → 同时写 MMF 环（§2.6）
    public bool   FollowDefaultDevice = true;
    public double SilenceTimeoutSec = 0.25;
}

public sealed class LoopbackAnalyzer : IDisposable {
    public LoopbackAnalyzer(LoopbackOptions options);
    public LoopbackAnalyzer(LoopbackOptions options, ISpectrumSink sink);
    public event Action<AudioFrame> FrameReady;   // 推模式（可选）
    public event Action<BeatEvent>  BeatReady;
    public event Action<Exception> CaptureError;
    public void Start();      // 全部 COM/WASAPI 在专用 MTA 采集线程上创建；可安全从 WinForms STA UI 线程调用
    public void Stop();       // 幂等；未 Start 时安全返回；join 3 s
    public bool TryGetLatest(out AudioFrame frame);   // 拉模式：最近一帧（无则 false）
    public bool TryDequeueBeat(out BeatEvent beat);   // 节拍事件队列（有界 256）
    public LoopbackStatistics Stats { get; }
    public bool IsRunning { get; }
    public int  SampleRate { get; }
    public int  FftSize { get; }                 // 2048
    public static string DescribeDefaultDevice(int role);
}
```

**生命周期契约**：`Start()` 失败抛 `InvalidOperationException("loopback capture start failed: …")`（无设备/未被授权）或 5 s 超时 `TimeoutException`；宿主捕获后进入"无声呼吸"降级（§7.2）。`Stop()`/`Dispose()` 之后再 Start 同一实例未定义（宿主只建一个实例，关窗 Stop）。

### 2.3 帧契约（对应 `docs/protocol.md` §5）

- `Spectrum[1024]`：与 WebAudio `AnalyserNode.getByteFrequencyData` 等价的 0..255 字节；`binHz = sampleRate / 2 / 1024`（48 kHz 时 23.4375 Hz；**不要用 44.1k 常数**）。
- 五带 = 指定区间的 **bin 算术平均**（不是 RMS、不是 log band）：
  `bass 20–150 Hz`、`lowMid 150–400`、`mid 400–1200`、`vocal 1000–3500`、`treble 3500–12000`（vocal 与 mid 有意重叠，与 Folia 一致）。
- 页面形状值（`FoliaAudioMapper.Shape`）：`shape(v,boost) = (v/255)^boost * 255`，`power = shape((bass+lowMid)/2, 3)`、`bass^1.8`、`lowMid^2`、`mid^2`、`vocal^1.5`、`treble^2`。输出 float 0..255（页面自己再 /255）。
- 无信号 / SPW 暂停：**不要发 0**。帧侧 `Silent=true`、`Spectrum=[]`；宿主发 `FoliaAudioMapper.PausedPayload(now)`：`breath = (sin(now/2000)+1)*20`（0..40）写入 `power` 与五个带，`spectrum=[]`，`paused` 由播放状态单独表达。页面据此"呼吸"而不是归零。
- 节拍：原生只发**事件**（`beat:true` 帧 + `TryDequeueBeat` 的 `BeatEvent{ts,strength,isDownbeat}`），不做包络。宿主在 60 Hz tick 里按事件更新 `beatImpact`（衰减 160 ms）/`downbeatImpact`（衰减 200 ms），公式 `exp(-dt/decay*2.3)`，弱拍下限 0.35；这是页面 motionSignals 的 `beatImpact`/`downbeatImpact` 语义。

### 2.4 采集线程模型与降级

- `Start()` 创建专用线程 `spw-folia-audio-capture`（MTA，AboveNormal）：打开默认渲染端点 → `GetMixFormat` → `Initialize(SHARED, LOOPBACK, 1 s)` → `GetService(IAudioCaptureClient)` → `Start()`。**不要在 UI 线程建 COM 对象**（跨 apartment 会挂）——内部已规避。
- 每次轮询 drain 全部 packet（`GetNextPacketSize` 循环），单声道混音（各声道平均；float32/int16/int24/int32/int8），滚动缓冲 ≥ 65536 样本。
- 帧调度用**绝对 deadline**（`Stopwatch` + timeBeginPeriod(1)），每 `1000/TargetFps` ms 发一帧，数据不足时按 `SilenceTimeoutSec` 判定静音帧。
- 默认设备每 2 s 检查一次 device id，变化则重开（最多 3 次重试，间隔 500 ms）；WASAPI 异常走 `CaptureError` + 恢复路径，`Stats.ReopenCount` 记录。
- 注意：`Stats` 的 `QpcLead*` 是设备 QPC 与本机 `HighResClock` 的差（引擎预渲染提前量，实测 10–19 ms），**仅供诊断，不要拿来算播放位置或从延迟里减掉**（§4.3）。

### 2.5 harness（`Program.cs`）

```bash
spw-folia-spectrum.exe --selftest                 # 44.1k+48k 全自检；exit 2 = 失败
spw-folia-spectrum.exe --describe                 # 默认设备/格式
spw-folia-spectrum.exe --seconds 8 --perf --stats-json   # 只统计不序列化：宿主代表值（CPU）
spw-folia-spectrum.exe --seconds 12 --json --stats-json > capture.jsonl
spw-folia-spectrum.exe --csv --seconds 10
spw-folia-spectrum.exe --shm measure/audio.shm --seconds 2   # 同时写 MMF 环
spw-folia-spectrum.exe --read-shm measure/audio.shm # 读环（调试）
```

- 帧 JSON（stdout，一行一帧）：`{"ev":"frame","seq","ts","mono","sp","sr","power","bass","lowMid","mid","vocal","treble","rawBass","rawLowMid","rawMid","rawVocal","rawTreble","rms","agc","beat","downbeat","bst","lat","silent","spec":[1024]}`
- 节拍 JSON（额外行）：`{"ev":"beat","seq","ts","mono","strength","downbeat"}`
- 统计 JSON（stderr，`--stats-json`）：`{"ev":"stats","frames","beats","downbeats","silent","analyzed","seconds","fps","cpuMs","cpuPercentOneCore","cpuPercentTotal","latMeanMs","latP95Ms","latMaxMs","emitAvgUs","emitMaxUs","analyzeAvgUs","drainAvgUs","loopPerSec","dataPackets","qpcPackets","qpcLeadMeanMs","discontinuities","deviceId","format","sr","fft","bins","errors","reopens"}`
- `--perf` 跳过每帧 JSON 序列化（序列化 ~180 µs/帧会额外吃 1–2% 单核，测 CPU 时用 `--perf`）。

### 2.6 可选传输：`SharedAudioRing`（file-backed MMF，v2）

宿主内分析是主路径；MMF 环保留给"未来需要把音频送进 JVM/其他进程"的场景（`--shm` 才启用），**默认不启用**。
- 布局：`magic=0x46575053 'SPWF'`、`version=2`、header 64 B（writeSeq@24 i64, startEpochMs@32, sampleRate@16, fftSize@20）、slot 1536 B × 256（slot: seq@0, tsEpochMs@8, tsMonoMs@16 f64, samplePos@24, sampleRate@32, specLen@36, raw bands@40..56, shaped bands@60..80, rms@84, agcGain@88, beatStrength@92, latencyMs@96, flags@100（bit0 beat, bit1 silent, bit2 downbeat）, spectrum bytes@128..1152）。
- 写入顺序：先写 slot 内容→发布 slot.seq→发布 header.writeSeq；读者按 header.writeSeq 追帧、跳过被覆盖/撕裂的 slot。
- 路径默认 `%TEMP%\spw-folia-audio.shm`；JVM 侧读取器 = `poc/audio/src/spwfolia/audio/SharedAudioRing.kt` 的 `SpectrumReader`（已实测：native 写 118 帧、JVM 读 118 帧、静音帧/节拍位/flags 一致）。
- 沙箱注意：本开发环境的 DSH 沙箱拒绝 .NET 子进程写 `C:\Users\*` 下路径（`UnauthorizedAccessException`），故自检/演示的 shm 放在工作区（`poc/audio/measure/audio.shm`）；真实宿主进程不受此限制，`%TEMP%` 默认可用。

---

## 3. 频谱标定（与 WebAudio AnalyserNode 对齐）

### 3.1 字节映射

WebAudio 默认 `minDecibels=-100`、`maxDecibels=-30`，`getByteFrequencyData`：

```
byte = clamp( (20*log10(magnitude) + 100) / 70 * 255 , 0, 255 )
```

- magnitude 侧：2048 点 Hann 窗；正弦满幅（bin 中心）→ magnitude 1.0；`_amp[k] = 2*gain*|X_k| / sum(hann)`。
- `smoothingTimeConstant = 0.6`：对**线性 magnitude** 做 `mag = 0.6*prev + 0.4*cur`，再转 dB（不是对 dB 或字节做平滑）。
- 等价标定断言（自检里逐项验证）：幅度 0.001 → byte 146；0.003 → 180；0.01 → 219；单音 1 kHz 相差 10.5 dB → 预期字节差 `10.5/70*255 = 38.25`。

### 3.2 实测标定（§4.4）

用 −40 dBFS / −50.5 dBFS 交替 1 kHz 单音 WAV（避免渲染链增益把响段顶到 255 造成截断偏差），取 1 kHz 主 bin 字节的响/轻聚类均值：
- `cal_sweep.jsonl`：237.48 vs 200.23 → Δ **37.25** 字节（期望 38.25，误差 −1.00 = −0.27 dB）
- `cal_sweep2.jsonl`：237.39 vs 199.93 → Δ **37.46**（误差 −0.79）
- `tones.capture.jsonl`：Δ 37.46

结论：线性度在 10.5 dB 步进上误差 ~2%（−0.2 dB），足以驱动视觉器；绝对值受系统音量影响（见 §7.5）。

### 3.3 gamma（页面形状值）

`shape(v,boost)=(v/255)^boost*255` 是**页面契约**，原生只做同样计算（`FoliaAudioMapper.Shape`），用于 `power/bass/lowMid/mid/vocal/treble` 字段；`spectrum` 字段保持 **raw**（不 gamma）。自检校验：shape(100,1.8)=47.29、shape(150,1.8)=98.12、shape(40,3)=0.98（页面 power 取 (bass+lowMid)/2 后再 ^3，例如 raw 80 → 71.7、raw 120 → 243；这些与 Lead 早期口头参考值 46.9/96.5 略有出入，以公式 `pow(v/255,boost)*255` 为准）。

### 3.4 节拍检测

- 能量源：**未平滑**的五带 bass 原始字节（避免 0.6 平滑拖尾造成一踢两拍）。
- 判据：`rawBass` 上升沿、历史 43 帧（~0.7 s）均值 × 1.25 + 6 阈值、最小能量 8、历史均值 > 4、上升幅度 ≥ 12 字节、**180 ms 不应期**。
- `strength = (rawBass - 阈值) / (255 - 阈值)` clamp 0..1。
- 重拍（启发式）：IBI 已知（EMA，250–2000 ms）后每第 4 拍标 `isDownbeat`。
- 实测：120 BPM 踢鼓 WAV（16 踢/8 s，每 4 踢加响）→ 10 s 捕获 20 拍 / 5 重拍，IBI 中位 500.0 ms、均值 499.1 ms → 120.0 BPM，strength 0.935–1.0；自检 8 s 合成信号 15 拍/3 重拍 PASS。

---

## 4. 实测数据（2026-10-18，本机 Windows 11，48 kHz / 2ch / float32 loopback）

环境：默认渲染端点 `{0.0.0.00000000}.{11b6df89-f8f6-4891-9c32-09517234a098}`（曾用 `{77304c5d-…}`，两次结论一致）；测试音源 = 合成 WAV 经 `System.Media.SoundPlayer.PlayLooping()` 播放（**不启动/不关闭 Salt Player**，避免干扰 hook-poc 的 SPW 测试）；exe = `poc/audio/native/spw-folia-spectrum.exe`（59 392 B，C# 5 csc，.NET 4.8）；证据 JSONL/WAV 在 `poc/audio/measure/`。

### 4.1 吞吐 / CPU / 延迟

| 场景（`measure/*.jsonl`） | 帧率 | CPU（单核 / 总） | 采集→发射延迟 mean / p95 / max (ms) |
|---|---|---|---|
| 单音循环 `tones7.perf.jsonl`（`--perf`，宿主代表值） | **59.58 fps** | **78.1 ms = 0.974% / 0.061%** | **3.38 / 7.88 / 9.06** |
| 单音循环 `tones.capture.jsonl`（`--json` 序列化） | 59.79–60.08 fps | 2.2–3.0% / ~0.15% | 2.65 / 6.88 / 8.39 |
| 无播放（静音）`--perf` | 59.11 fps | 0.519% / 0.032% | 2.88 / 7.26 / 8.32 |

- 逐帧成本（`--perf`）：`analyzeAvgUs` 111.6 µs、`drainAvgUs` 99.8 µs、`loopPerSec` 285.7、`emitAvgUs` 0.3；`dataPackets` 798/8 s。
- 采样率自适应：44.1k/48k → 2048 点窗；96k → 4096；192k → 8192（保持 ~21.5 Hz/bin）；自检覆盖 44.1k 与 48k。
- **测试注意**：同一台机器上若其他进程在放音频（团队共用机器时会发生），loopback 会被污染；测前先跑 2 s 看频谱形状是否与测试音一致，且不要同时跑两个 `SoundPlayer`（会让节拍检测看到双倍速率）。

### 4.2 正确性

| 项 | 结果 |
|---|---|
| `--selftest` | **0 failures**（44.1k + 48k；20 项检查：单音主 bin、标定、gamma、静音门、FFT vs 暴力 DFT maxErr 6.93E-014、带区间、shm 环、节拍 15 拍/3 重拍） |
| 五带映射（`tones48.wav`） | 60 Hz→bass、281 Hz→lowMid、1007.8 Hz→mid、3000 Hz→vocal、7968.8 Hz→treble 全部符合 |
| 节拍（`kicks48.wav`） | 598 帧/10 s，20 拍 / 5 重拍，IBI 中位 500.0 ms → 120.0 BPM |
| MMF 环（native→JVM） | 118 帧 seq 连续、静音帧 spectrum 空、节拍/重拍 flags 正确 |

### 4.3 延迟口径（重要）

- 上报 `LatencyMs` = **采集→发射服务延迟**：本帧发射时刻 − 最近一个数据包到达时刻（0–17 ms 量级，mean 2.6–3.4 / p95 ~7–8），clamp 0..500。
- **不是** WASAPI 引擎延迟，也**不是**"画面 vs 声音"的端到端延迟。已知：loopback packet 的 QPC 结束时间比本机 `HighResClock` **提前 10–19 ms**（设备 `{77304c5d…}`；另一端点 `{a812e3e6…}` 约 42–48 ms）——这是引擎预渲染（音频先写入渲染缓冲再被设备播放），意味着分析帧会**领先**人耳听到的声音约该量。
- v1 **不做补偿**：Folia 视觉器对这种小提前量不敏感，而把 QPC 差从时间线里减掉会引入错误。若未来有"音频-画面严格同步"需求，建议把该 lead 作为可配置 offset 单独下发（页面侧使用），不要改 `LatencyMs` 语义。`Stats.QpcLeadMeanMs/Min/Max` 已暴露供诊断。

### 4.4 标定曲线

见 §3.2（Δ37.25/37.46 vs 38.25 字节）。绝对电平受系统音量影响，属预期（§7.5）。

---

## 5. Kotlin 播放时间线（冻结，单文件交付）

### 5.1 文件与集成方式

- **交付物**：`poc/audio/kotlin/dev/spw/folia/PlaybackTimeline.kt`（单文件，593 行，package `dev.spw.folia`，纯 JDK/Kotlin stdlib，无协程依赖）。
- hook-poc 的插件：把该文件复制进插件源码树（保留 package 或改包名均可），实现 `WorkshopPlaybackCallbacks` 并转接 SPW 的 `PlaybackExtensionPoint`；`TimelineController` 直接用。**该文件已冻结**，只允许 bugfix。
- 构建（无 Gradle 项目、无 kotlinc 安装时也可）：`poc/audio/build-kotlin.sh` 用 Gradle 缓存里的 `kotlin-compiler-embeddable-2.4.20.jar` 编译；`./run-tests.sh [audio.shm]` 跑全部测试。

### 5.2 API

```kotlin
package dev.spw.folia

enum class PlaybackState { IDLE, BUFFERING, READY, ENDED }
enum class TimeSource { INTERPOLATED, ANCHORED }
data class TimelineSnapshot(
    val positionMs: Double, val durationMs: Long,
    val playing: Boolean, val buffering: Boolean, val ended: Boolean,
    val rate: Double, val seekPending: Boolean, val source: TimeSource)

class PlaybackTimeline(
    val clockNanos: () -> Long = { System.nanoTime() },
    val config: Config = Config()
) {
    class Config(
        val defaultRate: Double = 1.0,
        val seekAckWindowMs: Long = 2_500,
        val seekToleranceMs: Double = 1_500.0,
        val maxExtrapolationMs: Double = 2_500.0,
        val hardDriftMs: Double = 800.0,
        val softDriftMs: Double = 120.0,
        val softCorrectionGain: Double = 0.25,
        val rateLearning: Boolean = true,
        val minRate: Double = 0.25, val maxRate: Double = 4.0,
        val rateSmoothing: Double = 0.3,
        val rateMinSpanMs: Long = 300, val rateMaxSpanMs: Long = 5_000,
        val rateNoOpBand: Double = 0.005,
        val residualHistory: Int = 128)

    // 输入（从 SPW PlaybackExtensionPoint 转接）
    fun onPositionUpdated(positionMs: Long)      // 1 Hz 权威位置
    fun onIsPlayingChanged(playing: Boolean)
    fun onStateChanged(state: PlaybackState)
    fun onSeekTo(positionMs: Long)               // 乐观锚定 + ack 窗口
    fun onPlaybackRateChanged(rate: Double)      // 显式变速
    fun onTrackChanged(durationMs: Long, startPositionMs: Long = 0)

    // 输出
    fun currentTimeMs(): Double                  // 任意时刻调用，线程安全
    fun snapshot(): TimelineSnapshot
    fun stats(): Stats                           // 残差/seek/rate 统计，便于日志
    fun reset()
}

interface WorkshopPlaybackCallbacks {
    fun onPositionUpdated(positionMs: Long)
    fun onIsPlayingChanged(playing: Boolean)
    fun onStateChanged(state: PlaybackState)
    fun onSeekTo(positionMs: Long)
    fun onDurationChanged(durationMs: Long)
    fun onTrackChanged(durationMs: Long, startPositionMs: Long)
}

class TimelineController(
    val timeline: PlaybackTimeline = PlaybackTimeline(),
    val hostClock: (() -> Long?)? = null) : WorkshopPlaybackCallbacks {
    fun positionMs(): Double        // 建议发送 state 前调用
    fun snapshot(): TimelineSnapshot
    fun stats(): PlaybackTimeline.Stats
    fun timeline(): PlaybackTimeline
}
```

### 5.3 算法（为什么 1 Hz 输入能到 ~3 ms）

- 锚点模型：每次 `onPositionUpdated(p)` 记录 `(anchorPos=p, anchorNanos=now)`；`currentTime = anchorPos + clamp(now-anchor, 0, maxExtrapolationMs) * rate`。暂停/缓冲/结束冻结；`maxExtrapolationMs=2500` 防止断更后无限外推。
- seek：`onSeekTo(target)` 立即乐观锚定 target（`source=ANCHORED`），在 `seekAckWindowMs=2500` 内忽略与 target 偏差 `>seekToleranceMs=1500` 的旧位置更新（防止宿主回调滞后把时间拉回）；收到落在容差内的更新才确认。
- 漂移：残差 = 权威位置 − 外推位置。`<softDriftMs(120)` 直接重锚（常见情形）；`120–800 ms` 部分修正（`predicted + residual*0.25`，防跳变）；`>800 ms` 硬重锚（记 `hardSnaps`）。
- 变速：`rateLearning` 从相邻两次 1 Hz 更新观测 `Δpos/Δwall`（跨度 300–5000 ms，EMA 0.3，夹 0.25–4.0，变化 <0.5% 忽略），补偿播放器漂移/变速；显式 `onPlaybackRateChanged` 优先。`Stats` 记录 `rateObservations/rateChanges/meanAbsResidualMs/p95/max`。

### 5.4 实测精度（`run-tests.sh`，虚拟时钟，40 项全 PASS）

| 场景 | 平均绝对误差 | p95 | 最大 | 最大单帧跳变 |
|---|---|---|---|---|
| 稳态 60 s：1 Hz ±3 ms 抖动输入，60 Hz 采样 | **2.95 ms** | **3.00 ms** | 3.00 ms | 23.00 ms |
| 噪声输入：1 Hz ±40 ms 抖动（含坏更新） | 31.57 ms | 52.49 ms | — | 110.56 ms |

另覆盖并通过：暂停精确冻结 / 恢复；向前 seek 10 s→120 s（旧更新被忽略、ack 正常）；向后 seek 61 s→5 s；1.5× 变速学习（8 次观测后 rate=1.4712，1000 ms 墙钟外推 1152.7 ms，误差 <350 ms）与显式 2.0×（500 ms 墙钟 → 1000.0 ms）；缓冲冻结/恢复；曲目切换重置；IDLE/ENDED；`reset()`。

> 说明：±40 ms 噪声摊到 60 FPS 是 31.6 ms 平均误差，但**相邻帧不跳**（最大单帧跳变 110 ms 只发生在更新瞬间），页面侧再用 `tsMs + (now-tsMs)*rate` 插值后观感平滑。SPW 的 1 Hz 位置实测抖动远小于 ±40 ms（真实回调通常 ±1–3 ms），故稳态数字更有代表性。

### 5.5 插件侧接入配方（hook-poc）

```kotlin
// 1) 单一实例，随插件生命周期
private val controller = TimelineController()   // hostClock 默认 null = v1 纯插值

// 2) PlaybackExtensionPoint 转接（SPW 1.19.0）
override fun onPositionUpdated(position: Long)        = controller.onPositionUpdated(position)
override fun onIsPlayingChanged(isPlaying: Boolean)   = controller.onIsPlayingChanged(isPlaying)
override fun onStateChanged(state: PlaybackExtensionPoint.State) =
    controller.onStateChanged(when (state) {
        PlaybackExtensionPoint.State.Idle -> PlaybackState.IDLE
        PlaybackExtensionPoint.State.Buffering -> PlaybackState.BUFFERING
        PlaybackExtensionPoint.State.Ready -> PlaybackState.READY
        PlaybackExtensionPoint.State.Ended -> PlaybackState.ENDED })
override fun onSeekTo(position: Long)                 = controller.onSeekTo(position)

// 3) 曲目/歌词变化时补 duration（MediaItem.duration）
//    controller.onTrackChanged(durationMs = item.duration)

// 4) 100 ms 定时器 → 宿主 stdin（protocol.md §1 state）
val pos = controller.positionMs().toLong().coerceAtLeast(0L)
sendState(posMs = pos, durationMs = durationMs, playing = playing,
          rate = controller.snapshot().rate, tsMs = System.currentTimeMillis())
```

要点：**不要**在 60 FPS 循环里调用 `positionMs()` 之外的重活；`positionMs()` 为 O(1) 加锁，60 Hz 调用无压力；发 state 用 `positionMs()` 而不是 `snapshot().positionMs`（前者是实时值）。`TimelineController.hostClock` 只在启用 HostPlaybackProbe 时传入（§6）。

---

## 6. HostPlaybackProbe：宿主真实位置探测（实现+测试完成，v1 默认 OFF）

### 6.1 动机与结论

Workshop API 的 1 Hz 是**插件侧唯一权威时间源**；但宿主进程内部其实能读到 Pisces 播放器位置（反射），若能在插件里以 30–60 Hz 读到，可把时间线精度从"插值"提升为"跟真"，并顺带修正播放器漂移。**v1 不使用**（原因见 §6.5），实现与测试保留，默认关、失败自禁用。

### 6.2 宿主内部事实（静态分析，`work/audio/` 下 vineflower/javap 结果）

- `com.xuncorp.voxzen.service.PlaybackController`：Kotlin `object`（JVM 静态字段 `INSTANCE`），私有实例字段 **`service` : `PlaybackService`**；`PlaybackService` 继承自 R8 重定位基类 `androidx.compose.ui.ݱ`（不可按名引用），基类有 **public `getPlayer()` : `com.xuncorp.pisces.PiscesPlayer`**（继承可见、可按方法名反射）。
- `PlaybackController` 自己**没有**位置 getter；位置必须经 `PlaybackController.INSTANCE.service.getPlayer()` 拿 `PiscesPlayer`。
- `com.xuncorp.pisces.PiscesPlayer`（abstract，R8 后方法名仍是 1 个 Unicode 字符）：`ՠ()Z` = isPlaying、`ֈ()J` = durationMs、`֏()J` = positionMs、`ހ()[F` = FFT、`Ϳ(J)` = seek。
- 宿主自己的刷新节奏（`javap -c` 反编译 lambda）：progress job **1 Hz** `updateProgress(0,0)`（这就是 `onPositionUpdated` 的唯一来源，`JmtcManager.setPosition` 同源）；metering job **10 Hz** `updateAudioLevel`（可选 `updateFftData`）。因此：插件想 >1 Hz 只能自己反射读 player，宿主不会替它提高回调频率。
- 宿主 FFT：`PlaybackService.updateFftData` 把 256 个线性 bin 的 `copyOfRange(0,64)` 喂内部 visualizer；`PiscesPlayer` 的 fft 实现在 delegate `com.xuncorp.pisces.Ԭ`（BASS）里，非 ASIO 分支 256 bin。→ 宿主 FFT 是 **10 Hz / 256 线性 bin / 未按 AnalyserNode 标定**，只能作 `audioMode:"host-fft"` 降级源（protocol.md §1），不适合 Folia 视觉器主路径。

### 6.3 实现（`poc/audio/src/spwfolia/probe/HostPlaybackProbe.kt` + `FakeHost` 测试）

- 解析顺序（全程 try/catch，失败返回 null，绝不抛到插件）：
  1. `Class.forName("com.xuncorp.voxzen.service.PlaybackController")` → 静态字段 `INSTANCE`（或自类型静态字段/工厂方法）；
  2. 在该对象上找类型为 `PlaybackService` 的字段/方法 → `service`；
  3. 沿 `service` 的类层次（含被重定位的父类）找**无参且返回 `PiscesPlayer`** 的方法（优先名字含 "player"）→ `getPlayer()`；
  4. 在 `PiscesPlayer` 实例上枚举 public 无参 `long/int` getter（不信任名字，R8 会变）；取两次采样（间隔 120 ms）：**递增的**是位置；调用方可用 `hintPositionMs`（时间线当前值）挑最接近者；**最大值且 ≥ 位置的**是 duration。
  5. 也支持 `PlaybackMonitor` 的 `lyricsTime` StateFlow getter 作为备用高频率位置源（若其 call site 确认高频更新；目前未启用为默认）。
- 运行期：`createPositionSource(config, hint)` 懒解析、失败每 2 s 重试最多 10 次；成功返回 `HostPositionSource.pollPositionMs()/pollDurationMs()`。`TimelineController.hostClock = { source.pollPositionMs() }` 时，`positionMs()` 内部以 **≤10 Hz** 用真实位置校正时间线（间隔常量 `HOST_CLOCK_MIN_INTERVAL_NANOS=100 ms`），校正本身仍走时间线的漂移/soft-correction 逻辑（不会硬跳）。
- 测试：`HostPlaybackProbeTest` 21 项全 PASS（fake 图：controller 静态字段 → private `service` 字段 → `getPlayer()`；带干扰 getter 时靠"递增性+hint"选中位置；`createPositionSource` 轮询推进；真实宿主不存在时返回 null 不抛）。

### 6.4 设计约束（为什么默认 10 Hz 而不是 30–60 Hz）

- 反射 `long` getter 单次 ~0.1–1 µs，10 Hz 成本可忽略；30–60 Hz 收益 <1 ms（时间线插值误差本就 ~3 ms），但会增加与播放器/BASS 线程的交互面与崩溃风险。
- 每 2 s 重试 + 失败静默降级：宿主升级/R8 改名/类不存在的版本差异由 `createPositionSource` 兜底，不影响主链路。

### 6.5 v1 决策与开关

- **默认 OFF**：插件用纯插值（实测 2.95 ms，已足够；且不依赖宿主内部实现细节，跨 SPW 版本稳定）。
- 开关：插件配置 `audio.enableHostProbe=false`（默认）→ 只有 true 时才 `HostPlaybackProbe.createPositionSource(...)` 并传 `hostClock`；运行时自检：连续 3 次 poll 失败或与 1 Hz 权威更新残差持续 > `hardDriftMs` → 自动停止使用（记日志），退回插值。
- 打开时的风险见 §7.4；**禁止**在没有宿主实机验证（启动 SPW）的情况下默认开启。

---

## 7. 风险与缓解

### 7.1 采集面
- **只能抓 shared-mode 渲染流**：播放器若用 ASIO/独占模式（WASAPI exclusive），loopback 抓不到（表现为静音帧）；v1 降级为 breath，不报错。SPW 默认 WASAPI/共享，实测 OK。
- **抓的是系统全部声音**（其它应用通知/音乐也会进频谱）；单播放器场景正常，属可接受行为。
- **mix format 多样性**：已覆盖 float32/int16/int24/int32 与 WAVEFORMATEXTENSIBLE；未知 subformat 抛 `NotSupportedException` → 宿主进入 breath 降级并写日志。实测 48 kHz/2ch/float32 与 44.1 kHz 均正常。
- **设备切换/拔出**：每 2 s 检测默认设备 id，变化即重开（3 次重试）；`Stats.ReopenCount` 记录。极端情况（驱动卡死）最后靠 `CaptureError` + 宿主降级。
- **静音判定**：>0.25 s 无数据 → `Silent=true`；宿主按 `FoliaAudioMapper.PausedPayload` 发呼吸帧。注意系统在无声时也可能有静音流（实测 dataPackets 持续），此时帧为 `Silent=true` 但 `analyzed` 计数仍走分析路径。

### 7.2 启动失败降级（必须实现）
`Start()` 抛 `InvalidOperationException`/`TimeoutException`（无设备、权限、COM 失败）→ 宿主日志 warn，此后 60 Hz tick 一律发 `PausedPayload`（breath），窗口/视觉器照常工作。协议层把"音频不可用"视作可接受状态。

### 7.3 时间线
- 1 Hz 回调中断（SPW 卡顿/UI 线程忙）→ 外推上限 2500 ms，超过后 `currentTimeMs` 停在 cap；页面侧 clock 事件继续插值，观感是缓慢停住而非乱跳。
- 歌曲切换/seek：依赖 `onTrackChanged`/`onSeekTo` 事件及时送达；插件必须在 `onLyricsLinesUpdated`/MediaItem 变化时补 `duration`。
- 变速（播客/有声书）：`rateLearning` 会自动跟上；显式 API 更快。
- 多线程：`PlaybackTimeline` 所有公开方法 `synchronized`；`TimelineController` 用 `AtomicReference` 快照。60 Hz 读 + 1 Hz 写无锁竞争问题（实测无）。

### 7.4 HostPlaybackProbe 特有（为何默认关）
- **R8/混淆**：类/字段/方法名可随 SPW 版本变化；解析失败已兜底，但"解析成功却读错 getter"可能随时间线硬重锚表现为歌词跳变——由残差监控（`hardDriftMs` 连续超限）自禁用。
- **线程安全**：BASS/播放器 getter 在插件线程调用，未验证是否与音频线程竞争；只能在真实 SPW 上验证（本任务不允许启动 SPW）。10 Hz 轮询是风险折中。
- **版本绑定**：只对 SPW 1.19.0 做过静态分析；升级需回归。
- **收益有限**：v1 插值已 2.95 ms，开启后主要收益是极端场景（缓冲/长卡顿）下的位置跟真，不足以抵消风险。

### 7.5 WASAPI post-volume vs WebAudio pre-volume（**重要**）
- 页面里 Folia 的 `AnalyserNode` 接的是**页面自己的媒体元素输出**（pre-volume、pre-系统混音）；我们的 WASAPI loopback 拾取的是**系统混音后的信号（post-volume、post-应用音量、post-音效增强）**。
- 后果：用户调低系统/播放器音量时，原生频谱字节整体下降（例如音量 −20 dB ≈ 字节整体下移 ~73），视觉器会变暗；系统音效/响度均衡会改变绝对电平（实测某个端点上渲染链整体 +4 dB）。**相对动态（节拍/频带比例）不受影响**，标定曲线仍线性（§3.2 已验证 10.5 dB 步进）。
- v1 **不做补偿**：保持 AnalyserNode 等价标定是页面兼容性的前提；如需补偿可在宿主侧按用户音量乘 gain（需先读取音量，且不同端点行为不一致，风险大）。开发选项：`LoopbackOptions.EnableAgc=true` 会缓慢自适应增益（0.25 s 跟上/4 s 释放，夹 0.25–16×），但会破坏绝对标定，**默认关闭**，仅调试用。
- 同理，若播放器/系统音量 >100% 或开响度增强，近满幅频谱会被 255 截断（顶部 4 dB 丢失）；对视觉器影响小。

### 7.6 其他
- CPU：实测 0.97%（单核）/0.06%（整机），远低于 1–2% 目标；若宿主同时跑 WebView2 重渲染，音频线程 AboveNormal 优先级足够。
- 内存：帧缓冲固定（2048 float + 1024 byte ×2 buffer），无增长；`TryDequeueBeat` 队列有界 256。
- 版权：全部代码为本项目原创（手写 COM interop，未使用 NAudio）；`dynamic-lyrics-island-for-spw`（GPL-3.0）仅作为**行为参考**（loopback 可行性、1 Hz 插值思路），未复制其代码；Folia/AnalyserNode 常数来自 Web Audio 规范。

---

## 8. 复现与证据

```bash
# 原生：编译 + 自检
cd poc/audio/native && ./build.sh && ./spw-folia-spectrum.exe --selftest

# 测试 WAV（48 kHz stereo 16-bit，生成到 poc/audio/measure/）
cd poc/audio && python tools/gen_test_audio.py measure
#   tones48.wav（6×2 s 单音）、kicks48.wav（120 BPM 16 踢）、cal_sweep.wav（-40/-50.5 dBFS 交替 1 kHz）

# 播放（PowerShell 后台）+ 采集；注意别同时跑其它播放
pwsh -Command "\$p=New-Object System.Media.SoundPlayer 'D:\...\poc\audio\measure\tones48.wav'; \$p.PlayLooping(); Start-Sleep -Seconds 30; \$p.Stop()"
cd poc/audio/native && ./spw-folia-spectrum.exe --seconds 8 --perf --stats-json     # CPU/延迟
./spw-folia-spectrum.exe --seconds 12 --json --stats-json > ../measure/tones.capture.jsonl
cd .. && python tools/analyze_capture.py measure/tones.capture.jsonl --label tones  # fps/延迟/频带/标定

# Kotlin：编译 + 测试（含 native→JVM shm 端到端）
cd poc/audio && ./build-kotlin.sh && ./run-tests.sh measure/audio.shm
```

`python tools/analyze_capture.py` 输出：fps、帧间隔、采集延迟、静音数、逐段主 bin/频带检查、1 kHz 标定 Δ、节拍数/IBI/BPM。注意：`PYTHONIOENCODING=utf-8`（Windows GBK 控制台）。

**关键证据文件**（`poc/audio/measure/`）：

| 文件 | 内容 |
|---|---|
| `tones7.perf.jsonl` | 宿主代表 CPU/延迟（59.58 fps、0.974% 单核） |
| `tones.capture.jsonl` | 12 s 扫频/单音 JSON 帧（标定、频带映射） |
| `kicks.capture.jsonl` | 120 BPM 节拍检测（20 拍/5 重拍） |
| `cal_sweep.jsonl` / `cal_sweep2.jsonl` | 1 kHz 10.5 dB 步进标定（Δ37.25 / 37.46 bytes） |
| `audio.shm` | native 写、Kotlin `SpectrumReader` 读的 MMF 环（118 帧） |
| `tones48.wav` / `kicks48.wav` / `cal_sweep.wav` | 合成测试音 |

注：曾有一次采集因机器上其它进程同时播放音乐而被污染（频谱出现 bins 1–7 的强低频、rms 0.15），已删除；测量前务必确认只有测试音在播放。

---

## 9. 文件索引

| 路径 | 说明 |
|---|---|
| `poc/audio/native/AudioInterop.cs` | WASAPI COM interop（IMMDeviceEnumerator/IAudioClient/IAudioCaptureClient/IAudioClock） |
| `poc/audio/native/SpectrumAnalyzer.cs` | FFT、1024 频谱字节、五带、gamma、节拍、自检 |
| `poc/audio/native/FoliaAudioMapper.cs` | `Shape` / `Breath` / `PausedPayload`（页面契约） |
| `poc/audio/native/LoopbackAnalyzer.cs` | 采集线程、帧调度、静音/恢复、拉取 API、统计 |
| `poc/audio/native/SharedAudioRing.cs` | 可选 MMF 环 v2（file-backed，JVM 可读） |
| `poc/audio/native/Program.cs` | 独立 harness（测量/自检/describe；不进宿主） |
| `poc/audio/native/build.sh` / `build.bat` | csc 编译脚本 |
| `poc/audio/kotlin/dev/spw/folia/PlaybackTimeline.kt` | **交付插件的时间线单文件**（TimelineController + 回调接口） |
| `poc/audio/src/spwfolia/audio/FoliaAudioState.kt` | `FoliaAudioState` 接口 + `AudioFrameState` + `FoliaAudioMapper`（与 C# 镜像） |
| `poc/audio/src/spwfolia/audio/SharedAudioRing.kt` | MMF 环格式 + `SpectrumReader`（JVM 读端） |
| `poc/audio/src/spwfolia/probe/HostPlaybackProbe.kt` | 宿主位置反射探测（默认 OFF） |
| `poc/audio/tests/...` | PlaybackTimelineTest(40) / SpectrumReaderTest(22) / HostPlaybackProbeTest(21) |
| `poc/audio/build-kotlin.sh` / `run-tests.sh` | 无 Gradle 的 Kotlin 编译/测试脚本 |
| `poc/audio/tools/gen_test_audio.py` | 合成测试 WAV |
| `poc/audio/tools/analyze_capture.py` | 采集 JSONL 分析器 |
