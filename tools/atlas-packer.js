/* ─────────────────────────────────────────────────────────────
   Atlas Packer
   - MaxRects bin-packing (best-area-fit heuristic). Handles
     arbitrary sprite sizes without rotation (keeps JSON simple).
   - Grid algorithm = uniform tile, useful for tilemaps.
   - Three JSON output formats. PNG + JSON download as a pair.
   ───────────────────────────────────────────────────────────── */
(function () {
  const sprites = []; // {name, img, w, h, trimmedRect:{x,y,w,h}}
  let atInited = false;
  let lastAtlas = null; // {canvas, frames}

  function $(id) { return document.getElementById(id); }

  function init() {
    if (atInited) return; atInited = true;

    const drop = $('atDrop'), fileIn = $('atFileIn');
    const area = $('atCanvasArea');
    const addMore = $('atAddMore');

    // Both the initial dropzone AND the "+ add more" button open the picker.
    drop.addEventListener('click', () => fileIn.click());
    addMore.addEventListener('click', () => fileIn.click());

    fileIn.addEventListener('change', e => {
      Array.from(e.target.files).forEach(addFile);
      fileIn.value = '';
    });

    // Drag-and-drop works on the entire canvas area, not just the
    // initial dropzone — so users can keep dropping files after the
    // preview takes over the visible space.
    //
    // We track dragenter/leave with a counter because dragleave fires
    // for every child element you cross, not just on exit.
    let dragDepth = 0;
    area.addEventListener('dragenter', e => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      area.classList.add('dragover');
    });
    area.addEventListener('dragover', e => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
    });
    area.addEventListener('dragleave', e => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) area.classList.remove('dragover');
    });
    area.addEventListener('drop', e => {
      e.preventDefault();
      dragDepth = 0;
      area.classList.remove('dragover');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files) Array.from(files).forEach(addFile);
    });

    $('atPad').addEventListener('input', e => { $('atPadVal').textContent = e.target.value; repack(); });
    $('atAlgo').addEventListener('change', repack);
    $('atMax').addEventListener('change', repack);
    $('atPot').addEventListener('change', repack);
    $('atTrim').addEventListener('change', repack);
    $('atShowGuides').addEventListener('change', renderPreview);
    $('atPack').addEventListener('click', download);
  }

  function addFile(file) {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sprites.push({
        name: (file.name || 'sprite').replace(/\.[^.]+$/, ''),
        img, url,
        w: img.naturalWidth,
        h: img.naturalHeight,
      });
      renderSpriteList();
      repack();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  function renderSpriteList() {
    const list = $('atSpriteList');
    list.innerHTML = '';
    if (sprites.length === 0) {
      list.innerHTML = '<div class="at-empty">none loaded</div>';
      return;
    }
    sprites.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'at-sp-row';
      row.innerHTML = `
        <img src="${s.url}">
        <div class="nm" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
        <div class="sz">${s.w}×${s.h}</div>
        <button class="rm" data-i="${i}">✕</button>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('.rm').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.i, 10);
        URL.revokeObjectURL(sprites[i].url);
        sprites.splice(i, 1);
        renderSpriteList();
        repack();
      });
    });
  }

  function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

  // ── Trim transparent pixels per sprite (returns {x,y,w,h}) ──
  function computeTrim(img) {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = id.data;
    let minX = cv.width, minY = cv.height, maxX = -1, maxY = -1;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const a = d[(y * cv.width + x) * 4 + 3];
        if (a > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { x: 0, y: 0, w: cv.width, h: cv.height }; // fully transparent
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // ── MaxRects packing ──
  function packBinPack(rects, maxSize, padding) {
    // sort biggest first (sum of side lengths is decent heuristic)
    rects.sort((a, b) => (b.w + b.h) - (a.w + a.h));

    // grow atlas until everything fits or we exceed maxSize
    let size = 64;
    while (size <= maxSize) {
      const result = tryPackAt(rects, size, size, padding);
      if (result) return { width: size, height: size, placements: result };
      size *= 2;
    }
    return null;
  }

  function tryPackAt(rects, W, H, pad) {
    // free list of rectangles {x,y,w,h}
    let free = [{ x: 0, y: 0, w: W, h: H }];
    const placements = new Array(rects.length);

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const rw = r.w + pad * 2;
      const rh = r.h + pad * 2;
      // pick best (smallest) free that fits
      let bestIdx = -1, bestScore = Infinity;
      for (let j = 0; j < free.length; j++) {
        const f = free[j];
        if (f.w >= rw && f.h >= rh) {
          const score = f.w * f.h; // smallest free area first
          if (score < bestScore) { bestScore = score; bestIdx = j; }
        }
      }
      if (bestIdx < 0) return null;
      const chosen = free[bestIdx];
      placements[i] = { x: chosen.x + pad, y: chosen.y + pad, w: r.w, h: r.h, ref: r };
      // split chosen into two free rects (guillotine split)
      const splitA = { x: chosen.x + rw, y: chosen.y, w: chosen.w - rw, h: rh };
      const splitB = { x: chosen.x, y: chosen.y + rh, w: chosen.w, h: chosen.h - rh };
      free.splice(bestIdx, 1);
      if (splitA.w > 0 && splitA.h > 0) free.push(splitA);
      if (splitB.w > 0 && splitB.h > 0) free.push(splitB);
    }
    return placements;
  }

  function packGrid(rects, maxSize, padding) {
    const cellW = Math.max(...rects.map(r => r.w));
    const cellH = Math.max(...rects.map(r => r.h));
    const cw = cellW + padding * 2;
    const ch = cellH + padding * 2;
    const n = rects.length;
    const cols = Math.ceil(Math.sqrt(n * ch / cw));
    const rows = Math.ceil(n / cols);
    const W = cols * cw;
    const H = rows * ch;
    if (W > maxSize || H > maxSize) return null;
    const placements = rects.map((r, i) => {
      const c = i % cols, r2 = Math.floor(i / cols);
      return { x: c * cw + padding, y: r2 * ch + padding, w: r.w, h: r.h, ref: r };
    });
    return { width: W, height: H, placements };
  }

  function nextPot(v) { let p = 1; while (p < v) p *= 2; return p; }

  async function repack() {
    if (sprites.length === 0) {
      lastAtlas = null;
      $('atPack').disabled = true;
      $('atInfo').textContent = 'Drop sprites to begin.';
      $('atPreviewWrap').style.display = 'none';
      $('atDrop').style.display = 'block';
      return;
    }

    const padding = parseInt($('atPad').value, 10);
    const maxSize = parseInt($('atMax').value, 10);
    const algo = $('atAlgo').value;
    const wantPot = $('atPot').checked;
    const trim = $('atTrim').checked;

    // compute trim if requested
    const items = sprites.map(s => {
      const tr = trim ? computeTrim(s.img) : { x: 0, y: 0, w: s.w, h: s.h };
      return {
        name: s.name, img: s.img,
        ow: s.w, oh: s.h,        // original
        tx: tr.x, ty: tr.y,      // trim offset within original
        w: tr.w, h: tr.h,        // packed size
      };
    });

    const packResult = algo === 'grid'
      ? packGrid(items, maxSize, padding)
      : packBinPack(items, maxSize, padding);

    if (!packResult) {
      $('atInfo').textContent = "Doesn't fit. Increase max atlas size.";
      $('atPack').disabled = true;
      lastAtlas = null;
      return;
    }

    let W = packResult.width, H = packResult.height;
    if (wantPot) { W = nextPot(W); H = nextPot(H); }

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    const frames = [];
    packResult.placements.forEach(p => {
      ctx.drawImage(p.ref.img, p.ref.tx, p.ref.ty, p.w, p.h, p.x, p.y, p.w, p.h);
      frames.push({
        name: p.ref.name,
        frame: { x: p.x, y: p.y, w: p.w, h: p.h },
        sourceSize: { w: p.ref.ow, h: p.ref.oh },
        spriteSourceSize: { x: p.ref.tx, y: p.ref.ty, w: p.w, h: p.h },
        trimmed: trim && (p.ref.tx !== 0 || p.ref.ty !== 0 || p.w !== p.ref.ow || p.h !== p.ref.oh),
      });
    });

    // efficiency metric: occupied / total
    const used = frames.reduce((a, f) => a + f.frame.w * f.frame.h, 0);
    const efficiency = ((used / (W * H)) * 100).toFixed(1);

    lastAtlas = { canvas: cv, frames, W, H, efficiency };
    renderPreview();
    $('atPack').disabled = false;
    $('atInfo').textContent = `${frames.length} sprites · ${W}×${H} · ${efficiency}% used`;
  }

  // Renders the current lastAtlas into the visible preview canvas,
  // optionally overlaying sprite-boundary guides so the user can see
  // the actual packing geometry.
  function renderPreview() {
    if (!lastAtlas) return;
    $('atPreviewWrap').style.display = 'flex';
    $('atDrop').style.display = 'none';
    const out = $('atPreview');
    const { canvas, frames, W, H } = lastAtlas;
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(canvas, 0, 0);

    if ($('atShowGuides').checked) {
      // outline each sprite with the brand orange at 1 device-pixel weight
      ctx.strokeStyle = '#ff5a1f';
      ctx.lineWidth = Math.max(1, Math.round(Math.min(W, H) / 512));
      frames.forEach(f => {
        ctx.strokeRect(f.frame.x + 0.5, f.frame.y + 0.5, f.frame.w - 1, f.frame.h - 1);
      });
    }
    $('atStatus').textContent = `${frames.length} sprites · ${W}×${H} · ${lastAtlas.efficiency}% used`;
  }

  async function download() {
    if (!lastAtlas) return;
    const { canvas, frames, W, H } = lastAtlas;
    const pngBlob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    triggerDownload(pngBlob, 'atlas.png');
    const fmt = $('atFormat').value;
    const jsonText = serializeJson(fmt, frames, W, H);
    triggerDownload(new Blob([jsonText], { type: 'application/json' }), 'atlas.json');
  }

  function serializeJson(fmt, frames, W, H) {
    if (fmt === 'phaser') {
      // TexturePacker-compatible (Phaser-friendly)
      const obj = {
        frames: {},
        meta: { app: 'Agni Atlas Packer', version: '1.0', image: 'atlas.png', size: { w: W, h: H }, scale: '1' },
      };
      frames.forEach(f => {
        obj.frames[f.name] = {
          frame: f.frame,
          rotated: false,
          trimmed: f.trimmed,
          spriteSourceSize: f.spriteSourceSize,
          sourceSize: f.sourceSize,
        };
      });
      return JSON.stringify(obj, null, 2);
    }
    if (fmt === 'json-array') {
      return JSON.stringify({
        frames: frames.map(f => ({
          filename: f.name,
          frame: f.frame, rotated: false, trimmed: f.trimmed,
          spriteSourceSize: f.spriteSourceSize, sourceSize: f.sourceSize,
        })),
        meta: { app: 'Agni Atlas Packer', image: 'atlas.png', size: { w: W, h: H } },
      }, null, 2);
    }
    // 'agni' simple
    return JSON.stringify({
      atlas: { w: W, h: H, image: 'atlas.png' },
      sprites: frames.map(f => ({
        name: f.name,
        x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h,
        ox: f.sourceSize.w, oy: f.sourceSize.h,
        tx: f.spriteSourceSize.x, ty: f.spriteSourceSize.y,
      })),
    }, null, 2);
  }

  function triggerDownload(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  window.atInit = function atInit() { init(); };
  init();
})();
