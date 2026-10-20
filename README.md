# spw-folia — Salt Player for Windows 的 Folia 歌词可视化插件

把 [Folia](https://github.com/chthollyphile/folia-major) 的歌词可视化系统带进 **Salt Player for
Windows（SPW）**：迷你播放器「更多」菜单里的 `Folia` 条目打开无边框全屏模式，直接运行 Folia
**自己的**渲染代码（全部 14 种歌词样式），由 SPW 正在播放的音乐驱动。

[![Release](https://img.shields.io/github/v/release/azkbzxf/spw-folia)](https://github.com/azkbzxf/spw-folia/releases)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-lightgrey)](#安装)

**中文** | [English](README.en.md)

<p align="center"><img src="docs/images/style-lumiere.jpg" width="92%" alt="绘光（lumiere）样式：金色星尘与发光歌词"></p>

## 亮点

- **跑的是真 Folia，不是仿制** —— 插件内嵌 Folia 0.7.21 的生产级 OBS 浏览器源产物，14 种样式
  全部是 Folia 原始代码：动态、辉光、逐字时间轴、背景与转场都与 Folia 像素级一致。
- **14 种样式，随手切换** —— 商籁 · 凝彩 · 绘光 · 流光 · 心象 · 云阶 · 浮名 · 倾诉 · 回环 · 莫奈 ·
  时计 · 群唱 · 镜台 · 静止。
- **设置页与 Folia 1:1** ——「歌词样式」窗口复用 Folia 自己的 React 组件；左侧大预览就是同源
  iframe 里逐帧运行的真实渲染器，拖动任何滑块立刻看到结果。
- **桌面透明叠加** —— 全屏页右下角的圆钮面板可开关「播放页透明背景」：窗口变成真正的透明窗口，
  只留歌词与特效叠在桌面或其它窗口之上，适合直播 / OBS 叠加；第二行「鼠标穿透」让你一边放歌词
  一边照常操作电脑，**Ctrl+Alt+B** 随时恢复不透明。
- **封面取色** —— 主题、背景与强调色由当前歌曲封面派生，切歌即变。
- **与播放器完全同步** —— 逐字歌词、翻译字幕、播放 / 暂停 / 跳转 / 倍速；另有 WASAPI 环回音频
  分析，让画面跟着音乐起伏。
- **不联网、不上传** —— 没有 HTTP 服务、没有外部请求，数据只在插件与本地辅助进程之间经
  stdin/stdout 传递。

## 截图

<p align="center">
  <img src="docs/images/fullscreen-chrome.jpg" width="49%" alt="全屏播放页，右上角 ⚙ 打开设置">
  <img src="docs/images/settings-ui.jpg" width="49%" alt="Folia 设置页：左侧是真实渲染器大预览">
</p>
<p align="center">
  <img src="docs/images/transparent-background.jpg" width="49%" alt="播放页透明背景：歌词直接叠加在桌面上">
  <img src="docs/images/style-grid.png" width="49%" alt="14 种歌词样式一览">
</p>
<div align="center"><sub>全屏播放页 · Folia 设置页 · 播放页透明背景 · 14 种歌词样式</sub></div>

## 安装

**要求**：Windows 10/11 x64 · **Salt Player for Windows 1.19.0** · WebView2 Runtime（Windows 11
内置，Windows 10 需安装 “Microsoft Edge WebView2 Runtime”）· .NET Framework 4.8（Windows 10
1903 起内置）。完整依赖矩阵与闪退排查见
[docs/runtime-requirements.md](docs/runtime-requirements.md)。

1. 从 [Releases](https://github.com/azkbzxf/spw-folia/releases) 下载 `spw-folia-0.2.1.spmod`。
2. SPW → **设置 → 插件 / 创意工坊 → 导入插件**，选择该文件并启用；询问时授予 **class-transform**
   （「钩子」）权限——菜单 hook 需要它。
3. 插件管理器提示时重启 SPW。
4. 播放歌曲，打开迷你播放器的 **更多**（…）菜单 → **Folia**。

首次运行会打开 Folia 设置窗口，之后直接进入可视化器（⚙ 打开设置；ESC 先关设置、再关窗口）。
设置保存在 SPW 的插件数据目录中。

<p align="center"><img src="docs/images/menu-folia.png" width="240" alt="SPW「更多」菜单里的 Folia 条目"></p>

## 限制

- **不含智能动感的节拍特效** —— Folia 的 OBS 接口不暴露节拍事件，节拍模型（约 133 MB）跑在
  Folia 的 Electron 主进程里，不在其 web bundle 中。关闭智能动感时（Folia 默认值），所有样式的
  渲染与 Folia 完全一致。设置页已移除所有不会生效的控件，保留项清单见
  [docs/known-inert-settings.md](docs/known-inert-settings.md)。
- **仅支持 Windows** —— 辅助进程依赖 WebView2 + Windows WASAPI。
- **锁定 Salt Player for Windows 1.19.0** —— 菜单 hook 针对该宿主版本，其它版本上插件拒绝安装
  hook（见 [docs/hook-target.md](docs/hook-target.md)）。
- 只读取播放状态与当前歌曲 / 歌词 / 封面，不写入音乐库。

## 版本

当前 **v0.2.1**。每个版本的 `.spmod` 与 SHA-256 校验值都在
[GitHub Releases](https://github.com/azkbzxf/spw-folia/releases)；逐版变更与验收证据归档在
[docs/archive/](docs/archive/)，仓库内不再重复。

发布产物已在 Windows 11 + 真实 SPW 1.19.0 上完成端到端验收：菜单条目 → 全屏渲染、14 种样式
15/15 扫描、0 页面错误、0 外部网络请求、16 分钟长稳、设置持久化、无残留辅助进程。

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

## 文档

[架构](docs/architecture.md) · [通信协议](docs/protocol.md) · [原生宿主](docs/host-app.md) ·
[音频与时间轴](docs/audio-timeline.md) · [设置 UI](docs/settings-ui-impl.md) ·
[透明窗口机制](docs/live-transparency.md) · [Folia 复刻规格](docs/folia-spec/) ·
[打包发布](docs/release.md) · [运行环境与排障](docs/runtime-requirements.md) ·
[许可](docs/licensing.md)

## 致谢

- [Folia](https://github.com/chthollyphile/folia-major)，作者 chthollyphile（AGPL-3.0）——整个
  可视化器、设置 UI 与 web bundle 都来自 Folia 的工作（v0.7.21）。
- [Salt Player for Windows](https://saltplayer.com/) 创意工坊插件 API，作者 Moriafly。
- [spw-island（Dynamic Lyrics Island for SPW）](https://github.com/gaboron/spw-island) ——
  仅作为行为参考（GPL-3.0）；未复制任何代码。
- Microsoft Edge WebView2 SDK、.NET Framework、Kotlin/Compose、React/Vite。

## 许可

AGPL-3.0-or-later。与 Folia、Salt Player 均无隶属关系；本仓库包含 Folia 的衍生作品，分发时希望
它有用，但不提供任何担保。见 [LICENSE](LICENSE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
以及 [docs/licensing.md](docs/licensing.md) 中的源码提供说明。
