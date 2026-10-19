# spw-folia — Salt Player for Windows 的 Folia 歌词可视化插件

把 [Folia](https://github.com/chthollyphile/folia-major) 的歌词可视化系统以创意工坊插件形式带进
**Salt Player for Windows（SPW）**：迷你播放器「更多」菜单里的 `Folia` 条目会打开无边框全屏 Folia
模式，直接运行 Folia **自己的**渲染代码（全部 14 种歌词样式），并由 SPW 正在播放的音乐驱动。

> 与 Folia、Salt Player 均无隶属关系。Folia 采用 AGPL-3.0 许可；本插件是其衍生作品，同样以
> AGPL-3.0 发布（见 [LICENSE](LICENSE) 与 [docs/licensing.md](docs/licensing.md)）。

**中文** | [English](README.en.md)

![SPW 迷你播放器「更多」菜单中的 Folia 条目](docs/images/menu-folia.png)

![Folia 全屏模式与注入的 Folia 设置页面](docs/images/settings-ui.jpg)

<p align="center"><img src="docs/images/fullscreen-chrome.jpg" width="88%" alt="Folia 全屏可视化器与右上角 ⚙ 设置按钮"></p>

## 功能

- **模组管理作者名**：`azkbzxf`（GitHub 账号，v0.1.3 起）。
- **直接运行真正的 Folia，而非移植** — 插件在 WebView2 中承载 Folia 0.7.21 的生产级
  OBS 浏览器源产物；每种样式都是 Folia 原始代码，因此动态、辉光、逐字时间轴、背景与转场都与
  Folia 像素级一致。
- **全部 14 种歌词样式**：商籁 (sonnet) · 凝彩 (tempera) · 绘光 (lumiere) · 流光 (classic) ·
  心象 (cadenza) · 云阶 (partita) · 浮名 (fume) · 倾诉 (tilt) · 回环 (claddagh) · 莫奈 (monet) ·
  时计 (pendolo) · 群唱 (cappella) · 镜台 (diorama) · 静止 (still)。
- **Folia 设置页 1:1 还原** —「歌词样式」窗口（歌词动画 / 背景 / 字体 / 字幕 四个标签页、
  14 样式实时网格、默认 重置、纹理分辨率、镜头运动强度、文字动势、各样式专属调节项），
  复用 Folia 自己的 React 组件。
- **封面取色** — 主题、背景与强调色由当前歌曲封面派生（v0.1.2 修复），随封面切换实时变化。
- **与 SPW 播放同步** — 歌曲、封面、逐字歌词时间轴、翻译字幕、播放/暂停/跳转/倍速，来自
  SPW 播放 API 加一条平滑插值时间轴。
- **音频响应** — 在原生辅助进程内完成 WASAPI 系统回环采集，输出与 Folia 兼容的 1024-bin 频谱和
  5 段 gamma 映射电平（power/bass/lowMid/mid/vocal/treble）。
- **无 HTTP 服务、无网络** — 辅助进程把本地 bundle 映射到虚拟 https 主机，一个极小的注入 shim
  通过 stdin/stdout 直接把数据喂给 Folia 的 EventSource 协议。
- **AGPL-3.0 完整源码** — 插件（Kotlin）、辅助进程（C#）、设置 UI（React/TS）与打包脚本
  全部在本仓库中。

### v1 限制

- **智能动感的节拍特效未包含在 v1**：Folia OBS 接口不暴露节拍事件，而 Folia 的
  节拍模型（`beat_this` / `htdemucs`，约 133 MB）运行在 Folia 的 Electron 主进程里，不在其 web
  bundle 中。关闭智能动感时（Folia 的默认值），所有样式的渲染与 Folia 完全一致。
  **v0.1.2 / v0.1.3 起设置页陆续移除了所有无法生效的开关与选项**（智能动感、动感效果、罗马音/
  和声字幕、自定义字体、自定义背景、素材上传等）；保留的控件均会产生实际效果。清单见
  [docs/known-inert-settings.md](docs/known-inert-settings.md)。
- **仅支持 Windows**（辅助进程依赖 WebView2 + Windows WASAPI）。
- **锁定 Salt Player for Windows 1.19.0** — 菜单 hook 针对该宿主版本（SPW 内部名称随版本混淆
  变化），在其他版本上插件会拒绝安装 hook。见 [docs/hook-target.md](docs/hook-target.md)。
- 不写入音乐库；插件只读取播放状态与当前歌曲/歌词/封面。

## v0.1.3 更新内容

- **模组管理作者名改为 GitHub 账号** — 插件清单 `Plugin-Provider` 由 `dsh2 team` 改为 **`azkbzxf`**，
  SPW「模组管理」的作者列随之更新。
- **删除全部「有开关但无法生效」的设置** — 继 v0.1.2 移除「智能动感模式」后，v0.1.3 按
  [docs/known-inert-settings.md](docs/known-inert-settings.md) 移除了：动感效果（推镜裂光/涟漪）、
  自定义字体/系统字体、罗马音与和声字幕、自定义/URL 背景，以及凝彩图层图片、莫奈人像、群唱头像/
  表情包等上传类控件（构建期从设置页剥离，不改 Folia 源码）。设置页现在只显示真正生效的控件。
- **修复字体/字幕类设置无效** — 字体族（无衬线/衬线/等宽）与字重现在写入 `theme.fontStyle` /
  `theme.fontWeight`；字幕字体跟随歌词或独立设置都会映射到 `subtitleTheme`；字幕内容模式归一化为
  「翻译」。旧持久化值自动归一化。
- 验证见 [docs/verification-v0.1.3.md](docs/verification-v0.1.3.md)。

![模组管理中的 spw-folia 0.1.3：作者 azkbzxf](docs/images/mod-manager.jpg)

## v0.1.2 更新内容

- **修复封面取色** — 插件发送的封面字段是 `coverDataUrl`，设置页却只读 `coverUrl`，导致主题始终
  停留在默认深色。现在宿主同时发送两种拼写、页面侧回退到 `coverDataUrl`，全屏主题/背景/强调色
  随当前封面变化（橙色封面 → 暖色主题；近黑封面 → 中性深色，见
  [docs/images/cover-color.jpg](docs/images/cover-color.jpg) 与
  [docs/verification-v0.1.2.md](docs/verification-v0.1.2.md)）。
- **移除「智能动感模式」开关** — 构建期从设置页剥离该卡片（不影响其它卡片），因为节拍模型不在
  web bundle 中、开关不会有任何效果。
- **整理失效开关清单** — 见 [docs/known-inert-settings.md](docs/known-inert-settings.md)。

## v0.1.1 更新内容

- **更多菜单条目与宿主原生项风格一致** — 与 播放速度 / 桌面歌词 / 歌词翻译 / 释放音频引擎
  相同的行布局：19 dp 星芒图标（使用宿主内容色）、14 sp 文字、相同间距与禁用透明度。
- **修复光标自动隐藏** — 全屏模式中鼠标静止 2.5 秒后隐藏、移动即恢复，歌词样式面板打开期间强制
  显示。（v0.1.0 会永久隐藏光标，导致右上角 ⚙ 无法点击。）
- **设置面板稳定性** — 修复页面↔宿主 UI 状态回环，该问题会导致面板空白/闪烁；现在滚动正确、秒开。

## 端到端验证

发布产物已在 Windows 11 上的真实 Salt Player for Windows 1.19.0（MS 渠道）中验证：

| 检查项 | 证据 |
| --- | --- |
| 迷你播放器「更多」浮层出现 **Folia** 条目，点击后打开全屏渲染器 | [docs/plugin-integration.md](docs/plugin-integration.md) §1, `poc/hook/shots/task7-*` |
| 全屏 3200x2000 @175% DPI，页面 1776x1110 dpr1，3 个 canvas，110-120 fps；16 分钟长稳测试稳定（66-67.5 MB 工作集） | [docs/acceptance-report.md](docs/acceptance-report.md) T8 |
| 播放进度 + 逐字歌词随 SPW 播放推进（100 ms 插值时间轴）；暂停/继续与跳转跟随 | [docs/plugin-integration.md](docs/plugin-integration.md) §1, [docs/acceptance-report.md](docs/acceptance-report.md) T1-T3 |
| 真实鼠标输入：悬停 ⚙ 打开「歌词样式」浮层，← 返回渲染器，ESC 关闭（exit 0） | [docs/acceptance-report.md](docs/acceptance-report.md) T-G1..G3 |
| **更多** 菜单中的 Folia 条目与宿主字体/星芒图标一致（v0.1.1）；**封面取色**随歌曲封面派生主题（v0.1.2，橙/黑纯色封面平均 RGB 165/105/66 vs 71/71/72） | [docs/images/menu-folia.png](docs/images/menu-folia.png), [docs/images/cover-color.jpg](docs/images/cover-color.jpg), [docs/verification-v0.1.2.md](docs/verification-v0.1.2.md) |
| 设置/样式在 SPW 重启后保留；禁用插件后恢复 4 项菜单；5 次开/关与杀掉 SPW 后无残留辅助进程 | [docs/acceptance-report.md](docs/acceptance-report.md) T5-T7, T-E1 |
| v0.1.3：模组管理作者名 = `azkbzxf`；A/B 组失效控件全部移除；字体族/字重/字幕字体在 `pushConfig` 中生效 | [docs/verification-v0.1.3.md](docs/verification-v0.1.3.md) |
| 发布产物中全部 14 种样式均可渲染（15/15 扫描，0 页面错误，0 外部网络请求）；在干净目录解包的 RC 产物通过 19/19 布局/协议检查 | [docs/release-candidate.md](docs/release-candidate.md) |
| 完整验收矩阵（切歌 / 跳转 / 暂停 / 无歌词 / 生命周期 / 持久化 / 长稳） | [docs/acceptance-run.md](docs/acceptance-run.md), [docs/acceptance-report.md](docs/acceptance-report.md) |

<p align="center"><img src="docs/images/style-grid.png" width="82%" alt="设置窗口中的全部 14 种 Folia 歌词样式"></p>

## 安装

要求：Windows 10/11 x64、**Salt Player for Windows 1.19.0**、WebView2 Runtime（Windows 11 已内置；
Windows 10 需安装 “Microsoft Edge WebView2 Runtime”）。

1. 从 [Releases](https://github.com/azkbzxf/spw-folia/releases) 页面下载 `spw-folia-0.1.3.spmod`（Windows x64）。
2. 在 SPW 中：**设置 → 插件 / 创意工坊 → 导入插件**，选择该 `.spmod`，启用它，并在询问时授予
   **class-transform**（「钩子」）权限（更多菜单 hook 需要）。
3. 若插件管理器提示需要，重启 SPW。
4. 播放歌曲，打开迷你播放器的 **更多**（…）菜单 → **Folia**。

首次运行会打开 Folia 设置窗口；之后会直接打开可视化器（右上角 ⚙ 打开设置；ESC 先关设置、再关窗口）。
设置保存在 SPW 的插件数据目录中。

## 从源码构建

工具链：JDK 25、Gradle 9.8（含 wrapper）、Kotlin 2.4.20、Node 24 + pnpm（设置 UI）、
Windows 自带 `csc.exe`（.NET Framework 4.8，用于原生辅助进程）。无需 .NET SDK，无需 Android SDK。

```bat
:: 1) 插件（Kotlin，官方 SPW 创意工坊 Gradle 插件）
cd spw-folia
gradlew.bat plugin          :: -> build/libs/plugin-dev.spw.folia-0.1.3.spmod

:: 2) 原生辅助进程（C# + WebView2）
cd ..\poc\webview\host
bash build.sh               :: -> build/spw-folia-host.exe (+ WebView2 dlls)

:: 3) 设置 UI（React）
cd ..\..\settings-ui
pnpm install && pnpm build  :: -> dist/settings-ui.js

:: 4) 组装可分发 .spmod（插件 classes + 暂存 web bundle + 原生进程 + 许可证）
bash packaging/build-package.sh     :: 暂存 packaging/{web,native,licenses} + SHA256SUMS
python packaging/tools/assemble-release.py ^
    --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.3.spmod ^
    --staging packaging --out dist --name spw-folia-0.1.3.spmod
::    完整脚本化组装与本地安装测试流程见 docs/release.md。
```

项目结构：

```
spw-folia/       Kotlin 插件（hook、播放桥接、时间轴、配置、辅助进程管理）
poc/webview/     原生辅助进程源码（C# WinForms + WebView2）与开发服务器/驱动
poc/settings-ui/ Folia 设置窗口（复用 Folia 组件的 React island）
poc/audio/       WASAPI 回环分析器（C#）+ 时间轴说明
packaging/       暂存的 web bundle + 原生 payload + 许可证 + 发布文档
docs/            架构、协议、宿主程序、hook 目标、Folia 规格、许可
research/        Folia 样式/设置调研笔记（AGPL；参考素材不提交到仓库）
```

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

详见：[docs/architecture.md](docs/architecture.md) · 通信协议：
[docs/protocol.md](docs/protocol.md) · 原生宿主：[docs/host-app.md](docs/host-app.md) ·
Folia 规格：[docs/folia-spec/](docs/folia-spec/) · 许可：[docs/licensing.md](docs/licensing.md)。

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
