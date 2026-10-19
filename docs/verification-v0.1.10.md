# spw-folia v0.1.10 — 修复滚轮向下导致辅助进程崩溃

v0.1.9 用户报告：在「播放页透明背景 + 鼠标穿透」状态下滚动滚轮向下，弹出
「Microsoft .NET Framework 未处理异常」对话框，辅助进程退出。栈顶为：

```
System.OverflowException: 算术运算导致溢出。
   在 TransparencyInputCatcher.Forward(Message& m)
   在 TransparencyInputCatcher.WndProc(Message& m)
   在 System.Windows.Forms.NativeWindow.Callback(IntPtr hWnd, Int32 msg, IntPtr wparam, IntPtr lparam)
```

## 根因

`TransparencyInputCatcher.Forward`（`poc/webview/host/HostForm.cs`）用 `IntPtr.ToInt32()`
读取消息参数：

```csharp
int wp = m.WParam.ToInt32();
```

在 x64 .NET Framework 上，`IntPtr.ToInt32()` 是**带溢出检查**的窄化转换（与 `/checked` 无关，
是这个 API 本身的语义）。而 Win32 把消息参数按指针宽度零扩展投递：`WM_MOUSEWHEEL` 的
`WPARAM = MAKEWPARAM(keyState, wheelDelta)`，滚轮**向下**的 `wheelDelta = -120`，
低 32 位即 `0xFF88xxxx`，**bit31 为 1**；零扩展后 `IntPtr` 是 `0x00000000FF88xxxx`，
超出 `int` 正数范围，`ToInt32()` 抛 `OverflowException`。滚轮向上（`+120`）永远是
`0x0078xxxx`，bit31 为 0，所以只有向下会崩。

## 验证

### 1. 参数形状确认（`tmp-verify/live-wheel/paramprobe.exe`）

一个最小 WinForms 探针窗口，把每条到达的消息的原始参数与 `ToInt32()` 结果写进日志。由
`paramprobe-test.py` 用 `PostMessageW` 投递（`argtypes` 固定为 `c_size_t`，保证零扩展，
即 Win32 的真实投递形状）：

```
msg=0x020A wparam64=0x00000000FF880000 lparam64=0x00000000022B0378 wpToInt32=OverflowException lpToInt32=ok
msg=0x020A wparam64=0x0000000000780000 lparam64=0x00000000022B0378 wpToInt32=ok                lpToInt32=ok
```

即：同样的 `0x020A`，向下滚动时 `WParam.ToInt32()` 必抛，向上滚动时不抛 —— 与「只有滚轮向下崩溃」
的现场表现一致。另外顺带确认了 `0x0281`（`WM_IME_SETCONTEXT`）这类真实消息也会带
`lparam64=0x00000000C000000F` 且 `lpToInt32=OverflowException`，说明这不是滚轮独有的形状。

> 注：ctypes 若不写 `argtypes`，会把 Python int 当有符号 32 位再符号扩展成
> `0xFFFFFFFFFF880000`，那种形状 `ToInt32()` 不抛 —— 会假阴性。测试脚本已固定签名。

### 2. 反射级回归对比（`tmp-verify/overflowfix/forwardtest.cs`）

直接加载被测二进制，反射构造 `TransparencyInputCatcher`（全局命名空间，非 `SpwFolia.*`），
`ShouldForward` 恒为 true，把一个真实后端 `Form` 当转发目标，然后构造
`System.Windows.Forms.Message` 调用私有 `Forward(ref m)`。

| 用例 | v0.1.9 旧二进制 | v0.1.10 新二进制 |
| --- | --- | --- |
| `WM_MOUSEWHEEL` delta = -120（wParam `0x00000000FF880000`） | **抛 `OverflowException: 算术运算导致溢出`** | 通过 |
| `WM_MOUSEWHEEL` delta = +120 | 通过 | 通过 |
| `WM_MOUSEMOVE` lParam bit31 置位 | **抛 `OverflowException`** | 通过 |
| `WM_LBUTTONDOWN` lParam bit31 置位 | **抛 `OverflowException`** | 通过 |
| 参数全 `0xFF` | 通过 | 通过 |
| 滚轮 wParam / lParam 原样转发 | —（先崩） | 通过 |

新版 15/15 全通过、退出码 0；旧版在首个滚轮向下用例即失败、退出码 1。

### 3. 真机级独立回归（`tmp-verify/live-wheel/livewheel-standalone.py`）

不依赖 SPW，直接启动被测 `spw-folia-host.exe`（`--window 1280x720 --no-topmost --demo
--dev-settings '{"transparentPlayerBackground":true,"mousePassthrough":false}'`），
等透明捕获窗口出现（`WS_EX_LAYERED | WS_EX_TOOLWINDOW`，全屏尺寸），向它投递
`WM_MOUSEWHEEL wparam=0x00000000FF880000 lparam=0x03E80640`，然后检查是否出现新的顶层窗口。

| 检查项 | v0.1.9 旧二进制 | v0.1.10 新二进制 |
| --- | --- | --- |
| 进程存活 | 存活（对话框未关闭） | 存活 |
| 新顶层窗口 | **1 个：`Microsoft .NET Framework`，438x287** | 无 |
| 窗口是否响应（`WM_NULL` + `SendMessageTimeout`） | 响应 | 响应 |
| 20 连发滚轮向下 | 无新增窗口（对话框已在） | 无新增窗口 |
| 滚轮向上 | 正常 | 正常 |
| 捕获窗口尺寸/样式 | `rect=(960,640,1280,720) exstyle=0x08090088` | 同 |

### 4. 弹窗内容逐字比对（`tmp-verify/live-wheel/read-crash-dialog.py`）

枚举新出现对话框的子控件文本（UTF-8 落到 `dialog-<label>.txt`）：

旧二进制 —— 与用户截图完全一致：

```
=== window class='WindowsForms10.Window.8.app...' title='Microsoft .NET Framework'
  [STATIC]  应用程序中发生了未经处理的异常。如果单击"继续"，应用程序将忽略此错误并尝试继续。
            如果单击"退出"，应用程序将立即关闭。

            算术运算导致溢出。。
  [BUTTON]  详细信息(&D)
  [BUTTON]  继续(&C)
  [BUTTON]  退出(&Q)
RESULT: FAIL (unhandled-exception dialog appeared)
```

新二进制：

```
posted WM_MOUSEWHEEL wparam=0x00000000FF880000 (delta -120)
alive: True | new top-level windows: 0
RESULT: PASS (no dialog, helper still running)
```

### 5. 崩溃可观测性

`poc/webview/host/Program.cs` 的 `Main` 里注册了
`Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException)`、
`Application.ThreadException` 与 `AppDomain.CurrentDomain.UnhandledException`，
分别以 `ui-thread` / `unhandled` 阶段写 `{"t":"log","level":"error",...}` 协议行。
新二进制在测试全程 0 条 error 日志（旧二进制也没有 —— 因为旧版根本没装这个钩子，
这正是原始故障「日志里什么都看不到、只有一张弹窗截图」的原因）。

## 修复内容

`poc/webview/host/HostForm.cs`

- `TransparencyInputCatcher.Forward`：`IntPtr.ToInt32()` → `unchecked((int)x.ToInt64())`；
  滚轮分支改为坐标取自 `LPARAM`（滚轮消息的屏幕坐标在 `LPARAM`，原代码取反了），
  并把消息原样转发给 WebView2 子窗口（不再自拼 `WPARAM`、不再 `ScreenToClient`）。
- `WM_HOTKEY` 的 `WPARAM` 比较同样改为 `unchecked((int)m.WParam.ToInt64())`。
- `MakeLParam` 的 x 与 y 都做 16 位掩码。

`poc/webview/host/Program.cs`

- 新增 UI 线程 / AppDomain 未处理异常日志（见上）。

## 产物（构建 2026-10-19）

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.10.spmod` | 13,145,163 B（1941 entries） | `4a90d09e95ea37449882f6b7507fcfa3d0ccdf72d86dbc969b26d6426cbcf951` |
| `spw-folia-0.1.10.spmod.json` | 491 B | `c61ac9c8a1a1aab5f81445fd86fb7dbae5572416a77add9be4a53aeb7e1c46b2` |
| `SHA256SUMS.txt` | 89 B | `4d1a0474517c2a087c28d6ba84ae9dab7da53f459e54ae924546c94a6a341772` |

内含宿主 `native/spw-folia-host.exe` 128,000 B / sha256
`c2c18431426f7cd6b5076d6de0a73256ca1e5842bfb3eae73105d3cadcfee6b4`；
设置界面 `web/settings/settings-ui.js` 1,069,206 B / sha256
`af99b31c0941cb2c42fe953ad2fcffb932ae086195eed18634541bea5fb15216`（与 v0.1.9 相同）。

与 v0.1.9 逐条目对比：两个包都是 1941 个条目，无增删，仅 4 个条目变化 ——
`classes/META-INF/MANIFEST.MF`、`classes/dev/spw/folia/FoliaHostBridge.class`、
`classes/dev/spw/folia/FoliaPlugin.class`、`native/spw-folia-host.exe`。

## 构建方式

```bat
gradlew.bat plugin
bash poc/webview/host/build.sh
bash packaging/build-package.sh
python packaging/tools/assemble-release.py ^
    --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.10.spmod ^
    --staging packaging --out dist/release --name spw-folia-0.1.10.spmod
```

复现回归：

```bat
:: 反射级 A/B（旧二进制放在 tmp-verify/overflowfix-old/）
tmp-verify\overflowfix\forwardtest.exe
:: 真机级 A/B（真实启动辅助进程 + 真实捕获窗口）
python tmp-verify\live-wheel\livewheel-standalone.py tmp-verify\overflowfix-old\spw-folia-host.exe old
python tmp-verify\live-wheel\livewheel-standalone.py poc\webview\host\build\spw-folia-host.exe new
python tmp-verify\live-wheel\read-crash-dialog.py tmp-verify\overflowfix-old\spw-folia-host.exe old
```
