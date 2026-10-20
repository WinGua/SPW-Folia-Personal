# spw-folia v0.1.9 — 鼠标穿透开关，两个浮标任何状态可点

v0.1.8 把透明窗口变成了「可点的透明窗口」，但代价是整个窗口都在吃鼠标：想在 Folia 透明播放页上
操作桌面/其它应用，必须先退出透明模式。v0.1.9 把这件事拆成两半：默认仍然可点页面；需要时打开
**「鼠标穿透（操作桌面）」**，点击就落向桌面，而右下角圆钮与右上角齿轮（以及它们打开的面板/设置页）
在任何状态下都保持可点。

另外按反馈删掉了左下角那个控制 chip —— 现在页面自己就能点，不需要额外的浮标窗口。

## 更新内容

- **删除左下角 chip** — 宿主 `TransparencyBadge` 整个类、显示/隐藏逻辑与相关日志全部移除；透明模式下
  不再有额外窗口遮挡画面。
- **面板新增「鼠标穿透（操作桌面）」开关** — 位于右下角圆钮打开的面板第二行，只有透明开启时出现；
  状态存进设置树（`mousePassthrough`），重启后保留。关闭透明背景时宿主与页面都会自动把它复位成 `false`。
- **热区（hitbox）转发** — 页面把齿轮、圆钮、打开中的面板、设置整页的 CSS 矩形报给宿主
  （`{"type":"hitbox","vw","vh","rects"}`）；透明窗口上的不可见输入捕获窗口只在热区内转发鼠标，
  热区之外且穿透开启时改为「隐藏捕获窗口 → 合成一次真实左键 → 220 ms 后恢复」，
  所以同一个透明窗口既能点控件又能点桌面。
- **两个浮标永远可点** — 右下角圆钮与右上角齿轮天然在热区里；`mousePassthrough=false` 时整窗转发
  （v0.1.8 行为），`true` 时仅热区转发。
- **状态机修复延续** — 退出透明（热键 Ctrl+Alt+B / 页面开关）时 `mousePassthrough` 一并复位，
  避免「下次开透明还停留在穿透态」。

## 验证

页面级 + 宿主级（`tmp-inspect/verify-passthrough2.py`，standalone host + 页面 settings 回环）：

| 检查项 | 证据 |
| --- | --- |
| 穿透关闭时圆钮开面板 | `panel.open=true`（rect 读取），截图 `tmp-inspect/passthrough/11-panel-open.png` |
| 面板第二行开穿透 | 页面 `aria-checked=true`；宿主日志 `transparency passthrough=on rects=3` |
| 穿透下点屏幕中央 | `transparency mouse=catcher hidden` → `transparency passthrough=click at=1600,560` → `catcher shown bounds={0,0,3200,2000}` |
| 穿透下点圆钮 | 面板状态由 open 切到 close（证明点击进入页面），截图 `14-hotspot-panel.png` |
| 穿透下点齿轮 | 设置整页 `data-spw-settings-overlay=true` 打开，截图 `15-gear-overlay.png` |
| 穿透下点设置页里的返回键 | 设置整页关闭（selector 消失），截图 `17-overlay-click.png` |
| 面板关穿透 | `transparency passthrough=off rects=4`，`aria-checked=false` |
| 热键退出透明 | `transparency exit source=hotkey` / `mode=off` / `passthrough=off rects=2`，页面开关 `aria-checked=false` |

真机（SPW 1.19 + 0.1.9）：

| 检查项 | 证据 |
| --- | --- |
| 面板两行开关 | 截图 `tmp-inspect/passthrough-live/02-passthrough-on.png`（透明 + 两行开关都开 + 桌面透出） |
| 穿透下点桌面 | 插件日志 `transparency passthrough=click at=1600,700` + `catcher hidden/shown` |
| 穿透下点齿轮 | 设置整页打开，截图 `05-settings-overlay.png` |
| 热键退出并复位 | 日志 `exit source=hotkey` / `mode=off` / `passthrough=off`，截图 `06-after-hotkey.png`（恢复不透明） |

## 产物（构建 2026-10-19）

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.9.spmod` | 12,975,396 B（1941 entries） | `8ec1ffb3e4dee3c4befbc953f7d36a22ab1864e5e204439c7c16a5233257ce01` |
| `spw-folia-0.1.9.spmod.json` | 488 B | `36a2a141aa550dd3f976c0c14927671daf945a3ed4500bc9688b1cd3bc5f8cdb` |
| `SHA256SUMS.txt` | 88 B | `1b65a50f55a0b59928fa80fac8b7d3e31bd817654c31c236a5984ceb7d72082e` |

内含宿主 `native/spw-folia-host.exe` 127,488 B / sha256 `5ebc3c97422debfbe02666a4dd4b07a7751b95a13627d34310443fc47b225577`；
设置界面 `web/settings/settings-ui.js` 1,069,206 B / sha256 `af99b31c0941cb2c42fe953ad2fcffb932ae086195eed18634541bea5fb15216`。

## 构建方式

```bat
gradlew.bat plugin
bash poc/webview/host/build.sh
node packaging/tools/stage-web.mjs
python packaging/tools/assemble-release.py --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.9.spmod ^
    --staging packaging --out dist --name spw-folia-0.1.9.spmod
```
