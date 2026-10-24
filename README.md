# SPW-Folia 个人改进版

个人维护的 [spw-folia](https://github.com/azkbzxf/spw-folia) 改进分支，只通过 GitHub Actions 云端构建，滚动发布测试包。上游的文档、宣传站与调研资料不在本仓库重复，直接看上游。

- 上游项目：https://github.com/azkbzxf/spw-folia
- 上游文档：[架构](https://github.com/azkbzxf/spw-folia/blob/main/docs/architecture.md)、[通信协议](https://github.com/azkbzxf/spw-folia/blob/main/docs/protocol.md)、[原生宿主](https://github.com/azkbzxf/spw-folia/blob/main/docs/host-app.md)、[运行环境](https://github.com/azkbzxf/spw-folia/blob/main/docs/runtime-requirements.md)
- 上游发布：https://github.com/azkbzxf/spw-folia/releases
- 许可：AGPL-3.0-or-later（见 [LICENSE](LICENSE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）

## 本分支的改动

### 功能

- **多屏跟随**：全屏歌词窗口打开时落在椒盐音乐主窗口所在的显示器，不再固定系统主屏。
- **Alt + 左键拖动换屏**：按住 Alt 拖动窗口可跨显示器移动，松手自动铺满落点屏幕；拖动期间抑制 DPI 变化导致的回弹。
- **可配置快捷键**：通过椒盐音乐 Workshop 的 `keyBindingManager` 注册「呼出 / 关闭 Folia 歌词」，默认 `Ctrl+Alt+F`，可在「快捷键管理」中改键，并可设为全局；清单中声明了 `key-bindings` 权限。
- **快捷键也能关闭（默认组合）**：窗口获得焦点后，默认 `Ctrl+Alt+F` 会被窗口接管并直接关闭；若你在椒盐音乐里改过快捷键，窗口内请用 `ESC` 关闭。

### 默认值

- **纹理分辨率默认 1.0**（原为 1.5），降低首次启动的渲染压力。

### 构建 / 打包

- 纯云端构建（GitHub Actions，windows-latest）：编译 Kotlin 插件 + C# 辅助进程，组装 `.spmod` 并发布到 `test-latest`。
- 推送 `main` 即触发构建，也可以手动 `workflow_dispatch`。
- 底座固定为官方 0.3.1 包（本仓库 `base-v0.3.1` Release），SHA256 校验后只替换 `classes/` 与 `native/`。
- WebView2 SDK 直接取自底座包内的 dll，保证 exe 与随包程序集版本一致。
- 出包前执行程序集版本校验与宿主启动冒烟测试，拦截「插件注入成功但窗口打不开」这类坏包。

## 使用注意

1. **首次安装后建议重启一次椒盐音乐**：首次加载要初始化 WebView2 配置并编译渲染着色器，会明显卡顿；重启后依赖缓存，恢复流畅。
2. **关闭方式**：设置页内 `ESC` 逐层关闭；播放页 `ESC`、鼠标侧键或 `Ctrl+Alt+F` 关闭窗口。
3. **快捷键可以在椒盐音乐里自定义，用于呼出**；关闭仍请使用 `ESC`（默认 `Ctrl+Alt+F` 在窗口内也能关闭，改成其它组合后窗口内不再识别）。
4. 从旧版本升级不会自动迁移已保存的纹理分辨率：需手动改回 1.0，或在设置页点「默认 / 重置」。

## 下载测试包

- [test-latest](https://github.com/WinGua/SPW-Folia-Personal/releases/tag/test-latest)：每次推送 `main` 自动更新。

## 仓库结构

```
.github/            云端构建 workflow + 组装/校验脚本
spw-folia/          Kotlin 插件源码（Gradle wrapper 自带）
poc/webview/host/   C# + WebView2 辅助进程源码（build.sh 用系统 csc 编译）
poc/webview/shared/ demoData.mjs（build.sh 生成 DefaultConfig.json 用）
packaging/testdata/ 首次运行的默认设置树
```

## 云端构建产物组成

```
base-v0.3.1（官方包：web/ + licenses/ + WebView2 dll）
      + gradlew plugin（classes/）
      + build.sh（native/：exe + .config + dll）
      → dist/spw-folia-0.3.2-test.<run>.spmod
```

## 致谢

- [spw-folia](https://github.com/azkbzxf/spw-folia)，作者 azkbzxf——本仓库的基础。
- [Folia](https://github.com/chthollyphile/folia-major)，作者 chthollyphile（AGPL-3.0）——可视化器、设置 UI 与 web bundle。
- [Salt Player for Windows](https://saltplayer.com/) 创意工坊插件 API，作者 Moriafly。
- [spw-island](https://github.com/gaboron/spw-island)——仅作为行为参考，未复制代码。
- Microsoft Edge WebView2 SDK、.NET Framework、Kotlin/Compose、React/Vite。
