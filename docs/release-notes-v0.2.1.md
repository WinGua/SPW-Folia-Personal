# spw-folia v0.2.1 — 浅色主题菜单项配色 + 商店（MSIX）渠道启动修复

v0.2.1 是一个纯修复版本，两条修复都来自用户可感知的问题：**SPW 浅色主题下「更多」菜单里的 Folia
条目几乎看不见**，以及**Microsoft Store 渠道下点 Folia 弹出「This application could not be
started」**。没有新特性，行为、协议与设置格式均与 v0.2.0 相同。

## 更新内容

- **修复：浅色主题下「更多」菜单的 Folia 条目几乎不可见（PR #4）** — 注入项的文字与图标颜色此前
  硬编码为深色弹窗的采样值 `#EBEEF1`；SPW 换成浅色主题后弹窗底色变浅，浅色文字直接「隐形」。
  宿主自己的菜单项并不写死颜色：`MenuFlyoutItemCompat` 的 `contentColor` 参数**默认值**就是宿主
  主题面板的内容色，随浅/深主题切换。v0.2.1 改为**反射走同一条调用链**：

  ```
  androidx.compose.ui.ʰ.Ԩ(composer)   // 主题子对象（面板）
  androidx.compose.ui.ʹ.Ԩ()           // 内容色（打包 Color = J）
  ```

  面板颜色存在 `MutableState` 里，组合期读取即订阅，**主题切换无需重启即生效**。两个 `Method`
  用 `by lazy` 只解析一次；任一步失败（宿主改版导致混淆名变化）都吞掉 `Throwable` 并回退旧常量
  `#EBEEF1`，不会比修复前更糟。图标与文字共用该颜色，与宿主「图标 tint = 文字色」一致。
- **修复：商店（MSIX）渠道下辅助进程 CLR 激活失败（PR #5）** — 症状是点 Folia 后系统弹
  「`spw-folia-host.exe` - This application could not be started」，插件日志
  `host process exited code=-2146232576`（= `0x80131700` `CLR_E_SHIM_RUNTIMELOAD`），
  `spw-folia-host.stdout.log` 为 0 字节，但**手动双击同一个 exe 却正常**。
  根因：Store 版 SPW 是 MSIX 打包应用，插件目录可能只以**虚拟路径**
  （`%APPDATA%\Salt Player for Windows\...`）对带包身份的进程可见；.NET 加载器（mscoree）用原生
  NT 路径打开 `<exe>.config`，**不走 MSIX 文件系统重定向**，于是 `Config File (Open).
  Result:80070003` → 「Unable to find a version of the runtime to use」→ `0x80131700`。
  现在 spawn 前把 exe / web / settings / cwd 全部解析成物理路径：`physicalFile()` 做
  `toRealPath()` → `canonicalFile` → 绝对路径三级兜底，再叠加
  `%LOCALAPPDATA%\Packages\*\LocalCache\Roaming\...` 映射（仅在路径以 `%APPDATA%` 开头时尝试）。
  另外新增一条告警：`<exe>.config` 不可达时写
  `helper .config not reachable at ...; CLR activation will likely fail with 0x80131700`，
  让这个「stdout/stderr 全空」的故障下次能一眼定位。
- **新增运行时排查文档** — [runtime-requirements.md](runtime-requirements.md) §5 新增此案例
  （退出码、关键字、CLR 启动日志证据、用户侧目录联接绕过方案）。

## 验证

- **字节级复核（宿主 1.19.0 真实产物）** — 宿主类来自
  `...\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll`
  （polyglot jar，`javap -J-Dstdout.encoding=UTF-8 -p -c` 反汇编）。菜单项渲染函数
  `com.xuncorp.voxzen.ui.component.Ԭ`（Blur.kt）的 `long contentColor` 默认值分支
  （字节码 335–362）逐条对应：

  ```
  343: getstatic     androidx/compose/ui/ʰ.Ϳ
  349: invokestatic  androidx/compose/ui/ʰ.Ԩ(Composer): androidx/compose/ui/ʹ
  352: invokevirtual androidx/compose/ui/ʹ.Ԩ(): J
  355: lstore_3
  ```

  同一 long 在 695–718 传给 `ColorFilter.tint`、在 931 传入 `TextStyle`，**语义也确认为菜单内容色**，
  不只是「类存在」。`androidx.compose.runtime.currentComposer` 在宿主 runtime 中确实存在
  （`ComposablesKt.getCurrentComposer(Composer;I)Composer`）。
- **编译** — `./gradlew compileKotlin` / `./gradlew plugin`（JDK 25）均 BUILD SUCCESSFUL；版本号三处
  一致（`build.gradle.kts` `version`/`PluginVersion`、`FoliaPlugin.PLUGIN_VERSION` 均为 `0.2.1`，
  `SPW_VERSION` 仍锁 `1.19.0`）。
- **产物差异** — v0.2.0 → v0.2.1 的 `.spmod` 解包对比：**只有 5 个条目变化**
  （`classes/META-INF/MANIFEST.MF`、`FoliaHostBridge$Companion.class`、`FoliaHostBridge.class`、
  `FoliaMenuItemKt.class`、`FoliaPlugin.class`），其余 1,936 个条目逐字节相同。web / native /
  licenses 未改动。
- **非 Store 渠道零副作用** — `toRealPath()` 后路径不变、`LocalCache/Roaming` 无匹配时直接返回原路径，
  spawn 参数与 v0.2.0 完全一致。
- **打包布局验收** — `node packaging/tools/verify-layout.mjs`：**PASS**，10 项检查全过
  （`exitedZero` / `closedUser` / `bridgePresent` / `settingsInjected` / `settingsAutoOpened` /
  `closeSettingsCommand` / `openSettingsCommand` / `escClosedSettingsOnly` / `visualizerCanvases` /
  `noConsoleErrors`），`consoleErrors=0`，3 个 canvas。
- **真机验收** — 浅色与深色主题下「更多」菜单的 Folia 条目颜色均与宿主前 4 项一致（owner 确认）。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.2.1.spmod` | 13,152,604 B（1941 entries） | `56c0aa4177a1bea8fe0078a9c27ab2dee264f0c85387af0a667086cd39f0e792` |
| `spw-folia-0.2.1.spmod.json` | 488 B | `044d7cb63d17d370d01fb4de6048dffa8a3c7a4039c2394f2472572fa04540aa` |
| `SHA256SUMS.txt` | 88 B | `1d9ffb8371edf88927016eff9200d11299608650d7a8e500b5eb22a8b4164b12` |

包内构成：插件 classes `plugin-dev.spw.folia-0.2.1.spmod`（94,303 B，sha256
`68facfed0fa78b6316e1dc5f4f4b70dccf2ba1ee11d80e9be03af6c2ae412c57`）＋ native 辅助进程
`spw-folia-host.exe` 130,560 B（sha256 `2aa1f6c2284754a59718c5a399f8ee2103444e4f58fb94c539e3fff8ae763ea8`，
与 v0.2.0 相同，本次未改动宿主）＋ 完整 Folia 0.7.21 web bundle 与设置岛（`settings-ui.js` 1,071,968 B，
sha256 `eeb8a128359531fa3f1d68d6ce6db5e808c3128f92c5f933e040ae7bae95ad34`）＋ 许可证。

## 安装 / 升级

1. 关闭 Salt Player for Windows。
2. 打开 mod 管理器，删除旧版 `spw-folia`，导入 `spw-folia-0.2.1.spmod`。
3. 授予 `class-transform` 与 `library-read` 两项权限。
4. 重启 SPW，`更多 → Folia`。

可直接从 v0.2.0 覆盖升级（协议、设置格式、web bundle 均未变）。系统依赖
（WebView2 Runtime / .NET Framework 4.8）见 [runtime-requirements.md](runtime-requirements.md)。

## 已知限制

- **菜单配色依赖宿主混淆名**：`ʰ` / `ʹ` / `Ԩ` 是 SPW 1.19.0 的 R8 混淆名，宿主升级后可能变化。
  这类失败是**安全降级**（回退 `#EBEEF1`，深色主题下正常、浅色主题下仍不可见），不会崩溃；
  `SPW_VERSION` 已锁 1.19.0，不会在别的宿主版本上装载。
- **MSIX 修复是条件性的**：它只在「Roaming 路径对 .NET 加载器不可达」的安装上生效。在
  真实磁盘上 Roaming 目录本来就可访问的机器上（例如开发机，同为 Store 渠道但
  `%APPDATA%\Salt Player for Windows` 真实存在、`LocalCache\Roaming` 下无对应目录树），
  `physicalFile()` 是恒等变换，**属零副作用防御性改动**；该故障的真实触发配置未能在此环境复现，
  故 `0x80131700` 的修复效果依赖受影响用户的回归确认。
- 其余限制与 v0.2.0 相同：色键透明仍为 `rgb(255,0,255)` 方案；仅主屏全屏；`monet` 与浅色主题下的
  `lumiere` 在透明下不可用；WebView2 浏览器进程偶发退出暂无自动重试。
