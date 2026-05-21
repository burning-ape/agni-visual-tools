(function(){
  // State
  let MGW = 1024, MGH = 1024;
  const layers = [];        // {id, name, canvas, visible, opacity, brightness, contrast, open}
  let selIdx = -1;
  let seq = 0;
  const preview = document.getElementById('mgPreview');
  const pctx = preview.getContext('2d');
  preview.width = MGW; preview.height = MGH;

  const listEl = document.getElementById('mgLayersList');
  const adjEl = document.getElementById('mgAdjustments');

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function recomposite() {
    // black base
    pctx.clearRect(0, 0, MGW, MGH);
    pctx.fillStyle = '#000';
    pctx.fillRect(0, 0, MGW, MGH);
    for(const L of layers) {
      if(!L.visible) continue;
      const adj = mkCanvas(MGW, MGH);
      const ax = adj.getContext('2d');
      ax.filter = `brightness(${L.brightness}%) contrast(${L.contrast}%)`;
      ax.globalAlpha = L.opacity / 100;
      // scale layer canvas to fit current MGW/MGH
      ax.drawImage(L.canvas, 0, 0, MGW, MGH);
      pctx.drawImage(adj, 0, 0);
    }
  }

  function thumbOf(canvas) {
    const t = mkCanvas(48, 48);
    t.getContext('2d').drawImage(canvas, 0, 0, 48, 48);
    return t.toDataURL();
  }

  function renderLayers() {
    listEl.innerHTML = '';
    if(!layers.length) {
      listEl.innerHTML = '<div class="empty">no layers — add one with + or 🖼</div>';
      renderAdjustments();
      updateActionButtons();
      return;
    }
    // top of list = last layer
    layers.slice().reverse().forEach(L => {
      const ri = layers.indexOf(L);
      const card = document.createElement('div');
      card.className = 'mg-lc' + (L.visible ? '' : ' hid') + (ri === selIdx ? ' sel' : '');
      card.innerHTML = `
        <div class="mg-lc-top">
          <img src="${thumbOf(L.canvas)}">
          <span class="mg-lname">${L.name}</span>
          <span class="mg-ic mg-eye">${L.visible ? '👁' : '—'}</span>
          <span class="mg-ic mg-del">🗑</span>
        </div>`;
      card.querySelector('.mg-lname').onclick = () => { selIdx = ri; renderLayers(); renderAdjustments(); updateActionButtons(); };
      card.querySelector('.mg-eye').onclick = () => { L.visible = !L.visible; recomposite(); renderLayers(); };
      card.querySelector('.mg-del').onclick = () => {
        const p = layers.indexOf(L);
        layers.splice(p, 1);
        if(selIdx === p) selIdx = -1;
        else if(selIdx > p) selIdx--;
        recomposite(); renderLayers(); renderAdjustments(); updateActionButtons();
      };
      listEl.appendChild(card);
    });
  }

  function renderAdjustments() {
    if(selIdx < 0 || selIdx >= layers.length) {
      adjEl.innerHTML = '<div class="empty" style="padding:8px 0">select a layer</div>';
      return;
    }
    const L = layers[selIdx];
    adjEl.innerHTML = `
      <div class="srow"><label>Opacity</label>
        <input type="range" min="0" max="100" value="${L.opacity}" data-p="opacity">
        <input type="number" class="nv" min="0" max="100" value="${L.opacity}" data-p="opacity">
      </div>
      <div class="srow"><label>Bright</label>
        <input type="range" min="0" max="200" value="${L.brightness}" data-p="brightness">
        <input type="number" class="nv" min="0" max="200" value="${L.brightness}" data-p="brightness">
      </div>
      <div class="srow"><label>Contrast</label>
        <input type="range" min="0" max="200" value="${L.contrast}" data-p="contrast">
        <input type="number" class="nv" min="0" max="200" value="${L.contrast}" data-p="contrast">
      </div>`;
    adjEl.querySelectorAll('input[type=range], input[type=number]').forEach(inp => {
      inp.addEventListener('input', () => {
        const p = inp.dataset.p;
        const mx = (p === 'opacity') ? 100 : 200;
        let v = Math.round(Math.min(mx, Math.max(0, +inp.value || 0)));
        L[p] = v;
        adjEl.querySelectorAll(`[data-p="${p}"]`).forEach(o => { if(o !== inp) o.value = v; });
        recomposite();
      });
    });
  }

  function updateActionButtons() {
    const has = selIdx >= 0 && selIdx < layers.length;
    document.getElementById('mgGreyToAlpha').disabled = !has;
    document.getElementById('mgInvert').disabled = !has;
    document.getElementById('mgDownloadLayer').disabled = !has;
    document.getElementById('mgGenApply').disabled = !has;
    document.getElementById('mgSaveSession').disabled = layers.length === 0;
  }

  // ── Add layers ──
  document.getElementById('mgAddBlank').addEventListener('click', () => {
    const c = mkCanvas(MGW, MGH);
    const cx = c.getContext('2d');
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, MGW, MGH);
    addLayer(`Layer ${++seq}`, c);
  });

  document.getElementById('mgLoadImg').addEventListener('click', () => document.getElementById('mgImgIn').click());
  document.getElementById('mgImgIn').addEventListener('change', e => {
    const f = e.target.files[0]; if(!f) return;
    const url = URL.createObjectURL(f);
    e.target.value = '';
    const img = new Image();
    img.onload = () => {
      const c = mkCanvas(MGW, MGH);
      c.getContext('2d').drawImage(img, 0, 0, MGW, MGH);
      addLayer(f.name, c);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

  function addLayer(name, canvas) {
    const L = { id: ++seq, name, canvas, visible: true, opacity: 100, brightness: 100, contrast: 100, open: false };
    layers.push(L);
    selIdx = layers.length - 1;
    recomposite(); renderLayers(); renderAdjustments(); updateActionButtons();
  }

  // ── Resize ──
  document.getElementById('mgResize').addEventListener('click', () => {
    const w = Math.max(64, Math.min(4096, +document.getElementById('mgW').value || 1024));
    const h = Math.max(64, Math.min(4096, +document.getElementById('mgH').value || 1024));
    document.getElementById('mgW').value = w;
    document.getElementById('mgH').value = h;
    // resize each layer canvas to new dimensions (scaled)
    for(const L of layers) {
      const newC = mkCanvas(w, h);
      newC.getContext('2d').drawImage(L.canvas, 0, 0, w, h);
      L.canvas = newC;
    }
    MGW = w; MGH = h;
    preview.width = w; preview.height = h;
    recomposite(); renderLayers();
  });

  // ── Greyscale → Alpha ──
  document.getElementById('mgGreyToAlpha').addEventListener('click', () => {
    if(selIdx < 0) return;
    const L = layers[selIdx];
    const ctx = L.canvas.getContext('2d');
    const w = L.canvas.width, h = L.canvas.height;
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    for(let i = 0; i < d.length; i += 4) {
      // brightness from RGB → alpha; keep RGB white
      const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      d[i] = 255; d[i+1] = 255; d[i+2] = 255;
      d[i+3] = Math.round(lum);
    }
    ctx.putImageData(id, 0, 0);
    recomposite(); renderLayers();
  });

  // ── Invert ──
  document.getElementById('mgInvert').addEventListener('click', () => {
    if(selIdx < 0) return;
    const L = layers[selIdx];
    const ctx = L.canvas.getContext('2d');
    const w = L.canvas.width, h = L.canvas.height;
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    for(let i = 0; i < d.length; i += 4) {
      d[i] = 255-d[i]; d[i+1] = 255-d[i+1]; d[i+2] = 255-d[i+2];
    }
    ctx.putImageData(id, 0, 0);
    recomposite(); renderLayers();
  });

  // ── Download single layer ──
  document.getElementById('mgDownloadLayer').addEventListener('click', () => {
    if(selIdx < 0) return;
    const L = layers[selIdx];
    L.canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (L.name.replace(/\.[^.]+$/, '') || 'layer') + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });

  // ── Download composite ──
  document.getElementById('mgDownloadComp').addEventListener('click', () => {
    preview.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mask_composite.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });

  // ── Save to session (composite as a single mask) ──
  document.getElementById('mgSaveSession').addEventListener('click', () => {
    const name = prompt('Name for this mask:', `mask_${MGW}x${MGH}_${new Date().toLocaleTimeString().replace(/[:\s]/g,'')}`);
    if(!name) return;
    const dataUrl = preview.toDataURL('image/png');
    window.SessionStore.add(name, dataUrl);
    renderSessionList();
  });

  function renderSessionList() {
    const el = document.getElementById('mgSessionList');
    const items = window.SessionStore.sessionMasks;
    if(!items.length) { el.innerHTML = '<div class="empty" style="padding:8px 0">no saved masks</div>'; return; }
    el.innerHTML = '';
    items.forEach(m => {
      const row = document.createElement('div');
      row.className = 'mg-session-item';
      row.innerHTML = `<img src="${m.thumb}" style="filter:grayscale(1)"><span class="mss-nm">${m.name}</span><span class="mss-del">🗑</span>`;
      row.querySelector('.mss-del').onclick = () => {
        window.SessionStore.remove(m.id);
        renderSessionList();
      };
      el.appendChild(row);
    });
  }
  window.SessionStore.onChange(renderSessionList);
  renderSessionList();

  // ══ GENERATORS ══

  // ── Param definitions per generator ──
  const genParams = {
    solid:           [{key:'value', label:'Value', type:'range', min:0, max:255, val:128}],
    gradient_linear: [
      {key:'angle', label:'Angle°', type:'range', min:0, max:360, val:0},
      {key:'start', label:'Start',  type:'range', min:0, max:255, val:0},
      {key:'end',   label:'End',    type:'range', min:0, max:255, val:255}
    ],
    gradient_radial: [
      {key:'inner', label:'Center', type:'range', min:0, max:255, val:255},
      {key:'outer', label:'Edge',   type:'range', min:0, max:255, val:0},
      {key:'radius',label:'Radius%',type:'range', min:10, max:200, val:100}
    ],
    white_noise: [
      {key:'seed', label:'Seed', type:'range', min:0, max:9999, val:1},
      {key:'low',  label:'Min',  type:'range', min:0, max:255, val:0},
      {key:'high', label:'Max',  type:'range', min:0, max:255, val:255}
    ],
    value_noise: [
      {key:'seed',  label:'Seed', type:'range', min:0, max:9999, val:1},
      {key:'scale', label:'Scale',type:'range', min:2, max:128, val:32},
      {key:'low',   label:'Min',  type:'range', min:0, max:255, val:0},
      {key:'high',  label:'Max',  type:'range', min:0, max:255, val:255}
    ],
    perlin: [
      {key:'seed',  label:'Seed', type:'range', min:0, max:9999, val:1},
      {key:'scale', label:'Scale',type:'range', min:2, max:128, val:32}
    ],
    fractal: [
      {key:'seed',    label:'Seed',   type:'range', min:0, max:9999, val:1},
      {key:'scale',   label:'Scale',  type:'range', min:2, max:128, val:48},
      {key:'octaves', label:'Octaves',type:'range', min:1, max:8,   val:5},
      {key:'persist', label:'Persist',type:'range', min:10, max:90, val:50}
    ],
    cellular: [
      {key:'seed',   label:'Seed',  type:'range', min:0, max:9999, val:1},
      {key:'cells',  label:'Cells', type:'range', min:4, max:80,   val:16},
      {key:'invert', label:'Invert',type:'check', val:0}
    ],
    voronoi: [
      {key:'seed',  label:'Seed', type:'range', min:0, max:9999, val:1},
      {key:'cells', label:'Cells',type:'range', min:4, max:80,   val:16}
    ],
    stripes: [
      {key:'angle', label:'Angle°',type:'range', min:0, max:180, val:0},
      {key:'width', label:'Width', type:'range', min:2, max:128, val:24},
      {key:'soft',  label:'Soft%', type:'range', min:0, max:50,  val:0}
    ],
    checker: [
      {key:'size', label:'Cell px', type:'range', min:2, max:256, val:64}
    ],
    dots: [
      {key:'spacing', label:'Spacing',type:'range', min:8, max:128, val:32},
      {key:'radius',  label:'Radius', type:'range', min:1, max:64,  val:8},
      {key:'soft',    label:'Soft',   type:'range', min:0, max:32,  val:4}
    ]
  };

  const genTypeEl = document.getElementById('mgGenType');
  const genParamsEl = document.getElementById('mgGenParams');

  function renderGenParams() {
    const type = genTypeEl.value;
    const params = genParams[type] || [];
    genParamsEl.innerHTML = '';
    for(const p of params) {
      const row = document.createElement('div');
      row.className = 'srow';
      row.style.marginBottom = '5px';
      if(p.type === 'check') {
        row.innerHTML = `<label>${p.label}</label>
          <input type="checkbox" data-pk="${p.key}" ${p.val?'checked':''} style="margin-left:auto;accent-color:var(--ac)">`;
      } else {
        row.innerHTML = `<label>${p.label}</label>
          <input type="range" min="${p.min}" max="${p.max}" value="${p.val}" data-pk="${p.key}">
          <input type="number" class="nv" min="${p.min}" max="${p.max}" value="${p.val}" data-pk="${p.key}">`;
      }
      genParamsEl.appendChild(row);
      // bind sync
      const r = row.querySelector('input[type=range]');
      const n = row.querySelector('input[type=number]');
      if(r && n) {
        r.addEventListener('input', () => n.value = r.value);
        n.addEventListener('input', () => r.value = n.value);
      }
    }
  }
  genTypeEl.addEventListener('change', renderGenParams);
  renderGenParams();

  function getGenValues() {
    const out = {};
    genParamsEl.querySelectorAll('[data-pk]').forEach(inp => {
      const k = inp.dataset.pk;
      if(inp.type === 'checkbox') out[k] = inp.checked ? 1 : 0;
      else if(inp.type === 'number' || inp.type === 'range') {
        if(!(k in out)) out[k] = +inp.value;
      }
    });
    return out;
  }

  // ── Seeded PRNG ──
  function mulberry32(a) {
    return function() {
      a = (a + 0x6D2B79F5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  // ── Generators (write greyscale to provided ImageData) ──
  function genSolid(d, w, h, p) {
    const v = p.value | 0;
    for(let i = 0; i < d.length; i += 4) { d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255; }
  }

  function genGradientLinear(d, w, h, p) {
    const ang = p.angle * Math.PI / 180;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    // project corners onto direction to find min/max
    const proj = [0, w*cx, h*cy, w*cx + h*cy];
    const pmin = Math.min(...proj), pmax = Math.max(...proj);
    const range = pmax - pmin || 1;
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      const t = (x*cx + y*cy - pmin) / range;
      const v = p.start + (p.end - p.start) * t;
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = v|0; d[i+3] = 255;
    }
  }

  function genGradientRadial(d, w, h, p) {
    const cx = w/2, cy = h/2;
    const maxR = Math.min(w, h) * 0.5 * (p.radius/100);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      const dx = x-cx, dy = y-cy;
      const r = Math.sqrt(dx*dx + dy*dy);
      const t = Math.min(1, r/maxR);
      const v = p.inner + (p.outer - p.inner) * t;
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = v|0; d[i+3] = 255;
    }
  }

  function genWhiteNoise(d, w, h, p) {
    const rnd = mulberry32(p.seed | 0);
    const range = p.high - p.low;
    for(let i = 0; i < d.length; i += 4) {
      const v = p.low + rnd() * range;
      d[i] = d[i+1] = d[i+2] = v|0; d[i+3] = 255;
    }
  }

  // Value noise — random grid + bilinear interpolation with smoothstep
  function makeValueGrid(seed, gw, gh) {
    const rnd = mulberry32(seed | 0);
    const arr = new Float32Array(gw * gh);
    for(let i = 0; i < arr.length; i++) arr[i] = rnd();
    return arr;
  }
  function sampleValue(grid, gw, gh, x, y) {
    const x0 = Math.floor(x) % gw, y0 = Math.floor(y) % gh;
    const x1 = (x0 + 1) % gw, y1 = (y0 + 1) % gh;
    const fx = smoothstep(x - Math.floor(x)), fy = smoothstep(y - Math.floor(y));
    const a = grid[y0*gw + x0], b = grid[y0*gw + x1];
    const c = grid[y1*gw + x0], dd = grid[y1*gw + x1];
    return (a*(1-fx) + b*fx) * (1-fy) + (c*(1-fx) + dd*fx) * fy;
  }
  function genValueNoise(d, w, h, p) {
    const scale = Math.max(2, p.scale|0);
    const gw = Math.ceil(w/scale) + 2, gh = Math.ceil(h/scale) + 2;
    const grid = makeValueGrid(p.seed, gw, gh);
    const range = p.high - p.low;
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      const v = sampleValue(grid, gw, gh, x/scale, y/scale);
      const o = p.low + v * range;
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = o|0; d[i+3] = 255;
    }
  }

  // Perlin noise (gradient noise)
  function makePerlinGrad(seed, gw, gh) {
    const rnd = mulberry32(seed | 0);
    const arr = new Float32Array(gw * gh * 2);
    for(let i = 0; i < gw*gh; i++) {
      const a = rnd() * Math.PI * 2;
      arr[i*2] = Math.cos(a);
      arr[i*2+1] = Math.sin(a);
    }
    return arr;
  }
  function samplePerlin(grad, gw, gh, x, y) {
    const x0 = ((Math.floor(x) % gw) + gw) % gw;
    const y0 = ((Math.floor(y) % gh) + gh) % gh;
    const x1 = (x0+1) % gw, y1 = (y0+1) % gh;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const dot = (i, dx, dy) => grad[i*2]*dx + grad[i*2+1]*dy;
    const n00 = dot(y0*gw+x0, fx,     fy);
    const n10 = dot(y0*gw+x1, fx-1,   fy);
    const n01 = dot(y1*gw+x0, fx,     fy-1);
    const n11 = dot(y1*gw+x1, fx-1,   fy-1);
    const u = smoothstep(fx), v = smoothstep(fy);
    return ((n00*(1-u)+n10*u)*(1-v) + (n01*(1-u)+n11*u)*v);
  }
  function genPerlin(d, w, h, p) {
    const scale = Math.max(2, p.scale|0);
    const gw = Math.ceil(w/scale)+2, gh = Math.ceil(h/scale)+2;
    const grad = makePerlinGrad(p.seed, gw, gh);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      // perlin in [-~0.7..~0.7] → normalize
      const n = samplePerlin(grad, gw, gh, x/scale, y/scale);
      const v = Math.max(0, Math.min(255, ((n + 0.7) / 1.4) * 255));
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = v|0; d[i+3] = 255;
    }
  }

  // Fractal Brownian Motion (sum of Perlin octaves)
  function genFractal(d, w, h, p) {
    const baseScale = Math.max(2, p.scale|0);
    const oct = Math.max(1, Math.min(8, p.octaves|0));
    const persist = p.persist / 100;
    // pre-build gradient grids per octave
    const grids = [];
    for(let o = 0; o < oct; o++) {
      const s = baseScale / Math.pow(2, o);
      const gw = Math.ceil(w/s)+2, gh = Math.ceil(h/s)+2;
      grids.push({ grid: makePerlinGrad(p.seed + o*17, gw, gh), gw, gh, s });
    }
    let maxAmp = 0;
    for(let o = 0; o < oct; o++) maxAmp += Math.pow(persist, o);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      let sum = 0;
      for(let o = 0; o < oct; o++) {
        const g = grids[o];
        sum += samplePerlin(g.grid, g.gw, g.gh, x/g.s, y/g.s) * Math.pow(persist, o);
      }
      // normalize approx
      const n = (sum / maxAmp + 0.7) / 1.4;
      const v = Math.max(0, Math.min(255, n * 255));
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = v|0; d[i+3] = 255;
    }
  }

  // Cellular (Worley) — distance to nearest feature point
  function genCellular(d, w, h, p) {
    const rnd = mulberry32(p.seed | 0);
    const cells = Math.max(2, p.cells|0);
    const pts = [];
    for(let i = 0; i < cells*cells; i++) pts.push([rnd()*w, rnd()*h]);
    let maxD = 0;
    const buf = new Float32Array(w*h);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      let best = Infinity;
      for(const pt of pts) {
        const dx = pt[0]-x, dy = pt[1]-y;
        const dd = dx*dx + dy*dy;
        if(dd < best) best = dd;
      }
      best = Math.sqrt(best);
      buf[y*w+x] = best;
      if(best > maxD) maxD = best;
    }
    const inv = !!p.invert;
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      let v = (buf[y*w+x] / maxD) * 255;
      if(inv) v = 255 - v;
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = v|0; d[i+3] = 255;
    }
  }

  // Voronoi — flat color per region
  function genVoronoi(d, w, h, p) {
    const rnd = mulberry32(p.seed | 0);
    const cells = Math.max(2, p.cells|0);
    const pts = [];
    for(let i = 0; i < cells*cells; i++) pts.push([rnd()*w, rnd()*h, (rnd()*255)|0]);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      let best = Infinity, bv = 0;
      for(const pt of pts) {
        const dx = pt[0]-x, dy = pt[1]-y;
        const dd = dx*dx + dy*dy;
        if(dd < best) { best = dd; bv = pt[2]; }
      }
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = bv; d[i+3] = 255;
    }
  }

  function genStripes(d, w, h, p) {
    const ang = p.angle * Math.PI / 180;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    const period = Math.max(2, p.width * 2);
    const soft = (p.soft / 100) * period;
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      const proj = x*cx + y*cy;
      const m = ((proj % period) + period) % period;
      let v;
      if(soft <= 0) {
        v = m < period/2 ? 255 : 0;
      } else {
        // smooth transitions at both edges
        const t1 = Math.min(1, Math.max(0, (m - 0) / soft));
        const t2 = Math.min(1, Math.max(0, (period/2 - m) / soft));
        const t3 = Math.min(1, Math.max(0, (m - period/2) / soft));
        const t4 = Math.min(1, Math.max(0, (period - m) / soft));
        if(m < period/2) v = 255 * smoothstep(Math.min(t1, t2));
        else             v = 255 * (1 - smoothstep(Math.min(t3, t4)));
      }
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = v|0; d[i+3] = 255;
    }
  }

  function genChecker(d, w, h, p) {
    const s = Math.max(1, p.size|0);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) {
      const v = ((Math.floor(x/s) + Math.floor(y/s)) % 2 === 0) ? 255 : 0;
      const i = (y*w + x) * 4;
      d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
    }
  }

  function genDots(d, w, h, p) {
    const sp = Math.max(4, p.spacing|0);
    const r = Math.max(1, p.radius|0);
    const soft = Math.max(0, p.soft|0);
    // black background
    for(let i = 0; i < d.length; i += 4) { d[i]=d[i+1]=d[i+2]=0; d[i+3]=255; }
    for(let cy = sp/2; cy < h; cy += sp) {
      for(let cx = sp/2; cx < w; cx += sp) {
        const x0 = Math.max(0, Math.floor(cx-r-soft));
        const x1 = Math.min(w-1, Math.ceil(cx+r+soft));
        const y0 = Math.max(0, Math.floor(cy-r-soft));
        const y1 = Math.min(h-1, Math.ceil(cy+r+soft));
        for(let y = y0; y <= y1; y++) for(let x = x0; x <= x1; x++) {
          const dx = x-cx, dy = y-cy;
          const dist = Math.sqrt(dx*dx + dy*dy);
          let v;
          if(dist <= r) v = 255;
          else if(dist <= r+soft && soft > 0) v = 255 * (1 - smoothstep((dist-r)/soft));
          else continue;
          const i = (y*w + x) * 4;
          if(v > d[i]) { d[i]=d[i+1]=d[i+2]=v|0; }
        }
      }
    }
  }

  const generators = {
    solid: genSolid,
    gradient_linear: genGradientLinear,
    gradient_radial: genGradientRadial,
    white_noise: genWhiteNoise,
    value_noise: genValueNoise,
    perlin: genPerlin,
    fractal: genFractal,
    cellular: genCellular,
    voronoi: genVoronoi,
    stripes: genStripes,
    checker: genChecker,
    dots: genDots
  };

  document.getElementById('mgGenApply').addEventListener('click', () => {
    if(selIdx < 0) return;
    const L = layers[selIdx];
    const w = L.canvas.width, h = L.canvas.height;
    const ctx = L.canvas.getContext('2d');
    const id = ctx.createImageData(w, h);
    const type = genTypeEl.value;
    const p = getGenValues();
    const fn = generators[type];
    if(!fn) return;
    fn(id.data, w, h, p);
    ctx.putImageData(id, 0, 0);
    recomposite(); renderLayers();
  });

  // Init blank state
  recomposite();
})();
