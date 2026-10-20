# spw-folia v0.1.4 — 歌词样式预览随所选样式实时切换

本次修复用户反馈（m03519）：设置页（歌词样式）左侧的大预览图不会随当前选中的样式改变，
点击其它样式后预览仍停留在旧画面。

## 修复内容

- **预览交叉淡入逻辑重写** — 旧实现用 `[src, current]` 依赖的 effect 驱动淡入；`setCurrent()` 会
  触发 effect 重新执行并清理掉自己的 rAF/定时器，导致第一次切换后新图一直停在 opacity 0
  （旧图保持不透明）。现在 effect 只依赖目标图 `src`，旧图作底层、新图用 CSS keyframes
  `spw-preview-in` 淡入，220ms 后移除底层；连续快速切换也不会卡住。
- 点击任意样式格后：大预览立即切换到该样式的真实渲染帧，右侧参数面板与高亮同步更新。

## 验证

- 本地 host harness 连续点击 商籁→凝彩→莫奈→时计→群唱→静止，大预览图片依次变为
  `sonnet/tempera/monet/pendolo/cappella/still.jpg`（全部 opacity 1）。
- 真实 Salt Player for Windows 1.19.0 + v0.1.4 安装版：真实鼠标点 ⚙ 打开设置页，依次点击
  「凝彩」「莫奈」「静止」，大预览与参数面板均同步切换（截图见 `docs/archive/verification-v0.1.4.md`）。
- 详情：[docs/archive/verification-v0.1.4.md](https://github.com/azkbzxf/spw-folia/blob/main/docs/archive/verification-v0.1.4.md)。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.4.spmod` | 12,405,269 B | `24ddaf34982a6acb9b92943ead1123d6dfb34ed4c9ae082c94ed2e7d1d82c04e` |
| `SHA256SUMS.txt` | 88 B | — |

## 安装 / 升级

1. 关闭 Salt Player for Windows；
2. 在「模组管理」中删除旧版 spw-folia（或删除
   `%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-*`）；
3. 导入 `spw-folia-0.1.4.spmod`，启用并授予 `class-transform`、`library-read` 权限；
4. 重启后打开小播放器「更多」→「Folia」，右上角 ⚙ 打开设置页，点击样式格即可看到大预览实时切换。

已知限制不变：仅支持 Salt Player for Windows 1.19.0（Windows 10/11 x64，需 WebView2 Runtime）；
预览使用真实渲染帧的静态画面（非实时动画），随选择即时切换。
