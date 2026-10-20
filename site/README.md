# spw-folia promo site

A single-page, fully static promo site for spw-folia. No build step, no
dependencies at runtime, no network requests — open `index.html` and it works
(though a local HTTP server is better for the videos' range requests).

Deployed to **https://azkbzxf.github.io/spw-folia/** by
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) on every push
that touches `site/**`.

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The page. All copy is hand-written Chinese; the nav, hero, seven sections, closing band and footer. |
| `style.css` | All styling: ink/gold palette, serif display type, reveal animations, responsive rules, `prefers-reduced-motion` support. |
| `main.js` | Style gallery injection, scroll reveals, stat counters, lazy video playback, and the lightbox. |
| `assets/fonts/serif.woff2` | Subset of Noto Serif SC (495 glyphs) covering exactly the characters the site uses. |
| `assets/styles/*.jpg` | 14 gallery thumbnails, 960×540. |
| `assets/styles/large/*.jpg` | The same 14 at 1600×900 for the lightbox. |
| `assets/video/` | Four H.264 clips plus posters: `hero` (page background), `reel` (Folia styles montage), `overlay` (transparent desktop), `tour` (the 48 s recorded walkthrough of this site). |
| `assets/stills/` | The two UI screenshots used in the copy (`menu-folia.png`, `settings-ui.jpg`). |
| `tools/` | Scripts that regenerate everything above. See below. |

## Regenerating the assets

All the screenshots and videos are **real renders of the Folia visualizer**,
not mockups: the tools drive the same production bundle the plugin ships, in a
headless Edge, through the OBS browser-source protocol implemented by
`poc/webview/server/server.mjs`.

Prerequisites:

- `poc/webview/dist/` — the Folia bundle (gitignored; rebuild with the
  instructions in `poc/webview/README.md`).
- `poc/webview/server/node_modules/` — `cd poc/webview/server && pnpm install`.
- A full ffmpeg with libx264 for `encode.sh` (the Playwright-bundled ffmpeg is
  trimmed and cannot encode H.264). Point `FFMPEG=/path/to/ffmpeg` at one.
- Python with Pillow and fontTools for the two `.py` scripts.

Then:

```bash
cd poc/webview/server && pnpm install && cd -

# 14 style stills, sampled at the middle of each lyric line (~4 min)
node site/tools/capture-styles.mjs .tmp-capture/gallery
python site/tools/make-gallery.py .tmp-capture/gallery

# style stills for the reels and the overlay demo (~2 min)
node site/tools/capture-hero.mjs
node site/tools/capture-scenes.mjs

# the recorded walkthrough of the page itself (~1 min)
node site/tools/tour.mjs

# encode every video asset + posters
FFMPEG=/path/to/ffmpeg bash site/tools/encode.sh

# subset the serif font to the page's own characters
python site/tools/make-font.py
```

`capture-styles.mjs` accepts an optional mode list and phase list:
`node site/tools/capture-styles.mjs .tmp-capture/gallery lumiere,sonnet 2.2,6.2`.
It aims each screenshot at the middle of a lyric line because the demo track is
a 16 s loop and character-by-character styles are nearly empty at a line
boundary — a random screenshot usually lands on that boundary.

`tempera` and `monet` paint their own opaque backdrop, so the capture tool
renders those two without the transparent flag; the other twelve are composited
over a hand-drawn gradient.

## Deploying

Push to `main`; the workflow uploads `site/` as the Pages artifact. Nothing is
built, so what you see locally is exactly what gets served.

## Licensing

The page text and the capture tooling are AGPL-3.0, same as the rest of the
repository. The Folia visualizer renders are images of the Folia project
(`chthollyphile/Folia`, AGPL-3.0); the site credits it in the footer.
