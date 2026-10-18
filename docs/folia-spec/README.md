# Folia 复刻规格 · 总索引（task-2 交付）

目标：让 spw-folia 插件在 WebView2 里托管 Folia 自己的可视化代码，1:1 复刻 **全屏歌词模式** 与 **歌词样式设置页**（截图 1）。
所有文档基于 **Folia v0.7.21**：源码 `work/folia/folia-major-main`（AGPL-3.0），安装包 `C:\Program Files\Folia\resources\app.asar`（已解包到 `C:\tmp\asar`，临时目录）。

---

## 1. 文档索引

| 文件 | 内容 | 谁该读 |
|---|---|---|
| [`style-map.md`](style-map.md) | 14 中文名 ↔ `src/components/visualizer/<dir>` 映射（网格顺序 = `order` 升序）、命名纠错、技术栈、webview 托管优先级/工时估算、字体主题 | 所有人 |
| [`settings-ui.md`](settings-ui.md) | 设置页 1240×780 骨架、大预览 stage、4 个 tab（歌词动画/背景/字体/字幕）、**截图 1 每个控件 → 代码/default/min/max/step/格式**、kit 组件视觉规格、Vue 宿主复用方案、与截图差异、验收清单 | 做设置页的人 |
| [`tunings.md`](tunings.md) | 13 个样式 tuning 的 storage key / setter / 面板 / **每个键的默认值** + 4 个背景 tuning 默认值 | 要调默认值/做持久化的人 |
| [`runtime-contracts.md`](runtime-contracts.md) | `VisualizerSharedProps` 全表、MotionValue 契约、Line/Word 语义与词三态、GlowWord、音频输入（**0..255 + gamma + 呼吸值**）、平移/切换/交接、背景、字幕、renderer 生命周期、性能旋钮、**最小 harness 代码** | 做 webview harness / 数据层的人 |
| [`fullscreen-shell.md`](fullscreen-shell.md) | 全屏歌词 = 播放页外壳：z-index 层表、背景/视频/样式/字幕/和声层序、返回键 120px 热点、底部胶囊、chrome 自动隐藏与光标、设置页大预览、截图参考、Vue harness 复刻清单与验收 | 做全屏模式的人 |
| [`assets.md`](assets.md) | 已抽取素材清单（截图 11、cappella 头像/表情 24、占位封面 2、构建入口/CSS）、app.asar 结构、**无缩略图/无字体**说明、AGPL-3.0 合规约束 | 打包/法务/素材 |

原始调研笔记（未精简、含源码行号）：`research/folia/notes-runtime.md`、`notes-audio.md`、`notes-shell.md`、`tuning-defaults.md`；素材与校验和：`research/assets/`（`SHA256SUMS.txt`）。

---

## 2. 十个必须知道的结论

1. **网格顺序 = 各样式 `entry.tsx` 的 `order` 升序**，不是目录名/字母序：商籁10 sonnet · 凝彩20 tempera · 绘光25 lumiere · 流光30 classic · 心象40 cadenza · 云阶50 partita · 浮名60 fume · 倾诉70 tilt · 回环80 claddagh · 莫奈90 monet · 时计100 pendolo · 群唱110 cappella · **镜台120** diorama · 静止130 still。
2. **第 13 个中文是「镜台」，不是「铭台」**：`zh-CN.ts:865`、`diorama/entry.tsx` 均如此；`铭台` 在源码和打包产物中出现 0 次。
3. **样式网格没有缩略图图片**：每格是 `preview/LyricStylePicture.tsx` 用真渲染器实时画的小图（多数时候是冻结帧）。复用组件即可，别找 PNG。
4. **默认值以 `src/types.ts` 为准**：`DEFAULT_SMART_BEAT_SETTINGS.enabled = false`（截图 1 里开关是 ON = 用户自己开的）；`textureResolution` 默认 **1.5**（不是 1.00）；单效果默认 `{on:true, strength:1}`，强度上限 2。
5. **音频尺度是 0..255，不是 0..1**，且要套 gamma：`audioPower = ((bass+lowMid)/2 /255)^3 *255`（各频段另有 boost）。设置页 preview 用 0..1 是**反例**，照抄会让多个样式「不随音乐动」。
6. **渲染一个样式的最小输入**：`mode` + `currentTime/audioPower/audioBands` 三个 MotionValue + `currentLineIndex` + `lines` + `theme`，即可 `<VisualizerRenderer>`；不需要 Electron/播放器/文件系统。
7. **Folia 自带现成「浏览器 harness」参照**：`src/components/obs/ObsBrowserSourceApp.tsx` 在纯浏览器页里挂 `VisualizerRenderer`，自造 MV、改写 DPR/尺寸，经 SSE 接收时钟/音频——可直接抄成 WebView 入口。
8. **构建产物可直接静态托管**：`C:\tmp\asar\dist`（23MB，含 index.html）就是完整前端；主样式包 `dist/assets/src-*.css`（214KB）已抽到 `research/assets/folia/css/`。
9. **全屏歌词不是独立窗口**：它就是播放页 `absolute inset-0 z-0` 的 visualizer 层；返回键是左上 120×120 热区，chrome 3s 自动隐藏。
10. **授权硬约束**：Folia 是 **AGPL-3.0**。把其代码打进插件再分发 ⇒ 插件整体按 AGPL-3.0 开源并提供源码；需保留版权头、附 LICENSE/第三方说明，不得用 Folia 名称/图标当品牌。

---

## 3. 推荐实施路径（与 Lead 的 WebView 方案对齐）

1. **设置页（截图 1）**：Vue 壳 + **React island**（`createRoot`）直接挂 Folia 的 `VisPlaygroundSettingsPanel`/`VisPlayground`/kit 组件；CSS 用 `src-*.css`，i18n 用项目 `zh-CN` locale，状态用自建 config store（文档 `settings-ui.md §8` 有 import 清单和 provider 清单）。兜底：Vue 手写 UI（视觉规格在 `settings-ui.md §7`）。
2. **全屏歌词**：宿主全屏窗口 + 透明 WebView2，内部挂 `VisualizerRenderer`（单样式按需 lazy），字幕/和声由 renderer 自带；返回键/底部胶囊/自动隐藏按 `fullscreen-shell.md §7` 自写（可后置）。
3. **数据**：时钟自建 rAF；音频接 audio-probe 的 WASAPI 数据或按 `runtime-contracts.md §7` 合成；智能动感默认关（webview 里 `useSmartBeatAvailability()` 恒 `desktopOnly`），**关状态下可像素级一致**，v1 直接不做。
4. **打包**：`dist` 静态资源 + cappella PNG + 两个占位封面（Vite 会自动打进去）；字体用系统字体 / 自备 Noto Serif SC woff2（OFL），不要依赖 Folia 的 CDN。

---

## 4. 待 Lead 决策 / 已知风险

| 项 | 现状 | 建议 |
|---|---|---|
| 设置页 UI 技术 | React island 复用 vs Vue 重写 | 复用优先（省 80% 细节）；Vue 重写为兜底 |
| 智能动感模式开关 | 源码默认关；截图 1 为开 | 复刻时默认**关**（与源码一致），或 UI 显示开但不接模型——需产品决策 |
| pixi/three 性能 | sonnet/tempera/lumiere 是 WebGL2；diorama three.js | 先 P0 样式验证通道，再上 sonnet（`style-map.md §5` 工时表） |
| 音频 | audio-probe 的 WASAPI helper 尚未验证 | 先用占位（呼吸值），音频到位后替换 |
| 字体 | Noto Serif SC 走 CDN，离线/内网会回退 | 打包 woff2（OFL）并改 `@font-face` |
| AGPL | 插件需整体 AGPL-3.0 | 仓库根放 LICENSE + THIRD_PARTY 说明 |

---

## 5. 复现命令

```bash
# 源码
cd D:\输出目录\dsh2\work\folia\folia-major-main
# 打包产物
npx --yes @electron/asar extract "C:\Program Files\Folia\resources\app.asar" C:\tmp\asar
# 素材校验
cd D:\输出目录\dsh2\research\assets && sha256sum -c SHA256SUMS.txt
# 关键入口
#   设置页:  src/components/visualizer/window/VisPlayground.tsx + VisPlaygroundSettingsPanel.tsx
#   渲染器:  src/components/visualizer/VisualizerRenderer.tsx
#   全屏层:  src/App.tsx:2790-2801
#   OBS 参考: src/components/obs/ObsBrowserSourceApp.tsx
```
