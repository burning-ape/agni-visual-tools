/* ─────────────────────────────────────────────────────────────
   Agni Router — lazy-loads each tool's HTML, CSS, JS on demand.
   Tools register themselves into window.Agni.tools (set in tool JS).
   Public API: launchEditor(id), goHome().
   Also responds to URL hash (#texture, #normalgen, ...).
   ───────────────────────────────────────────────────────────── */
(() => {
  const TOOL_REGISTRY = {
    // existing
    texture:      { paneId: 'editor-app',     html: 'tools/texture-editor.html', js: 'tools/texture-editor.js', module: true },
    bgremove:     { paneId: 'bg-remover-app', html: 'tools/bg-remover.html',     js: 'tools/bg-remover.js',     module: true  },
    maskgen:      { paneId: 'mask-gen-app',   html: 'tools/mask-generator.html', js: 'tools/mask-generator.js', module: false },
    colorreplace: { paneId: 'cr-app',         html: 'tools/color-replacer.html', js: 'tools/color-replacer.js', module: false, init: 'crInit' },
    // new
    normalgen:    { paneId: 'ng-app',         html: 'tools/normal-map.html',     js: 'tools/normal-map.js',     css: 'tools/normal-map.css',     module: false, init: 'ngInit' },
    seamless:     { paneId: 'sm-app',         html: 'tools/seamless.html',       js: 'tools/seamless.js',       css: 'tools/seamless.css',       module: false, init: 'smInit' },
    channelpack:  { paneId: 'cp-app',         html: 'tools/channel-packer.html', js: 'tools/channel-packer.js', css: 'tools/channel-packer.css', module: false, init: 'cpInit' },
    resizer:      { paneId: 'rs-app',         html: 'tools/resizer.html',        js: 'tools/resizer.js',        css: 'tools/resizer.css',        module: false, init: 'rsInit' },
    uvcheck:      { paneId: 'uv-app',         html: 'tools/uv-checker.html',     js: 'tools/uv-checker.js',     css: 'tools/uv-checker.css',     module: true,  init: 'uvInit' },
    atlas:        { paneId: 'at-app',         html: 'tools/atlas-packer.html',   js: 'tools/atlas-packer.js',   css: 'tools/atlas-packer.css',   module: false, init: 'atInit' },
    colormask:    { paneId: 'cm-app',         html: 'tools/color-mask.html',     js: 'tools/color-mask.js',     css: 'tools/color-mask.css',     module: false, init: 'cmInit' },
  };

  const loaded = new Set();
  const loading = new Map();

  async function loadTool(id) {
    const cfg = TOOL_REGISTRY[id];
    if (!cfg) throw new Error('unknown tool: ' + id);
    if (loaded.has(id)) return cfg;
    if (loading.has(id)) return loading.get(id);

    const p = (async () => {
      // 1. fetch HTML fragment and append to body
      const htmlText = await fetch(cfg.html, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error('failed to fetch ' + cfg.html);
        return r.text();
      });
      const wrap = document.createElement('div');
      wrap.innerHTML = htmlText.trim();
      // expect the fragment's root element to be the pane
      const paneEl = wrap.firstElementChild;
      document.body.appendChild(paneEl);

      // 2. optional CSS
      if (cfg.css) {
        await new Promise((res, rej) => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = cfg.css;
          link.onload = res;
          link.onerror = () => res(); // don't block on css 404
          document.head.appendChild(link);
        });
      }

      // 3. script
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        if (cfg.module) s.type = 'module';
        s.src = cfg.js;
        s.onload = res;
        s.onerror = () => rej(new Error('failed to load ' + cfg.js));
        document.body.appendChild(s);
      });

      loaded.add(id);
      return cfg;
    })();

    loading.set(id, p);
    try { await p; } finally { loading.delete(id); }
    return cfg;
  }

  function hideAllPanes() {
    document.querySelectorAll('.tool-pane.is-active').forEach(el => el.classList.remove('is-active'));
  }

  window.launchEditor = async function (id) {
    const menu = document.getElementById('main-menu');
    try {
      const cfg = await loadTool(id);
      menu.classList.add('is-hidden');
      hideAllPanes();
      const pane = document.getElementById(cfg.paneId);
      if (pane) pane.classList.add('is-active');

      // run optional init (idempotent — tools may guard against re-entry)
      if (cfg.init && typeof window[cfg.init] === 'function') {
        try { window[cfg.init](); } catch (e) { console.error(e); }
      }

      // sync URL hash for deep-linking
      if (location.hash.slice(1) !== id) {
        history.replaceState(null, '', '#' + id);
      }

      // force layout recalculation for WebGL etc.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      });
    } catch (err) {
      console.error('[router]', err);
      alert('Failed to load tool: ' + id + '\n' + err.message);
    }
  };

  window.goHome = function () {
    hideAllPanes();
    document.getElementById('main-menu').classList.remove('is-hidden');
    history.replaceState(null, '', '#');
  };

  // hash-based deep linking on first load
  function bootFromHash() {
    const id = location.hash.slice(1);
    if (id && TOOL_REGISTRY[id]) {
      window.launchEditor(id);
    }
  }
  window.addEventListener('hashchange', bootFromHash);
  document.addEventListener('DOMContentLoaded', bootFromHash);

  // expose for debugging
  window.Agni = window.Agni || {};
  window.Agni.tools = TOOL_REGISTRY;
})();
