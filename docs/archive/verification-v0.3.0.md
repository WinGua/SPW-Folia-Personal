# spw-folia v0.3.0 — 四项验收反馈的验证方法与结果

v0.3.0 的四项改动（开源链接、按钮样式、透明字体随系统明暗、底部播放进度条）全部是视觉/元数据
层面的增量，验证重点在**证据链**与**真实渲染路径**，而非协议层。本文记录验证方法，供复跑。

## 1. 开源链接（MANIFEST 字段名证据链）

风险点：workshop gradle 插件（0.1.0-dev23）的 DSL 属性名与 MANIFEST 属性名没有公开文档，
写错字段不会报错、只会静默无效。三级证据：

1. 反编译 `~/.gradle/caches/.../spw-workshop-gradle-plugin-0.1.0-dev23.jar`：`SpmodExtension.class`
   常量池含 DSL 属性 `PluginOpenSourceUrl`；`WorkshopGradlePlugin.class` 含 MANIFEST key
   `Plugin-Open-Source-Url`（与 Plugin-Class/Id/Name/Version/Provider/Description/Has-Config/
   Permissions 同处并列）。
2. 已装第三方模组实证：spw-island 0.12.1 与 SPW-Tag-Workbench 1.2.0 的
   `classes/META-INF/MANIFEST.MF` 均含 `Plugin-Open-Source-Url: https://github.com/...`，
   且两者在 SPW 模组管理菜单中「开源链接」可点。
3. 构建产物回读：`./gradlew plugin` 后解包 `plugin-dev.spw.folia-0.3.0.spmod` 的 MANIFEST.MF，
   实测 `Plugin-Open-Source-Url: https://github.com/azkbzxf/spw-folia`。

## 2. 按钮样式（CSS 差分）

金色色环唯一来源是 `poc/settings-ui/src/app.css` 中 `.spw-chrome-btn--player` 对基准样式
`.spw-chrome-btn` 的覆盖（金色描边 + 2px `box-shadow` 色环 + 深色底 + 专属 hover）。删除覆盖后
grep 全文件金色（`214,168,84`）仅剩兼容提示文字一处（设计保留）。按钮 JSX 无专属样式类，无需改动。

## 3. 透明字体色（决策链 diff + 对比度数学）

旧链：封面 48×48 canvas 平均色亮度 `> 0.55` ⇒ 明暗、文字色全部由封面推导。新链（仅透明窗口）：

- 明暗 = `window.matchMedia('(prefers-color-scheme: dark)')`（宿主不注入主题；WebView2 跟随
  Windows 应用模式）；系统翻转经 `change` 事件实时重染。
- 色相仍取封面；`ensureContrast` 把主/次/弱化色锁到系统一侧：浅色系统亮度 > 0.45 者向黑 mix
  压到 0.45，深色系统 < 0.55 者向白 mix 抬到 0.55（闭式解一次 mix）。
- **回归保障**：`isLightOverride` 为 undefined（非透明窗口）时走原表达式，逐像素与 v0.1.x 一致
  —— 对照 git diff 逐行比对旧 `deriveThemeFromCover` 数学式确认。
- tsc：新增/改动代码零错误（范围内 9 个存量错误经 git hunk 证据确认在改动区外）。

## 4. 播放进度条（puppeteer 渲染验证 10/10）

脚本 `research/settings-ui/v030-playback-verify.mjs`（puppeteer-core + 系统 Edge headless）打
dev.html（真实注入路径），经 `window.__SPW_FOLIA__.emit('track'|'state'|'settings', …)` 驱动
（与宿主远程消息同一 applySnapshot 路径）：

| # | 断言 | 结果 |
| --- | --- | --- |
| 1 | 收起态 `data-expanded=false`，时间 00:31/02:45，fill 19.052%（31/165） | PASS |
| 2 | 悬停 600 ms → `data-expanded=true` | PASS |
| 3 | 展开态曲名正确 | PASS |
| 4 | 控制按钮 5/5 全 disabled（DOM 实为 5 个按钮，进度条是展示元素） | PASS |
| 5 | 透明开（未穿透）：bar 仍在、`data-flat=true`、pill `backdrop-filter:none` | PASS |
| 6 | 鼠标穿透开：`.spw-playback` 整体卸载（DOM 查询 null，且已排除设置遮挡干扰） | PASS |
| 7 | 全程无 dev error overlay / console 错误 | PASS |

收起/展开/穿透三态截图：`research/settings-ui/v030-playback-{collapsed,expanded,passthrough}.png`。
打包级回归另跑 `node packaging/tools/verify-layout.mjs`：PASS，`consoleErrors=0`。

## 已解决 gap（0.3.0 追加：播放控制已接线）

v0.3.0 最初冻结的 page→host `action` 仅 `close|reset|openDevTools`，插件收不到播放指令，按钮只能
disabled。后续按 `docs/playback-controls.md` 追加了 `control`（page→host→plugin）与 `queue`
（plugin→host→page）两条消息，5 个传输按钮全部接线；详见 §5。

## 5. 播放控制接线（真实 SPW 插件宿主验证）

协议（`docs/protocol.md` v0.3.0 增补，向后兼容）：

- page→host `{"type":"control",...}` → host 转 `{"t":"control",...}` 写进插件 stdin；
- 插件经反射调用宿主内部 `com.xuncorp.voxzen.service.PlaybackController`
  （`playOrPause/previous/next/seekTo/changePlaybackMode/playMusicAt`）执行，
  队列状态经 `PlaybackQueueState`（mode/normalQueue/normalIndex/…）回读；
- 插件→host `{"t":"queue"}` → Shim `queue` 事件 → 设置 UI 渲染播放列表。

真实 SPW 1.19.0 日志证据（`%APPDATA%\Salt Player for Windows\workshop\logs\dev.spw.folia.log`）：

```
playback controls ready: loader=jdk.internal.loader.ClassLoaders$AppClassLoader@... controller=com.xuncorp.voxzen.service.PlaybackController
  queueState=com.xuncorp.spc.core.queue.PlaybackQueueState modeClass=...PlaybackQueue$Mode
  itemClass=com.xuncorp.spc.core.queue.? mediaClass=com.xuncorp.pisces.PiscesMediaItem
  stateValue=kotlinx.coroutines.flow.StateFlow.getValue()
queue -> helper (2931 bytes, force)
state -> helper: pos=6498 dur=190769 playing=true rate=1.0
```

即：真实插件类加载器能解析宿主类、队列 provider 有数据、状态泵正常。点击验证走打包级 E2E
（下）与真实窗口人工/截图验证（`poc/hook/shots/v030-acrylic-expanded-0.png`）。

打包级 E2E：`node packaging/tools/verify-playback-controls.mjs`（PASS 15/15）——拉起打包宿主，
注入 queue/state，经 `command eval` 点击 5 个按钮并拖动 seek，断言宿主 stdout 出现
`toggle/previous/next/shuffle/queue-play(index=2,random=false)/seek(positionMs≈50%)`、播放列表面板
≥6 行且当前行高亮、ESC 只关面板、退出码 0、consoleErrors=0；
截图 `packaging/out/packaged-controls-{bar,queue}.png`，报告
`packaging/out/verify-playback-controls-report.json`。

设置 UI 级回归：

| 脚本 | 结果 |
| --- | --- |
| `node research/settings-ui/v030-playback-controls-verify.mjs` | PASS 31/31（含 acrylic、idle 断言） |
| `node research/settings-ui/v030-playback-verify.mjs` | PASS 10/10（收起/展开/透明/穿透渲染回归） |
| `node packaging/tools/verify-layout.mjs` | PASS，consoleErrors=0 |

## 6. HUD 亚克力 + 鼠标闲置自动隐藏（用户反馈追加）

- **亚克力**：`.spw-playback` 由实色底改为半透明渐变 + `backdrop-filter: blur(28px) saturate(1.7)
  brightness(1.08)` + 顶部内高光 + 外阴影；透明窗口（`data-flat=true`）无法采样桌面，回退为
  `rgba(14,12,12,0.9)` 的致密亚克力底、不启用 backdrop-filter。
- **闲置隐藏**：`IDLE_HIDE_MS=2600`；窗口级 `pointermove/pointerdown/keydown` 唤醒，
  `transform: translate(-50%, 100%+56px)` + `opacity:0` 下滑隐藏；播放列表面板打开期间暂停倒计时，
  seek 拖动中不隐藏；键盘 Tab 聚焦到播放条同样唤醒并展开。
- 验证：`v030-playback-controls-verify.mjs` 新增「acrylic」与「idle 隐藏/唤醒」3 条断言全 PASS；
  真实 SPW 全屏歌词下截图确认——展开态亚克力透出粉紫色舞台、闲置 3.4 s 后播放条完全滑出画面
  （`poc/hook/shots/v030-idle-hidden-0.png`、`poc/hook/shots/v030-acrylic-expanded-0.png`）。

## 7. 验收反馈修复：透明窗口 hover 展开 + 面板注释文案（用户 m00972）

- **透明窗口下播放条无法展开**（问题 1）— 根因：透明模式由 `TransparencyInputCatcher` 转发鼠标
  消息，每次 forwarded `WM_MOUSEMOVE` 会让 Chromium 在同帧先产生 pointerover/enter、紧接着
  pointerout/leave（`work/tmp/tp-events.json` 记录到 enter→leave 序列），React 的
  `onPointerEnter`（150 ms 展开）被随后的 `onPointerLeave`（260 ms 收起）抵消，播放条只唤醒不展开。
  修复（`poc/settings-ui/src/chrome/playback/PlaybackBar.tsx`）：悬停判定改为窗口级 `pointermove`
  坐标命中「稳定展开区」（`min(620px, vw-48)` × 96 px、底边 28 px，即 `hitTestHud`），不再依赖
  光标下 DOM 的 pointerover/leave；单次移动即可展开，移出同样用坐标判定，`pointerenter/leave`
  仅作补充；`hoverTarget` 去抖避免展开/收起计时器互相覆盖。亚克力、闲置隐藏、透明 `data-flat`
  适配均保留。
- **右下角「播放页透明背景」面板注释文案**（问题 2）— 删除两行开关说明（`hint` / `passthroughHint`）
  与底部说明段落：`poc/settings-ui/src/chrome/PlayerBackgroundControl.tsx` 移除渲染与 props、
  `poc/settings-ui/src/App.tsx` 移除传参、`app.css` 移除 `.spw-player-bg-hint` 样式；保留
  `spw-player-bg-note--compat` 兼容性警告（用户未要求删除）。
- **验证** —
  - 新增 `node packaging/tools/verify-transparent-hud.mjs`（打包宿主 + 透明背景，真实注入路径）：
    断言面板只剩 2 行开关且 0 hint/0 note、`data-flat=true`、悬停展开 620×96、移开收起、闲置 3.2 s
    `data-hidden=true`、再移动唤醒并展开 —— **6/6 PASS**，报告
    `packaging/out/verify-transparent-hud-report.json`，截图 `packaging/out/packaged-transparent-*.png`。
  - 回归：`verify-playback-controls.mjs` **15/15 PASS**、`verify-layout.mjs` **PASS**
    （consoleErrors=0）、设置 UI 脚本 31/31 与 10/10 PASS。
  - 真实 SPW 1.19.0：透明背景开启后悬停展开实拍
    `poc/hook/shots/v030-final-trans-hover-0.png`、`poc/hook/shots/v030-final-clean-0.png`；
    面板无注释文案实拍 `poc/hook/shots/v030-pbg2-click-0.png`。

## 8. 鼠标侧键返回退出 Folia（用户反馈追加）

- **行为**：鼠标侧键「返回」（XBUTTON1）与 ESC 同义——设置 overlay 打开时第一次返回只关闭 overlay，
  否则直接退出 Folia 模式（宿主窗口关闭、插件保持加载、`reason=user`）；侧键「前进」（XBUTTON2）
  不退出。
- **实现**：`poc/webview/host/Shim.js` 在 window capture 阶段监听 `mousedown`，`button===3` 时
  `preventDefault/stopPropagation`，按 overlay 状态关闭面板或
  `post({type:'action',name:'close'})`（复用 §3.1 `action` 通道）；`poc/webview/host/HostForm.cs` 的
  `TransparencyInputCatcher.Forward` 增加 `WM_XBUTTONDOWN`/`WM_XBUTTONUP`（0x020B/0x020C）转发
  （透明模式下 catcher 原先会吞掉侧键），坐标转换与左右键一致，不参与 drag 状态。
- **验证**：新增 `node packaging/tools/verify-mouse-back.mjs`（真实 OS 鼠标事件，经
  `packaging/tools/win-cursor.ps1 -XButton1/-XButton2` 注入）**4/4 PASS**：① 不透明窗口侧键返回 →
  `closed reason=user`、exit 0；② 透明窗口侧键返回（catcher 转发路径）→ 同样退出；③ 侧键前进 →
  不退出（随后 quit 正常收尾）；④ 设置 overlay 打开时第一次返回只关 overlay、第二次退出。报告
  `packaging/out/verify-mouse-back-report.json`。真实 SPW 1.19.0 复验（插件日志）：不透明模式
  `folia window closed (reason=user)` / `host-exit code=0`；透明模式 catcher 转发下同样
  `reason=user`、exit 0。

