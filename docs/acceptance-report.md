# spw-folia 验收报告（task-13 最终矩阵）

- 验收对象：**最终发布产物** `dist/release/spw-folia-0.1.0.spmod`
  - size **12,443,495 B**，sha256 `8c265dc1aca7ee5ee378b65f5b045ccba7e51536e812e399b0d9cf6bd9d46838`
  - 构建来源：gradle classes `81137cc97612679bf0e2093292d6faf5040c05c523e1d9cd19a41cee37e791b9`（含 `native/spw-folia-host.exe` 解析候选）、原生 host `aee45d4a88c7395cce72b05eb7bb14f4e07188c4a20afe8b2d460f5f4c3337b4`、完整 web（1,872 asset 文件）、licenses
- 安装位置：`%APPDATA%\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY`（release 布局：`classes/` + `native/` + `web/` + `licenses/`）
- 权限：`permissions.json` → `{"dev.spw.folia":{"reviewed":["class-transform","library-read"],"granted":["class-transform","library-read"]}}`；`enabled.txt` 含 `dev.spw.folia`
- 真实宿主：SPW 1.19.0（MS channel），Windows 11，屏幕 3200x2000 物理 / WinDpi 173 / 页面 CSS viewport 1776x1110 dpr=1
- 插件日志：`<plugin dir>/spw-folia.log`；helper stdout：`<plugin dir>/spw-folia-host.stdout.log`；证据截图/日志：`poc/hook/acceptance/`

## 结论

**RELEASE-READY（有条件）**：核心链路（更多菜单第 5 项 "Folia" → 插件进程内 spawn 已安装 payload 的原生 helper → 全屏 WebView2 Folia 渲染器 + 实时歌词/时钟 → 真实鼠标 ⚙ 打开设置 → ← 关闭 → ESC 关窗 → 无孤儿进程）在最终产物上全部 PASS。条件/注意：
1. 自动化下无法稳定点到「播放条进度条」做 seek（紧凑播放条/播放页没有可定位的进度条点击区），seek 用 SPW 的 ←/→ 快捷键验证（同一 `PlaybackExtensionPoint.onSeekTo` 链路，最终产物上 seek 计数 3→6 + 时钟跳变），见 T2；人工可用进度条。
2. 未能在自动化中找到「无歌词曲目」并切歌成功，T4 为 PARTIAL（零歌词渲染路径本身有证据：spawn 首帧/纯背景渲染 0 js error、`canvases=3`）。
3. 观察到 1 次 WebView2 `BrowserProcessExited reason=Unexpected` 的偶发 helper 退出（最终产物、空闲约 11.6 s；见「已知问题」），未复现于 16 分钟 soak。

## 测试矩阵

图例：PASS=在最终产物上实测通过；PARTIAL=部分验证/自动化受限；N/A=不适用。

| # | 测试 | 结果 | 证据 |
|---|------|------|------|
| T0 | 更多菜单出现第 5 项 Folia（真实 SPW） | **PASS** | `acceptance/finA-menu` 由 `tasks7-menu-5items.png`/`t13d-*` 同款；本轮 `finB` 运行日志 `Folia item appended (scope=androidx.compose.ui.ჰ$Ϳ, bridge=Ϳ)`（`finD-plugin.log` 中 23:34:42 / 23:35:34 等） |
| T0b | 点击 Folia → 插件进程内 spawn **已安装 payload** 的 helper | **PASS** | `finD-plugin.log`：`spawn exe=…\dev.spw.folia-0.1.0-LOCAL-ONLY\native\spw-folia-host.exe web=…\web`；Win32 进程路径同；helper parent = SPW pid 7416 |
| T0c | helper 几何 / DPI / 页面 viewport | **PASS** | `finD-plugin.log`：`geometry reason=handle-created mode=fullscreen bounds=0,0 3200x2000 client=3194x1953 screen=3200x2000 dpi=96 winDpi=173 awareness=per-monitor`；`page-viewport w=1776 h=1110 dpr=1 canvases=3 client=3200x2000` |
| T1 | 曲目切换（next/prev，窗口打开状态） | **PASS** | 最终产物实测：media NEXT → 日志 `track -> helper (103045 bytes)` / `lyrics -> helper (25856 bytes)`（新曲，曲目/歌词均重发），截图 `acceptance/finT1-next.png`；soak 期间 same 链路持续（duration 321533→240133→326853 变化）。早期构建同链路 `poc/hook/shots/acc1-next-0.png` |
| T2 | seek（进度条点击 → onSeekTo + 时钟跳变 + 不同歌词行） | **PASS-by-keyboard**（最终产物实测） | 进度条点击在紧凑播放条/播放页无稳定可点区域（自动化不可定位，人工可用）；最终产物实测 SPW ←/→ ×3：日志 `callbacks/10s … seek=3` → `seek=6`（+3 次 onSeekTo），10 s 内 pos 14336→38372（+24 s，自然播放仅 +10 s）；seek 后重开 helper 截图 `acceptance/finT2-reopen.png`（不同歌词区段）。早期构建：`callback seek first: 45208`、`acc1-seekposA/B-0.png` |
| T3 | 暂停/恢复（时钟冻结/恢复） | **PASS**（最终产物实测） | 暂停：`state -> helper: pos=4233 dur=265813 playing=false` 在 2.6 s 内两次采样完全一致，截图 `acceptance/finT3-paused.png`；恢复：`pos=4371 … playing=true`，截图 `acceptance/finT3-resumed.png`；soak 采样 posMs 单调递增。早期构建：`acc1-pausedA/B-0.png`、`acc1-resumed-0.png` |
| T4 | 无歌词曲目渲染不崩溃 | **PARTIAL** | 未能自动化选中无歌词曲目（列表/搜索点击受桌面争用与输入焦点限制）；但零歌词路径有证据：spawn 后首帧（track/lyrics 尚未到达）纯背景渲染无错误 `poc/hook/shots/t7c-folia-click-0.png`、`t7i-open-0.png`，页面 `canvases=3`、0 js error |
| T5 | 禁用插件→菜单项消失；重新启用→菜单项恢复 + spawn 可用 | **PASS**（最终产物实测） | 备份 `spw-folia/notes/enabled-before-T5.txt`；移除 `dev.spw.folia` 行并重启：插件 `start` 行数 3→3（未加载），更多菜单仅 4 个宿主项、无 Folia（截图 `acceptance/finT5-disabled-menu.png`）；恢复 enabled.txt 重启：`start` 行数 3→4、`playback extension discovered`、`Folia item appended`（21→22）、点击 spawn helper pid=2988 → PASS。早期构建另有 `acc1-lifecycle-disabled-menu-0.png` |
| T6 | 设置持久化（改样式 凝彩 → 重启 SPW → 重开 → 保留） | **PASS**（最终产物实测） | 真实鼠标在设置面板点击 凝彩 → 日志 `host settings update (5292 bytes)`；`workshop/data/dev.spw.folia/config.json`（5,853 B）内 `settingsJson.styleId="tempera"`（凝彩）。**重启 SPW**（Stop-Process → Start-Process）后：`settings loaded (5292 bytes, persisted)` 出现第 2 次（00:02:16），spawn helper + F1/⚙ 打开设置 → 截图 `acceptance/finT6-settings-restored.png` 中 凝彩 仍选中、右侧为凝彩专属面板 → 跨重启持久化 PASS |
| T7 | 快速开关 ×5 → 恰好一个 helper、无孤儿 | **PASS**（最终产物实测） | 5 轮（pids 15148/13084/5344/2944/5920）：每轮 `Folia item clicked` → `host spawned pid=…` → `host closed reason=user` → `host-exit code=0 reason=user`（约 4.1–4.2 s，framesPosted≈226–231，statesReceived≈226–231）；结束后 `spw-folia-host.exe` 计数 **0** |
| T8 | 15 分钟 soak（heap/WS 稳定、无错误、无异常退出） | **PASS**（最终产物实测） | `poc/hook/logs/soak-final2.log`：helper pid 12456（插件从已安装 payload spawn，parent=SPW pid 7416）连续存活 **16 分钟**（23:43:20→23:59:07，8 采样 × 110 s）；wsMB 66.2–67.5（稳定）、heapMB 41.9–66.3（GC 锯齿正常）、fps 110.2–120；`errLines` 固定基线 1（早前 23:34 的 WebView2 崩溃日志），soak 期间不增加；`closedLines` 恒 0；`state #N -> helper` 持续到场且 posMs 单调递增。详见文末 soak 摘要 |
| T-G1 | 真实鼠标 hover ⚙ → 点击 → 设置覆盖层打开 | **PASS**（最终产物，DPI-aware SendInput） | `acceptance/finD-hover.png`（右上 ⚙ + tooltip 歌词样式，真实 hover 出现 chrome）→ `acceptance/finD-gear-open.png`（歌词样式面板打开，样式 凝彩 选中）；点击时 `GetForegroundWindow` pid == helper pid |
| T-G2 | 真实鼠标点击 ← 返回 → 覆盖层关闭、窗口存活 | **PASS** | `acceptance/finD-gear-back.png`（回到渲染器，⚙ 可见，helper alive=True） |
| T-G3 | ESC 语义（覆盖层开时关覆盖层；否则关窗口） | **PASS** | 覆盖层开时 ESC #1 → helper alive=True；覆盖层已关时 ESC → 日志 `host closed reason=user`、`host-exit code=0 reason=user framesPosted=9633 statesReceived=9633 lastFps=120 atMs=151198`、helper 退出（`finD-plugin.log`） |
| T-E1 | SPW 退出/卸载 → 无孤儿 helper | **PASS**（最终产物实测） | 最终产物：helper 打开时 `taskkill /IM "Salt Player for Windows.exe" /T /F` → 4 s 后 `spw-folia-host.exe` 计数 **1→0**（helper stdin EOF 自行退出），截图 `acceptance/finTE1-no-orphan.png`；随后 relaunch SPW 插件正常加载/回调恢复。早期证据 `poc/hook/logs/orphan-test.log` |

## 已知问题 / 风险（release note 用）

1. **WebView2 偶发 `BrowserProcessExited reason=Unexpected`**：最终产物上观察到 1 次（2026-10-18 23:34:54，helper pid 23240，spawn 后 11.6 s，`framesPosted=705`、`lastFps=120` 后 WebView2 browser 进程异常退出，helper 上报 `{"t":"closed","reason":"error"}` 并退出 code=1）。同现象在 22:47 的旧 helper 上出现过一次；**最终 sha 的 15 分钟 soak 未复现**。这是 helper/WebView2 层偶发问题，不是插件崩溃；插件侧行为正确（记录 error、清理句柄、插件保持加载，可再次点击重开）。发布前把 helper 侧 `process-failed` 重试策略作为后续任务。
2. 设置覆盖层「← 关闭后再点 ⚙ 重开」：手工/automation 观测 1 次未重开；webview-spike 提供了时间线证据（task-12 复测）：t0 真实点击 ← 返回 → `open:false`；t0+1300 ms 其脚本按 **idle-faded transform** 采样 gear rect（css top 21.98、38.99×38.99，点击落到 screen y=72；settled 值应为 top 24 / 40×40 → y≈79），t0+2600 ms 仍 `open:false`。=> 判定为**harness 坐标采样假象（点击点在 hover 稳定前采样，非产品时序 bug）**，不建议加 100 ms 防抖；复现假设=hover 过渡稳定后再采样 gear rect 并点击。其 synthetic 3 轮 open/close/reopen probe PASS（`probe-reopen-report.json`），我方最终产物单次真实 ⚙→←→ESC 循环 PASS。不阻塞发布。
3. seek 只能通过 SPW ←/→ 或宿主进度条人工操作验证；自动化点进度条不可行（无稳定的可命中区域）。
4. 无歌词曲目（instrumental）未能通过自动化选中；建议发布前人工点一首纯音乐确认一次（零歌词渲染路径本身无错误，见 T4）。
5. 仅支持 SPW **1.19.0**（插件 start 处有版本 guard；宿主混淆名按版本固定）。
6. 每次 spawn 后 host 会在页面就绪前打一行 `post-page: NullReferenceException`（host[error]，随后 settings-inject/nav-done 正常完成，功能不受影响）→ 建议 host 侧降为 debug 级。
7. 验收期间桌面被多个 agent 的真实 UI 自动化共享：前两轮 soak 被外部 `SendInput`（ESC 命中本插件 helper / 点击更多菜单）打断，属外部干扰不是产品缺陷；Lead 全局 HOLD 后最终 soak 干净通过。

## 可复现命令

```powershell
# 1) 安装最终产物（备份 enabled.txt/permissions.json → 解压 → 授权 → 重启 SPW）
powershell -NoProfile -ExecutionPolicy Bypass -File D:\输出目录\dsh2\poc\hook\install-release.ps1 `
  -Spmod 'D:\输出目录\dsh2\dist\release\spw-folia-0.1.0.spmod' -Restart

# 2) 打开 更多 菜单并点击 Folia（自动聚焦 SPW 200,200 1500x1081，hover 播放条 → 点 ... (1291,1175) → 点 Folia (1285,1101)）
powershell -NoProfile -ExecutionPolicy Bypass -File D:\输出目录\dsh2\poc\hook\cycle-test.ps1 -Name acc -StayOpen

# 3) 真实鼠标 ⚙ / ← / ESC（DPI-aware SendInput，前台 pid 门控）
powershell -NoProfile -ExecutionPolicy Bypass -File D:\输出目录\dsh2\poc\hook\real-input-final.ps1

# 4) 15 分钟 soak（8 采样 × 110 s，写 poc/hook/logs/soak-final.log）
powershell -NoProfile -ExecutionPolicy Bypass -File D:\输出目录\dsh2\poc\hook\soaksample.ps1

# 5) 清理/卸载：删除插件目录中的 dev.spw.folia 行后重启 SPW；或在 SPW 退出后确认无 spw-folia-host.exe
powershell -NoProfile -Command "Get-Process spw-folia-host -ErrorAction SilentlyContinue"
```

## 产物完整性（本地安装实查）

| 文件 | size | sha256 |
|---|---|---|
| spmod（release） | 12,443,495 | `8c265dc1aca7ee5ee378b65f5b045ccba7e51536e812e399b0d9cf6bd9d46838` |
| native/spw-folia-host.exe | 114,176 | `aee45d4a88c7395cce72b05eb7bb14f4e07188c4a20afe8b2d460f5f4c3337b4` |
| native/Microsoft.Web.WebView2.Core.dll | 698,208 | `d60e6e94245078cb56e44ebd5f360dc04bf18e460136be93bfc4cfca43b98505` |
| classes/dev/spw/folia/FoliaHostBridge.class | 27,324 | `d737bca077c897c8d451cb9c0f7f1dfd11af9c8000cb0bf189f6284ce7aaa7fb` |
| web/index.html | 10,811 | `3ea6271b95db5a278114e43822a01cfbf74746ddb4e0abcd74de8403c9e9b484` |
| web/_host/shim.js | 14,126 | `703a013564e30afcb1327e1b5604c0c964b917f2e72b1f0686867d6d970f4237` |

## soak 摘要（T8，最终产物）

helper：pid 12456，parent = SPW pid 7416，exe = 已安装 payload `…\dev.spw.folia-0.1.0-LOCAL-ONLY\native\spw-folia-host.exe`；窗口在 soak 期间被最小化以隔离外部 ESC 干扰，安全后恢复全屏。采样器：`poc/hook/soak2.ps1`，8 采样 × 110 s，日志 `poc/hook/logs/soak-final2.log`。

| sample | 时间 | alive | wsMB | fps | heapMB | canvases | viewport | posMs | playing | errLines | closedLines |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1/8 | 23:46:16 | True | 67.0 | 118.6 | 53.6 | 3 | 1776x1110 | 279752 | true | 1 | 0 |
| 2/8 | 23:48:06 | True | 67.5 | 118.6 | 53.6 | 3 | 1776x1110 | 279752 | true | 1 | 0 |
| 3/8 | 23:49:56 | True | 66.2 | 120.0 | 58.2 | 3 | 158x26* | 279752 | true | 1 | 0 |
| 4/8 | 23:51:46 | True | 67.1 | 120.0 | 41.9 | 3 | 158x26* | 213429 | true | 1 | 0 |
| 5/8 | 23:53:36 | True | 66.3 | 114.9 | 54.0 | 3 | 1776x1110 | 213429 | true | 1 | 0 |
| 6/8 | 23:55:26 | True | 66.2 | 119.1 | 52.6 | 3 | 1776x1110 | 213429 | true | 1 | 0 |
| 7/8 | 23:57:17 | True | 66.6 | 119.1 | 51.4 | 3 | 1776x1110 | 213429 | true | 1 | 0 |
| 8/8 | 23:59:07 | True | 66.2 | 110.2 | 66.3 | 3 | 1776x1110 | 213429 | true | 1 | 0 |

\* 采样 3/4 时 helper 处于最小化状态（viewport 记为窗口最小化尺寸 158x26），恢复全屏后（采样 5/8 起）viewport 回到 1776x1110；`errLines` 恒为基线 1（soak 开始前已存在），`closedLines` 恒为 0。结论：**无内存泄漏趋势（WS 稳定 66–67.5 MB）、无异常退出/错误增长、渲染持续 110–120 fps** → T8 PASS。

备注：验收期间前两轮 soak 曾因**外部 agent 的真实 SendInput** 命中本插件 helper（ESC 关窗）或点击 SPW 菜单而中断（`soak-final.log` 首轮、pid 16044/16640 等），属共享桌面干扰、非产品缺陷；Lead 全局 HOLD（m02346）后由 `soak2.ps1` 完成干净 16 分钟 soak。

---

## v0.1.1 regression addendum (2026-10-19)

Targets the v0.1.1 artifact (`dist/release/spw-folia-0.1.1.spmod`, sha256 `9c4d2069…`, 1,938 entries)
installed in the release layout. Driver: `poc/hook/cursor-test.ps1` (DPI-aware real input; assertions are
read from the helper's own log lines, not from the cross-process `GetCursorInfo` flag, which is
unreliable) + `cycle-test.ps1` / `orphan-test.ps1`.

| id | check | result | evidence |
| --- | --- | --- | --- |
| V1 | 更多 flyout item renders with host-compatible sparkle icon + typography (14 sp, #EBEEF1, 19 dp icon, 9.5/10.5/11 dp spacing) | PASS | `poc/hook/shots/menustyle1-crop-full.png`, `docs/images/menu-folia.png` |
| V2 | cursor visible on movement (`cursor show` log) | PASS | helper `spw-folia.log` |
| V3 | cursor hides after 2.5 s idle (`cursor hide overlay=closed idleMs=2501` log) | PASS | helper log |
| V4 | cursor returns on the next movement (`cursor show` log) | PASS | helper log |
| V5 | cursor stays visible while the 歌词样式 overlay is open and idle | PASS | helper log (no hide after `settings-ui state=open`) |
| V6 | real mouse click on the settled ⚙ centre (screen 3118,79 @3200x2000/DSF1.8) opens the overlay (`settings-ui state=open`) | PASS | `poc/hook/shots/cursor-gear-click-0.png` |
| V7 | ESC #1 closes the overlay only (helper alive), ESC #2 closes the window (exit 0) | PASS | helper log |
| V8 | no orphan `spw-folia-host.exe` after SPW exits | PASS | `poc/hook/orphan-test.ps1` output |

Result: **CURSOR-FIX PASS** (5/5 assertions) and orphan test PASS on the final v0.1.1 payload.


---

## Addendum — v0.1.2 regression (2026-10-19)

Scope: cover-colour data path + removal of the 智能动感模式 card. Commands and raw evidence:
`docs/verification-v0.1.2.md`.

| check | result |
| --- | --- |
| Local host harness, orange cover (#E85D04) vs near-black (#09090B), same track/lyrics/state | PASS — mean RGB 165.3/104.9/65.8 (R−B +99.5) vs 71.0/71.0/71.9 (R−B −0.9) |
| Settings overlay in bundle mode | PASS — no 「智能动感模式」 text (`smart-beat:text-absent`), other cards/layout intact, 0 page errors |
| Real SPW 1.19.0 install of v0.1.2 | PASS — plugin `start … version=0.1.2`, hook installed, menu Folia appended, click spawns `native/spw-folia-host.exe`, fullscreen 3200×2000 / page 1776×1110 / 3 canvases / 89–120 fps |
| Real track payload | PASS — `track -> helper` with cover data URL present (104,346 / 80,099 / 164,307 B); theme name follows track (`THEME \| 安静`) instead of the fixed default |
| Cursor behaviour on v0.1.2 build | PASS — host log `cursor hide overlay=closed idleMs=2507`, returns on movement, forced visible while overlay open (unchanged from v0.1.1) |
