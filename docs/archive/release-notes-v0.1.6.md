# spw-folia v0.1.6 — 设置页大预览改用真实 Folia 渲染器（可播放 / 可暂停）

本次把「歌词样式」设置页左侧的大预览从「静态样式帧」升级为**真实 Folia 渲染器的实时动画**：
预览框里跑的就是全屏模式同一套 Folia OBS 页面与渲染管线，样式与各项参数改动即时生效，右上角的
暂停/播放按钮也真正冻结和恢复画面。

> 说明：v0.1.5 是仅本地验证、未发布的内部版本（静态帧 + Ken Burns 轻微推拉）。v0.1.6 用真实渲染器
> 取代了该方案，静态帧只保留为 iframe 不可用时的 fallback。

## 更新内容

- **大预览 = 真实渲染器** — 设置页在 `preview.html` 同源 iframe 中挂载 Folia 自己的 OBS 页面与
  渲染管线（3 个 canvas），settings bundle 只负责用主发布器同一个 `buildConfig()` 构造配置并通过
  `postMessage` 下发，不把渲染器代码打进设置页（仅 +12 KB）。样式、纹理分辨率、镜头运动幅度、
  文字动势、字体、背景、主题都会立刻反映到大预览。
- **暂停即完全静止** — 子帧在 `document_start` 用 rAF gate 包装 `requestAnimationFrame`：暂停时
  渲染器/粒子/噪点循环全部停摆（canvas 保留最后一帧），恢复时冲刷队列；shim 自己的 tick 用原生
  rAF 保持 4 Hz PAUSED 时钟。设置页关闭（overlay `display:none`）时子帧自动收到 `paused:true`，
  避免隐藏的 1080p 渲染器空转耗电。
- **健壮性** — 4 s 内未收到子帧 `ready`、或子帧报错时，自动回退到 v0.1.5 的静态帧预览并继续可用；
  连续 5 轮开合复用同一个 iframe 元素，无重建、无泄漏。
- **占位歌与封面** — 设置页无歌曲时用两首 Folia 原生占位歌（「神文之诗」/「野芝麻」）驱动预览，
  占位封面由打包树本地提供（`/preview/placeholder_cover*.jpg`），不依赖网络。
- **宿主修复** — WebView2 就绪前收到的 `hello`/`settings` 不再触发 `post-page: NullReferenceException`
  （未就绪时记 debug 后返回，`lyrics`/`track` 缓存并在导航完成后回放）。

## 验证

- 真实 WebView2 宿主：`[data-spw-live-preview] iframe` 存在，子帧 3 canvas、`frames` 持续增长，
  `receivedConfig=true`；点「凝彩」后大预览立即变为 tempera 真实渲染、右栏同步；连续 5 轮开合
  `iframeCount` 恒为 1 且为同一 DOM 节点；0 页面错误。
- `node poc/hook/probe-live-preview.mjs`：**pass = True，11/11 checks PASS**；暂停时
  wrapper∩iframe 可见区帧差 **ratio 0.00000 / meanAbsDiff 0.00**，暂停时钟 Δ=0 ms，恢复时钟
  +1775 ms；playing/resumed 帧差 ratio 0.3322 / 0.5367。
- 详情：[docs/archive/verification-live-preview-ui.md](https://github.com/azkbzxf/spw-folia/blob/main/docs/archive/verification-live-preview-ui.md)，
  跨端契约：[docs/live-preview-iframe.md](https://github.com/azkbzxf/spw-folia/blob/main/docs/live-preview-iframe.md)。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.6.spmod` | 13,136,350 B | `aacd02afb078b13d09a26930f6981740930df5dfe04343b7a9584cfd84bdcad9` |
| `SHA256SUMS.txt` | 88 B | — |
| `spw-folia-0.1.6.spmod.json` | 488 B | — |

清单：`Plugin-Version 0.1.6`、`Plugin-Provider azkbzxf`、permissions `class-transform,library-read`；
1,941 个 zip entries；相对 v0.1.4 增加 `preview.html`、`_host/preview-shim.js`、占位封面与预览资源
（发布包 +731,081 B ≈ 0.7 MB）。

## 安装 / 升级

1. 关闭 Salt Player for Windows；
2. 在「模组管理」中删除旧版 spw-folia（或删除
   `%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-*`）；
3. 导入 `spw-folia-0.1.6.spmod`，启用并授予 `class-transform`、`library-read` 权限；
4. 重启后打开小播放器「更多」→「Folia」，右上角 ⚙ 打开设置页即可看到大预览在实时播放，
   点暂停按钮画面完全静止、再点恢复。

已知限制不变：仅支持 Salt Player for Windows 1.19.0（Windows 10/11 x64，需 WebView2 Runtime）；
大预览是 1920×1080 子帧缩放显示，首帧就绪约 0.6–1.2 s，渲染器常驻约 +70 MB 堆内存（重样式更明显），
关闭设置页后子帧冻结。
