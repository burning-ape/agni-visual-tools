#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────
   Build a single-file standalone version of Agni Visual Tools.
   The modular index.html uses fetch() for lazy loading, which
   browsers block on file:// URLs. The standalone build inlines
   every tool's HTML / JS / CSS into one document so users can
   open it by double-click.
   Usage:  node build.js
   Output: agni-standalone.html
   ───────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TOOLS = path.join(ROOT, 'tools');
const OUT = path.join(ROOT, 'agni-standalone.html');

// Same registry the router uses; kept in sync manually for now.
const TOOL_REGISTRY = {
  texture:      { paneId: 'editor-app',     base: 'texture-editor',  module: true,  hasCss: false },
  bgremove:     { paneId: 'bg-remover-app', base: 'bg-remover',      module: true,  hasCss: false },
  maskgen:      { paneId: 'mask-gen-app',   base: 'mask-generator',  module: false, hasCss: false },
  colorreplace: { paneId: 'cr-app',         base: 'color-replacer',  module: false, hasCss: false },
  normalgen:    { paneId: 'ng-app',         base: 'normal-map',      module: false, hasCss: true  },
  seamless:     { paneId: 'sm-app',         base: 'seamless',        module: false, hasCss: true  },
  channelpack:  { paneId: 'cp-app',         base: 'channel-packer',  module: false, hasCss: true  },
  resizer:      { paneId: 'rs-app',         base: 'resizer',         module: false, hasCss: true  },
  uvcheck:      { paneId: 'uv-app',         base: 'uv-checker',      module: true,  hasCss: true  },
  atlas:        { paneId: 'at-app',         base: 'atlas-packer',    module: false, hasCss: true  },
  colormask:    { paneId: 'cm-app',         base: 'color-mask',      module: false, hasCss: true  },
};

const read = p => fs.readFileSync(p, 'utf8');

// Start with the modular shell.
let shell = read(path.join(ROOT, 'index.html'));

// 1. Inline the shared stylesheet.
const sharedCss = read(path.join(ROOT, 'css/agni.css'));
shell = shell.replace(
  /<link rel="stylesheet" href="css\/agni\.css">/,
  `<style>\n${sharedCss}\n</style>`
);

// 2. Inline the shared session script.
const sharedSession = read(path.join(ROOT, 'js/shared-session.js'));
shell = shell.replace(
  /<script src="js\/shared-session\.js"><\/script>/,
  `<script>\n${sharedSession}\n</script>`
);

// 3. Build inline templates + module bundles for every tool.
//    Each tool gets:
//      <template id="tpl-<id>">  ...html fragment...  </template>
//      <style data-tool="<id>">  ...tool css...  </style>      (if any)
//    Tool scripts are NOT inlined upfront — we still load them
//    on demand so first paint stays cheap and we don't pull THREE
//    until the user opens a 3D tool. But we register the script
//    text in a global JS map the standalone router reads from.

let templatesBlock = '';
let toolScriptsMap = 'window.__AGNI_TOOL_SOURCE = {\n';

for (const [id, cfg] of Object.entries(TOOL_REGISTRY)) {
  const htmlPath = path.join(TOOLS, `${cfg.base}.html`);
  const jsPath   = path.join(TOOLS, `${cfg.base}.js`);
  const cssPath  = path.join(TOOLS, `${cfg.base}.css`);

  const htmlText = read(htmlPath);
  const jsText   = read(jsPath);
  const cssText  = cfg.hasCss && fs.existsSync(cssPath) ? read(cssPath) : '';

  // Template for the DOM fragment.
  templatesBlock += `<template id="tpl-${id}">${htmlText}</template>\n`;

  // CSS goes straight into a <style> tag.
  if (cssText) {
    templatesBlock += `<style data-tool="${id}">${cssText}</style>\n`;
  }

  // JS goes into a JSON-encoded string so the standalone router
  // can eval/inject it on first launch.
  toolScriptsMap += `  ${JSON.stringify(id)}: { module: ${cfg.module}, code: ${JSON.stringify(jsText)} },\n`;
}
toolScriptsMap += '};\n';

// 4. Replace the modular router with a standalone version.
//    The standalone router reads from inline templates + the source map,
//    so it never calls fetch().
const standaloneRouter = `
${toolScriptsMap}

(() => {
  const TOOL_REGISTRY = ${JSON.stringify(
    Object.fromEntries(Object.entries(TOOL_REGISTRY).map(([k, v]) => [k, { paneId: v.paneId }]))
  )};
  const mounted = new Set();

  function mountTool(id) {
    if (mounted.has(id)) return;
    const tpl = document.getElementById('tpl-' + id);
    if (!tpl) throw new Error('No template for ' + id);
    // Clone the template fragment into the body.
    const frag = tpl.content.cloneNode(true);
    document.body.appendChild(frag);
    // Inject script text.
    const src = window.__AGNI_TOOL_SOURCE[id];
    if (src) {
      const s = document.createElement('script');
      if (src.module) s.type = 'module';
      s.textContent = src.code;
      document.body.appendChild(s);
    }
    mounted.add(id);
  }

  function hideAllPanes() {
    document.querySelectorAll('.tool-pane.is-active').forEach(el => el.classList.remove('is-active'));
  }

  window.launchEditor = function (id) {
    try {
      mountTool(id);
    } catch (e) {
      console.error('[router]', e);
      alert('Failed to launch ' + id + ': ' + e.message);
      return;
    }
    document.getElementById('main-menu').classList.add('is-hidden');
    hideAllPanes();
    const cfg = TOOL_REGISTRY[id];
    const pane = document.getElementById(cfg.paneId);
    if (pane) pane.classList.add('is-active');

    if (location.hash.slice(1) !== id) {
      history.replaceState(null, '', '#' + id);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))));
  };

  window.goHome = function () {
    hideAllPanes();
    document.getElementById('main-menu').classList.remove('is-hidden');
    history.replaceState(null, '', '#');
  };

  function bootFromHash() {
    const id = location.hash.slice(1);
    if (id && TOOL_REGISTRY[id]) window.launchEditor(id);
  }
  window.addEventListener('hashchange', bootFromHash);
  document.addEventListener('DOMContentLoaded', bootFromHash);
})();
`;

shell = shell.replace(
  /<script src="js\/router\.js"><\/script>/,
  `<script>${standaloneRouter}</script>`
);

// 5. Inject templates block right before the importmap.
shell = shell.replace(
  /<!-- importmap so any module-tool/,
  `${templatesBlock}\n<!-- importmap so any module-tool`
);

fs.writeFileSync(OUT, shell, 'utf8');

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`Wrote ${path.relative(ROOT, OUT)} (${kb} KB)`);
