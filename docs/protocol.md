# spw-folia 集成协议 v1（冻结草案，2026-10-18）

> 本文件是 **插件(Kotlin) ↔ 宿主进程(C#) ↔ WebView2 页面(JS)** 的接口契约。
> 任何一方改动字段必须先改本文件并通知 Lead。设计目标：页面内计算 `config`，宿主只做搬运；无 HTTP 服务、无网络依赖。

## 0. 进程与职责

```
SPW (JVM) ── spawn ──> spw-folia-host.exe (C#/.NET, 全屏窗口 + WebView2 + WASAPI 采集)
   │  stdin/stdout JSON-lines                │  chrome.webview.postMessage / AddHostObject? 否，只用消息
   │                                         ▼
   │                              WebView2 页面 = Folia dist + 注入 Shim.js + 注入 settings UI
   └── 菜单项点击 / 播放数据                    (配置构建、主题推导、渲染、设置界面)
```

- **插件**：唯一数据源（播放时间/歌词/曲目/封面/持久化设置）。不做音频分析、不建窗口。
- **宿主 exe**：窗口/全屏/ESC/DPI、加载离线 web bundle、注入 Shim + 设置 UI、WASAPI loopback 音频分析、stdin/stdout 转发、退出汇报。
- **页面**：Folia 生产 dist（`/obs` surface）负责视觉；注入脚本负责 (a) 用 `EventSource` shim 接收 clock/audio/config，(b) 设置界面与 `ObsBrowserSourceConfig` 构建、主题推导。
- **无 HTTP**：bundle 通过 `SetVirtualHostNameToFolderMapping(https://spw-folia.local)` 加载；开发可选 `--dev-url`。

## 1. 插件 → 宿主（stdin，每行一个 JSON 对象，UTF-8）

| t | 字段 | 说明 |
|---|---|---|
| `hello` | `protocol:1`, `pluginVersion`, `spwVersion`, `devUrl?`, `bundleDir?` | 启动握手；`devUrl` 存在时加载开发服务器（仅开发） |
| `settings` | `settings: object` | 全量持久化设置（启动时一次；UI 每次改动后回传一次做确认） |
| `state` | `posMs:int`, `durationMs:int`, `playing:bool`, `rate:number`, `tsMs:int64` | 播放时钟，建议 100ms 一次（≥20Hz）。页面按 `tsMs + (now-tsMs)*rate` 插值 |
| `lyrics` | `lines:[{startMs,endMs,main,sub,cells:[{startMs,endMs,text}]}]`, `offsetMs:int`, `translationMode?` | 曲目/歌词变化时发送；空数组=无歌词 |
| `track` | `id`, `title`, `artist`, `album`, `durationMs`, `coverDataUrl?`, `coverPath?` | 封面优先 data URL（JPEG/PNG base64），否则宿主负责本地读取。宿主转发页面时同时给出 `coverUrl` 镜像（v0.1.2+，见 §1.1） |
| `config` | `config: object` | 可选覆盖：插件强制推送完整 Folia `ObsBrowserSourceConfig`（调试/兼容用，正常不用） |
| `audioMode` | `mode:"loopback"|"host-fft"|"off"` | 可选；默认 loopback |
| `quit` | — | 请求优雅退出 |

### 1.1 封面字段兼容（v0.1.2）

`coverDataUrl` 是 Kotlin 插件发送的规范字段（base64 data URL）。宿主转发给页面时，把同一值**镜像**为
`coverUrl`，以同时满足 Folia 自身 `ObsBrowserSourceConfig.coverUrl` 与旧调试脚本；页面消费方可读任一拼写，
设置岛 `bridge.ts` 的 `bridgeTrackCover(track)` 优先 `coverUrl`、回退 `coverDataUrl`。

## 2. 宿主 → 插件（stdout，每行一个 JSON 对象）

| t | 字段 | 说明 |
|---|---|---|
| `ready` | `protocol:1`, `pid`, `webviewVersion`, `bundle` | WebView2 与 bundle 就绪，可开始发 state |
| `closed` | `reason:"user"|"error"|"plugin"` | 窗口关闭（ESC/Alt+F4/崩溃）；随后进程退出。**插件必须据此清理状态，再点菜单可重新启动** |
| `settings` | `settings: object` | UI 修改了设置 → 插件持久化（并可选校验/夹紧） |
| `action` | `name:"reset"|"openDevTools"|"reload"` | UI 请求的动作 |
| `log` | `level:"info"|"warn"|"error"`, `msg` | 诊断日志（插件写入 logs.txt） |

## 3. 宿主 ↔ 页面

### 3.1 页面 → 宿主（`window.chrome.webview.postMessage`）
- `{"type":"ready"}`：页面/注入脚本就绪（dist 的 `__spwFoliaReady` 与设置 UI 分别报，宿主转发给插件仅作诊断）
- `{"type":"settings","settings":{...}}`：设置 UI 改动（宿主立即转发给插件持久化）
- `{"type":"action","name":"close"|"reset"|"openDevTools"}`
- `{"type":"log","level":"...","msg":"..."}`
- `{"type":"beatDebug",...}`：可选
- `{"type":"ui","settingsOpen":true|false}`：设置覆盖层开合状态（Shim 在捕获阶段拦截 `settingsUI` 特殊消息后发出；宿主据此在覆盖层打开期间强制显示光标，并保证 ESC 优先关闭覆盖层）

### 3.2 宿主 → 页面（`chrome.webview.postMessage`，页面侧由 Shim.js 统一接收）
| type | 负载 | Shim 行为 |
|---|---|---|
| `hello` | `{protocol:1,bundleVersion}` | 记录，触发 `__SPW_FOLIA__.emit('hello')` |
| `settings` | `{settings}` | 交给设置 UI 初始化（`window.__SPW_FOLIA__.settings`） |
| `state` | `{posMs,durationMs,playing,rate,tsMs,lyricOffsetMs?}` | 转成 `clock` 事件：`{currentTime:posMs/1000, duration:durationMs/1000, playerState:playing?'playing':'paused', sentAtMs:Date.now(), playbackRate:rate, lyricOffsetMs:offsetMs/1000}`（EventSource 分发，250ms 或变化时发；时间插值在页面侧做） |
| `lyrics` | `{lines,offsetMs}` | 更新设置 UI 的歌词输入 + 重算 config |
| `track` | `{...}` | 更新配置（theme/cover/title） |
| `audio` | `{power,bass,lowMid,mid,vocal,treble,spectrum:[...]}` | 转成 `audio` 事件，**已是 0..255 gamma 尺度**；spectrum 为 0..255 数组（1024 bins） |
| `config` | `{config}` | 直接分发 `config` 事件（覆盖页面自算，调试用） |
| `beat` | `{beatImpact,downbeatImpact}` | 可选：若 beat-FX 注入可用，Shim 负责 `.set()` 模块 MV |

### 3.3 注入全局（Shim.js 暴露，设置 UI 使用）
```ts
window.__SPW_FOLIA__ = {
  protocol: 1,
  on(type: 'hello'|'settings'|'state'|'lyrics'|'track'|'audio'|'config', fn),
  emit(type, payload),                  // 设置 UI → KHost（内部转 chrome.webview.postMessage）
  pushConfig(config),                   // 设置 UI → 页面: 立即作为 config 事件分发
  getSettings(), setSettings(partial),  // 内存 + 持久化（emit({type:'settings'}))
  requestClose(),
  inputs: { state, lyrics, track }      // 只读快照
}
```

## 4. 设置对象（settings）与 config 构建
- `settings` 是设置 UI 的状态树（JSON），字段见 `docs/folia-spec/settings-ui.md` §4；键名**沿用 Folia 存储键**（styleId、smartBeat…），便于对照。
- config 构建由页面内 **settings publisher**（`publisher.js`）完成：`inputs(settings, lyrics, state, track, coverColors, theme)` → `ObsBrowserSourceConfig`（字段同 `src/types/obsBrowserSource.ts`，见 `docs/folia-spec/runtime-contracts.md` 与 webview-spike 的 `shared/` 提取）。
- 主题（theme）由页面从封面图像 canvas 取色推导（暗/亮、主色、次色、背景色），输出 `Theme`；无封面用默认暗色主题。
- 节流：settings/lyrics/theme 变化时重算 config（≤10Hz）；state 不进 config（走 clock 事件）。

## 5. 音频（宿主内完成，页面只用结果）
- 宿主 WASAPI loopback：`LoopbackAnalyzer`（audio-probe 的 C# 文件，合并进宿主）；sampleRate = mix format rate。
- 每帧（30–60Hz）：
  - `spectrum[1024]` = `getByteFrequencyData` 等价（0..255，raw）
  - binHz = `sampleRate/2/1024`；五带 = **bin 算术平均**（区间 20–150,150–400,400–1200,1000–3500,3500–12000 Hz）
  - `shape(v,boost) = (v/255)^boost*255`；`power=shape((bass+lowMid)/2,3)`、`bass^1.8`、`lowMid^2`、`mid^2`、`vocal^1.5`、`treble^2`
  - **无信号/暂停**：`breath=(Math.sin(Date.now()/2000)+1)*20` 写入 power+五带，spectrum 空数组
- 采样率不是 44100 时必须用实际 binHz（否则五带偏移）。

## 6. 生命周期
1. 菜单项点击 → 插件确保单例；无窗口则 spawn 宿主 → 发 `hello` + `settings`；收 `ready` 后 100ms 周期发 `state`。
2. 宿主窗口关闭 → `closed` → 插件停止 state 发送、等待进程退出（超时强杀）、清理。
3. 插件 disable/uninstall → 插件发 `quit`，等 2s 后强杀；删除任务前释放。
4. 宿主崩溃 → 插件读 stdout EOF + 退出码，写日志并允许重开。

## 7. 开发与调试
- 开发模式：`spw-folia-host.exe --dev-url http://127.0.0.1:18080/?obs=1&token=dev --dev-settings <json>`（webview-spike 的 `server.mjs` 提供 demo 数据）。
- 生产：`--bundle <dir>`（`.spmod` 解包目录里的 `web/`），虚拟 host `https://spw-folia.local/`。
- 宿主参数统一支持：`--fullscreen`（默认）、`--windowed w,h`、`--port`（仅 dev）、`--fps-log <path>`、`--user-data-dir <dir>`。

## 7.5 v1 全屏 UI / 交互契约（设置 UI 注入层 + 宿主协作）

- 设置 UI bundle 额外在 `window.__SPW_FOLIA__.ui` 注册：
  - `isSettingsOpen(): boolean`、`openSettings()`、`closeSettings()`（页面内覆盖层状态，不重建页面）
  - 覆盖层打开时接管 ESC：capture 阶段 `keydown Escape` → closeSettings + `stopPropagation()`；
    覆盖层关闭时不拦截 ESC，交给宿主/Shim → `action close` → 宿主关窗。
  - 覆盖层开合状态通过 `{"type":"ui","settingsOpen":bool}` 报告给宿主（v0.1.1 起为正式契约）。
- 设置 UI 提供轻量 chrome（v1）：右上角 ⚙ 按钮（唤出设置；鼠标静止 2.5s 后与光标一起淡出）、
  覆盖层左上角 ← 返回按钮（关闭覆盖层）。样式贴近 Folia（半透明圆角、白字、hover 高亮）。
- 宿主首次打开且无持久化设置时带 `--open-settings`（可在 hello 后发 `command open-settings`），
  之后直接显示视觉器；菜单再次点击时窗口已存在则置前（不重复开窗）。
- 宿主收到 `command close-settings` 时调用 `__SPW_FOLIA__.ui.closeSettings()`；`open-settings` 相反。
- 视觉器页面本身保持 OBS 模式（`isPlayerChromeHidden:true`），不注入任何 Folia 播放器 chrome。
- 光标策略（v0.1.1 起）：全屏窗口内鼠标静止 2.5 s 后隐藏光标，移动即恢复；设置覆盖层打开期间强制显示；
  关闭窗口后恢复系统光标。宿主把「`settingsOpen` OR 未空闲」作为目标可见性（幂等、状态变化时才写日志）。
- 覆盖层内容在 `display:none` 下保持挂载（不重建 React 树），滚动条修复（`.st-window-scroll`）已包含在
  v0.1.1 设置 UI 里；重新打开覆盖层是瞬时的。

## 8. 待定/风险
- 智能动感节拍动画：依赖“注入脚本能否 `import()` 到 motionSignals 的 chunk 并 `.set()`”，webview-spike 探测中；不可用则 UI 保留开关但对动画降级说明。
- Folia `getByteFrequencyData` 的 `minDecibels/maxDecibels` 默认值(-100/-30) 与 WASAPI 电平映射需标定（audio-probe 负责给标定曲线）。
- 多显示器/DPI：宿主按目标屏 DPI 设置 WebView2 `RasterizationScale`/`Bounds`，避免模糊。
