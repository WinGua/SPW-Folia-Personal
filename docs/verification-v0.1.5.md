# v0.1.5 local verification — animated preview with a working pause/play button (m03640)

状态：**仅本地验证，未发布 GitHub**（用户 2026-10-19 指示：这一版暂时不发）。

## 需求

用户 (m03640)：点击歌词样式大预览右上角的暂停/播放键没有反应，预览框静止不动，需要“动起来”。

## 实现（轻量方案，按用户“不需要完整动画”的指示）

- `poc/settings-ui/src/model/StylePreview.tsx`：选中样式的大预览仍是真实截帧，但外层加了一
  个缓慢的 Ken Burns 位移/缩放（`spw-preview-drift` 26s alternate 循环），并接受 `paused`：
  通过 `animationPlayState` 冻结/恢复。
- `poc/settings-ui/src/app.css`：新增 `@keyframes spw-preview-drift` /
  `.spw-preview-drift`（`transform-origin: 50% 55%`、`will-change: transform`），并与样式切换
  的 `spw-preview-in` 交叉淡入共存（drift 在外层容器，淡入在图片层）。
- `poc/settings-ui/src/model/Stage.tsx`：暂停按钮接上 `useState`；图标保留 lucide
  `Play`/`Pause`，`aria-label` 使用 Folia 的 `options.pausePreview` / `options.resumePreview`。
- 放弃“注入页内挂载 Folia 真正渲染器”的方案：它能渲染（本地探针 s1–s5 帧差通过），但会拉入
  约 38 MB 的渲染器分块，并触发 React #185 无限更新（组件栈指向
  `VisPlaygroundSettingsPanel`）。根因在测试期替换的 `stubs/foliumTunings.tsx` 与注入页渲染
  图组合；已恢复原 stub 并删除 `LivePreview*.tsx`。详见下方“失败记录”。

## 验证证据（真实 SPW 1.19.0 + 已安装的 v0.1.5 插件）

设置窗口打开、真实鼠标点击暂停按钮（物理坐标 1859,449，DSF 1.8）：

| 步骤 | 证据 | 结果 |
| --- | --- | --- |
| 播放中 | 按钮图标 ⏸（tooltip 暂停预览），预览区 1.3 s 前后截图 | 变化 223,312 px (19.40%) |
| 点击暂停 | 按钮图标 ▶（tooltip 继续预览） | 状态已暂停 |
| 暂停中 | 预览区 1.3 s 前后截图 | 变化 **0 px (0.00%)** → 冻结 |
| 点击继续 | 图标回到 ⏸ | 恢复播放 |

- 截图：`tmp-verify/q1-resumed.png` … `q4-paused.png`、`btn-q1-resumed.png` /
  `btn-q3-paused.png`（按钮图标裁剪）；本地探针 `tmp-verify/lp-final/`。
- 本地探针 `poc/hook/probe-live-preview.mjs`：`drift:true`、`image: thumbs/sonnet.jpg`、
  预览区帧差 playing 10.45% → paused 0.00% → resumed 15.63%，按钮标签
  `暂停预览 → 继续预览 → 暂停预览`。
- 生命周期：ESC #1 关设置、ESC #2 关窗口；日志
  `host-exit code=0 reason=user framesPosted=7056 statesReceived=7056 lastFps=120 atMs=112135`，
  无残留 helper。

## 版本与安装

- 插件版本 0.1.5（`spw-folia/build.gradle.kts`、`PluginVersion`、`FoliaPlugin.PLUGIN_VERSION`）。
- 本地构建：`bash packaging/build-package.sh` → `python packaging/tools/assemble-release.py
  --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.5.spmod --staging packaging --out dist/local
  --name spw-folia-0.1.5.spmod` → `dist/local/spw-folia-0.1.5.spmod`
  12,574,908 B，sha256 `8e88488ba9d4137602c550a1633c98b2b45d2a4ebf578822f7412940d9655c11`。
- 已安装到 `%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-0.1.5\`
  （classes/ + native/ + web/ + licenses/），`enabled.txt` 与 permissions（class-transform,
  library-read）预授权。

## 失败记录：Folia 真实渲染器预览（不采用）

- 在注入页内挂载 `VisualizerRenderer` + `VisPlaygroundSampleStage` + `usePreviewClock`，可在
  独立探针中渲染并响应暂停（`tmp-verify/lp-*` 早期证据），但打包后注入页打开设置时抛
  `Minified React error #185`（最大更新深度），React 卸载整棵注入树。
- 组件栈（可读构建）：`VisPlaygroundSettingsPanel ← aside ← StudioWindow ← App`；sourcemap
  指向 `react-dom-client.production.js` 抛出点 + `motion-dom` 的 projection/animation 帧。
- 二分：恢复 `stubs/foliumTunings.tsx` 原实现后崩溃消失（同一次构建、同一注入页），说明崩溃
  与“真实渲染器 + 注入页 + stub 图”的组合有关；同时该方案 web 资源约 38 MB（发布包 +25 MB），
  与“只需要预览框能播放/暂停”的需求不匹配，故回退到轻量方案。

## 未做（按用户指示）

- 未提交、未推送 GitHub，未创建 v0.1.5 release；工作区保留改动。需要发布时再走
  `docs/release.md` 流程（更新 README/release notes/acceptance）。
