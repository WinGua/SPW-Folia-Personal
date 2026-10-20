/* spw-folia promo site — interaction layer */
(function () {
  "use strict";

  /* ── the 14 real Folia styles ─────────────────────────────── */
  const STYLES = [
    { id: "sonnet",    zh: "商籁",  en: "Sonnet"    },
    { id: "tempera",   zh: "凝彩",  en: "Tempera"   },
    { id: "lumiere",   zh: "绘光",  en: "Lumiere"   },
    { id: "classic",   zh: "流光",  en: "Classic"   },
    { id: "cadenza",   zh: "心象",  en: "Cadenza"   },
    { id: "partita",   zh: "云阶",  en: "Partita"   },
    { id: "fume",      zh: "浮名",  en: "Fume"      },
    { id: "tilt",      zh: "倾诉",  en: "Tilt"      },
    { id: "claddagh",  zh: "回环",  en: "Claddagh"  },
    { id: "monet",     zh: "莫奈",  en: "Monet"     },
    { id: "pendolo",   zh: "时计",  en: "Pendolo"   },
    { id: "cappella",  zh: "群唱",  en: "Cappella"  },
    { id: "diorama",   zh: "镜台",  en: "Diorama"   },
    { id: "still",     zh: "静止",  en: "Still"     },
  ];

  /* ── gallery ──────────────────────────────────────────────── */
  const gallery = document.getElementById("gallery");
  if (gallery) {
    const frag = document.createDocumentFragment();
    STYLES.forEach((s, i) => {
      const btn = document.createElement("button");
      btn.className = "tile";
      btn.type = "button";
      btn.dataset.src = `assets/styles/large/${s.id}.jpg`;
      btn.dataset.name = `${s.zh} ${s.en}`;
      btn.setAttribute("aria-label", `放大查看「${s.zh}」样式截图`);
      btn.style.setProperty("--i", String(i));
      btn.innerHTML =
        `<img src="assets/styles/${s.id}.jpg" alt="Folia「${s.zh}」样式：金色逐字歌词渲染画面" loading="lazy" decoding="async" />` +
        `<span class="tile-label"><b>${s.zh}</b><i>${s.en}</i></span>`;
      frag.appendChild(btn);
    });
    gallery.appendChild(frag);
  }

  /* ── reveal on scroll ─────────────────────────────────────── */
  const reveals = Array.from(document.querySelectorAll(".reveal"));
  if ("IntersectionObserver" in window && reveals.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target;
          const delay = Number(el.dataset.delay || 0);
          setTimeout(() => el.classList.add("in"), delay);
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );
    reveals.forEach((el, i) => {
      // stagger siblings that share a parent, so grids cascade
      if (!el.dataset.delay) el.dataset.delay = String((i % 4) * 90);
      io.observe(el);
    });
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ── counting stats ───────────────────────────────────────── */
  const counters = Array.from(document.querySelectorAll(".count"));
  const runCount = (el) => {
    if (el.dataset.done) return;
    el.dataset.done = "1";
    const to = Number(el.dataset.to || 0);
    const dur = 1400;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(to * eased));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = String(to);
    };
    requestAnimationFrame(tick);
  };
  if ("IntersectionObserver" in window && counters.length) {
    const co = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { runCount(e.target); co.unobserve(e.target); } }),
      { threshold: 0.5 }
    );
    counters.forEach((c) => co.observe(c));
  } else {
    counters.forEach((c) => (c.textContent = c.dataset.to));
  }

  /* ── nav background on scroll ─────────────────────────────── */
  const nav = document.getElementById("nav");
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle("solid", window.scrollY > 40);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ── lazy video loading (don't pull 5MB on first paint) ───── */
  const vids = Array.from(document.querySelectorAll("video.frame-video, video.desk-video"));
  if ("IntersectionObserver" in window && vids.length) {
    const vo = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          const v = e.target;
          if (!e.isIntersecting) {
            if (!v.paused) v.pause();
            return;
          }
          if (!v.dataset.loaded) {
            v.dataset.loaded = "1";
            v.load();
          }
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        });
      },
      { threshold: 0.15 }
    );
    vids.forEach((v) => vo.observe(v));
  }

  /* the promo film never autoplays — just warm it when nearby */
  const film = document.querySelector("video.film-video");
  if (film && "IntersectionObserver" in window) {
    const fo = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting || film.dataset.loaded) return;
        film.dataset.loaded = "1";
        film.load();
        fo.disconnect();
      }),
      { rootMargin: "300px 0px" }
    );
    fo.observe(film);
  }

  /* ── lightbox ─────────────────────────────────────────────── */
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = '<img alt="" /><button class="lightbox-close" type="button" aria-label="关闭">✕</button>';
  document.body.appendChild(lb);
  const lbImg = lb.querySelector("img");
  const closeLb = () => {
    lb.classList.remove("open");
    document.body.style.overflow = "";
  };
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.classList.contains("lightbox-close")) closeLb(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLb(); });

  gallery &&
    gallery.addEventListener("click", (e) => {
      const tile = e.target.closest(".tile");
      if (!tile) return;
      lbImg.src = tile.dataset.src;
      lbImg.alt = tile.dataset.name;
      lb.classList.add("open");
      document.body.style.overflow = "hidden";
    });

  /* ── hero video: pause when scrolled away ─────────────────── */
  const heroVideo = document.querySelector(".hero-video");
  if (heroVideo && "IntersectionObserver" in window) {
    const ho = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { const p = heroVideo.play(); if (p && p.catch) p.catch(() => {}); }
        else heroVideo.pause();
      }),
      { threshold: 0.02 }
    );
    ho.observe(heroVideo);
  }
})();
