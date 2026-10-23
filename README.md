# SPW-Folia（个人补充）

> **原项目**：[azkbzxf/spw-folia](https://github.com/azkbzxf/spw-folia) —— 插件本体、Folia 渲染器、
> 设置 UI、协议与全部文档都来自原作者 azkbzxf 的工作。
>
> 本仓库是**个人补充分支**，只用于在向原项目提交 PR 前验证下面这几项改动，不是独立发行版。

## 这次补充的内容

- **多屏跟随** —— Folia 全屏窗口开在椒盐音乐所在的显示器上，不再固定落在系统主屏；
  SPW 主窗口在副屏时也能直接对上。
- **Alt 拖动换屏** —— 在全屏歌词页按住 **Alt + 左键拖动**，把窗口拖到另一块屏幕，
  松手后自动铺满落点显示器；跨不同 DPI 的屏幕也能正确吸附。
- **可配置快捷键** —— 默认 **Ctrl+Alt+F** 呼出 / 关闭歌词界面，不必每次进「更多」二级菜单；
  键位可以在椒盐音乐的「快捷键设置」里修改，也可以在那里设为全局快捷键。

## 测试构建

仓库自带 `build-test` 工作流（Windows + JDK 25 + Node 24），会编译插件与原生宿主，并把新产物
换入官方 0.3.1 的 `.spmod`，产出 `spw-folia-0.3.2-test.spmod`：

1. Actions → **build-test** → 最近一次运行 → **Artifacts**；
2. 下载 `spw-folia-0.3.2-test`，解压得到 `.spmod`；
3. SPW → 设置 → 插件 / 创意工坊 → 导入插件（需要授予 `class-transform` 与 `key-bindings` 权限）。

Folia 的 web 渲染包与设置 UI 直接复用官方发行包，本分支没有改动它们。

## 改动范围（相对上游 `main`）

| 文件 | 改动 |
| --- | --- |
| `poc/webview/host/MonitorSupport.cs` | 新增：按父进程窗口解析 SPW 所在显示器 |
| `poc/webview/host/HostForm.cs` | 全屏几何改用该显示器；接入 Alt 拖动与松手吸附；拖动中跳过 DPI 重定位 |
| `poc/webview/host/Shim.js` | 新增 `windowDrag` 消息（Alt + 左键，设置页打开时不触发） |
| `spw-folia/.../FoliaPlugin.kt` | 注册 `toggle-folia-visualizer` 快捷键（默认 Ctrl+Alt+F，可配置全局） |
| `spw-folia/build.gradle.kts` | 声明 `KEY_BINDINGS` 权限；版本号支持 `-PspwFoliaVersion` 覆盖 |
| `.github/workflows/build-test.yml` | 新增测试构建流水线（只供本人验证） |

## 许可

沿用原项目的 **AGPL-3.0-or-later**，并保留 Folia / Salt Player / WebView2 的全部上游许可与致谢。
原项目文档、构建说明与截图请见 [azkbzxf/spw-folia](https://github.com/azkbzxf/spw-folia)。
