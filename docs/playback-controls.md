# 播放条控制通道（v0.3.0 增补）实现契约

> 用户请求（2026-10-21）：把 v0.3.0 底部播放条中原本无法点击的按钮全部变为可点击、有实际作用，
> 包括最右侧的随机播放与播放列表。保持 0.3.0 版本号；先本地验收，不自动上架 GitHub。
>
> 线协议以 `docs/protocol.md` 为准（§1 `queue`、§2 `control`、§3.1 `control`、§3.2 `queue`、§3.4）。
> 本文档记录 **宿主内部反射映射**、各层实现契约、文件所有权与验收标准。所有层并行开发，
> 由 Lead 负责协议文档、集成构建与端到端验收。

## 1. 数据流

```
[设置 UI PlaybackBar/QueuePanel] --emit('control')--> Shim --> §3.1 {"type":"control",...}
   --> HostForm.OnWebMessageReceived --> §2 {"t":"control",...} --> 插件 FoliaHostBridge stdout 读取
   --> FoliaPlaybackControls（反射）--> PlaybackController / PlaybackQueue
[队列状态]PlaybackController.getPlaybackQueueState() --> FoliaPlaybackControls.snapshotJson()
   --> §1 {"t":"queue",...} --> HostForm.HandleStdinLine --> §3.2 {"type":"queue",...} --> Shim emit('queue')
   --> PlaybackBar（随机激活态）+ PlaybackQueuePanel（列表/当前项/点击切歌）
```

宿主只做搬运（`t` ⇄ `type` 改名、字段白名单校验），**不得自行处理播放语义**；插件是控制落点。

## 2. 宿主内部反射映射（SPW 1.19.0，已在宿主自身代码中验证）

插件已用 `spwVersion == "1.19.0"` 版本守卫；以下名称固定于该版本。全部用 `java.lang.reflect`，
**不要**把宿主类加入编译期依赖。

```
Class PlaybackController = "com.xuncorp.voxzen.service.PlaybackController"
  static field INSTANCE
  getPlaybackQueueState() : kotlinx.coroutines.flow.StateFlow
  play() / pause() / playOrPause() / previous() / next()
  seekTo(long)
  changePlaybackMode(PlaybackQueue$Mode)
  playMusicAt(int index, boolean isRandomQueue)   // = 跳到对应队列的 index 并播放
Class StateFlow = "kotlinx.coroutines.flow.StateFlow"
  getValue() : Object          // 可读名字，未被混淆
Class PlaybackQueueState = "com.xuncorp.spc.core.queue.PlaybackQueueState"
  mode        \u037F() -> PlaybackQueue$Mode
  normalQueue \u0528() -> java.util.List      // 元素 com.xuncorp.spc.core.queue.Ϳ（U+037F 顶层单字符类）
  normalIndex \u0529() -> int
  randomQueue \u052A() -> java.util.List
  randomIndex \u052B() -> int
  readyToSave \u052C() -> boolean
Class PlaybackQueue$Mode = "com.xuncorp.spc.core.queue.PlaybackQueue$Mode"
  values() -> [Circle, CircleEnd, RepeatOne, Random]（ordinal 0..3；枚举名可读，valueOf 可用）
Class QueueItem = "com.xuncorp.spc.core.queue.Ϳ"   // U+037F，*不是* PlaybackQueueItem（1.19.0 实测）
  \u037F() -> int              // 队列项 id（内部用，页面不用）
  \u0528() -> Object           // data = PiscesMediaItem
Class PiscesMediaItem = "com.xuncorp.pisces.PiscesMediaItem"
  \u037F() -> String  id
  \u0528() -> String  title
  \u0529() -> String  artist
  \u052A() -> String  album
  \u052B() -> String  albumArtist
  \u052C() -> String  path
```

注意事项（重要）：

1. **加载器**：插件与宿主同 JVM。首选 `Class.forName(name, false, WorkshopApi::class.java.classLoader)`
   （`com.xuncorp.spw.workshop.api.WorkshopApi` 由宿主运行时提供，其 classloader 必能看见宿主类）；
   失败再依次退回 `Thread.currentThread().contextClassLoader`、插件自身 classloader。首次解析时记录实际生效的
   loader 与失败原因到插件日志。
2. **不要独立 JVM 探测**：`PlaybackController.<clinit>` 会构造 `PlaybackService` 并初始化 BASS 原生库
   （独立 JVM 中表现为 `IllegalArgumentException: Invalid library name ""`）。只能在 SPW 进程内调用。
3. 反射失败必须吞掉并记日志（首次含异常类型/消息，之后限流），绝不能让宿主桥线程或插件加载失败。
4. `Method`/`Field` 句柄一次性解析并缓存（`@Volatile` + 双检）；`getValue()` 每次实时读，不回放缓存。
5. 队列元素是 `com.xuncorp.spc.core.queue.Ϳ`（U+037F）包装：先取 `\u037F()` 的 int 与 `\u0528()` 的 data，再把 data 当
   `PiscesMediaItem` 取字段。

## 3. 各层契约

### 3.1 插件（Kotlin）

新文件 `spw-folia/src/main/kotlin/dev/spw/folia/FoliaPlaybackControls.kt`（`internal object`）：

- `fun handleControl(line: String)`：入参为宿主 stdout 的整行 `{"t":"control",...}`。用现有 `Json` 工具读字段；
  `action` 分派：
  - `toggle` → `playOrPause()`
  - `previous` / `next` → 对应方法
  - `seek` → `seekTo(max(0, positionMs))`
  - `shuffle` → 当前 mode 名：`Random` → `changePlaybackMode(记住的非随机模式)`；否则先记住当前模式再
    `changePlaybackMode(Random)`。记住值默认 `Circle`，仅保存在插件内存。
  - `queue-play` → `playMusicAt(index, random)`（`index<0` 时忽略；`random` 缺省 false）
  - 未知 action：忽略并记日志（前向兼容）。
- `fun queueJson(): String?`：读 `PlaybackController.getPlaybackQueueState().getValue()` 生成
  `{"mode":"circle|circle-end|repeat-one|random","random":bool,"index":int,"items":[{"id","title","artist","album"}]}`。
  `random = modeName == "Random"`；列表取 `randomQueue/randomIndex` 或 `normalQueue/normalIndex`；
  字段用 `Json` 转义。反射不可用（宿主版本缺失）时返回 `null`。
- 控制成功后置 `queueDirty = true`，让 pump 立即重发快照（例如 shuffle 切换后激活态、切歌后高亮）。

`FoliaHostBridge.kt`：

- providers 增加 `@Volatile var queueProvider: (() -> String?)? = null`。
- `replaySnapshot()` 在 `ready` 时发送一次 `queue`。
- state pump 里每 5 tick（500ms）调用 `queueProvider`，与 `AtomicReference` 缓存比较，变化才
  `sendLine("{\"t\":\"queue\",...}")`；`queueDirty` 时下一 tick 强制发送。
- `handleHostLine` 增加 `"control"` 分支 → `FoliaPlaybackControls.handleControl(line)`；异常只记日志。
- 首帧/回放顺序：`sendState` → `sendTrack` → `queue`（页面侧允许任意顺序）。

`FoliaPlugin.kt`：装配 providers 处设置 `bridge.queueProvider = { FoliaPlaybackControls.queueJson() }`
（与现有 snapshot/lyrics/track provider 同处；`onClosed`/disable 时清空可选）。

不新增任何构建依赖；不要改动版本号、MANIFEST、spmod 配置。

### 3.2 宿主（C#，.NET Framework 4.8，`poc/webview/host`）

`HostForm.cs`：

- `OnWebMessageReceived`（页面→宿主）新增 `type == "control"` 分支：
  - 白名单 `action ∈ {toggle, previous, next, seek, shuffle, queue-play}`；非法 action 丢弃并记日志。
  - 组装并 `log.WriteLine`（即写插件 stdin，不要用 `Console.Out` 另开通道）：
    `{"t":"control","action":"<a>"[, "positionMs":<num>][, "index":<num>][, "random":true|false]}`
    - `positionMs`/`index` 用 `JsonUtil.Num` 输出；负数夹到 0；`random` 用 `JsonUtil.GetBool`。
- `HandleStdinLine`（插件→宿主）新增 `t == "queue"` 分支 → `SendQueueToPage(msg, line)`：
  - payload：`{"type":"queue","mode":"...","random":true|false,"index":N,"items":<原样数组>}`
  - `items` 用 `JsonUtil.ExtractRawValue(line, "items")` 原样搬运；`mode` 白名单校验
    （circle/circle-end/repeat-one/random，非法按 circle 处理）。
  - 缓存 `lastQueuePayload`；`OnNavigationCompleted` 回放（紧邻 lyrics/track 回放），并在
    `type == "bridgeReady"` 处理里再回放一次（设置 UI 晚挂载时补发）。
- `PostToPage` 已线程安全，不必额外 marshal。

`Shim.js`：

- host→page `switch` 增加 `case 'queue': inputs.queue = msg; emitLocal('queue', msg); break;`
- `emit()` 增加 `else if (type === 'control') post(Object.assign({type:'control'}, payload || {}))`
  （平铺字段，与 §3.1 一致；不要嵌套 `payload`）。
- 不改动其它消息路径；`__SPW_FOLIA__` 版本仍为 `protocol: 1`。

### 3.3 设置 UI（React/TS，`poc/settings-ui`）

`src/bridge.ts`：

- `BridgeEventType` 增加 `'queue'`；导出
  `PlaybackQueueSnapshot { mode: 'circle'|'circle-end'|'repeat-one'|'random'; random: boolean; index: number; items: QueueItem[] }`、
  `QueueItem { id: string; title: string; artist: string; album?: string }`。
- 导出 `sendPlaybackControl(action, extra?)` → `getBridge().emit('control', { action, ...extra })`。
- fake bridge（dev.html）：
  - 维护 demo 队列（≥6 首，首项用 `DEMO_TRACK`），初始派发 `queue` 事件；
  - `emit('control', …)` 记录到 `window.__SPW_FOLIA_TEST_CONTROLS__`（数组，验收脚本读取）；
  - 模拟语义：`toggle` 切 `playing` 并推进/暂停 demo 时钟、`next/previous` 改 index、`seek` 改位置、
    `shuffle` 切 `random`、`queue-play` 改 index；随后派发新的 `queue` 与 `state`，让 UI 有真实反馈；
  - 不引入网络/新依赖。

`src/chrome/playback/PlaybackBar.tsx`（重写）：

- 所有 `disabled` 与 `gapTitle` 移除；按钮可点击、可键盘聚焦（`type="button"`，保留 aria-label）。
  - 播放/暂停：`sendPlaybackControl('toggle')`，图标仍按 `meta.playing`。
  - 上一首/下一首：`previous` / `next`。
  - 随机播放：`sendPlaybackControl('shuffle')`；`data-active={queue?.mode==='random'}`，激活时高亮
    （CSS `.spw-playback-icon[data-active='true']`），title 动态「随机播放：开/关」。
  - 播放列表：切换 `PlaybackQueuePanel` 开合；`aria-expanded`；面板打开时保持展开。
  - 进度条：pointerdown/move/up（以及点击）计算比例 → `sendPlaybackControl('seek', { positionMs })`；
    拖动中本地预览填充，不等待回流；拖动时 `stopPropagation`，避免误触展开/收起。
- 订阅 `bridgeOn<PlaybackQueueSnapshot>('queue')`（初值读 `getBridge().inputs?.queue` 兼容晚挂载）；
  记录 `queue` 状态传给按钮与面板。
- 新组件 `src/chrome/playback/PlaybackQueuePanel.tsx`（DOM 选择器契约，集成验收脚本依赖）：
  - 面板根节点 class `spw-queue-panel`；每个可点击行 `data-queue-index="<items 下标>"`；
    当前项行 `data-current="true"` 高亮。
  - 标题「播放列表」+ 曲目数；列表项显示序号/标题/歌手；当前项
    `scrollIntoView({ block:'center' })`；点击项 → `sendPlaybackControl('queue-play', { index, random })`。
  - 打开时 capture 阶段监听 Escape 关闭面板并 `stopPropagation()`（不关设置覆盖层/窗口）；
    点击面板外关闭；关闭后焦点回到列表按钮。
  - 样式写 `app.css` 播放条附近：深色半透明+模糊、圆角、最大高度 46vh、内部滚动、
    hover/current 高亮、宽度 420px 居中、位于栏上方；`data-flat` 下沿用现有扁平视觉。
- 设置覆盖层打开或 mouse passthrough 时组件保持现有「不渲染」行为。

`research/settings-ui/v030-playback-controls-verify.mjs`（新验收脚本，puppeteer-core + dev server）：

- 断言：5 个传输按钮（播放/暂停、上一首、下一首、随机播放、播放列表）均非 disabled；逐个点击后 `window.__SPW_FOLIA_TEST_CONTROLS__` 出现对应 action；
- 点击「播放列表」出现面板与 demo 项；点击第 3 项 → `queue-play {index:2, random:false}`；
- 点击「随机播放」→ `shuffle` 且按钮 `data-active="true"`（fake bridge 回发 random 队列后）；
- 在进度条 50% 处点击 → `seek` 且 `positionMs` 落在 `durationMs*0.5 ± 5%`；
- 打开面板按 Escape 只关面板；
- 截图：`v030-controls-bar.png`、`v030-controls-queue.png`；
- 输出 JSON 摘要 + 非零退出表示失败。

## 4. 验收（Definition of Done）

1. 三层各自可构建：`pnpm --dir poc/settings-ui build`、`bash poc/webview/host/build.sh`、
   `cd spw-folia && "C:/Users/24037/Downloads/gradle-9.8.0/bin/gradle.bat" plugin --console=plain`。
2. `node research/settings-ui/v030-playback-controls-verify.mjs`（dev server :18090）全 PASS。
3. Lead 集成：`bash packaging/build-package.sh` → 生成 `dist/release/spw-folia-0.3.0.spmod`；
   `bash spw-folia/scripts/install-local.sh --restart`；真实 SPW 打开视觉器：按钮可点、暂停/继续/上下首/
   拖动进度/随机切换/列表切歌均生效，`%APPDATA%` 插件日志无反射错误；截图存档 `research/settings-ui/`。
4. 更新 `docs/archive/verification-v0.3.0.md` 与 `docs/archive/release-notes-v0.3.0.md`（Lead 负责）。
