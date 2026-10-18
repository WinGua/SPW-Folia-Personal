// Generates docs/folia-spec/tunings.md from research/folia/tuning-defaults.md
const fs = require('fs');
const raw = fs.readFileSync('research/folia/tuning-defaults.md', 'utf8');

const visKeys = ['sonnet', 'tempera', 'lumiere', 'classic', 'cadenza', 'partita', 'fume', 'tilt', 'claddagh', 'monet', 'pendolo', 'cappella', 'diorama', 'still'];
const zh = { sonnet: '商籁', tempera: '凝彩', lumiere: '绘光', classic: '流光', cadenza: '心象', partita: '云阶', fume: '浮名', tilt: '倾诉', claddagh: '回环', monet: '莫奈', pendolo: '时计', cappella: '群唱', diorama: '镜台', still: '静止' };
const panel = {
    sonnet: 'SonnetSettingsPanel (sonnet/SonnetSettingsPanel.tsx)',
    tempera: 'TemperaSettingsPanel (tempera/)',
    lumiere: 'LumiereSettingsPanel (lumiere/)',
    classic: 'ClassicSettingsPanel (settingsPanels.tsx:31)',
    cadenza: '无面板（歌词动画 tab 显示「这个样式没有参数」）',
    partita: 'PartitaSettingsPanel (settingsPanels.tsx:93)',
    fume: 'FumeSettingsPanel (settingsPanels.tsx:171)',
    tilt: 'TiltSettingsPanel (settingsPanels.tsx:514)',
    claddagh: 'CladdaghSettingsPanel (settingsPanels.tsx:762)',
    monet: 'MonetSettingsPanel (monet/)',
    pendolo: 'PendoloSettingsPanel (pendolo/)',
    cappella: 'CappellaSettingsPanel (settingsPanels.tsx:309)',
    diorama: 'DioramaSettingsPanel (settingsPanels.tsx:591)',
    still: '无面板（歌词动画 tab 显示「这个样式没有参数」）',
};
const effect = { sonnet: 'sonnet.lensTear 推镜裂光', diorama: 'diorama.ripple 水镜涟漪', pendolo: 'pendolo.drumhead 仿真鼓面（drums）' };
const cap = s => s[0].toUpperCase() + s.slice(1);
const tuneFiles = { sonnet: 'sonnet/tuning.ts', tempera: 'tempera/tuning.ts', lumiere: 'lumiere/tuning.ts', classic: 'classic/tuning.ts', cadenza: 'cadenza/tuning.ts', partita: 'partita/tuning.ts', fume: 'fume/tuning.ts', tilt: 'tilt/tuning.ts', claddagh: 'claddagh/tuning.ts', monet: 'monet/tuning.ts', pendolo: 'pendolo/tuning.ts', cappella: 'cappella/tuning.ts', diorama: 'diorama/tuning.ts' };

let md = '# Folia 各歌词样式 tuning 键与默认值\n\n';
md += '> 自动抽取自 `src/types.ts` 的 `DEFAULT_<MODE>_TUNING`（v0.7.21）与各 `src/components/visualizer/<mode>/tuning.ts` 的声明。所有值持久化在 localStorage；「默认」按钮（歌词动画 tab）写回 defaults 并弹 `notifications.<mode>Reset` toast。\n';
md += '> 配套文档：`docs/folia-spec/settings-ui.md`（设置窗口/控件/默认值）、`docs/folia-spec/style-map.md`（14 样式映射）。\n\n';

md += '## 1. 样式 tuning 一览（13 个样式有 tuning；still 没有）\n\n';
md += '| 样式 dir | 中文名 | tuning mode | settingsKey | setter | resetter | localStorage key | 设置面板 | 动感效果 |\n|---|---|---|---|---|---|---|---|---|\n';
for (const k of visKeys) {
    if (k === 'still') {
        md += '| still | 静止 | —（无 tuning.ts） | — | — | — | — | 无 | — |\n';
        continue;
    }
    md += `| ${k} | ${zh[k]} | \`${k}\` | \`${k}Tuning\` | \`handleSet${cap(k)}Tuning\` | \`handleReset${cap(k)}Tuning\` | \`${k}_tuning\` | ${panel[k]} | ${effect[k] || '—'} |\n`;
}
md += '\n- tuning.ts 位置：`src/components/visualizer/<mode>/tuning.ts`（' + visKeys.filter(k => k !== 'still').map(k => `\`${tuneFiles[k]}\``).join('、') + '）。\n';
md += '- 唯一带 `olderKeys` 的是 cadenza（旧键 `cadenze_tuning`，`cadenza/tuning.ts:21`）。\n';
md += '- `applyVisualizerTuning(mode, props, bundle)` 把 tuning 以命名 prop（如 `sonnetTuning`）传给样式 renderer，同时 `props.visualizerTunings` 带整包 bundle（`tuningRegistry.ts`）。\n';
md += '- 每个 `tuning.ts` 可声明 `preview(draft, saved)`（拖动滑块时预览画什么）、`apply(props, tuning)`、`storage: {key, olderKeys, read, merge, onChange, resetNotice, actions}`（`tuningDefinition.ts`）。\n';
md += '- 默认 `preview` 行为：预览画 draft；`apply` 一律 `{...props, <mode>Tuning: tuning}`（monet 额外设 `onMonetTuningChange`）。\n\n';

// Defaults blocks
const blocks = raw.split(/^## /m).filter(Boolean);
const visBlocks = [];
const bgBlocks = [];
for (const b of blocks) {
    const name = b.split('\n')[0];
    (name.includes('_BACKGROUND_') ? bgBlocks : visBlocks).push(b);
}
md += '## 2. 各样式默认值（`DEFAULT_<MODE>_TUNING` 原文）\n\n';
for (const b of visBlocks) {
    const lines = b.trim().split('\n');
    const title = lines[0].replace(/^DEFAULT_(\w+)_TUNING \((.+)\)$/, (m, a, type) => `${cap(a.toLowerCase())} —— ${type}`);
    md += '### ' + title + '\n```ts\n' + lines.slice(1).join('\n') + '\n```\n\n';
}
md += '## 3. 背景 tuning 默认值（`backgrounds/<mode>/tuning.ts` 用）\n\n';
md += '背景 mode：`common`、`latent`（默认）、`monet`、`nomand`、`sora`、`url`；下述为有 tuning 对象的背景。\n\n';
for (const b of bgBlocks) {
    const lines = b.trim().split('\n');
    const title = lines[0].replace(/^DEFAULT_(\w+)_TUNING \((.+)\)$/, (m, a, type) => `${cap(a.toLowerCase())} —— ${type}`);
    md += '### ' + title + '\n```ts\n' + lines.slice(1).join('\n') + '\n```\n\n';
}
md += '## 4. 与设置 UI 的关系\n\n';
md += '- 每个样式的设置面板把 tuning 字段渲染成 kit 控件；字段的 label 文案在各样式面板文件里（如 sonnet 见 `docs/folia-spec/settings-ui.md` §3.4）。\n';
md += '- 所有数值区间不在 types 里，而在面板组件里（SliderRow 的 min/max/step）。WebView 复刻时以面板源文件为准。\n';
md += '- 13 个 tuning 的默认值随 Folia 版本变化；迁移桌面 Folia 配置时按 `DEFAULT_*_TUNING` 做 merge（`readStoredTuning` 会把缺字段补默认）。\n';

fs.writeFileSync('docs/folia-spec/tunings.md', md);
console.log('wrote', md.length, 'chars, blocks', visBlocks.length, '+', bgBlocks.length);
