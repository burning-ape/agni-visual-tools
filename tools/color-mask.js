/* ─────────────────────────────────────────────────────────────
   Color Masking
   Input:  image + target colour + algorithm
   Output: B&W mask (white = matches target, black = doesn't)

   Pipeline per pixel:
     1. distance(pixel, target) using HSL hue-distance OR LAB ΔE
     2. f(distance) → mask value in [0, 1]:
          dist <= tol            → 1
          tol < dist <= tol+feat → linear fade 1 → 0
          else                   → 0
     3. optional box-blur of the mask (pixel-space softening)
     4. threshold + sharpen: pushes values >= threshold to 1,
        keeps values < threshold at exactly 0
        (this guarantees "black is always fully black")
     5. optional invert
   ───────────────────────────────────────────────────────────── */
(function () {
  let cmImg = null;
  let cmName = 'image';
  let cmSrcCanvas, cmOutCanvas;
  let cmW = 0, cmH = 0;
  let cmSrcImageData = null;     // ImageData of the source, kept for re-eval
  let cmInited = false;
  let cmEyeOn = false;
  let cmRenderQueued = false;

  const p = {
    color: '#e02020',
    mode: 'hsl',           // 'hsl' | 'lab'
    tol: 20,               // HSL: hue degrees (0..180). LAB: ΔE (0..80).
    feather: 0,            // same units as tol
    blur: 0,               // post-blur in pixels
    thresh: 50,            // 0..100, where to cut white from black
    invert: false,
  };

  const $ = id => document.getElementById(id);

  function init() {
    if (cmInited) return; cmInited = true;
    cmSrcCanvas = $('cmSrcCanvas');
    cmOutCanvas = $('cmOutCanvas');

    // ── file input + drag drop ──
    const drop = $('cmDrop'), fileIn = $('cmFileIn'), area = $('cmCanvasArea');
    drop.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', e => {
      const f = e.target.files[0]; if (f) loadFile(f);
      fileIn.value = '';
    });

    // drag overlay (same UX as atlas-packer)
    let dragDepth = 0;
    area.addEventListener('dragenter', e => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault(); dragDepth++; area.classList.add('dragover');
    });
    area.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    area.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) area.classList.remove('dragover');
    });
    area.addEventListener('drop', e => {
      e.preventDefault(); dragDepth = 0; area.classList.remove('dragover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    // ── controls ──
    $('cmColor').addEventListener('input', e => { p.color = e.target.value; queueRender(); });

    $('cmEyedrop').addEventListener('click', () => {
      cmEyeOn = !cmEyeOn;
      $('cmEyedrop').classList.toggle('on', cmEyeOn);
      cmSrcCanvas.classList.toggle('eyedropping', cmEyeOn);
      $('cmEyeHint').textContent = cmEyeOn ? 'click on the source image' : 'click swatch or eyedropper';
    });
    cmSrcCanvas.addEventListener('click', e => {
      if (!cmEyeOn || !cmSrcImageData) return;
      // map click coords from displayed canvas to underlying pixel grid
      const rect = cmSrcCanvas.getBoundingClientRect();
      // canvas uses object-fit: contain — figure out actual drawn rect
      const cAR = cmW / cmH, vAR = rect.width / rect.height;
      let dispW, dispH, ox, oy;
      if (cAR > vAR) { dispW = rect.width; dispH = rect.width / cAR; ox = 0; oy = (rect.height - dispH) / 2; }
      else            { dispH = rect.height; dispW = rect.height * cAR; oy = 0; ox = (rect.width - dispW) / 2; }
      const cx = e.clientX - rect.left - ox, cy = e.clientY - rect.top - oy;
      if (cx < 0 || cy < 0 || cx >= dispW || cy >= dispH) return;
      const px = Math.floor(cx * cmW / dispW);
      const py = Math.floor(cy * cmH / dispH);
      const i = (py * cmW + px) * 4;
      const d = cmSrcImageData.data;
      const hex = '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
      p.color = hex;
      $('cmColor').value = hex;
      cmEyeOn = false;
      $('cmEyedrop').classList.remove('on');
      cmSrcCanvas.classList.remove('eyedropping');
      $('cmEyeHint').textContent = 'picked ' + hex;
      queueRender();
    });

    $('cmMode').addEventListener('click', e => {
      const b = e.target.closest('button[data-m]'); if (!b) return;
      $('cmMode').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); p.mode = b.dataset.m;
      // update slider ranges and labels for the active algorithm
      const tol = $('cmTol'), fea = $('cmFeather');
      if (p.mode === 'lab') {
        tol.max = 80; fea.max = 80;
        if (p.tol > 80) p.tol = 80;
        if (p.feather > 80) p.feather = 80;
        $('cmTolLabel').textContent = 'ΔE tolerance';
        $('cmTolUnit').textContent = 'ΔE';
        $('cmModeHint').textContent = 'LAB ΔE: perceptual. Slower but matches how human eyes see similarity.';
      } else {
        tol.max = 180; fea.max = 60;
        $('cmTolLabel').textContent = 'Hue tolerance';
        $('cmTolUnit').textContent = '°';
        $('cmModeHint').textContent = 'HSL: fast, hue-based. Best for vivid distinct colours.';
      }
      tol.value = p.tol; $('cmTolVal').textContent = p.tol;
      fea.value = p.feather; $('cmFeatherVal').textContent = p.feather;
      queueRender();
    });

    bindSlider('cmTol', 'cmTolVal', v => { p.tol = v; });
    bindSlider('cmFeather', 'cmFeatherVal', v => { p.feather = v; });
    bindSlider('cmBlur', 'cmBlurVal', v => { p.blur = v; });
    bindSlider('cmThresh', 'cmThreshVal', v => { p.thresh = v; }, '%');

    $('cmInvert').addEventListener('change', e => { p.invert = e.target.checked; queueRender(); });

    $('cmDownload').addEventListener('click', download);
    $('cmReset').addEventListener('click', reset);
    $('cmSendMaskGen').addEventListener('click', sendToMaskGen);
  }

  function bindSlider(id, valId, cb, suffix) {
    const el = $(id), valEl = $(valId);
    el.addEventListener('input', () => {
      const v = parseInt(el.value, 10);
      valEl.textContent = suffix ? v + suffix : v;
      cb(v); queueRender();
    });
  }

  function loadFile(file) {
    cmName = (file.name || 'image').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      cmImg = img;
      cmW = img.naturalWidth; cmH = img.naturalHeight;
      cmSrcCanvas.width = cmW; cmSrcCanvas.height = cmH;
      cmOutCanvas.width = cmW; cmOutCanvas.height = cmH;
      const sctx = cmSrcCanvas.getContext('2d');
      sctx.drawImage(img, 0, 0);
      cmSrcImageData = sctx.getImageData(0, 0, cmW, cmH);
      $('cmSplit').style.display = 'grid';
      $('cmDrop').style.display = 'none';
      $('cmDownload').disabled = false;
      $('cmReset').disabled = false;
      $('cmSendMaskGen').disabled = false;
      queueRender();
    };
    img.onerror = () => { alert('Failed to load image'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  // ── colour-space utilities ──
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = ((b - r) / d + 2);
      else h = ((r - g) / d + 4);
      h *= 60;
    }
    return [h, s, l];
  }
  function hueDiff(a, b) { const d = Math.abs(a - b); return d > 180 ? 360 - d : d; }

  function rgbToLab(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    // sRGB → linear
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    // linear → XYZ (D65)
    let X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let Y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
    let Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    X = X > 0.008856 ? Math.cbrt(X) : (7.787 * X + 16 / 116);
    Y = Y > 0.008856 ? Math.cbrt(Y) : (7.787 * Y + 16 / 116);
    Z = Z > 0.008856 ? Math.cbrt(Z) : (7.787 * Z + 16 / 116);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  function deltaE(a, b) {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  // ── render pipeline ──
  function queueRender() {
    if (cmRenderQueued || !cmSrcImageData) return;
    cmRenderQueued = true;
    requestAnimationFrame(() => { cmRenderQueued = false; render(); });
  }

  function render() {
    if (!cmSrcImageData) return;
    const w = cmW, h = cmH;
    const N = w * h;
    const src = cmSrcImageData.data;
    const target = hexToRgb(p.color);

    // 1+2. Per-pixel mask in [0,1]
    const mask = new Float32Array(N);
    if (p.mode === 'lab') {
      const tLab = rgbToLab(target[0], target[1], target[2]);
      const tol = p.tol, feat = p.feather;
      const featMax = Math.max(feat, 0.0001);
      for (let i = 0, j = 0; j < N; i += 4, j++) {
        const lab = rgbToLab(src[i], src[i + 1], src[i + 2]);
        const d = deltaE(lab, tLab);
        if (d <= tol) mask[j] = 1;
        else if (d <= tol + feat) mask[j] = 1 - (d - tol) / featMax;
        else mask[j] = 0;
      }
    } else {
      const tHue = rgbToHsl(target[0], target[1], target[2])[0];
      const tol = p.tol, feat = p.feather;
      const featMax = Math.max(feat, 0.0001);
      // Also gate by saturation: target hue is meaningless when src is grey.
      // Allow grey-to-grey match only when target itself is grey.
      const tHsl = rgbToHsl(target[0], target[1], target[2]);
      const targetIsGrey = tHsl[1] < 0.08;
      for (let i = 0, j = 0; j < N; i += 4, j++) {
        const hsl = rgbToHsl(src[i], src[i + 1], src[i + 2]);
        if (!targetIsGrey && hsl[1] < 0.05) { mask[j] = 0; continue; }
        const d = hueDiff(hsl[0], tHue);
        if (d <= tol) mask[j] = 1;
        else if (d <= tol + feat) mask[j] = 1 - (d - tol) / featMax;
        else mask[j] = 0;
      }
    }

    // 3. Optional pixel-space box-blur
    let work = mask;
    if (p.blur > 0) work = boxBlur(mask, w, h, p.blur);

    // 4. Threshold + sharpen.
    //    Below threshold → exactly 0 (true black, never grey).
    //    Above threshold → ramp to 1 over a narrow band so user's edge
    //    softness still reads visually but never bleeds into grey shadows.
    const t = p.thresh / 100;
    const sharpenBand = 0.05;   // hard-coded — width of the 0→1 ramp at the cut
    const lo = Math.max(0, t - sharpenBand / 2);
    const hi = Math.min(1, t + sharpenBand / 2);
    const band = Math.max(hi - lo, 1e-6);
    const out = cmOutCanvas.getContext('2d').createImageData(w, h);
    const od = out.data;
    const inv = p.invert;
    for (let j = 0; j < N; j++) {
      let v = work[j];
      // Special case: when both feather and blur are zero, t becomes a hard
      // cutoff (input is already binary {0,1}); the band logic still works.
      if (v <= lo) v = 0;
      else if (v >= hi) v = 1;
      else v = (v - lo) / band;
      if (inv) v = 1 - v;
      const g = Math.round(v * 255);
      const k = j * 4;
      od[k] = g; od[k + 1] = g; od[k + 2] = g; od[k + 3] = 255;
    }
    cmOutCanvas.getContext('2d').putImageData(out, 0, 0);
  }

  // separable box blur on a single-channel Float32Array
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const n = r * 2 + 1;
    const clamp = (v, hi) => v < 0 ? 0 : v > hi ? hi : v;
    // horizontal
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[y * w + clamp(i, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / n;
        const i0 = clamp(x - r, w - 1);
        const i1 = clamp(x + r + 1, w - 1);
        sum += src[y * w + i1] - src[y * w + i0];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += tmp[clamp(i, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / n;
        const j0 = clamp(y - r, h - 1);
        const j1 = clamp(y + r + 1, h - 1);
        sum += tmp[j1 * w + x] - tmp[j0 * w + x];
      }
    }
    return out;
  }

  function download() {
    cmOutCanvas.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = cmName + '_mask.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  function sendToMaskGen() {
    if (!window.SessionStore) {
      alert('SessionStore not available.');
      return;
    }
    const dataUrl = cmOutCanvas.toDataURL('image/png');
    window.SessionStore.add(cmName + '_mask', dataUrl);
    $('cmEyeHint').textContent = 'sent to Mask Generator session';
  }

  function reset() {
    cmImg = null; cmSrcImageData = null;
    $('cmSplit').style.display = 'none';
    $('cmDrop').style.display = 'block';
    $('cmDownload').disabled = true;
    $('cmReset').disabled = true;
    $('cmSendMaskGen').disabled = true;
    $('cmFileIn').value = '';
  }

  window.cmInit = function cmInit() { init(); };
  // auto-init for standalone build (DOM is already in place)
  init();
})();
