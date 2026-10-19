# 播放页透明背景 — 宿主窗口透明机制（v0.1.7 契约）

日期：2026-10-19
范围：`poc/settings-ui/src/chrome/PlayerBackgroundControl.tsx`（新控件）、`poc/settings-ui/src/model/settings.ts`、
`poc/settings-ui/src/publisher/config.ts`、`poc/settings-ui/src/App.tsx`、`poc/settings-ui/src/app.css`、
`poc/webview/host/HostForm.cs`、`poc/webview/host/Program.cs`。跨仓依据：Folia 的
`transparentPlayerBackground`（`work/folia/folia-major-main/src/stores/usePlayerChromeSettingsStore`）与
`ObsBrowserSourceApp.tsx` / `VisualizerBackgroundRenderer.tsx`。

结论先说：**透明由两层组成——页面侧 `config.background.transparent=true`（Folia 渲染器自己不再画背景、文档底色本来就是透明），
宿主侧把 WinForms 窗口做成色键透明（`BackColor` = 键色 + `TransparencyKey` + `WebView2.DefaultBackgroundColor = Color.Transparent`）。**
色键透明是 Windows 上 windowed WebView2 唯一不需要改写为 composition hosting 的真实桌面透出方案（`repro/transparency-probe.cs` 已证）。

---

## 1. 需求与位置

用户参考图（m00228 / m00229）：图 1 是 SPW 播放页「控制」面板里的「播放页透明背景」行 + 开关；
图 2 红框在 Folia 全屏页**右下角**，框住那个圆形金色描边的「调音台」按钮。因此本版把开关放进那个圆钮弹出的面板里：

| 元素 | 位置（CSS px，视口 1776×1110 时） | 说明 |
| --- | --- | --- |
| 圆形按钮 `.spw-chrome-btn--player` | `right:32px; bottom:56px`，40×40 | 图标 lucide `SlidersHorizontal`，深色底 + 暖金色描边/光圈；`bottom:56px` 是为避开全屏时自动隐藏的任务栏触发条 |
| 面板 `.spw-player-bg-panel` | `right:32px; bottom:108px`，宽 300 | 深色圆角卡；一行标题「播放页透明背景」+ Folia 现成 hint（`options.transparentPlayerBackgroundDesc`）+ 开关；透明开启时多一行热键提示 |
| 开关 `.spw-switch` | 40×24，knob 18px | off 灰轨 / on 金色 `#d8b072` |

齿轮（`.spw-chrome-btn`）保持 v0.1.1 位置（右上角 24/24）。透明开启时两个 chrome 都常驻（见 §4）。

## 2. 设置链路（无需改插件）

1. 开关 → `useSettingsStore.setTransparentPlayerBackground(bool)`；
2. `snapshotFromState()` 把它写进 `SettingsSnapshot.transparentPlayerBackground`，由 `ConfigPublisher` 推送 → 宿主 `settings` 消息 → 插件 `FoliaSettingsStore` 整树持久化（插件不解释 JSON，新字段零改动，`applySnapshot` 的 `clean()` 保证旧树缺键时回落 false）；
3. `buildBackgroundConfig()` 输出 `background.transparent`，页面里 `VisualizerBackgroundRenderer` 见到 `transparent` 直接 `return null`，`ObsBrowserSourceApp` 的根 div 底色也变成 `transparent`；
4. 宿主同时**自己**从 settings JSON 里读 `transparentPlayerBackground`（`JsonUtil.ExtractRawValue`），这样开关一动窗口立刻变透明，不必等插件回环。

启动顺序：插件启动宿主时把持久化的 settings 树写在 stdin 的 `settings` 消息里；宿主解析参数后立即应用 → 上次开着透明的话，窗口从第一帧就是透明的（验证见 `docs/verification-v0.1.7.md`）。

## 3. 宿主实现（`HostForm.cs`）

```csharp
static readonly Color TransparencyKeyColor = Color.FromArgb(255, 0, 255); // 页面永远不会画出的纯键色
// on
TransparencyKey = Color.Empty;          // 先清再设，避免黑底残帧
BackColor       = TransparencyKeyColor;
TransparencyKey = TransparencyKeyColor;
webView.DefaultBackgroundColor = Color.Transparent;
// off
BackColor = Color.Black;
TransparencyKey = Color.Empty;
webView.DefaultBackgroundColor = Color.Black;
```

- `ApplyTransparencyFromSettings()` — 在构造函数（`--dev-settings` 之后）、stdin `settings`、页面 `{"type":"settings"}` 三处调用；`--no-transparency` 强制关闭（诊断/回归用）。
- 日志：`transparency mode=on|off`。
- 窗口仍是原来的 borderless topmost 全屏 Form，几何/DPI/鼠标 idle 逻辑不变。

## 4. 色键合成的三个副作用与对策

1. **鼠标完全穿透**（真实 host 与最小探针都验证过：点击会落到下面的窗口，连金色圆钮的不透明像素也一样）。
   → 透明模式定位为「叠加在桌面上的歌词层」；要操作页面必须用热键，面板里常驻一行提示。
2. **`backdrop-filter` 图层在色键合成下不绘制**（chrome 和面板的 `backdrop-filter: blur()` 会让它们整块消失，但 `CapturePreviewAsync` 抓页面表面时它们又都在——这组"表面有、屏幕无"的对照把原因锁定在合成层）。
   → 透明时给两个 chrome 加 `data-flat='true'`，CSS 里 `backdrop-filter: none`（`.spw-chrome-btn[data-flat='true']`、`.spw-player-bg[data-flat='true'] …`）。视觉上少一层模糊，可读性不受影响。
3. **透明后鼠标点不到页面，就无法关掉透明** → 全局热键逃生：
   - `RegisterHotKey` 链 **Ctrl+Alt+B** → Ctrl+Alt+Y → Ctrl+Alt+P → Ctrl+Alt+Shift+B（本机 Ctrl+Alt+T 已被别的程序占用，所以 B 优先）；
   - 只在透明生效时注册，关闭透明即 `UnregisterHotKey`；日志 `transparency hotkey=registered mods=0x3 vk=0x42` / `hotkey=off` / `hotkey=unregistered` / `hotkey=failed`；
   - `WM_HOTKEY` 处理：`SetTransparency(false)` + `ExecuteScriptAsync("window.__spwFoliaSetTransparent(false)")`——后者由 `App.tsx` 注册到 `useSettingsStore`，于是页面开关同步回 off、再随 settings 回环持久化成 `false`。

透明时 chrome 常驻（`chromeAlwaysOn = transparentPlayerBackground === true`），并且 ESC 仍可关窗（窗口保持键盘焦点时；一旦发生穿透点击转移焦点就只剩热键可用）。

## 5. 已知限制

- 键色是纯洋红 `rgb(255,0,255)`：页面若恰好绘制该像素会被挖空（当前 Folia 主题/歌词不会产生该纯色；属于可接受风险）。
- 透明就是「透到桌面/其它窗口」，不是 OBS 浏览器的 alpha 源——OBS 场景请直接用 Folia 的浏览器源，或用窗口捕获。
- 仅主屏全屏（与 v0.1.0 起一致）；多屏选择未实现。
- 透明模式下 `backdrop-filter` 视觉退化（见 §4.2），且不能点击页面（见 §4.1）。
