# v0.1.4 验证记录 — 歌词样式预览随所选样式实时切换

日期：2026-10-19 · 对应需求：用户 m03519「修复歌词样式预览的无法随当前选定的模式实时改变」

## 1. 根因

`poc/settings-ui/src/model/StylePreview.tsx`（设置页大预览）的交叉淡入效果由
`fading` 布尔状态驱动，而驱动它的 `useEffect` 依赖数组是 `[src, current]`：

```tsx
useEffect(() => {
    if (src === current) return undefined;
    setPrevious(current);
    setCurrent(src);       // ← 改变 current 会重新触发本 effect
    setFading(false);
    const raf = requestAnimationFrame(() => setFading(true));
    const timer = setTimeout(() => { setPrevious(null); setFading(false); }, CROSSFADE_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };  // ← 新 effect 先清理旧定时器
}, [src, current]);
```

`setCurrent(src)` 使依赖变化，effect 重新执行前先跑上一次的 cleanup，把 rAF 与 220ms 定时器都取消；
新一次 effect 又因 `src === current` 提前返回。结果：第一次切换能淡入（rAF 恰好在 cleanup 前触发），
此后每次切换都停留在旧图（新图 opacity 0、旧图 opacity 1）——即"预览不随所选模式改变"。

修复前实测（本地 host harness，连续点击样式格）：`sonnet→tempera` 正常，`tempera→monet` 出现
`tempera.jpg opacity=1` + `monet.jpg opacity=0`，之后切换全部停留在旧样式。

## 2. 修复

`StylePreview.tsx` 重写为不依赖 `current` 的两层结构：

- effect 只依赖 `[src]`，用 `lastSrc` ref 记住上一张图；
- 上一张图作为底层保持不透明，新图作为顶层用 CSS keyframes `spw-preview-in`（220ms，0→1）淡入；
- 220ms 后移除底层；连续快速切换时每次都能正确显示新图。

`app.css` 新增：

```css
@keyframes spw-preview-in { from { opacity: 0; } to { opacity: 1; } }
.spw-preview-in { animation: spw-preview-in 220ms ease both; }
```

## 3. 修复后验证

### 3.1 本地 host harness（`poc/hook/probe-style-preview.mjs`）

依次点击样式格 商籁→凝彩→莫奈→时计→群唱→静止，读取大预览 `<img>`：

| 点击 | 大预览（快照 600ms 后） |
| --- | --- |
| 商籁 | `sonnet.jpg` opacity 1 |
| 凝彩 | `tempera.jpg` opacity 1 |
| 莫奈 | `monet.jpg` opacity 1 |
| 时计 | `pendolo.jpg` opacity 1 |
| 群唱 | `cappella.jpg` opacity 1 |
| 静止 | `still.jpg` opacity 1 |

报告：`tmp-verify/preview-probe2/preview-report.json`；截图 `tmp-verify/preview-probe2/preview-*.png`。

### 3.2 真实 SPW 1.19.0（v0.1.4 安装版）

插件日志 `start: id=dev.spw.folia version=0.1.4 spw=1.19.0`、hook 安装、Folia 菜单点击 → 全屏窗口；
真实鼠标点 ⚙ 打开设置页后依次点击样式格，截图：

- `tmp-verify/v014-tempera.png` — 点击「凝彩」后：大预览变为凝彩画面，样式格高亮凝彩，右侧显示凝彩参数；
- `tmp-verify/v014-monet.png` — 点击「莫奈」后：大预览变为莫奈画面，样式格高亮莫奈，右侧显示莫奈参数；
- `tmp-verify/v014-still.png` — 点击「静止」后同理。

README 使用的 `docs/images/settings-ui.jpg` 已更新为 v0.1.4 真实截图（凝彩选中）。

## 4. 产物

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `dist/release/spw-folia-0.1.4.spmod` | 12,405,269 B（1,937 entries） | `24ddaf34982a6acb9b92943ead1123d6dfb34ed4c9ae082c94ed2e7d1d82c04e` |

manifest：`Plugin-Version: 0.1.4`、`Plugin-Provider: azkbzxf`、权限 `class-transform,library-read`；
settings-ui bundle 1,054,069 B（新增预览淡入 CSS）。

## 5. 复现命令

```bash
cd poc/settings-ui && npm run build        # 内容含 spw-preview-in keyframes
cd spw-folia && ./gradlew.bat plugin
bash packaging/build-package.sh
python packaging/tools/assemble-release.py --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.4.spmod \
  --staging packaging --out dist/release --name spw-folia-0.1.4.spmod
node poc/hook/probe-style-preview.mjs --out tmp-verify/preview-probe2
```
