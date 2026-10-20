# spw-folia v0.2.1 — 修复：浅色主题下「更多」菜单 Folia 条目颜色未适配（几乎不可见）

用户反馈：SPW 浅色主题下，迷你播放器「更多」弹窗里宿主的 4 个条目（播放速度/桌面歌词/
歌词翻译/释放音频引擎）都是深色文字，注入的 Folia 条目却是浅色（白底白字），只剩一条
隐约的残影。

## 根因

`FoliaMenuItem.kt` 把内容色**硬编码**为 `Color(0xFFEBEEF1)`——当时从 SPW 1.19.0 深色弹窗
上采样的文字/图标色。弹窗底色随主题变化后，浅色文字落在浅色底上，对比度趋近于零。

## 宿主自己的颜色从哪来（字节级证据）

宿主类来源：`C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll`（polyglot jar，`javap -J-Dstdout.encoding=UTF-8` 反汇编）。

宿主菜单项渲染函数 `com.xuncorp.voxzen.ui.component.Ԭ`（Blur.kt）中：

```
public static final void Ϳ(String, Modifier, Painter, long, boolean, Composer, int, int)
//                                                    ^^^^ contentColor，可选参数
```

其 `long contentColor` 参数的**默认值分支**（javap 偏移 335–364，`iload 8; bipush 8; iand`
判 default 位）为：

```
343: getstatic     // Field androidx/compose/ui/ʰ.Ϳ : Landroidx/compose/ui/ʰ;
349: invokestatic  // Method androidx/compose/ui/ʰ.Ԩ(Composer): Landroidx/compose/ui/ʹ;
352: invokevirtual // Method androidx/compose/ui/ʹ.Ԩ() : J
355: lstore_3      // => contentColor = ʰ.Ԩ(composer).Ԩ()
```

即：**宿主条目的文字/图标色 = 宿主主题面板的内容色，随浅/深主题自动切换**。
后续该 long 同时用于图标 `ColorFilter.tint-xETnrds$default`（偏移 696–718）与文字样式。

相关类结构（javap）：

- `androidx.compose.ui.ʰ`：7 个静态 `(Composer)` 访问器（`Ϳ/Ԩ/ԩ/Ԫ/ԫ/Ԭ/ԭ`），分别返回
  主题的不同子对象；菜单用的是 `Ԩ(Composer): ʹ`。
- `androidx.compose.ui.ʹ`：主题调色板，内含 **11 个 `MutableState` 字段**（即颜色存于
  Compose 状态），`Ϳ()`、`Ԩ()` 等 getter 返回打包的 `Color` long。因为读的是
  `MutableState`，**组合期读取即订阅**——主题切换时读取方自动重组。

## 修复

`FoliaMenuItem.kt`：

1. 新增 `hostFlyoutContentColor()`：反射调用 `ʰ.Ԩ(currentComposer)` 拿到调色板，再调
   `ʹ.Ԩ()` 取内容色，与宿主条目逐指令一致；两个 `Method` 用 `by lazy` 缓存且只解析一次。
2. 任一步失败（宿主版本变化导致类/方法改名）抛 `Throwable` 均被吞掉，**回退**到旧常量
   `#EBEEF1`（深色弹窗下的原行为），不会比修复前更糟。
3. 图标（`FoliaSparkle`）与文字（`BasicText`）共用该颜色，与宿主「图标 tint = 文字色」
   的做法一致。

代码点（沿用 hook-target.md 的码位表风格）：

| glyph | codepoint | 角色 |
|---|---|---|
| ʰ | U+02B0 | 主题访问器类（`Ԩ(Composer): ʹ`） |
| ʹ | U+0374 | 主题调色板（`Ԩ(): J` 内容色） |
| Ԩ | U+0528 | 访问器方法名 / 调色板 getter 名 |

## 验证

- **字节级**：上述默认值分支与本 PR 的反射调用链逐条对应（同一静态方法、同一 getter、
  同一返回类型 `J` = 打包 Color）。
- **回退安全性**：反射路径全部包在 `runCatching`（捕获 `Throwable`，含
  `NoClassDefFoundError`）内，宿主改版后行为退化为 v0.1.11 的硬编码色，不引入新崩溃。
- **待真机复核**（合入后）：SPW 浅色主题打开「更多」弹窗，Folia 条目应与前 4 项同为深色；
  切回深色主题应为浅色；主题切换无需重启即生效（MutableState 订阅）。
