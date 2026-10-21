# spw-folia v0.3.0 — 开源链接 · 按钮样式统一 · 透明字体随系统明暗 · 底部播放控制条（可点可用 · 亚克力 · 闲置隐藏 · 侧键退出）

v0.3.0 是 UI/元数据 + 播放控制通道的增量更新：插件管理补开源链接、右下角按钮去掉专属色环、
透明窗口字体颜色改随系统深浅模式、新增底部播放控制条；并在验收反馈后完成 **播放控制接线**
（上一版协议只读，按钮原本只能 disabled）与 **HUD 观感修正**（亚克力毛玻璃、鼠标闲置自动下滑
隐藏，避免遮挡歌词）。协议新增 `control`（page→host→plugin）与 `queue`（plugin→host→page）
两条**向后兼容**消息，旧页面/旧插件互不感知。本地验收反馈又完成一轮体验修复：
**透明窗口下 HUD 悬停无法展开**（改为 `pointermove` 坐标命中）、**右下角透明面板删掉说明
文案**、**鼠标侧键「返回」可直接退出 Folia**。

## 更新内容

- **插件管理「开源链接」可用** — `spmod{}` 块新增 `PluginOpenSourceUrl = "https://github.com/azkbzxf/spw-folia"`，
  经 workshop gradle 插件写入 MANIFEST.MF 的 `Plugin-Open-Source-Url` 属性（字段名经
  SpmodExtension 常量池与两个已装第三方模组的 MANIFEST 双重实证）。SPW 模组管理菜单里的
  「开源链接」不再置灰，指向本仓库。「配置」仍置灰是预期（`PluginHasConfig=false` 未变）。
- **右下角按钮样式与右上角齿轮统一** — 删除 `.spw-chrome-btn--player` 的全部专属覆盖
  （金色 `rgba(214,168,84,…)` 描边 + 2px 色环 + 深色底），视觉完全继承 `.spw-chrome-btn`
  基准样式（半透明黑底 + 白色细描边 + blur 12px），hover 效果与齿轮一致。
- **透明窗口字体颜色随系统深浅模式** — 开启「透明播放背景」后，文字明暗由 Windows 系统
  应用模式（`matchMedia('(prefers-color-scheme: dark)')`，WebView2 跟随系统）决定，不再由
  封面平均亮度决定；**色相仍取自封面**，主/次/弱化三色经 `ensureContrast` 锁到系统模式
  一侧（浅色系统亮度压到 ≤0.45、深色系统抬到 ≥0.55），深色封面 accent 不会再糊在浅色系统
  的浅字区。系统深↔浅切换实时重染；无封面时提供 Daylight Default / Midnight Default 双
  fallback。**非透明窗口的取色路径逐像素保持 v0.1.x 行为不变**；lumiere 兼容检查改用
  「有效明暗」（opaque=封面、transparent=系统）。
- **底部播放进度条** — 歌词舞台底部中央新增播放 HUD：收起态为小 pill（当前时间 / 细进度条
  带位置圆点 / 总时长），悬停 150 ms 展开成控制条（白色播放圆钮、上一首、曲名、下一首、
  随机、队列 + 进度行），移出 260 ms 收起。进度用 rAF 直绘 DOM，不触发 React 重渲染；
  位置由 `state` 快照按 `tsMs + rate` 外推（漂移超 5 s 不外推）。**鼠标穿透模式下整条不渲染**
  （零像素、零热区，点击照常落向桌面）；设置 overlay 打开时同样让位。
- **播放控制条按钮全部可用** — 播放/暂停（含状态图标切换）、上一首、下一首、随机播放
  （点亮态 + 记忆原播放模式，关闭随机恢复）、播放列表（面板 420px，当前曲高亮，点行切歌），
  进度条支持鼠标拖动/点击 seek。page→host 新增 `{"type":"control",...}`，宿主转
  `{"t":"control",...}` 交给插件；插件经反射调用宿主内部
  `com.xuncorp.voxzen.service.PlaybackController`（`playOrPause/previous/next/seekTo/
  changePlaybackMode/playMusicAt`），队列经 `PlaybackQueueState` 回读后以 `{"t":"queue"}`
  推回页面（mode/random/index/items）。宿主版本经插件启动版本门锁到 SPW 1.19.0。
- **HUD 亚克力毛玻璃** — 半透明底 + `backdrop-filter: blur(28px) saturate(1.7) brightness(1.08)`
  + 顶部内高光 + 外阴影，透出舞台颜色；透明窗口（无法采样桌面）回退为致密亚克力底、不启用模糊。
- **鼠标闲置自动隐藏** — 2.6 s 无 `pointermove/pointerdown/keydown` 时整条下滑出画面（不遮歌词），
  任意鼠标移动/按键即滑回；播放列表面板打开或拖动 seek 时暂停倒计时；键盘 Tab 聚焦到 HUD 时
  自动展开。悬停 150 ms 展开、移出 260 ms 收起的原交互不变。
- **透明窗口下播放条可正常悬停展开** — 透明模式的输入捕获窗转发鼠标消息时，Chromium 对每次
  forwarded `WM_MOUSEMOVE` 都会先发 pointerover/enter、紧接 pointerout/leave，原 pointerenter/
  leave 悬停逻辑被来回抵消（只唤醒不展开）。改为窗口级 `pointermove` 坐标命中「稳定展开区」
  （620×96、底边 28 px）判定悬停/移出，单次移动即可展开；亚克力、闲置隐藏、透明扁平样式不变。
- **透明面板去说明文案** — 右下角「播放页透明背景」面板删掉两行开关说明与底部说明段落，只保留
  两个开关和兼容性警告，更干净；面板功能不变。
- **鼠标侧键「返回」退出 Folia** — XBUTTON1 与 ESC 同义：设置 overlay 打开时先关 overlay，否则
  退出 Folia 模式（`reason=user`，插件保持加载）；XBUTTON2「前进」不退出。透明模式下由输入捕获窗
  转发 `WM_XBUTTON*`，两条渲染路径共用页面同一个 mousedown 处理器。

## 验证

- **构建** — 宿主 `bash poc/webview/host/build.sh` OK（`spw-folia-host.exe` 134,144 B，控制/队列转发 +
  透明捕获窗侧键转发新代码）；插件 `./gradlew plugin`（JDK 25）BUILD SUCCESSFUL；设置岛 `pnpm build` 通过。
- **设置 UI 回归（puppeteer-core + 系统 Edge，dev.html 真实注入路径）** —
  `research/settings-ui/v030-playback-controls-verify.mjs` **31/31 PASS**：5 按钮全可用、点按发出
  正确 `toggle/previous/next/shuffle/queue-play(index,random)/seek(positionMs)`、播放列表面板 7 行/
  当前行高亮/点行切歌、ESC 只关面板、拖动/点击 seek≈50%、亚克力（半透明 + blur + 内高光）与
  闲置 2.6 s 隐藏/移动唤醒；`research/settings-ui/v030-playback-verify.mjs` **10/10 PASS**（收起/
  展开/透明平铺/鼠标穿透渲染回归）。截图 `research/settings-ui/v030-controls-{bar,queue,idle-hidden}.png`。
- **打包级 E2E** — `node packaging/tools/verify-playback-controls.mjs` **PASS 15/15**：拉起打包宿主，
  注入 queue/state，经 `command eval` 点击 5 按钮 + seek，断言宿主 stdout 收到
  `toggle/previous/next/shuffle/queue-play(index=2,random=false)/seek(≈50%)`、面板 ≥6 行、ESC 只关
  面板、退出码 0、`consoleErrors=0`；截图 `packaging/out/packaged-controls-{bar,queue}.png`。
- **打包布局验收** — `node packaging/tools/verify-layout.mjs`：**PASS**，`consoleErrors=0`。
- **透明 HUD 验收** — `node packaging/tools/verify-transparent-hud.mjs` **6/6 PASS**：面板仅剩 2 行
  开关（0 hint / 0 note）、透明下 `data-flat`、悬停展开 620×96、移开收起、闲置 3.2 s 隐藏、再移动
  唤醒并展开；报告 `packaging/out/verify-transparent-hud-report.json`。
- **鼠标侧键验收** — `node packaging/tools/verify-mouse-back.mjs` **4/4 PASS**（真实 OS 鼠标事件）：
  不透明窗口侧键返回退出（`reason=user`、exit 0）、透明窗口侧键返回退出（catcher 转发）、侧键前进
  不退出、设置 overlay 打开时第一次返回只关 overlay 第二次退出；报告
  `packaging/out/verify-mouse-back-report.json`。
- **真实 SPW 1.19.0 验收** — 插件日志出现 `playback controls ready: loader=… controller=…PlaybackController
  queueState=… modeClass=… itemClass=…PiscesMediaItem stateValue=StateFlow.getValue()` 与
  `queue -> helper (2931 bytes, force)`；全屏歌词实拍：展开态亚克力透出舞台色、闲置 3.4 s 后播放条
  完全滑出画面（`poc/hook/shots/v030-acrylic-expanded-0.png`、`v030-idle-hidden-0.png`）；透明背景
  下悬停展开实拍 `poc/hook/shots/v030-final-trans-hover-0.png`、`v030-final-clean-0.png`；面板无注释
  文案 `poc/hook/shots/v030-pbg2-click-0.png`；侧键返回日志 `folia window closed (reason=user)` /
  `host-exit code=0`（透明与不透明两条路径均验）。
- **diff 审查** — 三方写入范围互不重叠：插件（FoliaPlaybackControls.kt 新增 + FoliaHostBridge/
  FoliaPlugin）、宿主（HostForm.cs + Shim.js）、设置 UI（bridge.ts + PlaybackBar + 新增
  PlaybackQueuePanel + app.css）；协议文档与验收脚本由 Lead 统一维护。

## 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.3.0.spmod` | 13,178,430 B（1943 entries） | `7f79d9dc8184c1119ce42a6dc59e1036fb3ffee6bb883c0c603cfdd977d80744` |
| `spw-folia-0.3.0.spmod.json` | 488 B | `82d54753a922d582bc8331bdaead16bd28ccb69e0f892ddebcd49baf2aff94bf` |
| `SHA256SUMS.txt` | 88 B | `8390a0c2185ce29d7696339c2036dfeae2f72ec966935b0c6ce9e09e573015c8` |

包内构成：插件 classes `plugin-dev.spw.folia-0.3.0.spmod`（112,411 B，sha256
`18e89d9eebfe5575e488d7a5fec4caf604e977c89fd5b77efe68b679037f8767`，Gradle 产出的
`classes/` + metadata 打包件，解压后 classes 33 个文件共 238,514 B；含播放控制反射桥/队列
provider/control 路由）＋ native 辅助进程 `spw-folia-host.exe` 134,144 B（sha256
`536037d5864217983dc34667e0fb1d94d8d79e1658318355dc70bd0e52c606af`，新增 control→stdin 与
queue→page 转发、内嵌新版 Shim（侧键返回退出）与透明捕获窗 `WM_XBUTTON*` 转发）＋ 完整 Folia
0.7.21 web bundle（未改动）＋ 设置岛 `settings-ui.js` 1,093,739 B（sha256
`62609003c09b43ed4cd05258af810fb21c334525d4d6b4ca7141c48140b011bd`，控制条/播放列表/亚克力/
闲置隐藏/透明悬停修复/面板文案精简均在此）＋ 许可证。`SHA256SUMS.txt` 随发布资产一并上传。

## 安装 / 升级

1. 关闭 Salt Player for Windows。
2. 打开 mod 管理器，删除旧版 `spw-folia`，导入 `spw-folia-0.3.0.spmod`。
3. 授予 `class-transform` 与 `library-read` 两项权限。
4. 重启 SPW，`更多 → Folia`。

可直接从 v0.2.2 覆盖升级（协议、设置格式、web bundle 均未变）。系统依赖
（WebView2 Runtime / .NET Framework 4.8）见 [runtime-requirements.md](../runtime-requirements.md)。

## 已知限制

- **播放控制依赖宿主内部类** — 反射目标为 SPW 1.19.0 的内部实现（`PlaybackController` /
  `PlaybackQueueState` 等），插件已用 `spwVersion == 1.19.0` 版本门锁住；SPW 升级后若内部
  改名，控制通道会安全降级（按钮仍可点、动作被忽略并记 warning 日志），不会崩溃。
- 其余限制与 v0.2.2 相同：色键透明仍为 `rgb(255,0,255)` 方案；仅主屏全屏；`monet` 与浅色主题下的
  `lumiere` 在透明下不可用；WebView2 浏览器进程偶发退出暂无自动重试。
