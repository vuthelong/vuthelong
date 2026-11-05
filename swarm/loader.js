(() => {
  const SRC = new URL("swarm.js", document.currentScript.src).href;
  const api = () => window.__swarmRebuild;
  const running = () => !!(api() && api().app);
  let busy = false;
  let rebuilding = false;
  let watcher = 0;
  let width = 0;

  const restore = () => {
    for (const img of document.querySelectorAll("img[data-swarm-snap]")) img.remove();
    const stage = document.getElementById("stage");
    if (stage) stage.style.removeProperty("visibility");
  };

  const freezeModels = async () => {
    restore();
    if (typeof window.__profileSnapshot !== "function") return;
    const shots = window.__profileSnapshot();
    const imgs = shots.map(({ el, url }) => {
      const img = document.createElement("img");
      img.dataset.swarmSnap = "";
      img.alt = "";
      img.src = url;
      img.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;";
      el.appendChild(img);
      return img;
    });
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    const stage = document.getElementById("stage");
    if (stage) stage.style.setProperty("visibility", "hidden", "important");
  };

  const OVERLAY_CSS =
    ".bg,.layer,.port,.intro,.ov,.badges,.rulers{opacity:0!important;pointer-events:none!important;transition:opacity .6s ease!important}" +
    '.hud [data-a="live"]{display:none!important}';

  const overlay = (a) => {
    if (a.__overlay || a.dead) return;
    a.__overlay = true;
    const style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    a.view.root.appendChild(style);
    a.view.host.style.setProperty("pointer-events", "none", "important");
    restore();
  };

  const hookHud = (a) => {
    if (!a || a.__hooked) return;
    a.__hooked = true;
    a.view.hud.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.dataset.a !== "replay") return;
      e.stopImmediatePropagation();
      rebuild(300, true);
    }, true);
  };

  const mirrorBg = (a) => {
    const src = document.querySelector("svg.bg-art");
    if (!src || !a || a.__bgMirror) return;
    a.__bgMirror = true;
    const cs = getComputedStyle(src);
    const clone = src.cloneNode(true);
    clone.removeAttribute("class");
    clone.style.cssText =
      `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;color:${cs.color};opacity:${cs.opacity};` +
      `-webkit-mask-image:${cs.webkitMaskImage};mask-image:${cs.maskImage};`;
    a.view.bg.appendChild(clone);
    const from = src.querySelector("#bg-icons");
    const to = clone.querySelector("#bg-icons");
    const tick = () => {
      if (a.dead || !a.view.host.isConnected) return;
      const s = from.children;
      const d = to.children;
      if (s.length !== d.length) to.replaceChildren(...[...s].map((n) => n.cloneNode(true)));
      else
        for (let i = 0; i < s.length; i++) {
          const t = s[i].getAttribute("transform");
          if (d[i].getAttribute("transform") !== t) d[i].setAttribute("transform", t);
        }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const inOverlay = () => running() && api().app.__overlay;

  const watch = () => {
    clearInterval(watcher);
    watcher = setInterval(() => {
      const s = api();
      if (!s || !s.app) {
        clearInterval(watcher);
        if (!rebuilding) restore();
        return;
      }
      hookHud(s.app);
      if (s.app.complete && !s.app.__done) {
        const a = s.app;
        a.__done = true;
        setTimeout(() => overlay(a), 1500);
      }
    }, 300);
  };

  const load = () =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });

  const run = async () => {
    if (running() || busy) return;
    busy = true;
    try {
      await freezeModels();
      width = innerWidth;
      if (api()) api().start();
      else await load();
      mirrorBg(api() && api().app);
      watch();
    } catch (_) {
      restore();
    } finally {
      busy = false;
    }
    if (running() && innerWidth !== width) {
      api().stop(false);
      restore();
      resizing = true;
      settle();
    }
  };

  const rebuild = (delay, force) => {
    if (!running() || rebuilding) return;
    if (inOverlay() && !force) return;
    rebuilding = true;
    api().stop(false);
    restore();
    setTimeout(async () => {
      await run();
      rebuilding = false;
    }, delay);
  };

  new MutationObserver(() => rebuild(900)).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  let resizeTimer = 0;
  let resizing = false;
  const settle = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      if (busy || rebuilding) return settle();
      resizing = false;
      await run();
    }, 500);
  };
  addEventListener("resize", () => {
    if (inOverlay() || innerWidth === width) return;
    if (!running() && !resizing && !busy && !rebuilding) return;
    if (running() && !busy) {
      api().stop(false);
      restore();
    }
    resizing = true;
    settle();
  });

  addEventListener("click", (e) => {
    if (!running() || !e.isTrusted || inOverlay()) return;
    const top = e.composedPath()[0];
    if (top && top.closest && top.closest(".hud")) return;
    const btn = document.getElementById("theme-btn");
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) btn.click();
  }, true);

  addEventListener("keydown", (e) => {
    if (e.repeat || /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return;
    const help = document.getElementById("help");
    if (help && help.open) return;
    const plain = e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey && !e.altKey;
    const combo = e.code === "KeyS" && e.altKey && e.shiftKey;
    if (plain || combo) start();
  });

  const start = () => (inOverlay() ? rebuild(300, true) : run());

  const btn = document.getElementById("swarm-btn");
  if (btn) btn.addEventListener("click", start);
})();
