# spw-folia v0.1.8 — 切歌/封面/歌词链路修复 + 透明窗口可点击

这一版是两处实际使用问题的修复：

1. **自动切歌后封面取色不跟随、动态歌词切换慢** —— SPW 自动切歌后，全屏页的主题配色还停在上
   一首，歌词也要好几秒才换。根因是歌词被「track 变了才推」的门控挡住，而且 track/封面探询链路
   串了 1 s 轮询 + 1.5 s 节流 + 2 s 封面超时。
2. **透明窗口模式鼠标点不到开关** —— 色键透明窗口整窗不可点（v0.1.7 的已知限制）。本版给它加了一层
   不可见的输入捕获窗口，透明模式下页面控件重新可点。

## 更新内容

### 切歌链路（插件侧）

- **歌词独立推送** — `FoliaHostBridge` 不再把歌词挂在 track 变化上：新增 `lastSentLyrics` 与
  `maybeSendLyrics()`，每个 100 ms tick 都比对一次歌词 JSON，变化即推；track 探询从 1 s 提速到 200 ms。
  真机日志：`track -> helper (cover=false)` → `lyrics -> helper (…)` 相差 ~1 ms，切歌即换词。
- **封面更早到达** — `FoliaPlaybackExtension` 在 `adoptMediaItem()` 里立刻发起封面加载（`requestCoverLoad`
  按 track id 去重），刷新节流 1.5 s → 0.4 s；封面 >160 KB 且长边 >512 时先缩到 512 再 base64，
  日志 `cover ready id=… <raw> -> <shrunk> bytes`。真机从 `track` 到带封面的 `track`：`cover=false`
  → `cover=true` 约 0.4 s（原来是等封面才推一次 track，最坏 3–4 s）。
- **主题不再闪回默认色** — 页面侧 `useConfigPublisher` 在切歌瞬间若封面还没到，保留上一首配色；
  封面到达后再推导主题，并用 `themeToken` 丢弃过期的异步推导结果。

### 透明窗口可点击（宿主侧）

- 新增 `TransparencyInputCatcher`：一个 `WS_EX_LAYERED + WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW`、
  alpha=1/255 的不可见窗口，几何跟随主窗口；它接收
  `WM_MOUSEMOVE / LBUTTON / RBUTTON / WHEEL`，把坐标换成屏幕坐标后
  `SendMessage` 投递给 WebView2 的输入子窗口（`Chrome_WidgetWin_1`），并吞掉原消息。
- 因此**透明模式下右下角圆钮、面板、开关、齿轮全部可点**：真机验证「透明中点击开关 → `transparency mode=off`
  + catcher 隐藏 + 页面开关同步」。
- 左下角 chip 与 **Ctrl+Alt+B**（双向切换）保留，作为页面卡住时的保险；chip 文案改为
  「点开关或 Ctrl+Alt+B 恢复不透明」。
- 副作用（已写进文档）：透明窗口不再把鼠标穿透给下层窗口，要操作桌面请先切回不透明或 ESC 退出。

## 验证

- 页面级（真实 host + 协议驱动，红/蓝假封面）：A 主题 `#3e0b0b`；切到无封面 B 时主题保持 A 且
  歌词已是 B；B 封面到达后主题 `#0b163e`；角落采样 A (157,37,37) → B1 (147,32,32) → B2 (25,56,165)。
- 真机（SPW 1.19.0 + 0.1.8）：`track -> helper (158 bytes, cover=false)` → `lyrics -> helper (20875 bytes)`
  → `cover ready … 1085681 -> 56553 bytes` → `track -> helper (75608 bytes, cover=true)`，全程 ~0.4 s。
- 透明可点击（真机）：`transparency badge=shown` → `mouse=catcher shown bounds={0,0,3200,2000}` →
  `mode=on`；在透明窗口里点同一个开关 → `badge=hidden` → `mouse=catcher hidden` → `mode=off`。
- 探针 `poc/webview/host/repro/click-post-probe.cs` 先证明合成消息链路可行；`WH_MOUSE_LL` 钩子在本机
  不触发，故没有采用钩子方案。

机制见 [live-transparency.md](live-transparency.md)，明细见 [verification-v0.1.8.md](verification-v0.1.8.md)。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.8.spmod` | 12,976,142 B（12.38 MB，1941 entries） | `0913914b37ba5a1b4b8db7775ebb1b7ab1621d1a069a000c43766c4c62b9ad1f` |
| `spw-folia-0.1.8.spmod.json` | 488 B | `d94d93093905ff7e38c5e7aa22c648e5f6193115962e17d50377f357c6a93e66` |
| `SHA256SUMS.txt` | 88 B | `3f5bd6ddcf125341c1e124ac75383dda6fe187cef83f37fe8ca5769b10e4f135` |

## 安装 / 升级

1. 关闭 Salt Player for Windows；
2. 删除旧版 `%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia-*`；
3. 导入 `spw-folia-0.1.8.spmod` 并授予 `class-transform`、`library-read`；
4. 重启 SPW，`更多 → Folia` 打开播放页。

## 已知限制

- 透明模式会捕获鼠标，不再点穿到下层窗口（切回不透明或 ESC 即可操作桌面）。
- 键色是纯洋红：页面若恰好画出该颜色会被挖空（当前主题/歌词不会）。
- 仅主屏全屏；多屏未实现。
