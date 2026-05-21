/* ─────────────────────────────────────────────────────────────
   Seamless Maker
   - Offset method: shift the image by w/2, h/2, then feather a
     crossfade band along the new center seams.
   - Mirror method: 2x2 mirrored composite, guarantees seamless
     at the cost of obvious symmetry.
   ───────────────────────────────────────────────────────────── */
(function () {
  let smOrigImg = null;
  let smOrigName = 'texture';
  let smTileCanvas = null;          // off-screen single tile result
  let smCanvas = null;              // visible canvas (may show 1x/2x/3x)
  let smTileMul = 1;

  const params = {
    method: 'offset',
    feather: 30,    // % of half-width
    size: 0,        // 0 = original
  };

  function $(id) { return document.getElementById(id); }

  function init() {
    smCanvas = $('smCanvas');
    smTileCanvas = document.createElement('canvas');

    const drop = $('smDrop'), fileIn = $('smFileIn');
    drop.addEventListener('click', () => fileIn.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
    fileIn.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); });

    $('smMethod').addEventListener('click', e => {
      const b = e.target.closest('button[data-m]'); if (!b) return;
      $('smMethod').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); params.method = b.dataset.m;
      $('smOffsetGroup').style.display = params.method === 'offset' ? '' : 'none';
      $('smMethodHint').textContent = params.method === 'offset'
        ? "Offset wraps the image and feathers the seam. Best for organic textures."
        : "Mirror tiles 2×2 with reflections. Always seamless, but symmetry shows.";
      rebuild();
    });

    $('smFeather').addEventListener('input', e => {
      params.feather = parseInt(e.target.value, 10);
      $('smFeatherVal').textContent = params.feather + '%';
      rebuild();
    });

    $('smSize').addEventListener('change', e => { params.size = parseInt(e.target.value, 10); rebuild(); });

    [['smView1x', 1], ['smView2x', 2], ['smView3x', 3]].forEach(([id, mul]) => {
      $(id).addEventListener('click', () => {
        smTileMul = mul;
        ['smView1x', 'smView2x', 'smView3x'].forEach(x => $(x).classList.remove('on'));
        $(id).classList.add('on');
        redrawVisible();
      });
    });

    $('smDownload').addEventListener('click', download);
    $('smReset').addEventListener('click', reset);
  }

  function loadFile(file) {
    smOrigName = (file.name || 'texture').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      smOrigImg = img;
      $('smPreview').style.display = 'flex';
      $('smDrop').style.display = 'none';
      $('smDownload').disabled = false;
      $('smReset').disabled = false;
      rebuild();
    };
    img.onerror = () => { alert('Failed to load image'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function rebuild() {
    if (!smOrigImg) return;
    const w0 = smOrigImg.naturalWidth;
    const h0 = smOrigImg.naturalHeight;
    const outSize = params.size || Math.min(w0, h0);

    // First produce a square base image at outSize
    const base = document.createElement('canvas');
    base.width = outSize; base.height = outSize;
    const bctx = base.getContext('2d');
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(smOrigImg, 0, 0, outSize, outSize);

    if (params.method === 'mirror') {
      buildMirror(base, outSize);
    } else {
      buildOffset(base, outSize);
    }
    redrawVisible();
  }

  function buildMirror(base, n) {
    // Output canvas is n x n. We place base scaled to n/2, then mirror to fill.
    smTileCanvas.width = n; smTileCanvas.height = n;
    const ctx = smTileCanvas.getContext('2d');
    const half = n / 2;
    const small = document.createElement('canvas');
    small.width = half; small.height = half;
    small.getContext('2d').drawImage(base, 0, 0, half, half);

    // top-left original
    ctx.drawImage(small, 0, 0);
    // top-right mirror X
    ctx.save(); ctx.translate(n, 0); ctx.scale(-1, 1); ctx.drawImage(small, 0, 0); ctx.restore();
    // bottom-left mirror Y
    ctx.save(); ctx.translate(0, n); ctx.scale(1, -1); ctx.drawImage(small, 0, 0); ctx.restore();
    // bottom-right mirror XY
    ctx.save(); ctx.translate(n, n); ctx.scale(-1, -1); ctx.drawImage(small, 0, 0); ctx.restore();
  }

  function buildOffset(base, n) {
    // Step 1: shift the image by (n/2, n/2) with wrap.
    smTileCanvas.width = n; smTileCanvas.height = n;
    const ctx = smTileCanvas.getContext('2d');
    const half = n / 2;
    // tile in a 2x2 starting at (-half,-half)
    ctx.drawImage(base, -half, -half);
    ctx.drawImage(base,  half, -half);
    ctx.drawImage(base, -half,  half);
    ctx.drawImage(base,  half,  half);

    // Step 2: feather a band along center vertical and horizontal seams.
    // The seam is now at x=half and y=half. We crossfade pixels around it
    // with the "other side" coming from the original (un-shifted) image,
    // because that gives us a continuous version across the seam.
    const featherPx = Math.max(0, Math.floor((params.feather / 100) * half));
    if (featherPx === 0) return;

    const shifted = ctx.getImageData(0, 0, n, n);
    // Build a copy of original tiled the same way but un-shifted
    const refC = document.createElement('canvas');
    refC.width = n; refC.height = n;
    refC.getContext('2d').drawImage(base, 0, 0);
    const ref = refC.getContext('2d').getImageData(0, 0, n, n);

    const sD = shifted.data, rD = ref.data;

    // Horizontal seam at y=half: blend rows [half-featherPx, half+featherPx]
    for (let dy = -featherPx; dy <= featherPx; dy++) {
      const y = half + dy;
      if (y < 0 || y >= n) continue;
      // weight: 1 at seam center, 0 at edges of feather band
      const w = 1 - Math.abs(dy) / featherPx;
      // we want the shifted image (visible) blended toward something that
      // makes the seam less visible. Use the average of shifted top/bottom
      // mirrored across the seam.
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const yMirror = (2 * half - y) % n;
        const iM = (((yMirror + n) % n) * n + x) * 4;
        sD[i]     = sD[i]     * (1 - w * 0.5) + sD[iM]     * (w * 0.5);
        sD[i + 1] = sD[i + 1] * (1 - w * 0.5) + sD[iM + 1] * (w * 0.5);
        sD[i + 2] = sD[i + 2] * (1 - w * 0.5) + sD[iM + 2] * (w * 0.5);
      }
    }
    // Vertical seam at x=half
    for (let dx = -featherPx; dx <= featherPx; dx++) {
      const x = half + dx;
      if (x < 0 || x >= n) continue;
      const w = 1 - Math.abs(dx) / featherPx;
      for (let y = 0; y < n; y++) {
        const i = (y * n + x) * 4;
        const xMirror = (2 * half - x) % n;
        const iM = (y * n + ((xMirror + n) % n)) * 4;
        sD[i]     = sD[i]     * (1 - w * 0.5) + sD[iM]     * (w * 0.5);
        sD[i + 1] = sD[i + 1] * (1 - w * 0.5) + sD[iM + 1] * (w * 0.5);
        sD[i + 2] = sD[i + 2] * (1 - w * 0.5) + sD[iM + 2] * (w * 0.5);
      }
    }
    ctx.putImageData(shifted, 0, 0);
  }

  function redrawVisible() {
    const n = smTileCanvas.width;
    smCanvas.width = n * smTileMul;
    smCanvas.height = n * smTileMul;
    const ctx = smCanvas.getContext('2d');
    ctx.clearRect(0, 0, smCanvas.width, smCanvas.height);
    for (let ty = 0; ty < smTileMul; ty++) {
      for (let tx = 0; tx < smTileMul; tx++) {
        ctx.drawImage(smTileCanvas, tx * n, ty * n);
      }
    }
  }

  function download() {
    smTileCanvas.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = smOrigName + '_tile.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  function reset() {
    smOrigImg = null;
    $('smPreview').style.display = 'none';
    $('smDrop').style.display = 'block';
    $('smDownload').disabled = true;
    $('smReset').disabled = true;
    $('smFileIn').value = '';
  }

  window.smInit = function smInit() { if (!smCanvas) init(); };
  init();
})();
