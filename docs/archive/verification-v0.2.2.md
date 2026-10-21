# spw-folia v0.2.2 — 鼠标穿透重构（合成点击回放 → 系统级 shaped region）

背景：owner 提出学习开源项目 SPW-island（Kotlin/Compose Desktop 桌面挂件）的鼠标穿透实现，
评估能否借鉴进 folia 插件。调研结论：可以，而且应当**替换** v0.1.9 现有的「合成点击回放」
机制——两者的差距不是功能多少，而是命中测试发生在哪一层。

## 旧机制（v0.1.9）根因

透明模式下主窗是色键窗口（`TransparencyKey` = rgb(255,0,255)），WebView2 内容走独立合成面，
宿主窗口自身整块是键色 ⇒ **整窗都不可点**。v0.1.8 引入 `TransparencyInputCatcher` 全屏
1/255 alpha 捕获窗拦截输入，v0.1.9 在捕获窗里做软件命中测试（`IsInteractiveAt` 对页面上报的
hitbox 矩形逐点判断），不在热区内的 WM_LBUTTONDOWN 走 `FallThroughToDesktop`：

```
HideInputCatcher() → mouse_event(LeftDown); mouse_event(LeftUp) → 220ms 后恢复捕获窗
```

缺陷：只回放左键（右键/滚轮/悬停被整吞）；down+up 即时合成 ⇒ 拖拽必断；220 ms 恢复时序在
极快连点下可能丢一次；合成输入被提权窗口与反作弊软件拦截。

## 新机制（v0.2.2）

SPW-island 的做法（`WindowsOverlay.kt` `clickThrough()` + `WindowsGpuInput.kt` shaped input
peer）是 **OS 命中测试层的真穿透**：`WS_EX_TRANSPARENT|WS_EX_LAYERED` 整窗穿透，交互区域由
一个 1/255 alpha、`window.shape` 反选的小窗接管。spw-folia 的捕获窗本来就是 1/255 alpha 的
输入接管窗（v0.1.8），因此把其双窗方案折叠为单窗：**捕获窗的 window region 就是命中测试**。

- `TransparencyInputCatcher.ApplyHitRegion(List<Rectangle> rects)`：hitbox 矩形 CSS → client
  按 `ClientSize/hitViewport` 缩放、四周放大 ±4 CSS px 容差（与 v0.1.9 一致），`CreateRectRgn`
  逐矩形 + `CombineRgn(RGN_OR)` 合成 + `SetWindowRgn`。**HRGN 所有权**：传给 `SetWindowRgn` 的
  句柄归系统所有（MSDN），绝不 `DeleteObject`；只回收未成功提交的中间量。
- 区域之外的输入在 OS 层直接落向下层窗口：点击、右键、滚轮、悬停、拖拽全部真实穿透，
  `Forward` 无需再做任何软件判断（能到达的消息 = 在区域内，无条件转发给 Chrome_WidgetWin_1）。
- fail-open：`!mousePassthrough` / 无矩形 / viewport 非法 ⇒ `SetWindowRgn(Handle, 0, true)`
  清除区域 = 整窗可点。宁可多点到页面，不吞用户的点击。
- 拖拽连续性：`BeginDrag`/`EndDrag` 计数按键，任一按键期间区域临时整窗（`catcherDragActive`），
  归零恢复；`HealDragState` 用 `GetAsyncKeyState(VK_LBUTTON|VK_RBUTTON)` 在下一次移动时自愈
  被 WebView2 捕获吃掉的 button-up。
- 区域重建时机四处：页面 hitbox 更新（`UpdateHitRegions`）、bounds 变化（`SyncInputCatcherBounds` /
  `ApplyInputCatcherBounds`）、穿透开关（`ApplyTransparencyFromSettings`）、句柄重建
  （`OnHandleCreated`）。
- v0.1.10 修复原样保留：`unchecked((int)m.LParam.ToInt64())`（x64 下 `ToInt32()` 检查窄化在
  滚轮向下 delta -120 时抛 `OverflowException`）；wheel lParam 已是屏幕坐标，直传
  `SendMessage`；`MakeLParam` 两半字 `& 0xFFFF` 掩码。

## 验证

- **旧机制零残留** — 全源 grep `mouse_event|catcherRestoreAt|IsInteractiveAt|FallThroughToDesktop|
  ShouldForward|FallThrough|MouseEventLeft` 无命中。
- **编译** — `bash poc/webview/host/build.sh`（in-box csc.exe，.NET Framework 4.8，
  `-platform:x64 -optimize+`）成功，仅 3 个与本次改动无关的既有告警；
  `./gradlew plugin`（JDK 25）BUILD SUCCESSFUL。
- **打包布局验收** — `node packaging/tools/verify-layout.mjs`（打包件自带真实 WebView2 启动 +
  UI 探针）：`"pass": true`，10/10 检查全过，`consoleErrors 0`，fps 中位 107（90–119），
  `spawnToReadyMs 590`，`heapMaxMB 101.7`。
- **真机验收** — `install-local.sh` 装入真实 workshop（MANIFEST 确认 Plugin-Version 0.2.2），
  owner 实测热区可点、其余位置点击/右键/滚轮/悬停/拖拽直落下层，2026-10-21 验收通过。

## 产物哈希

| 组件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.2.2.spmod` | 13,153,013 B（1,941 entries） | `ca74c7fc4b6ce807af582f8dcbae041f4001bbf8b291e86e3be29a30f9fa38ac` |
| 插件 classes `plugin-dev.spw.folia-0.2.2.spmod` | 94,303 B | `4893ce145c10ac91a8bfffde4aed293b113baf27a2b8d7cc655a81484ea4d7cb` |
| `spw-folia-host.exe` | 131,584 B | `e4248044c5bfad60aab7145ce37c3af9ba82e62413e4ca34b92d9c403b9d1ee9` |
| `settings-ui.js`（未改动） | 1,071,968 B | `eeb8a128359531fa3f1d68d6ce6db5e808c3128f92c5f933e040ae7bae95ad34` |

设计契约见 [live-transparency.md](../live-transparency.md) §4.7。
