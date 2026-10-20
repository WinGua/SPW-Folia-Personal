# spw-folia v0.1.7 — 播放页透明背景

这一版给全屏播放页加上「播放页透明背景」：打开后宿主窗口变成真正的透明窗口，Folia 不再绘制背景，
歌词与特效直接叠加在桌面或其它窗口之上，适合 OBS / 直播叠加。开关的位置与 SPW 播放页自己的
「播放页透明背景」一致——进入全屏页后点**右下角的金色「调音台」圆钮**，面板里就是这一行开关。

参考图（用户提供）：SPW 播放页「控制」面板里的「播放页透明背景」行；Folia 全屏页右下角的圆形控制按钮。
本版按图实现：圆钮位置、面板行布局、开关外观都与参考一致，透明效果见 README 顶部截图。

## 更新内容

- **播放页透明背景** — 右下角金色圆钮（`SlidersHorizontal` 图标）弹出面板，内含「播放页透明背景」开关，
  下方是 Folia 原文提示「透明窗口模式，适合 OBS 浏览器源或抠像叠加。」打开后：
  - 宿主窗口用色键（`TransparencyKey` + `WebView2.DefaultBackgroundColor = Transparent`）变成真透明窗口；
  - 页面侧 `background.transparent = true`，Folia 的背景渲染器直接不绘制，文档底色本来就是透明的；
  - 因此看到的是**真的透到桌面**，而不是黑底。
- **透明时的逃生通道**（重要）— 色键窗口是鼠标穿透的，透明开启后页面内按钮点不到，这是叠加用途的预期行为。
  所以透明开启时左下角会出现一个不抢焦点的常驻浮标「恢复不透明背景 · Ctrl+Alt+B」：
  - 点浮标，或按 **Ctrl+Alt+B**（备用 Ctrl+Alt+Y / Ctrl+Alt+P / Ctrl+Alt+Shift+B）即可恢复不透明；
  - 恢复后页面开关会通过注入钩子同步回「关」，并随设置树持久化；
  - 顺手修掉了「退出透明后立刻再打开开关无效」的状态不同步问题；
  - ESC 仍可退出播放。
- **透明时 chrome 不消失** — 色键合成会丢弃 `backdrop-filter` 图层，导致齿轮/圆钮/面板在屏幕上整块看不见；
  透明开启时 chrome 常驻并自动切到无模糊的 flat 样式，恢复不透明后毛玻璃效果回来。
- **零插件改动** — 新字段 `transparentPlayerBackground` 走现有设置树（插件把整棵树原样持久化），
  宿主自己从 settings JSON 读该字段并切换窗口，重启后保持上次状态；`--no-transparency` 供诊断时强制关闭。

机制与限制见 [live-transparency.md](../live-transparency.md)，验证见 [verification-v0.1.7.md](verification-v0.1.7.md)。

## 验证

- 最小探针证明色键方案可行（`repro/transparency-probe.cs`：桌面窗口完整透出）。
- 真实 host：点开关 → `transparency mode=on`、桌面透出；点浮标/按热键 → `transparency exit source=badge|hotkey`
  → `mode=off`，页面开关同步为 off；stdin 推持久化设置 → 启动/运行中即透明；ESC 正常关窗。
- `tmp-inspect/verify-transparent13.py` 自动化 **9/9 PASS**（浮标显隐、点浮标恢复、热键恢复、页面开关同步、
  恢复后再次开启、透明时 chrome 可见）。
- 透明时页面表面（`CapturePreviewAsync`）与屏幕截图对照，排除了「页面没渲染」的误判。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.7.spmod` | 12,970,892 B（12.37 MB，1941 entries） | `5cf8eba69c9d1bb961efd160075c29b9cde52e5b30699598e5ec174106dd5138` |
| `spw-folia-0.1.7.spmod.json` | 488 B | `44cc030c6716395a41e7995ed912e863aa31231711ff782270c48f373b20261b` |
| `SHA256SUMS.txt` | 88 B | `346b526b38f77e20afc5b3ed9374423454fd4ff2b9355ffc0672fa11b76c12bb` |

产物内 `native/spw-folia-host.exe`：123,392 B，sha256
`248e1b021ddf594491b128c018151c07765b689ecc5a081054380dc55330ca2b`；
`web/settings/settings-ui.js` 1,066,766 B（含浮标提示文案）；Folia OBS bundle 仍为 0.7.21，licenses 原样随包。

## 安装 / 升级

1. 关闭 Salt Player for Windows。
2. 打开 `%APPDATA%\Salt Player for Windows\workshop\plugins\`，删除旧目录 `spw-folia-0.1.6`（或对应旧版本目录）。
3. 把下载的 `spw-folia-0.1.7.spmod` 通过「设置 → 插件 → 导入」载入，并授予 `class-transform` 与 `library-read` 权限。
4. 重启 Salt Player for Windows，右上「更多 → Folia」打开全屏页；右下角金色圆钮里就是新设置。

## 已知限制

- 透明模式是鼠标穿透的：透明开启后页面内控件点不到，请用左下角浮标或 Ctrl+Alt+B 恢复不透明。
- 透明是「透到桌面/其它窗口」，不是 OBS 浏览器的 alpha 源；OBS 场景请直接用 Folia 的浏览器源或窗口捕获。
- 透明开启时 chrome 使用 flat（无模糊）样式；键色为纯洋红，理论上页面若画出该纯色会被挖空（当前主题不会）。
- 仅主屏全屏（与之前版本一致），多屏选择未实现。
