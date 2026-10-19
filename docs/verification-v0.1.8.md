# v0.1.8 验证记录

日期：2026-10-19。产品包：`spw-folia-0.1.8.spmod`（12,976,142 B / 1941 entries /
sha256 `0913914b37ba5a1b4b8db7775ebb1b7ab1621d1a069a000c43766c4c62b9ad1f`）。

## 1. 切歌后封面取色 / 歌词切换

### 1.1 页面级（真实 host + 协议驱动）

脚本 `tmp-inspect/verify-autoadvance.py`：往真实 host 的 stdin 依序推 A 曲（红色假封面 `#3e0b0b`）、
B 曲无封面（`Track B|nocover`）、B 曲带封面（蓝色 `#0b163e`），再从 host 页面截图采样角落颜色。

| 阶段 | 页面输入 | 主题（页面采样） | 结论 |
| --- | --- | --- | --- |
| A 曲 | `Track A\|coverA\|A line` | `#3e0b0b` | 基准 |
| 切到 B（封面未到） | `Track B\|nocover\|B line one,B line two` | 仍 `#3e0b0b`（A 的红） | 歌词/曲名已换，配色保留旧值不闪回默认色 |
| B 封面到达 | 同上 + `coverB` | `#0b163e`（B 的蓝） | 主题跟随封面 |

屏幕采样：A (157,37,37) → B1 (147,32,32) → B2 (25,56,165)，与配置一致。

### 1.2 真机（SPW 1.19.0 + 0.1.8，媒体键切歌）

插件日志（`%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-0.1.8\spw-folia.log`）：

```
19:39:29.089 track -> helper (158 bytes, cover=false)
19:39:29.091 lyrics -> helper (20875 bytes)
19:39:29.269 cover ready id=8c6080… 1085681 -> 56553 bytes (image/jpeg)
19:39:29.291 track -> helper (75608 bytes, cover=true)
```

- 歌词不再等 track：`track` 与 `lyrics` 相差 2 ms；
- 封面 0.18 s 内加载并缩图（1.09 MB → 56 KB），0.2 s 后带封面的 track 推给页面；
- 旧版本此路径是「track 只在 JSON 变化时才推、歌词挂在 track 上」，切歌后要 1–4 s 才换词、
  封面失败则该曲永远不推歌词。

## 2. 透明窗口内鼠标可点击

### 2.1 探针（可行性）

- `poc/webview/host/repro/click-post-probe.cs`：向 `Chrome_WidgetWin_1` 投递
  `WM_MOUSEMOVE/WM_LBUTTONDOWN/WM_LBUTTONUP` 后页内 mousedown 计数 0→1→2；
  投给 `Chrome_WidgetWin_0` 或 `PostMessage` 到父窗口均无效。
- `poc/webview/host/repro/hook-probe.cs`：`WH_MOUSE_LL` 在本机完全收不到事件（events=0），
  钩子路线废弃，改为独立捕获窗口。

### 2.2 真机端到端

`tmp-inspect/real-click-test.py`（金色像素定位圆钮 → 点开面板 → 点面板开关两次）：

```
transparency badge=shown at=24,1900
transparency mouse=catcher shown bounds={X=0,Y=0,Width=3200,Height=2000}
transparency mode=on
transparency badge=hidden
transparency mouse=catcher hidden
transparency mode=off
```

即：在**透明**窗口里点击同一个页内开关，设置回环（页面 → 插件持久化 → 插件推回）让宿主关掉透明、
catcher 一并隐藏。截图：`tmp-inspect/transparent-click/real-03-transparent-on.png`（透明中面板开、
开关为开、桌面透出）、`real-04-transparent-off.png`（恢复不透明、开关为关、chip 消失）。

### 2.3 回归（不透明模式）

不透明模式下页面本来就可点：`real-02-panel.png` 面板正常打开，开关可切换、设置持久化不变。

## 3. 构建可复现

- `bash poc/webview/host/build.sh` → `spw-folia-host.exe` 130,560 B；
- `bash packaging/build-package.sh` → web 1898 files / native 5 / licenses；
- `python packaging/tools/assemble-release.py --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.8.spmod --staging packaging --out dist/local --name spw-folia-0.1.8.spmod`
  → 12,976,142 B、1941 entries、sha256 `0913914b…`；
- 包内 `native/spw-folia-host.exe` 与 build 产物一致。

## 4. 真机安装

`tmp-inspect/reinstall-and-verify-018.py`：关 SPW → 备份旧目录 → 解压新包到
`%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-0.1.8` → 重启 SPW。
插件日志：`start: id=dev.spw.folia version=0.1.8 spw=1.19.0`、`playback extension discovered`、
`settings loaded (… bytes, persisted)`；host 侧 `canvases=3`、`fps≈118–120`。
