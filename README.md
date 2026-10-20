# spw-folia — Salt Player for Windows 的 Folia 歌词可视化插件

把 [Folia](https://github.com/chthollyphile/folia-major) 的歌词可视化系统以创意工坊插件形式带进
**Salt Player for Windows（SPW）**：迷你播放器「更多」菜单里的 `Folia` 条目会打开无边框全屏 Folia
模式，直接运行 Folia **自己的**渲染代码（全部 14 种歌词样式），并由 SPW 正在播放的音乐驱动。

> 与 Folia、Salt Player 均无隶属关系。Folia 采用 AGPL-3.0 许可；本插件是其衍生作品，同样以
> AGPL-3.0 发布（见 [LICENSE](LICENSE) 与 [docs/licensing.md](docs/licensing.md)）。

**中文** | [English](README.en.md)

![SPW 迷你播放器「更多」菜单中的 Folia 条目](docs/images/menu-folia.png)

<p align="center"><img src="docs/images/fullscreen-chrome.jpg" width="88%" alt="Folia 全屏可视化器与右上角 ⚙ 设置按钮"></p>

<p align="center"><img src="docs/images/transparent-background.jpg" width="88%" alt="播放页透明背景：歌词直接叠加在桌面上，右下角为开关面板"></p>

<div align="center"><sub>播放页透明背景：Folia 只画歌词与特效，窗口其余部分是真正的透明区域（右下角为开关面板）。</sub></div>

## 功能

- **直接运行真正的 Folia，而非移植** — 插件在 WebView2 中承载 Folia 0.7.21 的生产级 OBS 浏览器源
  产物；每种样式都是 Folia 原始代码，动态、辉光、逐字时间轴、背景与转场都与 Folia 像素级一致。
- **全部 14 种歌词样式**：商籁 (sonnet) · 凝彩 (tempera) · 绘光 (lumiere) · 流光 (classic) ·
  心象 (cadenza) · 云阶 (partita) · 浮名 (fume) · 倾诉 (tilt) · 回环 (claddagh) · 莫奈 (monet) ·
  时计 (pendolo) · 群唱 (cappella) · 镜台 (diorama) · 静止 (still)。
- **Folia 设置页 1:1 还原** —「歌词样式」窗口（歌词动画 / 背景 / 字体 / 字幕 四个标签页、14 样式
  实时网格、默认 重置、纹理分辨率、镜头运动强度、文字动势、各样式专属调节项），复用 Folia 自己的
  React 组件；左侧大预览就是同源 iframe 里逐帧运行的真实渲染器。
- **播放页透明背景 + 鼠标穿透** — 全屏页右下角圆形按钮面板里可开关「播放页透明背景」：宿主窗口
  变成真正的透明窗口，Folia 停止绘制背景，歌词与特效直接叠加在桌面或其它窗口之上（直播 / OBS 叠加
  场景）。第二行「鼠标穿透（操作桌面）」让点击落向桌面，而圆钮、齿轮与设置页始终可点。开关随设置树
  持久化，**Ctrl+Alt+B**（备用 Ctrl+Alt+Y / Ctrl+Alt+P / Ctrl+Alt+Shift+B）可随时恢复不透明。
  透明窗口是色键合成，14 种样式按兼容级别分为直接支持（11 种）、透明期自动精简（凝彩 / 绘光 / 时计 /
  静止，关闭透明即恢复用户原样）与不兼容（莫奈、浅色主题下的绘光——选中时自动关闭透明并说明原因）。
- **封面取色** — 主题、背景与强调色由当前歌曲封面派生，随封面切换实时变化。
- **与 SPW 播放同步** — 歌曲、封面、逐字歌词时间轴、翻译字幕、播放/暂停/跳转/倍速，来自 SPW 播放
  API 加一条平滑插值时间轴。
- **音频响应** — 原生辅助进程内完成 WASAPI 系统回环采集，输出与 Folia 兼容的 1024-bin 频谱和 5 段
  gamma 映射电平（power/bass/lowMid/mid/vocal/treble）。
- **无 HTTP 服务、无网络** — 辅助进程把本地 bundle 映射到虚拟 https 主机，一个极小的注入 shim 通过
  stdin/stdout 直接把数据喂给 Folia 的 EventSource 协议。
- **AGPL-3.0 完整源码** — 插件（Kotlin）、辅助进程（C#）、设置 UI（React/TS）与打包脚本全部在本仓库中。

### v1 限制

- **智能动感的节拍特效未包含**：Folia OBS 接口不暴露节拍事件，节拍模型（`beat_this` / `htdemucs`，
  约 133 MB）运行在 Folia 的 Electron 主进程里，不在其 web bundle 中。关闭智能动感时（Folia 默认值），
  所有样式的渲染与 Folia 完全一致。设置页已移除所有无法生效的开关与选项（智能动感、动感效果、罗马音 /
  和声字幕、自定义字体、自定义背景、素材上传等），保留的控件均会产生实际效果——清单见
  [docs/known-inert-settings.md](docs/known-inert-settings.md)。
- **仅支持 Windows**（辅助进程依赖 WebView2 + Windows WASAPI）。
- **锁定 Salt Player for Windows 1.19.0** — 菜单 hook 针对该宿主版本（SPW 内部名称随版本混淆变化），
  在其他版本上插件会拒绝安装 hook。见 [docs/hook-target.md](docs/hook-target.md)。
- 不写入音乐库；插件只读取播放状态与当前歌曲/歌词/封面。

## 版本历史

每个版本的可下载产物（`.spmod` + `SHA256SUMS.txt`）在
[GitHub Releases](https://github.com/azkbzxf/spw-folia/releases)。仓库内不再保留逐版发布说明；
需要复盘时见 [docs/archive/](docs/archive/)（历史发布说明、验证报告与验收证据，仅供追溯，无需阅读）。

| 版本 | 概要 |
| --- | --- |
| **v0.2.1** | 浅色主题下「更多」菜单 Folia 条目配色跟随宿主主题；商店（MSIX）渠道 CLR 启动失败修复 |
| v0.2.0 | 透明窗口样式兼容分级（native / tuned / unsupported）；桥重开后旧 stdin 写线程泄漏修复；宿主 stdout 非阻塞有界队列加固；新增 [运行环境与排障](docs/runtime-requirements.md) |
| v0.1.11 * | 修复 stdin 泵跨线程访问 WebView2 导致的必闪退（并可连带 SPW 卡死）；插件写管道阻塞冻结 SPW 修复 |
| v0.1.10 | 修复透明模式下滚轮向下导致辅助进程 `OverflowException` 崩溃；未处理异常写入日志 |
| v0.1.9 | 面板新增「鼠标穿透（操作桌面）」；圆钮/齿轮/面板热区始终可点；移除左下角常驻浮标 |
| v0.1.8 * | 切歌即换词（歌词独立轮询）、封面/主题跟随提速、透明窗口内鼠标可点 |
| v0.1.7 | 播放页透明背景（色键透明窗口 + Ctrl+Alt+B 恢复）；透明时 chrome 无模糊常驻 |
| v0.1.6 | 设置页大预览改为 iframe 内真实 Folia 渲染器（暂停即完全静止） |
| v0.1.5 * | 设置页大预览加肯·伯恩斯漂移，暂停/播放按钮可用（后被 v0.1.6 的真实渲染器取代） |
| v0.1.4 | 修复歌词样式预览不随所选样式变化（交叉淡入 effect 自取消） |
| v0.1.3 | 模组管理作者名改为 `azkbzxf`；移除全部无法生效的设置；修复字体/字幕类设置无效 |
| v0.1.2 | 修复封面取色（`coverDataUrl` / `coverUrl` 不一致）；移除「智能动感模式」开关 |
| v0.1.1 | 「更多」菜单条目与宿主原生项风格一致；光标自动隐藏与设置面板回环修复 |
| v0.1.0 | 首个版本：菜单 hook、全屏 Folia 渲染器、14 种样式、设置页、音频分析 |

`*` 标记的版本只在本地构建过，未发布到 GitHub Releases（其代码已包含在后续版本中）。

发布产物已在 Windows 11 的真实 SPW 1.19.0 上完成端到端验收（菜单条目 → 全屏渲染、14 种样式
15/15 扫描、0 页面错误、0 外部网络请求、16 分钟长稳、设置持久化、无残留辅助进程）。完整矩阵见
[docs/archive/acceptance-report.md](docs/archive/acceptance-report.md)。

<p align="center"><img src="docs/images/style-grid.png" width="82%" alt="设置窗口中的全部 14 种 Folia 歌词样式"></p>

## 安装

要求：Windows 10/11 x64、**Salt Player for Windows 1.19.0**、WebView2 Runtime（Windows 11 已内置；
Windows 10 需安装 “Microsoft Edge WebView2 Runtime”），以及系统自带 **.NET Framework 4.8**
（Windows 10 1903 起内置）。完整依赖矩阵、退出码与闪退排查见
[docs/runtime-requirements.md](docs/runtime-requirements.md)。

1. 从 [Releases](https://github.com/azkbzxf/spw-folia/releases) 下载 `spw-folia-0.2.1.spmod`（Windows x64）。
2. 在 SPW 中：**设置 → 插件 / 创意工坊 → 导入插件**，选择该 `.spmod`，启用它，并在询问时授予
   **class-transform**（「钩子」）权限（更多菜单 hook 需要）。
3. 若插件管理器提示需要，重启 SPW。
4. 播放歌曲，打开迷你播放器的 **更多**（…）菜单 → **Folia**。

首次运行会打开 Folia 设置窗口；之后会直接打开可视化器（右上角 ⚙ 打开设置；ESC 先关设置、再关窗口）。
设置保存在 SPW 的插件数据目录中。

## 从源码构建

工具链：JDK 25、Gradle 9.8（含 wrapper）、Kotlin 2.4.20、Node 24 + pnpm（设置 UI）、Windows 自带
`csc.exe`（.NET Framework 4.8，用于原生辅助进程）。无需 .NET SDK，无需 Android SDK。

```bat
:: 1) 插件（Kotlin，官方 SPW 创意工坊 Gradle 插件）
cd spw-folia
gradlew.bat plugin          :: -> build/libs/plugin-dev.spw.folia-0.2.1.spmod

:: 2) 原生辅助进程（C# + WebView2）
cd ..\poc\webview\host
bash build.sh               :: -> build/spw-folia-host.exe (+ WebView2 dlls)

:: 3) 设置 UI（React）
cd ..\..\settings-ui
pnpm install && pnpm build  :: -> dist/settings-ui.js

:: 4) 组装可分发 .spmod（插件 classes + 暂存 web bundle + 原生进程 + 许可证）
bash packaging/build-package.sh     :: 暂存 packaging/{web,native,licenses} + SHA256SUMS
python packaging/tools/assemble-release.py ^
    --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.2.1.spmod ^
    --staging packaging --out dist/release --name spw-folia-0.2.1.spmod
```

完整的打包流水线、payload 清单、大小预算与发布检查表见 [docs/release.md](docs/release.md)。

## 项目结构

```
spw-folia/       Kotlin 插件（hook、播放桥接、时间轴、配置、辅助进程管理）
poc/webview/     原生辅助进程源码（C# WinForms + WebView2）与开发服务器/驱动
poc/settings-ui/ Folia 设置窗口（复用 Folia 组件的 React island）
poc/audio/       WASAPI 回环分析器（C#）+ 时间轴说明
packaging/       暂存的 web bundle + 原生 payload + 许可证 + 发布文档
docs/            架构、协议、宿主程序、hook 目标、Folia 规格、许可
docs/archive/    历史发布说明、验证报告与验收证据（仅供追溯）
research/        Folia 样式/设置调研笔记（AGPL；参考素材不提交到仓库）
```

文档索引：[docs/architecture.md](docs/architecture.md)（架构）·
[docs/protocol.md](docs/protocol.md)（通信协议）· [docs/host-app.md](docs/host-app.md)（原生宿主）·
[docs/audio-timeline.md](docs/audio-timeline.md)（音频与时间轴）·
[docs/settings-ui-impl.md](docs/settings-ui-impl.md)（设置 UI）·
[docs/live-transparency.md](docs/live-transparency.md)（透明窗口机制）·
[docs/folia-spec/](docs/folia-spec/)（Folia 复刻规格）· [docs/licensing.md](docs/licensing.md)（许可）。

## 架构（简版）

```
SPW (JVM)                                    spw-folia-host.exe (C#/WebView2)
┌──────────────────────────┐  stdin/stdout   ┌───────────────────────────────────┐
│ spw-folia 插件           │  JSON-lines     │ 无边框全屏窗口                    │
│  MenuHook（更多 → Folia）│ ──────────────▶ │  Folia OBS bundle (React)         │
│  PlaybackBridge ────────▶│ state/lyrics/   │  注入的 EventSource shim          │
│  Timeline（平滑进度）    │ track/settings  │  注入的 Folia 设置 UI             │
│  ConfigStore             │ ◀────────────── │  WASAPI 回环 → 音频帧             │
└──────────────────────────┘ ready/closed/…  └───────────────────────────────────┘
```

## 致谢

- [Folia](https://github.com/chthollyphile/folia-major)，作者 chthollyphile（AGPL-3.0）——整个
  可视化器、设置 UI 与 web bundle 都来自 Folia 的工作（v0.7.21）。
- [Salt Player for Windows](https://saltplayer.com/) 创意工坊插件 API，作者 Moriafly。
- [spw-island（Dynamic Lyrics Island for SPW）](https://github.com/gaboron/spw-island) ——
  仅作为行为参考（GPL-3.0）；未复制任何代码。
- Microsoft Edge WebView2 SDK、.NET Framework、Kotlin/Compose、React/Vite。

## 许可

AGPL-3.0-or-later。本仓库包含 Folia 的衍生作品，分发时希望它有用，但不提供任何担保。见
[LICENSE](LICENSE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 以及
[docs/licensing.md](docs/licensing.md) 中的源码提供说明。
