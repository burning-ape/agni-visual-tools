/* ─────────────────────────────────────────────────────────────
   UV Checker
   - Loads FBX, applies a procedurally-generated checker texture
     so the user can spot UV stretches, seams, density problems.
   - Optional "flatten to UV space" mode renders each face on its
     UV coordinates instead of in 3D, giving a 2D layout view.
   ───────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

let scene, camera, renderer, controls;
let currentModel = null;
let flatModel = null;       // 2D UV-space mesh
let uvInited = false;

const params = {
  pattern: 'checker',
  tiles: 8,
  res: 1024,
  wire: false,
  flatten: false,
};

let checkerTex = null;
let lastPatternCanvas = null;

function $(id) { return document.getElementById(id); }

function init() {
  if (uvInited) return; uvInited = true;

  const vp = $('uvViewport');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e2028);

  camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
  camera.position.set(2, 2, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  vp.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 5, 4);
  scene.add(dir);

  // grid as world reference
  const grid = new THREE.GridHelper(10, 10, 0x333333, 0x222222);
  grid.position.y = -0.001;
  scene.add(grid);

  rebuildChecker();
  resize();
  animate();

  // UI bindings
  $('uvLoadBtn').addEventListener('click', () => $('uvFileIn').click());
  $('uvFileIn').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) loadFbx(f);
  });

  $('uvPattern').addEventListener('change', e => { params.pattern = e.target.value; rebuildChecker(); });
  $('uvTiles').addEventListener('input', e => {
    params.tiles = parseInt(e.target.value, 10);
    $('uvTilesVal').textContent = params.tiles;
    rebuildChecker();
  });
  $('uvRes').addEventListener('change', e => { params.res = parseInt(e.target.value, 10); rebuildChecker(); });
  $('uvWire').addEventListener('change', e => { params.wire = e.target.checked; applyMaterials(); });
  $('uvFlatten').addEventListener('change', e => { params.flatten = e.target.checked; applyFlatten(); });

  $('uvDownloadPattern').addEventListener('click', () => {
    if (!lastPatternCanvas) return;
    lastPatternCanvas.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `agni_checker_${params.pattern}_${params.tiles}_${params.res}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });

  window.addEventListener('resize', resize);
}

function resize() {
  if (!renderer) return;
  const vp = $('uvViewport');
  const w = vp.clientWidth, h = vp.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (!renderer) return;
  controls.update();
  renderer.render(scene, camera);
}

// ── Procedural pattern generation ──
function rebuildChecker() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = params.res;
  const ctx = cv.getContext('2d');
  const n = params.tiles;
  const cell = cv.width / n;

  if (params.pattern === 'checker') {
    // Each pair of cells alternates between two color schemes so you get
    // both checker and color cues — easier to spot mirroring & rotation.
    const palette = ['#ff5a1f', '#0a0a0a', '#3a85ff', '#f5f3ee'];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const ci = (x + y * 2) % 4;
        ctx.fillStyle = palette[ci];
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    // outline
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (let i = 1; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, cv.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(cv.width, i * cell); ctx.stroke();
    }
  } else if (params.pattern === 'grid') {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#ff5a1f';
    ctx.lineWidth = Math.max(1, cv.width / 512);
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, cv.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(cv.width, i * cell); ctx.stroke();
    }
    ctx.fillStyle = '#f5f3ee';
    ctx.font = `${Math.max(10, cell * 0.18)}px JetBrains Mono, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillText(`${x},${y}`, x * cell + cell / 2, y * cell + cell / 2);
      }
    }
  } else if (params.pattern === 'density') {
    // gradient from black (0,0) to white (1,1), so per-texel density shows
    const id = ctx.createImageData(cv.width, cv.height);
    const d = id.data;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const t = (x + y) / (cv.width + cv.height);
        const v = Math.round(t * 255);
        const i = (y * cv.width + x) * 4;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    // overlay checker for orientation
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#ff5a1f';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if ((x + y) & 1) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.globalAlpha = 1;
  } else if (params.pattern === 'stripes-h' || params.pattern === 'stripes-v') {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#ff5a1f';
    for (let i = 0; i < n; i++) {
      if (i & 1) continue;
      if (params.pattern === 'stripes-h') ctx.fillRect(0, i * cell, cv.width, cell);
      else ctx.fillRect(i * cell, 0, cell, cv.height);
    }
  }

  lastPatternCanvas = cv;

  if (checkerTex) checkerTex.dispose();
  checkerTex = new THREE.CanvasTexture(cv);
  checkerTex.wrapS = checkerTex.wrapT = THREE.RepeatWrapping;
  checkerTex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  checkerTex.needsUpdate = true;

  applyMaterials();
}

function applyMaterials() {
  if (!currentModel) return;
  currentModel.traverse(obj => {
    if (obj.isMesh) {
      const mat = new THREE.MeshStandardMaterial({
        map: checkerTex,
        roughness: 0.8,
        metalness: 0.0,
        wireframe: false,
      });
      obj.material = mat;
      // add wireframe overlay as a separate child if requested
      if (params.wire) {
        if (!obj.userData._wire) {
          const wmat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 });
          const wmesh = new THREE.Mesh(obj.geometry, wmat);
          obj.add(wmesh);
          obj.userData._wire = wmesh;
        }
      } else if (obj.userData._wire) {
        obj.remove(obj.userData._wire);
        obj.userData._wire.material.dispose();
        delete obj.userData._wire;
      }
    }
  });
  if (flatModel) {
    flatModel.traverse(obj => {
      if (obj.isMesh) obj.material.map = checkerTex;
    });
  }
}

function loadFbx(file) {
  const url = URL.createObjectURL(file);
  $('uvStatus').textContent = 'Loading ' + file.name + '...';
  const loader = new FBXLoader();
  loader.load(url, root => {
    URL.revokeObjectURL(url);
    // remove previous
    if (currentModel) { scene.remove(currentModel); disposeTree(currentModel); }
    if (flatModel)    { scene.remove(flatModel);    disposeTree(flatModel);    flatModel = null; }

    currentModel = root;
    scene.add(root);
    fitCameraToObject(root);
    applyMaterials();
    if (params.flatten) applyFlatten();

    // info
    let meshes = 0, tris = 0, verts = 0;
    root.traverse(o => {
      if (o.isMesh) {
        meshes++;
        const g = o.geometry;
        verts += (g.attributes.position ? g.attributes.position.count : 0);
        if (g.index) tris += g.index.count / 3;
        else if (g.attributes.position) tris += g.attributes.position.count / 3;
      }
    });
    $('uvModelInfo').textContent = `${file.name} · ${meshes} mesh · ${Math.round(tris).toLocaleString()} tris · ${verts.toLocaleString()} verts`;
    $('uvEmpty').style.display = 'none';
    $('uvStatus').textContent = '';
  }, undefined, err => {
    console.error(err);
    $('uvStatus').textContent = 'Failed: ' + err.message;
    URL.revokeObjectURL(url);
  });
}

function disposeTree(root) {
  root.traverse(o => {
    if (o.isMesh) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    }
  });
}

function fitCameraToObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z);
  const fitDist = max / (2 * Math.tan(Math.PI * camera.fov / 360));
  camera.position.copy(center).add(new THREE.Vector3(fitDist * 1.2, fitDist * 0.8, fitDist * 1.4));
  camera.near = max / 1000;
  camera.far = max * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

// Flatten: build a 2D mesh in UV space and show it alongside.
function applyFlatten() {
  if (flatModel) { scene.remove(flatModel); disposeTree(flatModel); flatModel = null; }
  if (!params.flatten || !currentModel) {
    if (currentModel) currentModel.visible = true;
    return;
  }

  flatModel = new THREE.Group();
  currentModel.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.uv) return;
    const g = o.geometry.clone();
    const uv = g.attributes.uv;
    const pos = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) {
      pos[i * 3]     = uv.getX(i);
      pos[i * 3 + 1] = uv.getY(i);
      pos[i * 3 + 2] = 0;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshBasicMaterial({ map: checkerTex, side: THREE.DoubleSide });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.4 });
    const mesh = new THREE.Mesh(g, m);
    const wmesh = new THREE.Mesh(g, wireMat);
    mesh.add(wmesh);
    flatModel.add(mesh);
  });

  // UV space is 0..1 — frame it neatly
  flatModel.position.set(-0.5, -0.5, 0);
  scene.add(flatModel);
  currentModel.visible = false;

  // Reset camera to look at UV quad
  camera.position.set(0, 0, 1.5);
  controls.target.set(0, 0, 0);
  controls.update();
}

window.uvInit = function uvInit() { init(); setTimeout(resize, 50); };

// boot when script loads (HTML is already in DOM, see router)
init();
setTimeout(resize, 50);
