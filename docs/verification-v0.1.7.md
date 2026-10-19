# v0.1.7 本地验证 — 播放页透明背景（m00230 / m01012）

状态：**已修好「开启透明后无法关闭」问题，9/9 自动化验证通过；产物已发布 GitHub Release v0.1.7**
（发布说明见 `docs/release-notes-v0.1.7.md`）。
日期：2026-10-19
范围：`poc/settings-ui/src/chrome/PlayerBackgroundControl.tsx`（新）、`poc/settings-ui/src/model/settings.ts`、
`poc/settings-ui/src/publisher/config.ts`、`poc/settings-ui/src/App.tsx`、`poc/settings-ui/src/app.css`、
`poc/webview/host/HostForm.cs`、`poc/webview/host/Program.cs`；机制与限制见 `docs/live-transparency.md`。

结论先说：**右下角圆钮 → 面板「播放页透明背景」开关可用；打开后窗口真的透到桌面（不是黑底），页面开关与持久化一致；
透明时 chrome/面板仍可见（flat 模式）；透明后左下角浮标或 Ctrl+Alt+B 都能恢复不透明并同步页面开关，退出后再次开启也正常；
ESC 仍能关窗。** 全部证据如下。

---

## 1. 改动清单

| 文件 | 内容 |
| --- | --- |
| `poc/settings-ui/src/chrome/PlayerBackgroundControl.tsx` | 新控件：右下角金色圆钮（`SlidersHorizontal`）+ 弹出面板（行标题 + Folia hint + 开关 + 透明时的热键提示）；`data-flat` 控制透明模式样式 |
| `poc/settings-ui/src/model/settings.ts` | `transparentPlayerBackground` 加入 state / setter / `SettingsSnapshot` / `snapshotFromState` / `applySnapshot`（缺键回落 `false`） |
| `poc/settings-ui/src/publisher/config.ts` | `buildBackgroundConfig` 输出 `transparent: settings.transparentPlayerBackground === true` |
| `poc/settings-ui/src/App.tsx` | 面板开关状态、ESC 先关面板、透明时 chrome 常驻、`window.__spwFoliaSetTransparent` 全局钩子（宿主热键回写） |
| `poc/settings-ui/src/app.css` | 圆钮/面板/开关样式（`right:32px; bottom:56px` / `bottom:108px; width:300px`，金色 `#d8b072`）；`data-flat` 时关 `backdrop-filter` |
| `poc/webview/host/HostForm.cs` | `SetTransparency()`（键色 + `DefaultBackgroundColor=Transparent`）、`ApplyTransparencyFromSettings()`（`active`/`target` 状态机）、热键注册/`WM_HOTKEY`、`SyncPageTransparency()`、左下角 `TransparencyBadge` 浮标（`WS_EX_NOACTIVATE`，不抢焦点）；stdin 与页面两侧 settings 都触发 |
| `poc/webview/host/Program.cs` | `--no-transparency` 诊断开关 |

## 2. 透明链路验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 色键方案可行（最小探针） | 桌面窗口透出，白字浮在上层 | `poc/webview/host/repro/transparency-probe.cs` → `tmp-inspect/transparency-key.png` |
| 运行时开关不炸页面 | on/off 双向切换后窗口正常，WebView 不死 | `tmp-inspect/transparency-v017/tr-runtime-on.png` / `tr-runtime-off.png` |
| 真实 host：点开关 → 透明 | 日志 `transparency mode=on`，截屏里桌面 DSH 窗口可见 | `host-transparent11.log:28`、`112-transparent-on.png` |
| 真实 host：热键恢复 | `hotkey=off` / `hotkey=unregistered` / `mode=off`，窗口回到不透明，页面开关同步为 off | `host-transparent11.log:32-34`、`113-after-hotkey.png` |
| 持久化回环 | 页面推 `settings` 两次：`transparentPlayerBackground` 先 `true`（树 5789 B）后 `false`（树 5790 B） | `host-transparent11.log:26,35` |
| 启动即透明（插件 stdin 路径） | 运行中 stdin 推 `{"t":"settings",…,"transparentPlayerBackground":true}` → `transparency mode=on`，桌面透出 | `host-transparent12.log:18`、`120-stdin-transparent.png` |
| 透明时 ESC | 窗口仍收键盘 → `{"t":"closed","reason":"user"}` | `host-transparent12.log:24-25` |
| 面板可用性 | 不透明时点圆钮 → 面板打开（标题/hint/开关与参考图一致） | `111-panel-off.png` |
| 透明时 chrome 可见 | `data-flat` 修掉色键丢 `backdrop-filter` 的问题后，圆钮/齿轮/面板都在屏幕上可见 | `112-transparent-on.png`（此前对照：页面表面 `101-surface-transparent-on-black.png` 有、屏幕 `92-transparent-on.png` 无 → 锁定合成层） |

## 2b. 「开启透明后无法关闭」修复验证（m01012）

用户反馈：「开启透明背景后无法关闭」。定位：热键本身有效（日志 `transparency hotkey=registered`，模拟按键即恢复不透明），
真正的问题是透明后页面鼠标穿透、而用户不知道要按热键；因此新增**左下角常驻浮标**，并修掉「浮标/热键退出后
`transparencyTarget` 未同步 → 再开开关无效」的状态机 bug。

`tmp-inspect/verify-transparent13.py`（DPI aware、先 `taskkill /F /IM spw-folia-host.exe` 隔离、按金色像素找浮标/圆钮、
按 >235 白像素找开关 knob）**9/9 PASS**：

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 启动即透明时浮标出现 | `transparency badge=shown at=24,1930`，屏幕上左下角可见 | `130-badge-transparent.png` |
| 点浮标恢复不透明 | `transparency exit source=badge` → `mode=off`、`badge=hidden` | `135-opaque-after-badge.png` |
| 恢复后页面开关同步为 off | 页面回传 settings `transparentPlayerBackground:false` | 日志 `settings flags: ['true','false','true','false']` |
| 再次开启正常（状态机修复） | 第二次开透明 `mode=on`、浮标再现 | `134-*` / 脚本 PASS |
| 热键同样可用 | `transparency exit source=hotkey` → `hotkey=unregistered` | 脚本 PASS |
| 面板内提示文案 | 「透明窗口为鼠标穿透：按 Ctrl+Alt+B 或点左下角浮标恢复不透明，ESC 退出播放。」 | `133-panel-open.png` |

## 3. 构建与产物

| 产物 | 值 |
| --- | --- |
| `poc/settings-ui/dist/settings-ui.js` | 1,066,766 B（含浮标提示文案） |
| `poc/webview/host/build/spw-folia-host.exe` | 123,392 B，sha256 `248e1b021ddf594491b128c018151c07765b689ecc5a081054380dc55330ca2b` |
| `packaging/build-package.sh` | web 25 MB / native 1.1 MB / licenses 64 KB |
| `dist/release/spw-folia-0.1.7.spmod` | 12,970,892 B（12.37 MB），1941 entries，sha256 `5cf8eba69c9d1bb961efd160075c29b9cde52e5b30699598e5ec174106dd5138` |
| 产物内 host exe | `native/spw-folia-host.exe` sha256 与 build 一致（`248e1b02…`） |
| 本机安装 | `%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-0.1.7`，插件日志 `start: … version=0.1.7 …`、`settings loaded (5324 bytes, persisted)`、`playback extension discovered`；旧版备份在 `tmp-inspect/install-badge-backup/` |

## 4. 用户验收路径

1. SPW → 更多 → Folia（全屏页）；
2. 右下角金色「调音台」圆钮 → 面板「播放页透明背景」→ 打开开关（桌面透出）；
3. 透明后鼠标穿透，点**左下角浮标**或按 **Ctrl+Alt+B** 恢复不透明（页面开关会同步回 off 并持久化）；
4. 回到不透明后可再次点开关验证「能反复开关」，ESC 退出播放。

## 5. 已知限制

- 透明模式点击穿透（色键窗口特性），页面内无法再点开关 → 依赖左下角浮标 / `Ctrl+Alt+B`；面板内常驻提示已写明。
- 透明时 `backdrop-filter` 退化（`data-flat`），chrome 切成无模糊样式。
- 键色为纯洋红，理论上页面画出该纯色会被挖空（当前主题不会）。
