import os, re, sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = 'site'
SRC = r'C:\Windows\Fonts\NotoSerifSC-VF.ttf'
os.makedirs('site/assets/fonts', exist_ok=True)

# 1. Collect every character appearing in the site's own text/CSS/JS.
chars = set()
for dirpath, _, names in os.walk(ROOT):
    if 'assets' in dirpath.split(os.sep):
        continue
    for n in names:
        if not n.endswith(('.html', '.css', '.js', '.md')):
            continue
        with open(os.path.join(dirpath, n), encoding='utf-8') as f:
            chars.update(f.read())

# 2. Always include full ASCII + CJK punctuation + a few typographic marks.
chars.update(chr(c) for c in range(0x20, 0x7F))
chars.update('　、。〃〈〉《》「」『』【】〔〕〖〗!＂#$%＆\'（）＊＋，－．／：；＜＝＞？＠［］＾＿｀｛｜｝～…—–·‘’“”•→←↑↓✦✕')
chars.update('〇一二三四五六七八九十百千万亿')

# drop controls/newlines
text = ''.join(sorted(c for c in chars if c.isprintable() or c == ' '))

print(f'unique chars: {len(text)}')

opts = subset.Options()
opts.flavor = 'woff2'
opts.desubroutinize = True
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.notdef_outline = True
opts.recalc_bounds = True
opts.drop_tables += ['DSIG']

font = subset.load_font(SRC, opts)
sub = subset.Subsetter(options=opts)
sub.populate(text=text)
sub.subset(font)
out = os.path.join('site/assets/fonts', 'serif.woff2')
subset.save_font(font, out, opts)
print(f'{out}: {os.path.getsize(out)/1024:.0f} KB (from {os.path.getsize(SRC)/1048576:.1f} MB)')

# sanity: confirm every site char is present
f2 = TTFont(out)
cmap = f2.getBestCmap()
missing = [c for c in text if c not in cmap and not c.isspace()]
print('missing glyphs:', ''.join(missing) if missing else 'none')
