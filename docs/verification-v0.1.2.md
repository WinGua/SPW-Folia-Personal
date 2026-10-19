# v0.1.2 验证记录：封面取色 + 智能动感开关移除

日期：2026-10-19。对应问题（用户反馈，m02706）：

1. 删除「智能动感模式」的开关；
2. 修复封面取色功能。

本文件记录根因、修复方式和可复现的证据。构建/打包命令见 [release.md](release.md)。

## 1. 封面取色（cover colour extraction）

### 根因

插件在 `track` 消息里发送的是 `coverDataUrl`（FoliaPlaybackExtension 通过 `Library.getCoverById` 取封面并编码为 base64 data URL），
宿主 `spw-folia-host.exe` 的 `HostForm.SendTrackToPage()` 也只把 `coverDataUrl` 转发给页面；
而页面侧（settings UI 的 bridge / publisher）读取的字段是 `coverUrl`（`ObsBrowserSourceConfig.coverUrl`），
于是 `deriveThemeFromCover(coverUrl, title)` 始终拿到 `null`，主题一直停留在 `Midnight Default`。
即：**传送字段名不一致，封面从未到达取色逻辑**。

### 修复

- `poc/webview/host/HostForm.cs` `SendTrackToPage()`：把封面的两种拼写都发出去
  （`coverDataUrl` 原值 + `coverUrl` 镜像），插件与旧页面两端都保持兼容。
- `poc/settings-ui/src/bridge.ts`：`BridgeTrackMessage` 增加 `coverDataUrl`；
  新增 `bridgeTrackCover(track) = track.coverUrl ?? track.coverDataUrl`。
- `poc/settings-ui/src/useConfigPublisher.ts`：`toPublisherTrack()` 使用 `bridgeTrackCover()`，
  封面色变化时会重新执行 `deriveThemeFromCover`。
- 版本号 0.1.1 → 0.1.2（plugin `version` / `PluginVersion` / `PLUGIN_VERSION` 三处一致）。

### 证据（本地宿主 + 合成封面）

用 `poc/hook/verify-cover.mjs` 向宿主发送同一首歌、两张纯色封面（其余输入完全相同），
截取全屏可视化画面并统计右下区域平均颜色（避开歌词）：

| 封面 | 平均 RGB | 暖度 R−B |
| --- | --- | --- |
| `#E85D04`（橙） | (165.3, 104.9, 65.8) | **+99.5** |
| `#09090B`（近黑） | (71.0, 71.0, 71.9) | **−0.9** |

- 并排对比图：[images/cover-color.jpg](images/cover-color.jpg)
- 全屏橙色主题截图（3200×2000 原始渲染）已随验证脚本输出。
- 设置页整体背景也随封面变化（截图见 [images/settings-ui.jpg](images/settings-ui.jpg) 的暖色环境光）。

### 真实 SPW 中的证据

- 安装 v0.1.2 后插件日志：`track -> helper (164307 bytes)`（含 base64 封面；旧版本同样发送，但字段名无人消费）。
- 运行中画面左下角主题名显示为歌曲派生的主题（`THEME | 安静`），而不是固定 `Midnight Default`；
  画面颜色随封面变化，`fps 89–120`、`canvases 3`、无页面报错。
- 复跑方式：`node poc/hook/verify-cover.mjs --out <dir> [--fullscreen]`。

## 2. 移除「智能动感模式」开关

### 做法

Folia 的 `VisPlaygroundSettingsPanel.tsx` 在 282 行渲染 `<SmartBeatSettingsCard t={t} />`。
我们在 settings-ui 的 Vite 构建里加了一个 **构建期精确替换插件**（`poc/settings-ui/vite.config.ts` 的
`stripSmartBeatCard()`，`enforce: 'pre'`）：

- 只匹配 `.../components/visualizer/window/VisPlaygroundSettingsPanel.tsx`；
- 必须能找到 `<SmartBeatSettingsCard t={t} />` 这一行，否则**构建直接报错**（防止上游改动后静默漏改）；
- 找到后替换为注释，并删除对应 `import SmartBeatSettingsCard ...`；
- 不修改 Folia 子模块源码本身（`work/folia` 仍保持上游原样）。

### 证据

- 构建产物 `poc/settings-ui/dist/settings-ui.js` 中 `SmartBeatSettingsCard` 出现次数 = 0。
- 宿主内实际渲染：页面文本 `智能动感模式` 不存在（`smart-beat:text-absent`），
  「动感效果」等其它卡片与布局不受影响；见 [images/settings-ui.jpg](images/settings-ui.jpg)。
- 本地回归：`node poc/hook/verify-cover.mjs` 的两次运行均返回 `settings-ui:ui smart-beat:text-absent`，0 页面错误。

## 3. 回归清单（v0.1.2）

- [x] 菜单第 5 项 Folia：星芒图标 + 与宿主一致的 14sp 字体/颜色（v0.1.1 已有，本版未改动）
- [x] 点击菜单项 → 全屏 Folia：`host-start pid=… fullscreen=True window=3200x2000 dpi=96`
- [x] 播放状态/歌词/曲目实时推送：`state` 100 ms、`track/lyrics` 切换即推送
- [x] 光标：移动显示、空闲 2500 ms 隐藏、设置页打开时常显（日志 `cursor hide/show overlay=…`）
- [x] 设置页：无「智能动感模式」；「默认」重置、14 样式网格、动效/渲染/构图分组保持完整
- [x] 封面取色：纯色封面 → 主题随封面变化（见上表）
- [x] 打包：`dist/release/spw-folia-0.1.2.spmod` 可通过 `packaging/tools/assemble-release.py` 复现

## 4. 仍然「有开关但不生效」的功能

未改动、但当前版本没有数据来源因此不产生视觉变化的功能，
统一列在 [known-inert-settings.md](known-inert-settings.md)。
