# spw-folia v0.2.2 — 鼠标穿透重构为系统级 shaped region（借鉴 SPW-island）

v0.2.2 把 v0.1.9 引入的「鼠标穿透」从**合成点击回放**重写为**操作系统级命中测试**，思路借鉴开源
桌面挂件项目 SPW-island（Kotlin/Compose Desktop + JNA）的 shaped input peer 设计。协议与设置
格式均与 v0.2.1 相同，这是 v0.2.0 以来第一次动宿主输入路径的行为级重构。

## 更新内容

- **重构：鼠标穿透改为系统级 shaped region** — 旧机制（v0.1.9）是「隐藏捕获窗 → `mouse_event`
  合成一次左键 → 220 ms 后恢复」的时序回放，缺陷成堆：只回放左键，**右键/滚轮/悬停被整吞**、
  **拖拽必断**、极快连点可能丢一次，且合成输入会被提权窗口与反作弊软件拦截。新机制直接把
  **捕获窗口的窗口区域（window region）做成命中测试**：页面上报的 hitbox 矩形并集（CSS → client
  按 `ClientSize/hitViewport` 缩放，四周放大 ±4 CSS px 容差）经 `CreateRectRgn` + `CombineRgn(RGN_OR)`
  合成后 `SetWindowRgn`。区域之外的输入在 OS 命中测试层直接落向下层窗口——**点击、右键、滚轮、
  悬停、拖拽全部真实穿透，零合成输入**，提权窗口 / 反作弊场景同样可用。
- **拖拽连续性** — 热区内按下任一鼠标键即把区域临时扩展为整窗（避免拖出热区后事件断流），
  全部按键抬起即恢复；若 button-up 被 WebView2 捕获吃掉，下一次移动用 `GetAsyncKeyState`
  自愈，区域不会永久保持整窗。
- **fail-open 保守策略** — 穿透关闭、页面未上报矩形或 viewport 非法时区域置空（整窗可点）：
  宁可多点到页面，也不吞掉用户的点击。
- **保留 v0.1.10 崩溃修复** — 消息参数一律 `unchecked((int)ToInt64())` 取值（x64 下
  `WParam.ToInt32()` 检查窄化会在滚轮向下 delta -120 时抛 `OverflowException` 崩掉 WndProc），
  `MakeLParam` 两半字掩码不变。
- **借鉴出处** — SPW-island `WindowsGpuInput.kt` / `WindowsOverlay.kt` 的
  `WS_EX_TRANSPARENT|WS_EX_LAYERED` 整窗穿透 + shaped 小窗反选区域双窗方案，被折叠成单一
  「区域化捕获窗」，OS 命中测试语义等价、窗口数减半。设计细节见
  [live-transparency.md](../live-transparency.md) §4.7。

## 验证

- **旧机制零残留** — 全源 grep `mouse_event|catcherRestoreAt|IsInteractiveAt|FallThroughToDesktop|
  ShouldForward|MouseEventLeft` 无命中；`Forward` 改为无条件转发到达的消息（能到达 = 在区域内）。
- **编译** — `bash poc/webview/host/build.sh`（csc.exe，.NET Framework 4.8，x64）与
  `./gradlew plugin`（JDK 25）均成功；版本号两处一致（`build.gradle.kts` `version`/`PluginVersion`
  均为 `0.2.2`）。
- **打包布局验收** — `node packaging/tools/verify-layout.mjs`：**PASS**，10 项检查全过
  （`exitedZero` / `closedUser` / `bridgePresent` / `settingsInjected` / `settingsAutoOpened` /
  `closeSettingsCommand` / `openSettingsCommand` / `escClosedSettingsOnly` / `visualizerCanvases` /
  `noConsoleErrors`），`consoleErrors=0`，fps 中位 107，spawnToReady 590 ms。
- **真机验收** — 安装进真实 workshop 后 owner 实测穿透行为（热区可点、其余位置点击/右键/滚轮/
  悬停/拖拽直落下层），于 2026-10-21 验收通过。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.2.2.spmod` | 13,153,013 B（1941 entries） | `ca74c7fc4b6ce807af582f8dcbae041f4001bbf8b291e86e3be29a30f9fa38ac` |
| `spw-folia-0.2.2.spmod.json` | 488 B | `419bf64bfd5a922f3e9cb5baeb68cd48aaaf01b5af29950068aae8411d4511dc` |
| `SHA256SUMS.txt` | 88 B | `e3d4f96bb69264c53b34668d90300aaada972c00415a5b3390ce772d06ad00eb` |

包内构成：插件 classes `plugin-dev.spw.folia-0.2.2.spmod`（94,303 B，sha256
`4893ce145c10ac91a8bfffde4aed293b113baf27a2b8d7cc655a81484ea4d7cb`）＋ native 辅助进程
`spw-folia-host.exe` 131,584 B（sha256 `e4248044c5bfad60aab7145ce37c3af9ba82e62413e4ca34b92d9c403b9d1ee9`，
本次重构宿主输入路径）＋ 完整 Folia 0.7.21 web bundle 与设置岛（`settings-ui.js` 1,071,968 B，
sha256 `eeb8a128359531fa3f1d68d6ce6db5e808c3128f92c5f933e040ae7bae95ad34`，未改动）＋ 许可证。

## 安装 / 升级

1. 关闭 Salt Player for Windows。
2. 打开 mod 管理器，删除旧版 `spw-folia`，导入 `spw-folia-0.2.2.spmod`。
3. 授予 `class-transform` 与 `library-read` 两项权限。
4. 重启 SPW，`更多 → Folia`。

可直接从 v0.2.1 覆盖升级（协议、设置格式、web bundle 均未变）。系统依赖
（WebView2 Runtime / .NET Framework 4.8）见 [runtime-requirements.md](../runtime-requirements.md)。

## 已知限制

- **穿透热区来自页面上报的 hitbox 矩形**（±4 CSS px 容差）；上报缺失或解析失败时退化为整窗
  可点（fail-open），按住拖拽期间热区临时扩展为整窗、松开恢复。
- 其余限制与 v0.2.1 相同：色键透明仍为 `rgb(255,0,255)` 方案；仅主屏全屏；`monet` 与浅色主题下的
  `lumiere` 在透明下不可用；WebView2 浏览器进程偶发退出暂无自动重试。
