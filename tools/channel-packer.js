/* ─────────────────────────────────────────────────────────────
   Channel Packer
   - 4 slots (R/G/B/A). For each: source image + which channel to
     extract + optional invert.
   - Output sized to user choice or max input dimension.
   - Presets just preset the names; user wires in textures freely.
   ───────────────────────────────────────────────────────────── */
(function () {
  const slots = { R: emptySlot(), G: emptySlot(), B: emptySlot(), A: emptySlot() };
  let cpInited = false;

  const PRESETS = {
    orm:  { R: 'AO',        G: 'Roughness', B: 'Metallic', A: '(unused)' },
    rma:  { R: 'Roughness',  G: 'Metallic',  B: 'AO',        A: '(unused)' },
    mra:  { R: 'Metallic',   G: 'Roughness', B: 'AO',        A: '(unused)' },
    hrgm: { R: 'Height',     G: 'Roughness', B: 'Metallic',  A: 'Mask' },
  };

  function emptySlot() {
    return { img: null, name: '', from: 'luma', invert: false };
  }

  function $(id) { return document.getElementById(id); }

  function init() {
    if (cpInited) return; cpInited = true;

    // wire drops & file inputs
    ['R','G','B','A'].forEach(ch => {
      const drop = document.querySelector(`.cp-drop[data-target="${ch}"]`);
      const input = $('cpIn' + ch);
      drop.addEventListener('click', () => input.click());
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
      drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag');
        const f = e.dataTransfer.files[0]; if (f) loadFor(ch, f);
      });
      input.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFor(ch, f); });

      document.querySelector(`.cp-from[data-channel="${ch}"]`).addEventListener('change', e => {
        slots[ch].from = e.target.value; render();
      });
      document.querySelector(`.cp-inv[data-channel="${ch}"]`).addEventListener('change', e => {
        slots[ch].invert = e.target.checked; render();
      });
      document.querySelector(`.cp-rm[data-channel="${ch}"]`).addEventListener('click', () => {
        slots[ch] = emptySlot();
        drop.classList.remove('loaded');
        drop.style.backgroundImage = '';
        input.value = '';
        render();
      });
    });

    // preset
    $('cpPreset').addEventListener('change', e => {
      const v = e.target.value;
      if (v === 'custom' || !PRESETS[v]) return;
      const p = PRESETS[v];
      $('cpRName').value = p.R; $('cpGName').value = p.G;
      $('cpBName').value = p.B; $('cpAName').value = p.A;
    });

    $('cpSize').addEventListener('change', render);
    $('cpExport').addEventListener('click', exportPng);

    render();
  }

  function loadFor(ch, file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      slots[ch].img = img;
      slots[ch].name = (file.name || ch).replace(/\.[^.]+$/, '');
      const drop = document.querySelector(`.cp-drop[data-target="${ch}"]`);
      drop.classList.add('loaded');
      drop.style.backgroundImage = `url("${img.src}")`;
      // re-export to dataURL so revoke doesn't break the bg
      const tmp = document.createElement('canvas');
      tmp.width = 64; tmp.height = 64;
      tmp.getContext('2d').drawImage(img, 0, 0, 64, 64);
      drop.style.backgroundImage = `url("${tmp.toDataURL('image/png')}")`;
      render();
    };
    img.onerror = () => { alert('Failed to load image for ' + ch); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function pickSize() {
    const explicit = parseInt($('cpSize').value, 10);
    if (explicit) return explicit;
    let max = 0;
    Object.values(slots).forEach(s => {
      if (s.img) max = Math.max(max, s.img.naturalWidth, s.img.naturalHeight);
    });
    return max || 512;
  }

  function extractChannel(img, channelKey, invert, size) {
    const tmp = document.createElement('canvas');
    tmp.width = size; tmp.height = size;
    const ctx = tmp.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size, size);
    const id = ctx.getImageData(0, 0, size, size);
    const d = id.data;
    const out = new Uint8ClampedArray(size * size);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let v;
      if (channelKey === 'r') v = d[i];
      else if (channelKey === 'g') v = d[i + 1];
      else if (channelKey === 'b') v = d[i + 2];
      else if (channelKey === 'a') v = d[i + 3];
      else v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (invert) v = 255 - v;
      out[j] = v;
    }
    return out;
  }

  let lastResult = null;

  function render() {
    const anyInput = Object.values(slots).some(s => s.img);
    $('cpExport').disabled = !anyInput;
    $('cpStatus').textContent = anyInput
      ? "Ready. Slots with no input default to black (alpha defaults to opaque)."
      : "Drop at least one channel to enable export.";

    if (!anyInput) {
      const cv = $('cpPreview');
      cv.width = 256; cv.height = 256;
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      lastResult = null;
      return;
    }

    const size = pickSize();
    const result = new Uint8ClampedArray(size * size * 4);

    ['R','G','B'].forEach((ch, idx) => {
      const s = slots[ch];
      if (s.img) {
        const arr = extractChannel(s.img, s.from, s.invert, size);
        for (let j = 0; j < arr.length; j++) result[j * 4 + idx] = arr[j];
      }
    });
    // alpha: if slot A has image, extract; else 255
    const sA = slots.A;
    if (sA.img) {
      const arr = extractChannel(sA.img, sA.from, sA.invert, size);
      for (let j = 0; j < arr.length; j++) result[j * 4 + 3] = arr[j];
    } else {
      for (let j = 0; j < size * size; j++) result[j * 4 + 3] = 255;
    }

    const cv = $('cpPreview');
    cv.width = size; cv.height = size;
    const id = new ImageData(result, size, size);
    cv.getContext('2d').putImageData(id, 0, 0);
    lastResult = { size, data: result };
  }

  function exportPng() {
    if (!lastResult) return;
    const { size, data } = lastResult;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    cv.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
    cv.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      const preset = $('cpPreset').value;
      const tag = preset === 'custom' ? 'packed' : preset.toUpperCase();
      a.download = `${tag}_${size}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  window.cpInit = function cpInit() { init(); };
  init();
})();
