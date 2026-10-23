# spw-folia v0.3.1 — 兼容 SPW 1.19.0 以上（宿主类名运行时解析）

v0.3.1 是**兼容性**更新，功能与 v0.3.0 完全一致：不再把宿主混淆类名写死在代码里，因此
**SPW 1.19.1 / 1.19.2 等补丁版也能直接用**，无需等插件再发一版来适配。

## 为什么需要这一版

SPW 每次发版都会重新跑 R8，插件要挂的类和方法**每次都会被改名**：

| 宿主编译 | 菜单文件门面 | MenuFlyoutScope | PopupState |
| --- | --- | --- | --- |
| 1.19.0（商店 / dev23） | `androidx.compose.ui.ē` | `androidx.compose.ui.ন` | `androidx.compose.ui.Ⴈ` |
| 1.19.2（Steam） | `androidx.compose.ui.घ` | `androidx.compose.ui.Ը` | `androidx.compose.ui.ะ` |

v0.3.0 之前这些名字是**常量**，并且 `start()` 里有一道 `spwVersion != "1.19.0"` 的硬门禁。
结果是 1.19.2 上插件照常加载、播放回调照常走，但日志只有一行
`unsupported SPW version 1.19.2; hook not installed`，**更多菜单里不出现 Folia**。

## 更新内容

- **宿主目标运行时解析**（新增 `HostTargets.kt`）—— 分三层，逐层校验：
  1. `host-targets.json` 缓存（按 `spwVersion` 键，写 `false` 不写失败结果）；
  2. 内置映射表（1.19.2 / 1.19.0）；
  3. **结构扫描**：读 `java.class.path` 的宿主 jar，按
     `(Track, PiscesMediaItem, <PopupState>, Navigator, State, <MenuFlyoutScope>)` 这个唯一签名
     认方法（其中 Track / PiscesMediaItem / Navigator / State 未被混淆），再用「接口 + 静态
     `(self, Function0, Function2)` 桥」认出 scope，剩下那个 `androidx.compose.ui.*` 就是
     PopupState。
  - 每层结果都用反射**验证**（方法签名、scope 桥、`dismiss()`、调色板 getter）后才采用，
    旧名字不会因为"看着像"被误用；
  - 未知版本在**后台线程**扫描（约 0.5–2 s，宿主启动不被卡住），结果写入缓存，之后每次启动
    都走缓存；
  - 扫描按类文件里解析出来的真实 `this_class` 认类——这个 jar 的 **zip 条目名不可信**
    （`androidx/compose/ui/Ϡ.class` 里装的是 `…/ϡ`）。
- **版本门禁改为语义版本比较** —— `>= 1.19.0` 才注入；低于 1.19.0 仍明确拒绝并记日志
  （`unsupported SPW version x.y.z (need >= 1.19.0)`），不再是"只认 1.19.0 这一个字符串"。
- **主题色同样改为解析** —— 菜单项文字/图标色仍取宿主调色板
  `ʰ.Ԩ(composer).Ԩ()`，但访问类名不再硬编码；解析失败才回退到固定浅色。
- **flyout 去重改为按字段类型发现** —— 不再依赖 `MenuFlyoutScope` 实现里的字段名 `Ϳ`，
  改为找实现类里第一个 `List` 字段；找不到就退化为按 scope 实例去重。
- **handshake 上报真实宿主版本** —— `hello` 行里的 `spwVersion` 以前恒为常量 `1.19.0`，
  现在上报 `pluginContext.spwVersion`（`1.19.2` 等）。

播放控制（`FoliaPlaybackControls`）**未改动**：`PlaybackQueueState` 的字段顺序与
`com.xuncorp.spc.core.queue.Ϳ` 在 1.19.2 上未变，`playback controls ready` 照常解析。

## 验证

- **真实 SPW 1.19.2（Steam 渠道，`-Djpackage.app-version=1.19.2`）**：
  - `host menu profile:1.19.2: androidx.compose.ui.घ.Ϳ(Track, PiscesMediaItem, ะ, Navigator, State, Ը)`
  - `hookMethod installed: … (profile:1.19.2)`；重启后走缓存 `host menu cache: …`
  - `Folia item appended (scope=androidx.compose.ui.ʎ$Ϳ, bridge=Ϳ)` —— 菜单项成功进 flyout
  - `playback controls ready: … controller=com.xuncorp.voxzen.service.PlaybackController …`
  - 打开 Folia 全屏：`host fps` 120、`state #100 -> helper` 连续、`host-exit code=0` 干净退出
  - `spw-folia.log` 无 hook 相关失败；唯一 error 是既有的
    `ServiceWorker registration … Failed to access storage`（离线 bundle 无 SW，v0.3.0 相同）
- **真实 SPW 1.19.0**：内置映射表即 v0.3.0 的已验证目标，回退路径不变。
- **构建**：`gradle plugin`（JDK 25 toolchain，Kotlin 2.4.20，workshop API `0.1.0-dev23`）
  BUILD SUCCESSFUL，`.spmod` 中 `classes/` 更新，`web/` `native/` `licenses/` 与 v0.3.0 逐字节相同。

## 安装 / 升级

1. 关闭 Salt Player for Windows。
2. mod 管理器里删除旧版 `spw-folia`，导入 `spw-folia-0.3.1.spmod`。
3. 授予 `class-transform` 与 `library-read`。
4. 重启 SPW，`更多 → Folia`。

可直接覆盖升级 v0.3.0（协议、设置格式、web bundle 均未变）。

## 已知限制

- 未知的新宿主版本依赖结构扫描，首次启动会多花 0.5–2 s（后台进行，结果缓存）。若上游把
  菜单构建方式整体重写（例如不再用 `PopupState` + `MenuFlyoutScope`），扫描会失败并记
  `could not locate the 更多 flyout`，需要重新适配。
- 其余限制与 v0.3.0 相同：色键透明（`rgb(255,0,255)`）、仅主屏全屏、`monet` 与浅色主题下的
  `lumiere` 在透明下不可用、WebView2 进程偶发退出暂无自动重试。
