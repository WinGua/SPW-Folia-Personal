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

1. **鼠标完全穿透**（真实 host 与最小探针都验证过：点击会落到下面的窗口，连金色圆钮的不透明像素也一样——色键窗口里 WebView2 的内容走独立合成面，宿主窗口自身整块是键色，所以整窗都不可点）。
   → v0.1.8 用「不可见输入捕获窗口」把鼠标补回来：`TransparencyInputCatcher : Form`，`WS_EX_LAYERED + WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW`，`SetLayeredWindowAttributes(alpha = 1/255)`（肉眼不可见但仍参与命中测试），几何跟随主窗口（`ApplyInputCatcherBounds()` + 每 tick `SyncInputCatcherBounds()`，实测 3200×2000 全屏对齐）。
   `WndProc` 捕获 `WM_MOUSEMOVE / WM_LBUTTONDOWN / WM_LBUTTONUP / WM_RBUTTONDOWN / WM_RBUTTONUP / WM_MOUSEWHEEL`，
   把捕获窗口客户坐标换成屏幕坐标后再 `ScreenToClient(WebView2 输入子窗口)`，`SendMessage` 投递给
   `Chrome_WidgetWin_1`（退路 `Chrome_RenderWidgetHostHWND`），并吞掉原消息。→ 透明模式下页面内的
   圆钮、面板、开关、齿轮全部可点（真机验证：透明中点击开关 → `transparency mode=off` + catcher 隐藏）。
   探针先验证过这条链路可行（`poc/webview/host/repro/click-post-probe.cs`：向 `Chrome_WidgetWin_1` 投递
   合成消息能让页内 mousedown 计数 0→1→2；而 `WH_MOUSE_LL` 钩子在本机根本不触发，所以没有走钩子路线）。
   捕获窗口会吃掉鼠标，因此 v0.1.8 里透明窗口无法直接操作桌面。
   **v0.1.9 的改法**：页面把自己的「热区」报给宿主（见 §4.4），捕获窗口只在热区里转发鼠标，
   热区之外的点击（且「鼠标穿透」开关打开时）会先隐藏自己、用 `mouse_event` 合成一次真实左键，
   220 ms 后重新显示 —— 于是同一个透明窗口既能点 Folia 的控件，又能点桌面/下层窗口。
2. **`backdrop-filter` 图层在色键合成下不绘制**（chrome 和面板的 `backdrop-filter: blur()` 会让它们整块消失，但 `CapturePreviewAsync` 抓页面表面时它们又都在——这组"表面有、屏幕无"的对照把原因锁定在合成层）。
   → 透明时给两个 chrome 加 `data-flat='true'`，CSS 里 `backdrop-filter: none`（`.spw-chrome-btn[data-flat='true']`、`.spw-player-bg[data-flat='true'] …`）。视觉上少一层模糊，可读性不受影响。
3. **逃生通道：热键 + 页面开关本身**（v0.1.9 起不再有左下角 chip）
   - **全局热键（双向切换）**：`RegisterHotKey` 链 **Ctrl+Alt+B** → Ctrl+Alt+Y → Ctrl+Alt+P → Ctrl+Alt+Shift+B
     （本机 Ctrl+Alt+T 已被别的程序占用，所以 B 优先）；启动时注册一次、不再注销，按一下在
     「透明 ↔ 不透明」之间切换（`EnterTransparentMode` / `ExitTransparentMode`）；日志
     `transparency hotkey=registered mods=0x3 vk=0x42` / `transparency enter source=hotkey` /
     `transparency exit source=hotkey` / `hotkey=failed`。
   - **页面里的两个开关**：右下角圆钮 → 面板里的「播放页透明背景」开关；有了热区转发，透明状态下它们
     永远可点，所以不需要额外的浮标窗口（v0.1.7/v0.1.8 的 `TransparencyBadge` chip 已在 v0.1.9 删除）。
   - 两条通道都走 `ExitTransparentMode(source)`：log → `SetTransparency(false)` →
     `ExecuteScriptAsync("window.__spwFoliaSetTransparent(false)")`；页面开关随 settings 回环持久化成 `false`。
     退出透明时宿主与页面都会把 `mousePassthrough` 复位为 `false`（`ApplyTransparencyFromSettings()` 里
     `if (!on) passthrough = false;`，页面 `App.tsx` 里同样有 effect），避免下次进透明还在穿透态。
   - **状态机要点**：`transparencyActive`（窗口实际状态）与 `transparencyTarget`（页面开关的意图）必须
     分开且都由 `SetTransparency()` 收尾时对齐；`ApplyTransparencyFromSettings()` 只在
     `on != transparencyActive` 时才真正切窗口。早期版本用 `on == transparencyTarget` 提前 return，
     导致「热键退出后页面开关还亮着，再点开关无效」——v0.1.7 发布前已修。

## 4.4 v0.1.9：鼠标穿透开关与热区（hitbox）

- 设置树新增 `mousePassthrough`（默认 `false`，与 `transparentPlayerBackground` 一起持久化）。
  它只出现在透明开启后的面板里（第二行「鼠标穿透（操作桌面）」），关掉透明时会自动复位。
- **页面 → 宿主**：`poc/settings-ui/src/bridge.ts` 的 `reportHitRegions()` 发送
  `{"type":"hitbox","vw":innerWidth,"vh":innerHeight,"rects":[{x,y,w,h},…]}`；`App.tsx` 收集
  `[data-spw-chrome="settings"]`（齿轮）、`[data-spw-chrome="player-background"]`（金色圆钮）、
  `[data-spw-chrome="player-background-panel"][data-open="true"]`（面板）、
  `[data-spw-settings-overlay="true"]`（设置整页），立即发一次 + 120 ms 后再发一次 + `resize` 监听，
  chrome/面板/设置页状态变化时重发。
- **宿主 → 判定**：`HostForm.UpdateHitRegions()` 存下 `vw/vh` 与 CSS 矩形；`IsInteractiveAt(screen)` 把屏幕点
  换算成客户端点、再按 `ClientSize.Width / hitViewportWidth`（实测 3200/1776 = 1.802）换算成 CSS 坐标，
  与每个矩形做 ±4 CSS px 容差命中（页面与宿主之间的亚像素/缩放误差都在容差内）。
- **穿透过桌面**：`TransparencyInputCatcher.FallThrough` → `FallThroughToDesktop()`：隐藏捕获窗口 →
  `mouse_event(LEFTDOWN|LEFTUP)`（真实输入，不是 `SendMessage`）→ `catcherRestoreAt = now + 220 ms` →
  `OnTick` 到点再 `ShowInputCatcher()`；日志 `transparency passthrough=click at=x,y`，
  开关状态日志 `transparency passthrough=on|off rects=N`。
- **默认行为不变**：`mousePassthrough = false` 时 `IsInteractiveAt()` 直接返回 `true`，捕获窗口照旧整窗转发
  （v0.1.8 的行为），只有打开穿透后热区之外才会落向桌面。

透明时 chrome 常驻（`chromeAlwaysOn = transparentPlayerBackground === true`），并且 ESC 仍可关窗。

## 4.5 v0.1.10：消息参数窄化崩溃修复

- **症状**：v0.1.9 在透明模式下（捕获窗口存在时）**滚轮向下**会弹出
  「Microsoft .NET Framework — 应用程序中发生了未经处理的异常 … 算术运算导致溢出。」然后辅助进程退出，
  而 `spw-folia.log` / 宿主 stdout 里没有任何 error 行。
- **根因**：`TransparencyInputCatcher.Forward()` 用 `m.WParam.ToInt32()` / `m.LParam.ToInt32()` 读参数。
  x64 .NET Framework 上 `IntPtr.ToInt32()` 是**带溢出检查**的窄化转换，而 Win32 把消息参数零扩展投递：
  `WM_MOUSEWHEEL` 的 `WPARAM` 低字是 delta，滚轮向下为 `-120`（`0xFF88`），低 dword 即 `0xFF88xxxx`
  （bit31 = 1），于是 `ToInt32()` 抛 `OverflowException`。滚轮向上 `+120` 不触发。
- **修复**：参数统一走 `unchecked((int)m.WParam.ToInt64())` / `unchecked((int)m.LParam.ToInt64())`
  （`HostForm.cs:Forward`，热键 `WM_HOTKEY` 判断同样处理）。同时修正滚轮分支的字段混淆——光标坐标取自
  `LPARAM`（已是屏幕坐标，无需 `PointToScreen`），delta/keyState 在 `WPARAM` 里，转发时 `WPARAM`/`LPARAM`
  原样投递；`MakeLParam()` 两个半字都做 `& 0xFFFF`。
- **可观测性**：`Program.Main` 里注册 `Application.SetUnhandledExceptionMode(CatchException)` +
  `Application.ThreadException` + `AppDomain.CurrentDomain.UnhandledException`，异常改为
  `<level=error>` 协议行（`ui-thread` / `unhandled` stage），随后进程照常结束由插件重启。
- **验证**：反射级 15/15；真机级旧二进制必现 `Microsoft .NET Framework` 弹窗、新二进制 0 弹窗；
  详见 `docs/verification-v0.1.10.md`。

## 5. 已知限制

- 键色是纯洋红 `rgb(255,0,255)`：页面若恰好绘制该像素会被挖空（当前 Folia 主题/歌词不会产生该纯色；属于可接受风险）。
- 透明就是「透到桌面/其它窗口」，不是 OBS 浏览器的 alpha 源——OBS 场景请直接用 Folia 的浏览器源，或用窗口捕获。
- 仅主屏全屏（与 v0.1.0 起一致）；多屏选择未实现。
- 透明模式默认会捕获鼠标（v0.1.8 的输入捕获窗口）；要操作下层窗口请打开面板里的「鼠标穿透（操作桌面）」，
  或按 Ctrl+Alt+B / ESC 退出透明。打开穿透后，只有两个浮标（右下角圆钮、右上角齿轮）、它们的面板/设置页
  仍然可点，其余位置都落向桌面。
- 穿透点击是「隐藏捕获窗口 → 合成一次左键 → 恢复」的时序（约 220 ms），极快连点时可能有一次丢失。
- 透明模式下 `backdrop-filter` 视觉退化（见 §4.2），但控件可点（见 §4.1）。
