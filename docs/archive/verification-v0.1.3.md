# v0.1.3 验证记录（作者名 / 无效开关清理 / C 组设置修复）

日期：2026-10-19 · 对应需求：用户 m03207（① 模组管理作者名改为 GitHub 账号；② 按
`docs/known-inert-settings.md` 删除 A/B 两组无法实现的设置开关，修复 C 组问题）

## 1. 作者名（模组管理显示）

- `spw-folia/build.gradle.kts`：`spmod { PluginProvider = "azkbzxf" }`（原 `"dsh2 team"`）。
- 打包产物 `dist/release/spw-folia-0.1.3.spmod` 内 `classes/META-INF/MANIFEST.MF`：
  `Plugin-Version: 0.1.3`、`Plugin-Provider: azkbzxf`（zip 校验）。
- 本机安装目录 `%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-0.1.3\classes\META-INF\MANIFEST.MF`
  同为 `Plugin-Provider: azkbzxf`；SPW「模组管理」读取该 manifest 字段显示（作者列为 `azkbzxf`）。

## 2. A/B 组无效开关删除（构建期剥离，不改 Folia 源码）

`poc/settings-ui/vite.config.ts` 中的 `foliaSettingsSurgery` 插件（`enforce: 'pre'`，标记缺失即构建失败）：

| 文件 | 删除项 |
| --- | --- |
| VisPlaygroundSettingsPanel.tsx | SmartBeatSettingsCard（v0.1.2 已删）、BeatEffectsGroup、背景注册表中的 `url` 自定义背景项、字幕「罗马音/两者」内容模式选项、自定义字体 Reveal 区块、HARMONY_GROUP 和声分组 |
| TemperaSettingsPanel.tsx | 图像图层分组（`IMAGE_GROUP`）+ TemperaImageLayerControls |
| MonetSettingsPanel.tsx | 人像来源「自定义」选项 + 人像上传行 |
| settingsPanels.tsx（群唱） | 自定义头像/表情包来源选项、头像上传行、表情包上传行 |

本地 host harness（`poc/hook/verify-settings-v013.mjs`）DOM 断言：

```
files:0  hasSmartBeat:false  hasBeatEffects:false  hasHarmony:false  hasRomanization:false
hasCustomFont:false  hasUrlBackground:false  hasUploadText:false  tabs:[歌词动画,背景,字体,字幕]
```

截图：`tmp-verify/tab-visualizer.png`（歌词动画直接以 渲染质量 开始）、`tab-font.png`（仅三档字族）、
`tab-subtitle.png`、`style-凝彩.png`、`style-莫奈.png`（人像来源仅「封面」）、`style-群唱.png`。

## 3. C 组修复（配置已映射到渲染器）

- 新增 `poc/settings-ui/src/publisher/themeFonts.ts`：`applyThemeFonts(theme, {fontStyle, fontWeight})`
  → 归一化字体族（custom/未知 → `sans`），写入 `theme.fontWeight`；删除陈旧 `fontFamily/fontFamilyStack`。
- `poc/settings-ui/src/useConfigPublisher.ts`：主题 = 封面派生主题 + 字体字段合成；字幕主题 =
  「跟随歌词」时继承歌词主题，否则使用字幕自己的字体族/字重。
- `poc/settings-ui/src/publisher/config.ts`：`subtitleContentMode` 归一化为 `translation`，
  `showHarmonySubtitle/harmonySubtitleBackground` 固定 false（无数据）。
- `poc/settings-ui/src/App.tsx`：移除自定义字体磁贴；启动时归一化旧持久化值（custom→sans、
  romanization/both→translation、background url→latent）。

页面 `pushConfig` 实测（宿主 harness）：

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 字体 衬线 + 字重 700 | `theme.fontStyle='serif'`, `fontWeight=700` | PASS |
| 字体 等宽 + 自动字重 | `theme.fontStyle='mono'`, 无 fontWeight | PASS |
| 字幕不跟随歌词：衬线 + 700 | `subtitleTheme.fontStyle='serif'`, `fontWeight=700` | PASS |
| 字幕内容模式 | `subtitleContentMode='translation'` | PASS |
| 和声字幕 | `showHarmonySubtitle=false` | PASS |

## 4. 真实 SPW 1.19.0 运行验证（v0.1.3 安装版）

插件日志（`%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-0.1.3\spw-folia.log`）：

```
start … version=0.1.3
playback extension discovered: dev.spw.folia.FoliaPlaybackExtension
Folia item appended (scope=androidx.compose.ui.ჰ$Ϳ, bridge=Ϳ)
Folia item clicked
spawn exe=…\spw-folia-0.1.3\native\spw-folia-host.exe web=…\web
host-start … fullscreen=True window=0,0 3200x2000 client=3200x2000 dpi=96 winDpi=173 awareness=per-monitor
settings-inject url=https://spw-folia.settings.local…（实际 https://spw-folia-settings.local/settings-ui.js?v=0.1.3）
host-exit code=0 reason=user framesPosted=5228 statesReceived=5227 lastFps=120 atMs=83138
```

- 真实鼠标点 ⚙ 打开设置页，`歌词动画` 无「智能动感模式」/「动感效果」，样式参数正常；
  截图 `tmp-verify/v013-settings2.png`（README 使用的 `docs/images/settings-ui.jpg` 即此截图）。
- ESC 两下：先关设置页、再关窗口，helper 退出码 0，无残留进程。

## 5. 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `dist/release/spw-folia-0.1.3.spmod` | 12,405,289 B（1,937 entries） | `16bdda573be6f9fed29780881e94feb1f5c0a6d542260c024e4f284c8a5d41ea` |
| `spw-folia/build/libs/plugin-dev.spw.folia-0.1.3.spmod` | 86,955 B | — |
| settings-ui bundle | 1,054.08 kB | — |

## 6. 复现命令

```bash
cd poc/settings-ui && npm run build          # 构建期剥离 A/B 组控件
cd spw-folia && ./gradlew.bat plugin          # 插件 classes（Plugin-Provider=azkbzxf）
bash packaging/build-package.sh               # 暂存 web/native/licenses + 校验和
python packaging/tools/assemble-release.py --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.3.spmod \
  --staging packaging --out dist/release --name spw-folia-0.1.3.spmod
node poc/hook/verify-settings-v013.mjs        # 本地 host harness（DOM + pushConfig 断言）
```
