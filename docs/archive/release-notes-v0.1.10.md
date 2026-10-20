# spw-folia v0.1.10 — 修复透明模式下滚轮向下滚动导致辅助进程崩溃

v0.1.9 的「鼠标穿透」把鼠标消息转给页面时，对消息参数直接调用了 `IntPtr.ToInt32()`。
在 x64 上这是一个**带溢出检查**的窄化转换，而 Win32 投递消息时把参数零扩展到指针宽度：
滚轮**向下**（delta = -120）的 `WPARAM` 低 32 位是 `0xFF880000`，bit31 为 1，
`ToInt32()` 于是抛出 `OverflowException: 算术运算导致溢出`。该异常从 `WndProc` 逃出，
WinForms 弹出一个「Microsoft .NET Framework」未处理异常对话框，辅助进程随即退出 —— 即用户看到的报错。

v0.1.10 修掉这个转换（改为 `unchecked((int)x.ToInt64())`），同时修正了滚轮分支里
坐标/增量取值取错字段的问题，并给辅助进程补上未处理异常日志，避免下次崩溃只能靠一张弹窗截图。

## 更新内容

- **修复滚轮向下崩溃（根因）** — `TransparencyInputCatcher.Forward` 不再用 `IntPtr.ToInt32()`
  读取 `WPARAM`/`LPARAM`，改为 `unchecked((int)m.WParam.ToInt64())`。
  `HostForm` 里比较全局热键 id 的那处同样改掉（`WM_HOTKEY` 的 `WPARAM` 也有同类风险）。
- **修正滚轮分支的取值** — 原代码从 `WPARAM` 取坐标、从 `LPARAM` 取 delta，二者正好相反：
  滚轮消息的屏幕坐标在 `LPARAM`，delta 与按键状态在 `WPARAM`。现在坐标取自 `LPARAM`，
  消息原样转发给 WebView2 子窗口（不再自行拼装 `WPARAM`／做 `ScreenToClient`），
  滚轮在透明页面上滚动恢复正常。
- **未处理异常写进日志** — 辅助进程注册 `Application.ThreadException` 与
  `AppDomain.UnhandledException`（`UnhandledExceptionMode.CatchException`），
  UI 线程异常现在输出 `{"t":"log","level":"error","msg":"ui-thread: ..."}` 协议行，
  不再弹出模态对话框静默退出。
- **`MakeLParam` 掩码补全** — x 与 y 都做 16 位截断，避免极端坐标污染 `LPARAM` 高位。

## 验证

- **回归对比测试**（同一份反射测试跑两个二进制，`tmp-verify/overflowfix/forwardtest.cs`）：
  旧版 v0.1.9 对 `WM_MOUSEWHEEL`（delta -120）抛 `OverflowException: 算术运算导致溢出`，新版 15/15 全通过。
- **独立实机回归**（`tmp-verify/live-wheel/livewheel-standalone.py`，真实启动辅助进程 + 真实透明捕获窗口）：
  向捕获窗口投递 `WM_MOUSEWHEEL` `wparam=0x00000000FF880000`，旧版立刻弹出
  「Microsoft .NET Framework」对话框（新顶层窗口），新版进程存活、窗口响应正常、0 条错误日志。
- **参数形状确认**（`tmp-verify/live-wheel/paramprobe.exe`）：实测该消息到达 `WndProc` 时
  `wparam64=0x00000000FF880000`、`wpToInt32=OverflowException`，与崩溃前提完全一致。
- **发布产物真机验收**：把本页发布的 `.spmod` 解包进真实 SPW 安装（`version=0.1.10`），
  打开透明模式后向真实捕获窗口投递 `WM_MOUSEWHEEL wparam=0xFF880000`（1 次 + 20 次连发）：
  辅助进程存活、捕获窗口仍响应、0 个新顶层窗口、0 条 error 日志；退出透明与关窗均正常（`host-exit code=0`）。
- 细节见 [verification-v0.1.10.md](verification-v0.1.10.md)。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.10.spmod` | 13,145,163 B（1941 entries） | `4a90d09e95ea37449882f6b7507fcfa3d0ccdf72d86dbc969b26d6426cbcf951` |
| `spw-folia-0.1.10.spmod.json` | 491 B | `c61ac9c8a1a1aab5f81445fd86fb7dbae5572416a77add9be4a53aeb7e1c46b2` |
| `SHA256SUMS.txt` | 89 B | `4d1a0474517c2a087c28d6ba84ae9dab7da53f459e54ae924546c94a6a341772` |

## 安装 / 升级

1. 关闭 Salt Player for Windows。
2. 打开 mod 管理器，删除旧版 `spw-folia`，导入 `spw-folia-0.1.10.spmod`。
3. 授予 `class-transform` 与 `library-read` 两项权限。
4. 重启 SPW，`更多 → Folia`。**强烈建议从 v0.1.9 升级**：v0.1.9 在
   「播放页透明背景 + 鼠标穿透」开启时，滚轮向下会直接崩溃。

## 已知限制

- 滚轮事件以原样转发，透明页面里的滚动按 WebView2 自己的规则处理；穿透开启且指针不在热区内时，
  滚轮不会落向桌面（只有左键按下会「隐藏捕获窗口 → 合成一次左键 → 220 ms 后恢复」）。
- 键色透明仍是 `rgb(255,0,255)` 色键方案：页面若恰好绘制该纯色会被挖空（当前主题不会）。
- 仅主屏全屏；多屏选择未实现。
