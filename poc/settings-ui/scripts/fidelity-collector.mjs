/* Task-11 fidelity metrics collector: identical measurements in our overlay and Folia's real page.
 * Pure DOM/CSS, no app internals; runs in any page that shows the 歌词样式 window. */

export function metricsCollector() {
    const round = (v) => Math.round(v * 100) / 100;
    const info = (el, extra = {}) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            rect: { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) },
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            color: cs.color,
            bg: cs.backgroundColor,
            radius: cs.borderRadius,
            border: cs.border,
            padding: cs.padding,
            gap: cs.gap,
            shadow: cs.boxShadow.slice(0, 160),
            fontFamily: cs.fontFamily.slice(0, 100),
            ...extra,
        };
    };
    const visible = (el) => !!el && (el.offsetWidth > 0 || el.offsetHeight > 0);
    const byExact = (sel, text) => [...document.querySelectorAll(sel)].filter(visible).find((e) => (e.textContent || '').trim() === text);
    const includesText = (sel, text) => [...document.querySelectorAll(sel)].filter(visible).find((e) => (e.textContent || '').trim().includes(text));
    const out = { url: location.href, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, windowClass: null };

    const allWins = [...document.querySelectorAll('.st-window')].filter(visible);
    const win = allWins.find((w) => ((w.querySelector('h2') || {}).textContent || '').trim() === '歌词样式') || allWins[allWins.length - 1] || null;
    out.window = info(win);
    out.windowClass = win ? String(win.className) : null;
    out.rootStyles = win ? (() => {
        const cs = getComputedStyle(win);
        const vars = {};
        for (const k of ['--st-win', '--st-card', '--st-side', '--st-raise', '--st-t1', '--st-t2', '--st-t3', '--st-line', '--st-line2', '--st-fill', '--st-fill2', '--st-track', '--st-accent', '--st-knob', '--st-warn']) vars[k] = cs.getPropertyValue(k).trim();
        return { bg: cs.backgroundColor, radius: cs.borderRadius, rows: cs.gridTemplateRows, cols: cs.gridTemplateColumns, vars };
    })() : null;

    // overlay dim: the fixed container rendered by the modal (parent of .st-window)
    const parent = win?.parentElement;
    out.dim = parent ? (() => {
        const cs = getComputedStyle(parent);
        return { cls: String(parent.className).slice(0, 200), bg: cs.backgroundColor, backdrop: cs.backdropFilter, z: cs.zIndex, pos: cs.position, rect: info(parent)?.rect };
    })() : null;

    out.title = info([...document.querySelectorAll('h1,h2')].filter(visible).find((e) => (e.textContent || '').trim() === '歌词样式'));
    out.backBtn = info([...document.querySelectorAll('button')].filter(visible).find((b) => ['返回', 'ui.back', '返回主页'].includes(b.getAttribute('aria-label'))));
    out.header = info(win?.querySelector('header')) || info([...document.querySelectorAll('div')].find((d) => d.querySelector(':scope > h2') && (d.querySelector(':scope > h2').textContent || '').trim() === '歌词样式'));

    // right column container + scroll area
    const tabs = ['歌词动画', '背景', '字体', '字幕'];
    out.tabs = tabs.map((label) => {
        const btn = [...document.querySelectorAll('button')].filter(visible).filter((e) => (e.textContent || '').trim() === label).pop();
        const bar = btn?.parentElement;
        const underline = btn?.querySelector('span, div');
        return {
            label,
            button: info(btn),
            bar: info(bar),
            barClass: bar ? String(bar.className).slice(0, 160) : null,
            underline: btn ? info([...btn.querySelectorAll('*')].find((e) => e !== btn && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')) : null,
        };
    });
    const defaultBtn = [...document.querySelectorAll('button')].filter(visible).find((b) => (b.textContent || '').trim() === '默认');
    out.defaultButton = info(defaultBtn);
    out.defaultClass = defaultBtn ? String(defaultBtn.className).slice(0, 220) : null;

    // right panel scroll container
    const scroller = [...document.querySelectorAll('.st-scroll')].filter(visible).pop();
    out.scroller = info(scroller);
    out.scrollerClass = scroller ? String(scroller.className).slice(0, 160) : null;
    if (scroller) {
        out.scrollerCss = (() => {
            const cs = getComputedStyle(scroller);
            return { scrollbarWidth: cs.scrollbarWidth, scrollbarGutter: cs.scrollbarGutter, overflowY: cs.overflowY, padding: cs.padding };
        })();
        out.scrollerBox = {
            clientWidth: scroller.clientWidth,
            offsetWidth: scroller.offsetWidth,
            scrollbar: scroller.offsetWidth - scroller.clientWidth,
            clientHeight: scroller.clientHeight,
            offsetHeight: scroller.offsetHeight,
            scrollHeight: scroller.scrollHeight,
            scrollTop: scroller.scrollTop,
        };
    }
    out.aside = win ? info(win.querySelector('aside')) : null;

    // group cards (kit Group uses section/div wrappers); find by known section titles
    const sectionTitles = ['智能动感模式', '动感效果', '渲染质量', '动态与构图', '背景类型', '主题', '字幕', '和声字幕', '字幕字体', '歌曲主题'];
    out.sections = {};
    out.sectionHeadings = {};
    for (const title of sectionTitles) {
        const candidates = [...document.querySelectorAll('h3, h4, div, span')]
            .filter(visible)
            .filter((e) => (e.textContent || '').trim() === title)
            .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
        const heading = candidates[0];
        if (heading) out.sectionHeadings[title] = info(heading);
        if (!heading) continue;
        // walk up to the nearest card-ish ancestor (has bg/radius)
        let card = heading;
        for (let i = 0; i < 6 && card.parentElement; i += 1) {
            const cs = getComputedStyle(card);
            if (parseFloat(cs.borderRadius) > 0 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') break;
            card = card.parentElement;
        }
        out.sections[title] = { heading: info(heading), card: info(card), cardClass: String(card.className).slice(0, 160) };
    }

    // kit rows (switch rows / slider rows) — first ones on the active tab
    out.switchRow = info([...document.querySelectorAll('div')].filter(visible).find((d) => d.querySelector('button[role="switch"]') && /^(开关|增强节拍响应|仅在播放页启用动态效果|可读性叠色)$/.test((d.textContent || '').trim().slice(0, 12))));
    const switchBtn = [...document.querySelectorAll('button[role="switch"]')].filter(visible)[0];
    out.switch = info(switchBtn, switchBtn ? { ariaChecked: switchBtn.getAttribute('aria-checked') } : {});
    if (switchBtn) {
        const knob = [...switchBtn.querySelectorAll('*')].filter((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)').pop();
        out.switchKnob = info(knob);
    }
    const range = [...document.querySelectorAll('input[type="range"]')].filter(visible)[0];
    out.slider = info(range, range ? { min: range.min, max: range.max, step: range.step, value: range.value } : {});
    if (range) {
        out.sliderCss = (() => { const cs = getComputedStyle(range); return { appearance: cs.appearance, accentColor: cs.accentColor, height: cs.height, bg: cs.backgroundImage.slice(0, 120) }; })();
        const valueEl = [...document.querySelectorAll('span, div')].filter(visible).find((e) => /^\d+\.\d{2}x$/.test((e.textContent || '').trim()));
        out.sliderValue = info(valueEl);
    }
    // inline notice row (warning / hint text with a leading dot)
    const noticeText = includesText('div, p', '提高纹理分辨率会增加');
    out.notice = info(noticeText?.parentElement || noticeText);
    out.noticeCss = noticeText ? (() => { const cs = getComputedStyle(noticeText); return { color: cs.color, fontSize: cs.fontSize, lineHeight: cs.lineHeight, dotColor: noticeText.firstElementChild ? getComputedStyle(noticeText.firstElementChild).backgroundColor : null }; })() : null;

    // style shelf: tiles + labels + heading
    const radios = [...document.querySelectorAll('[role="radio"]')].filter(visible);
    const tiles = radios.map((el) => {
        const frame = el.querySelector('span');
        const r = el.getBoundingClientRect();
        const fr = frame?.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            label: (el.textContent || '').trim(),
            tile: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100 },
            frame: fr ? { w: Math.round(fr.width * 100) / 100, h: Math.round(fr.height * 100) / 100 } : null,
            frameRadius: frame ? getComputedStyle(frame).borderRadius : null,
            labelFontSize: el.lastElementChild ? getComputedStyle(el.lastElementChild).fontSize : null,
            labelColor: el.lastElementChild ? getComputedStyle(el.lastElementChild).color : null,
            radius: cs.borderRadius,
            checked: el.getAttribute('aria-checked'),
        };
    });
    const gaps = [];
    for (let i = 1; i < Math.min(tiles.length, 8); i += 1) gaps.push(Math.round((tiles[i].tile.x - tiles[i - 1].tile.x - tiles[i - 1].tile.w) * 100) / 100);
    out.styleShelf = { count: tiles.length, tiles: tiles.slice(0, 14), columnGap: gaps.slice(0, 6) };
    const shelfHeading = byExact('h3', '样式') || includesText('h3', '样式');
    out.shelfHeading = info(shelfHeading);

    // preview stage: pause button's ancestor area
    const pauseBtn = [...document.querySelectorAll('button')].filter(visible).find((b) => /^(播放|暂停)$/.test(b.getAttribute('aria-label') || ''));
    out.previewPauseBtn = info(pauseBtn);
    if (pauseBtn) {
        let stage = pauseBtn.parentElement;
        for (let i = 0; i < 4 && stage.parentElement; i += 1) {
            const cs = getComputedStyle(stage);
            if (parseFloat(cs.borderRadius) >= 8 && stage.getBoundingClientRect().height > 120) break;
            stage = stage.parentElement;
        }
        const r = stage.getBoundingClientRect();
        out.previewStage = { ...info(stage), rect: { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 } };
    }
    // background chips (Folia draws a 背景设置 chip over the preview)
    out.bgChip = info([...document.querySelectorAll('button, div')].filter(visible).find((e) => (e.textContent || '').trim() === '背景设置'));
    return out;
}
