/* ─────────────────────────────────────────────────────────────
   Normal Map Generator
   - Loads any image, derives a heightmap, computes tangent-space
     normals via Sobel on a CPU pass (fast enough up to 4K).
   - GPU shader path would be faster but adds complexity; CPU is
     fine and predictable here, and we already get sub-frame perf.
   ───────────────────────────────────────────────────────────── */
(function () {
  let ngOrigImg = null;          // HTMLImageElement
  let ngOrigName = 'image';
  let ngSrcCanvas, ngOutCanvas;
  let ngHeightData = null;       // Uint8Array of height (one channel)
  let ngW = 0, ngH = 0;

  const params = {
    srcMode: 'auto',
    strength: 2.0,
    blur: 0,
    invX: false,
    invY: false,
  };

  function $(id) { return document.getElementById(id); }

  function init() {
    ngSrcCanvas = $('ngSrcCanvas');
    ngOutCanvas = $('ngOutCanvas');

    const drop = $('ngDrop');
    const fileIn = $('ngFileIn');
    drop.addEventListener('click', () => fileIn.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    fileIn.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) loadFile(f);
    });

    // toggles
    $('ngSrcMode').addEventListener('click', e => {
      const b = e.target.closest('button[data-src]');
      if (!b) return;
      $('ngSrcMode').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      params.srcMode = b.dataset.src;
      rebuildHeightAndRender();
    });

    bindSlider('ngStrength', 'ngStrengthVal', v => { params.strength = v; render(); });
    bindSlider('ngBlur', 'ngBlurVal', v => { params.blur = v; rebuildHeightAndRender(); }, true);

    $('ngInvX').addEventListener('change', e => { params.invX = e.target.checked; render(); });
    $('ngInvY').addEventListener('change', e => { params.invY = e.target.checked; render(); });

    $('ngDownload').addEventListener('click', downloadResult);
    $('ngReset').addEventListener('click', reset);
  }

  function bindSlider(id, valId, cb, asInt) {
    const el = $(id), valEl = $(valId);
    el.addEventListener('input', () => {
      const v = asInt ? parseInt(el.value, 10) : parseFloat(el.value);
      valEl.textContent = asInt ? v : v.toFixed(1);
      cb(v);
    });
  }

  function loadFile(file) {
    ngOrigName = (file.name || 'image').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ngOrigImg = img;
      ngW = img.naturalWidth; ngH = img.naturalHeight;
      ngSrcCanvas.width = ngW; ngSrcCanvas.height = ngH;
      ngOutCanvas.width = ngW; ngOutCanvas.height = ngH;
      ngSrcCanvas.getContext('2d').drawImage(img, 0, 0);
      $('ngSplit').style.display = 'grid';
      $('ngDrop').style.display = 'none';
      $('ngDownload').disabled = false;
      $('ngReset').disabled = false;
      rebuildHeightAndRender();
    };
    img.onerror = () => { alert('Failed to load image'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  // Build the height array from the source according to srcMode + blur.
  function rebuildHeightAndRender() {
    if (!ngOrigImg) return;
    const tmp = document.createElement('canvas');
    tmp.width = ngW; tmp.height = ngH;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(ngOrigImg, 0, 0);
    const id = tctx.getImageData(0, 0, ngW, ngH);
    const px = id.data;
    const h = new Float32Array(ngW * ngH);

    if (params.srcMode === 'diffuse') {
      // diffuse → luminance, then subtract local average to keep only detail
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        h[j] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      }
    } else {
      // auto / height — both treat luminance as height
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        h[j] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      }
    }

    // Optional box blur
    if (params.blur > 0) {
      const r = params.blur;
      const blurred = boxBlur(h, ngW, ngH, r);
      ngHeightData = blurred;
    } else {
      ngHeightData = h;
    }

    render();
  }

  function boxBlur(src, w, h, r) {
    // Two-pass box blur (separable). Simple, fast enough for typical textures.
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const n = r * 2 + 1;
    // horizontal
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[y * w + clamp(i, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / n;
        const i0 = clamp(x - r, 0, w - 1);
        const i1 = clamp(x + r + 1, 0, w - 1);
        sum += src[y * w + i1] - src[y * w + i0];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += tmp[clamp(i, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / n;
        const j0 = clamp(y - r, 0, h - 1);
        const j1 = clamp(y + r + 1, 0, h - 1);
        sum += tmp[j1 * w + x] - tmp[j0 * w + x];
      }
    }
    return out;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function render() {
    if (!ngHeightData) return;
    const w = ngW, h = ngH;
    const ctx = ngOutCanvas.getContext('2d');
    const out = ctx.createImageData(w, h);
    const d = out.data;
    const H = ngHeightData;
    const s = params.strength;
    const sx = params.invX ? -1 : 1;
    const sy = params.invY ? -1 : 1;

    // Sobel
    for (let y = 0; y < h; y++) {
      const yp = y > 0 ? y - 1 : y;
      const yn = y < h - 1 ? y + 1 : y;
      for (let x = 0; x < w; x++) {
        const xp = x > 0 ? x - 1 : x;
        const xn = x < w - 1 ? x + 1 : x;
        const tl = H[yp * w + xp], tc = H[yp * w + x], tr = H[yp * w + xn];
        const ml = H[y  * w + xp],                       mr = H[y  * w + xn];
        const bl = H[yn * w + xp], bc = H[yn * w + x], br = H[yn * w + xn];
        // Sobel kernel
        const gx = ((tr + 2 * mr + br) - (tl + 2 * ml + bl)) * 0.25;
        const gy = ((bl + 2 * bc + br) - (tl + 2 * tc + tr)) * 0.25;
        // tangent-space normal:  N = normalize( (-gx*s*sx, -gy*s*sy, 1) )
        let nx = -gx * s * sx;
        let ny = -gy * s * sy;
        let nz = 1.0;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * w + x) * 4;
        d[i]     = (nx * 0.5 + 0.5) * 255;
        d[i + 1] = (ny * 0.5 + 0.5) * 255;
        d[i + 2] = (nz * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  function downloadResult() {
    ngOutCanvas.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = ngOrigName + '_normal.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  function reset() {
    ngOrigImg = null; ngHeightData = null;
    $('ngSplit').style.display = 'none';
    $('ngDrop').style.display = 'block';
    $('ngDownload').disabled = true;
    $('ngReset').disabled = true;
    $('ngFileIn').value = '';
  }

  // Public init referenced by router (idempotent)
  window.ngInit = function ngInit() {
    if (!ngSrcCanvas) init();
  };

  // Auto-init: when script runs the HTML fragment is already mounted,
  // so we can wire up listeners immediately. This makes the tool work
  // identically under the standalone single-file build (which doesn't
  // call init() explicitly) and the modular dev build.
  init();
})();
