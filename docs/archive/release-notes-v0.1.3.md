# spw-folia v0.1.3 — 设置页清理与修复

本次更新按用户反馈（m03207）处理了三件事：模组管理作者名、删除无法实现的设置开关、修复一直
不生效的字体/字幕类设置。

## 1. 模组管理作者名改为 GitHub 账号

- 插件清单 `Plugin-Provider` 由 `dsh2 team` 改为 **`azkbzxf`**（GitHub 账号）。
- Salt Player for Windows 的「模组管理 → spw-folia」作者列现在显示 `azkbzxf`。

## 2. 删除「有开关但永远不生效」的设置（A/B 两组）

v0.1.2 已移除「智能动感模式」开关；v0.1.3 继续按
[`docs/known-inert-settings.md`](https://github.com/azkbzxf/spw-folia/blob/main/docs/known-inert-settings.md)
清理了全部无数据来源、无上传能力的控件（构建期从设置页剥离，不改 Folia 源码，标记缺失会让构建失败）：

- 歌词动画：**动感效果**（推镜裂光/涟漪 + 强度，依赖不存在的节拍数据）。
- 字体：**自定义字体/系统字体**与自定义字体磁贴（页面无法读取本地字体文件）。
- 字幕：**罗马音内容模式**、**和声字幕/和声字幕背景**（插件不提供对应数据）。
- 背景：**自定义图片/URL 背景**及图源列表（无上传能力）。
- 样式：**凝彩图层图片**、**莫奈自定义人像**、**群唱自定义头像/表情包上传**。

设置页现在只展示真正生效的控件。

## 3. 修复 C 组设置（已映射到渲染器）

- **字体族**（无衬线/衬线/等宽）与**字重**现在写入 `theme.fontStyle` / `theme.fontWeight`，
  全屏歌词渲染器实际读取。
- **字幕字体**跟随歌词时继承歌词字体；不跟随时使用字幕自己的字体族/字重（映射到 `subtitleTheme`）。
- 字幕内容模式固定为「翻译」、和声相关字段固定关闭（无数据）。
- 旧持久化设置自动归一化（自定义字体→无衬线、罗马音/两者→翻译、URL 背景→隐现背景）。

验证：`docs/archive/verification-v0.1.3.md`（pushConfig 断言 serif/700、mono/auto、字幕主题、DOM 无残留控件、
真实 SPW 安装验证、ESC 关闭无残留进程）。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.3.spmod` | 12,405,289 B | `16bdda573be6f9fed29780881e94feb1f5c0a6d542260c024e4f284c8a5d41ea` |
| `SHA256SUMS.txt` | 88 B | — |

## 安装 / 升级

1. 关闭 Salt Player for Windows；
2. 在「模组管理」里删除旧版 spw-folia（若为本地安装目录，直接删除
   `%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-*`）；
3. 导入 `spw-folia-0.1.3.spmod`，启用插件并授予 `class-transform`、`library-read` 权限；
4. 重启后打开小播放器「更多」菜单 →「Folia」。

已知限制不变：仅支持 Salt Player for Windows 1.19.0（Windows 10/11 x64，需 WebView2 Runtime）；
「智能动感」节拍特效与需要上传素材的功能不在 v1 范围内（已在设置页移除）。
