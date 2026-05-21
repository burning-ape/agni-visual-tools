# Agni Visual Tools

Browser-native visual tools for 3D & texture artists. Runs locally — nothing leaves your machine, no telemetry, no upload.

## Tools

**3D & UV**
- **Texture Editor** — paint decals, clone-stamp and blur directly on FBX models.
- **UV Checker** — inspect UV layouts with checker / grid / density / stripe patterns. Optional flatten-to-UV-space view.

**Texture pipeline**
- **Normal Map** — generate tangent-space normal maps from height or diffuse. Sobel filter, configurable strength and blur, X/Y invert (OpenGL ↔ DirectX).
- **Seamless Maker** — turn any photo into a tileable texture via offset-blend or mirror-tile.
- **Channel Packer** — pack up to four images into R/G/B/A. Presets for ORM, RMA, MRA, HRGM.
- **Atlas Packer** — bin-packing or grid layout for sprite sheets. Exports PNG + JSON (Agni / Phaser / generic).

**Image processing**
- **Background Remover** — local AI background removal.
- **Color Replacer** — swap a color range. HSL, LAB ΔE, or GPU WebGL shader.
- **Resizer** — batch resize with Lanczos / Mitchell / Bilinear / Nearest. Modes: longest-side, exact W×H, scale %, power-of-2.
- **Mask Generator** — compose B&W masks with layers and noise generators (Perlin, Worley, Voronoi, fBm, stripes, dots…).

## Architecture

```
index.html              ~6 KB    shell + menu only
css/agni.css            ~25 KB   shared design system
js/router.js            ~6 KB    lazy-loads each tool on demand
js/shared-session.js    ~1 KB    cross-tool clipboard (masks)
tools/<name>.html       per-tool view fragment
tools/<name>.js         per-tool logic (loaded on first launch)
tools/<name>.css        per-tool styles (loaded on first launch)
```

Initial download is roughly **37 KB** (vs. the 216 KB single-file build of v0.4).
Each tool then loads its own bundle on click; visited tools stay cached for the session.

## URL routing

Each tool has a hash route — links open the tool directly:
- `#texture`, `#bgremove`, `#maskgen`, `#colorreplace`
- `#normalgen`, `#seamless`, `#channelpack`, `#resizer`, `#uvcheck`, `#atlas`

## Running locally

The shell uses ES modules and `<script type="importmap">`, so it needs a real HTTP server (not `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

## License

MIT — see [LICENSE](./LICENSE).
