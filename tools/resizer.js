/* ─────────────────────────────────────────────────────────────
   Resizer — batch
   - Lanczos and Mitchell are implemented as separable filters on
     ImageData. Slow for huge images but accurate.
   - Bilinear/Nearest use the canvas built-in (fast).
   - Power-of-2 mode snaps each image to the nearest POT.
   ───────────────────────────────────────────────────────────── */
(function () {
  const items = [];          // {file, img, status}
  let rsInited = false;

  function $(id) { return document.getElementById(id); }

  const MODE_TEMPLATES = {
    longest: () => `
      <h3>Longest side (px)</h3>
      <input type="number" id="rsLongest" value="1024" min="1" max="16384"
             class="sm-select" style="font-family:var(--mono)">
    `,
    exact: () => `
      <h3>Exact size</h3>
      <div class="rs-mode-opts">
        <label>W <input type="number" id="rsExactW" value="512" min="1" max="16384"></label>
        <label>H <input type="number" id="rsExactH" value="512" min="1" max="16384"></label>
        <label><input type="checkbox" id="rsExactKeep" checked> keep aspect (fit inside)</label>
      </div>
    `,
    scale: () => `
      <h3>Scale</h3>
      <div class="ng-slider-row">
        <input type="range" id="rsScale" min="1" max="400" step="1" value="50">
        <span class="ng-val" id="rsScaleVal">50%</span>
      </div>
    `,
    pot: () => `
      <h3>Power-of-2</h3>
      <div class="rs-mode-opts">
        <label><select id="rsPotDir">
          <option value="nearest">Snap to nearest</option>
          <option value="up">Round up</option>
          <option value="down">Round down</option>
        </select></label>
        <label><input type="checkbox" id="rsPotSquare"> force square</label>
      </div>
      <div class="ng-hint">Common in game-dev: 256 / 512 / 1024 / 2048.</div>
    `,
  };

  function init() {
    if (rsInited) return; rsInited = true;

    const drop = $('rsDrop'), fileIn = $('rsFileIn');
    drop.addEventListener('click', () => fileIn.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('drag');
      Array.from(e.dataTransfer.files).forEach(addFile);
    });
    fileIn.addEventListener('change', e => {
      Array.from(e.target.files).forEach(addFile);
      fileIn.value = '';
    });

    $('rsMode').addEventListener('click', e => {
      const b = e.target.closest('button[data-m]'); if (!b) return;
      $('rsMode').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      setMode(b.dataset.m);
    });
    setMode('longest');

    $('rsFormat').addEventListener('change', () => {
      const v = $('rsFormat').value;
      $('rsQualityRow').style.display = v === 'png' ? 'none' : '';
    });

    $('rsClear').addEventListener('click', clearAll);
    $('rsRun').addEventListener('click', runAll);
  }

  function setMode(m) {
    const tpl = MODE_TEMPLATES[m] || MODE_TEMPLATES.longest;
    $('rsModeOpts').innerHTML = tpl();
    // delegated bindings — only ones that need it
    const sc = $('rsScale');
    if (sc) sc.addEventListener('input', () => { $('rsScaleVal').textContent = sc.value + '%'; });
    const q = $('rsQuality');
    if (q) {
      q.addEventListener('input', () => { $('rsQualityVal').textContent = Math.round(q.value * 100) + '%'; });
    }
    window._rsMode = m;
  }

  function addFile(file) {
    if (!file.type.startsWith('image/')) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    const item = { file, img, url, status: 'pending' };
    img.onload = () => {
      items.push(item);
      renderList();
      $('rsRun').disabled = false;
      $('rsClear').disabled = false;
      $('rsStatus').textContent = items.length + ' image(s) loaded.';
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
  }

  function renderList() {
    $('rsList').style.display = 'flex';
    $('rsDrop').style.display = items.length ? 'none' : 'block';
    const list = $('rsList');
    list.innerHTML = '';
    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'rs-row ' + (it.status === 'done' ? 'done' : it.status === 'err' ? 'err' : '');
      const w = it.img.naturalWidth, h = it.img.naturalHeight;
      row.innerHTML = `
        <div class="rs-thumb"><img src="${it.url}"></div>
        <div>
          <div class="rs-name">${escapeHtml(it.file.name)}</div>
          <div class="rs-meta">${(it.file.size/1024).toFixed(1)} KB</div>
        </div>
        <div class="rs-meta">${w} × ${h}</div>
        <div class="rs-meta">${it.status === 'done' ? '✓ exported' : it.status}</div>
        <button class="rs-rm" data-idx="${idx}" title="Remove">✕</button>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('.rs-rm').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.idx, 10);
        URL.revokeObjectURL(items[i].url);
        items.splice(i, 1);
        renderList();
        if (items.length === 0) {
          $('rsRun').disabled = true;
          $('rsClear').disabled = true;
          $('rsStatus').textContent = 'Drop images to begin.';
        }
      });
    });
  }

  function clearAll() {
    items.forEach(i => URL.revokeObjectURL(i.url));
    items.length = 0;
    renderList();
    $('rsRun').disabled = true;
    $('rsClear').disabled = true;
    $('rsStatus').textContent = 'Drop images to begin.';
  }

  function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

  function computeTarget(w, h) {
    const m = window._rsMode || 'longest';
    if (m === 'longest') {
      const L = parseInt($('rsLongest').value, 10) || 1024;
      const scale = L / Math.max(w, h);
      return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
    }
    if (m === 'exact') {
      const tw = parseInt($('rsExactW').value, 10) || w;
      const th = parseInt($('rsExactH').value, 10) || h;
      if ($('rsExactKeep').checked) {
        const s = Math.min(tw / w, th / h);
        return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
      }
      return { w: tw, h: th };
    }
    if (m === 'scale') {
      const s = (parseInt($('rsScale').value, 10) || 100) / 100;
      return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
    }
    if (m === 'pot') {
      const dir = $('rsPotDir').value;
      const sq = $('rsPotSquare').checked;
      const snap = v => {
        const lg = Math.log2(v);
        const lo = Math.pow(2, Math.floor(lg));
        const hi = Math.pow(2, Math.ceil(lg));
        if (dir === 'up')   return hi;
        if (dir === 'down') return lo;
        return (v - lo) < (hi - v) ? lo : hi;
      };
      let nw = snap(w), nh = snap(h);
      if (sq) { const m = Math.max(nw, nh); nw = nh = m; }
      return { w: nw, h: nh };
    }
    return { w, h };
  }

  async function runAll() {
    $('rsRun').disabled = true;
    const filter = $('rsFilter').value;
    const fmt = $('rsFormat').value;
    const quality = parseFloat($('rsQuality') ? $('rsQuality').value : 0.9);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        it.status = 'working...';
        renderList();
        await new Promise(r => setTimeout(r, 0)); // yield
        const t = computeTarget(it.img.naturalWidth, it.img.naturalHeight);
        const cv = resizeWith(it.img, t.w, t.h, filter);
        const blob = await new Promise(res => cv.toBlob(res, 'image/' + fmt, quality));
        triggerDownload(blob, deriveName(it.file.name, t.w, t.h, fmt));
        it.status = 'done';
      } catch (e) {
        console.error(e);
        it.status = 'err';
      }
      renderList();
    }
    $('rsRun').disabled = false;
    $('rsStatus').textContent = 'Done.';
  }

  function deriveName(orig, w, h, fmt) {
    const base = orig.replace(/\.[^.]+$/, '');
    return `${base}_${w}x${h}.${fmt === 'jpeg' ? 'jpg' : fmt}`;
  }

  function triggerDownload(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function resizeWith(img, tw, th, filter) {
    if (filter === 'nearest' || filter === 'bilinear') {
      const cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = filter === 'bilinear';
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, tw, th);
      return cv;
    }
    // Lanczos / Mitchell — separable. Render source to canvas first.
    const src = document.createElement('canvas');
    src.width = img.naturalWidth; src.height = img.naturalHeight;
    src.getContext('2d').drawImage(img, 0, 0);
    const srcData = src.getContext('2d').getImageData(0, 0, src.width, src.height);
    const out = resampleSeparable(srcData, tw, th, filter);
    const cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    cv.getContext('2d').putImageData(out, 0, 0);
    return cv;
  }

  // ── filter kernels ──
  function lanczosKernel(x, a) {
    if (x === 0) return 1;
    if (x <= -a || x >= a) return 0;
    const px = Math.PI * x;
    return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
  }
  function mitchellKernel(x) {
    // B=1/3, C=1/3
    const B = 1/3, C = 1/3;
    x = Math.abs(x);
    const x2 = x * x, x3 = x2 * x;
    if (x < 1) return ((12 - 9*B - 6*C) * x3 + (-18 + 12*B + 6*C) * x2 + (6 - 2*B)) / 6;
    if (x < 2) return ((-B - 6*C) * x3 + (6*B + 30*C) * x2 + (-12*B - 48*C) * x + (8*B + 24*C)) / 6;
    return 0;
  }

  function resampleSeparable(srcData, dw, dh, filterName) {
    const sw = srcData.width, sh = srcData.height;
    const sD = srcData.data;
    const kernel = filterName === 'mitchell' ? mitchellKernel : x => lanczosKernel(x, 3);
    const support = filterName === 'mitchell' ? 2 : 3;

    // 1D pass helper
    function pass(srcArr, sW, sH, dW, axis) {
      // axis 0 = horizontal (resize width sW->dW), axis 1 = vertical (resize height sW->dW)
      const dst = new Float32Array(axis === 0 ? dW * sH * 4 : sW * dW * 4);
      const scale = sW / dW;
      const filterScale = Math.max(1, scale);   // when downsampling, widen kernel
      const fwidth = support * filterScale;

      for (let d = 0; d < dW; d++) {
        const center = (d + 0.5) * scale - 0.5;
        const lo = Math.max(0, Math.ceil(center - fwidth));
        const hi = Math.min(sW - 1, Math.floor(center + fwidth));
        // gather weights
        let sum = 0;
        const weights = [];
        for (let s = lo; s <= hi; s++) {
          const w = kernel((s - center) / filterScale);
          weights.push(w);
          sum += w;
        }
        if (sum === 0) sum = 1;
        for (let i = 0; i < weights.length; i++) weights[i] /= sum;

        if (axis === 0) {
          for (let y = 0; y < sH; y++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let i = 0; i < weights.length; i++) {
              const s = lo + i;
              const idx = (y * sW + s) * 4;
              const w = weights[i];
              r += srcArr[idx]     * w;
              g += srcArr[idx + 1] * w;
              b += srcArr[idx + 2] * w;
              a += srcArr[idx + 3] * w;
            }
            const o = (y * dW + d) * 4;
            dst[o] = r; dst[o+1] = g; dst[o+2] = b; dst[o+3] = a;
          }
        } else {
          for (let x = 0; x < sW; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let i = 0; i < weights.length; i++) {
              const s = lo + i;
              const idx = (s * sW + x) * 4;
              const w = weights[i];
              r += srcArr[idx]     * w;
              g += srcArr[idx + 1] * w;
              b += srcArr[idx + 2] * w;
              a += srcArr[idx + 3] * w;
            }
            const o = (d * sW + x) * 4;
            dst[o] = r; dst[o+1] = g; dst[o+2] = b; dst[o+3] = a;
          }
        }
      }
      return dst;
    }

    // Convert src ImageData to Float32 for accumulation
    const srcF = new Float32Array(sD.length);
    for (let i = 0; i < sD.length; i++) srcF[i] = sD[i];

    // Horizontal then vertical
    const horiz = pass(srcF, sw, sh, dw, 0); // result is dw * sh * 4
    const vert  = pass(horiz, dw, sh, dh, 1); // result is dw * dh * 4

    const out = new ImageData(dw, dh);
    const oD = out.data;
    for (let i = 0; i < oD.length; i++) {
      oD[i] = Math.max(0, Math.min(255, vert[i] + 0.5));
    }
    return out;
  }

  window.rsInit = function rsInit() { init(); };
  init();
})();
