let bgrModel = null;       // imgly removeBackground function
let bgrLoading = false;
let bgrOriginalBlob = null; // original loaded image blob
let bgrOriginalUrl = null;
let bgrResultBlob = null;
let bgrResultUrl = null;
let bgrViewMode = 'result';
let bgrBgMode = 'transparent';

const bgrProgText = document.getElementById('bgrProgText');
const setBgrProgress = (visible, text) => {
  bgrProgText.style.display = visible ? 'block' : 'none';
  if(text) bgrProgText.textContent = text;
};
const bgrImg = document.getElementById('bgrImg');
const bgrImgWrap = document.getElementById('bgrImgWrap');
const bgrDrop = document.getElementById('bgrDrop');
const bgrFileIn = document.getElementById('bgrFileIn');
const bgrRunBtn = document.getElementById('bgrRunBtn');
const bgrExportBtn = document.getElementById('bgrExportBtn');
const bgrResetBtn = document.getElementById('bgrResetBtn');
const bgrProgress = document.getElementById('bgrProgress');
const bgrProgressBar = bgrProgress.querySelector('div');
const bgrCanvasArea = document.getElementById('bgrCanvasArea');

// Drop / browse
bgrDrop.addEventListener('click', () => bgrFileIn.click());
bgrFileIn.addEventListener('change', e => { if(e.target.files[0]) loadBgrImage(e.target.files[0]); });

bgrDrop.addEventListener('dragover', e => { e.preventDefault(); bgrDrop.classList.add('over'); });
bgrDrop.addEventListener('dragleave', () => bgrDrop.classList.remove('over'));
bgrDrop.addEventListener('drop', e => {
  e.preventDefault(); bgrDrop.classList.remove('over');
  if(e.dataTransfer.files[0]) loadBgrImage(e.dataTransfer.files[0]);
});

// Also accept drops anywhere in canvas area when image loaded
bgrCanvasArea.addEventListener('dragover', e => e.preventDefault());
bgrCanvasArea.addEventListener('drop', e => {
  e.preventDefault();
  if(e.dataTransfer.files[0]) loadBgrImage(e.dataTransfer.files[0]);
});

function loadBgrImage(file) {
  if(bgrOriginalUrl) URL.revokeObjectURL(bgrOriginalUrl);
  if(bgrResultUrl)   URL.revokeObjectURL(bgrResultUrl);
  bgrOriginalBlob = file;
  bgrOriginalUrl  = URL.createObjectURL(file);
  bgrResultBlob = null; bgrResultUrl = null;
  bgrImg.src = bgrOriginalUrl;
  bgrDrop.style.display = 'none';
  bgrImgWrap.style.display = 'flex';
  bgrRunBtn.disabled = false;
  bgrExportBtn.disabled = true;
  bgrResetBtn.disabled = false;
  bgrViewMode = 'original';
  updateBgrViewToggle();
  setBgrProgress(false);
}

// View toggle (Result / Original)
document.getElementById('bgrViewToggle').addEventListener('click', e => {
  if(e.target.tagName !== 'BUTTON') return;
  bgrViewMode = e.target.dataset.view;
  updateBgrViewToggle();
});
function updateBgrViewToggle() {
  document.querySelectorAll('#bgrViewToggle button').forEach(b =>
    b.classList.toggle('on', b.dataset.view === bgrViewMode));
  refreshBgrDisplay();
}

// Background toggle (Transparent / Color)
document.getElementById('bgrBgToggle').addEventListener('click', e => {
  if(e.target.tagName !== 'BUTTON') return;
  bgrBgMode = e.target.dataset.bg;
  document.querySelectorAll('#bgrBgToggle button').forEach(b =>
    b.classList.toggle('on', b.dataset.bg === bgrBgMode));
  document.getElementById('bgrBgColorRow').style.display =
    bgrBgMode === 'color' ? 'flex' : 'none';
  refreshBgrDisplay();
});
document.getElementById('bgrBgColor').addEventListener('input', refreshBgrDisplay);

function refreshBgrDisplay() {
  if(bgrViewMode === 'original' && bgrOriginalUrl) {
    bgrImg.src = bgrOriginalUrl;
    bgrCanvasArea.style.background = 'repeating-conic-gradient(#1a1c22 0% 25%, #22242d 0% 50%) 0 0/24px 24px';
  } else if(bgrViewMode === 'result' && bgrResultUrl) {
    bgrImg.src = bgrResultUrl;
    if(bgrBgMode === 'color') {
      bgrCanvasArea.style.background = document.getElementById('bgrBgColor').value;
    } else {
      bgrCanvasArea.style.background = 'repeating-conic-gradient(#1a1c22 0% 25%, #22242d 0% 50%) 0 0/24px 24px';
    }
  } else if(bgrOriginalUrl) {
    bgrImg.src = bgrOriginalUrl;
  }
}

// Process — lazy-load library on first use
bgrRunBtn.addEventListener('click', async () => {
  if(!bgrOriginalBlob) return;
  bgrRunBtn.disabled = true;
  bgrProgress.classList.add('on');
  bgrProgressBar.style.width = '0%';

  try {
    if(!bgrModel) {
      setBgrProgress(true, 'Loading model...');
      const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
      bgrModel = mod.default || mod.removeBackground || mod;
      if(typeof bgrModel !== 'function' && bgrModel.removeBackground) bgrModel = bgrModel.removeBackground;
      setBgrProgress(true, 'In progress...');
    } else {
      setBgrProgress(true, 'In progress...');
    }

    const config = {
      progress: (key, current, total) => {
        const pct = Math.round((current/total) * 100);
        bgrProgressBar.style.width = pct + '%';
        setBgrProgress(true, `In progress... ${pct}%`);
      }
    };

    const resultBlob = await bgrModel(bgrOriginalBlob, config);
    bgrResultBlob = resultBlob;
    if(bgrResultUrl) URL.revokeObjectURL(bgrResultUrl);
    bgrResultUrl = URL.createObjectURL(resultBlob);
    bgrViewMode = 'result';
    updateBgrViewToggle();
    bgrExportBtn.disabled = false;
  } catch(err) {
    console.error(err);
    setBgrProgress(true, 'Error: ' + (err.message || 'failed'));
  } finally {
    bgrRunBtn.disabled = false;
    setTimeout(() => { bgrProgress.classList.remove('on'); setBgrProgress(false); }, 800);
  }
});

// Export
bgrExportBtn.addEventListener('click', async () => {
  if(!bgrResultBlob) return;
  let exportBlob = bgrResultBlob;

  if(bgrBgMode === 'color') {
    // composite onto solid color
    const bgColor = document.getElementById('bgrBgColor').value;
    const url = URL.createObjectURL(bgrResultBlob);
    const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = url; });
    const c = Object.assign(document.createElement('canvas'), {width: img.width, height: img.height});
    const cx = c.getContext('2d');
    cx.fillStyle = bgColor;
    cx.fillRect(0, 0, img.width, img.height);
    cx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    exportBlob = await new Promise(res => c.toBlob(res, 'image/png'));
  }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(exportBlob);
  const baseName = bgrOriginalBlob.name ? bgrOriginalBlob.name.replace(/\.[^.]+$/, '') : 'image';
  a.download = baseName + '_nobg.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Reset
bgrResetBtn.addEventListener('click', () => {
  if(bgrOriginalUrl) URL.revokeObjectURL(bgrOriginalUrl);
  if(bgrResultUrl)   URL.revokeObjectURL(bgrResultUrl);
  bgrOriginalBlob = bgrOriginalUrl = bgrResultBlob = bgrResultUrl = null;
  bgrImg.src = '';
  bgrImgWrap.style.display = 'none';
  bgrDrop.style.display = 'block';
  bgrRunBtn.disabled = true;
  bgrExportBtn.disabled = true;
  bgrResetBtn.disabled = true;
  bgrFileIn.value = '';
  setBgrProgress(false);
});
