const RATIOS = [
  { label: '1:1',  w: 1,  h: 1  },
  { label: '4:3',  w: 4,  h: 3  },
  { label: '3:4',  w: 3,  h: 4  },
  { label: '4:5',  w: 4,  h: 5  },
  { label: '5:4',  w: 5,  h: 4  },
  { label: '16:9', w: 16, h: 9  },
  { label: '9:16', w: 9,  h: 16 },
  { label: '3:2',  w: 3,  h: 2  },
  { label: '2:3',  w: 2,  h: 3  },
];

const SLIDER_IDS = ['resolution', 'noiseScale', 'noiseOffX', 'noiseOffY', 'noiseSeed'];

const defaultParams = {
  resolution: 12,
  noiseScale: 30,
  noiseOffX:  0,
  noiseOffY:  0,
  noiseSeed:  0,
};

let currentRatioIdx = 6;   // 9:16 default
let mirrorMode      = 'none';
let userImage = null;
let p5Instance = null;
let pg = null;
let captureP5 = null;
let usingFrontCam = true;
let noiseTime = 0;
let playing = false;

// params  — smoothed values used for rendering (lerped toward targets each frame)
// targets — raw values set instantly by sliders / reset
const params  = { ...defaultParams };
const targets = { ...defaultParams };

// ── Ratio buttons ─────────────────────────────────────────────────────────────
const ratioRow = document.getElementById('ratio-buttons');
RATIOS.forEach((r, i) => {
  const btn = document.createElement('button');
  btn.className = 'ratio-btn' + (i === currentRatioIdx ? ' active' : '');
  btn.textContent = r.label;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRatioIdx = i;
    resizeToRatio();
  });
  ratioRow.appendChild(btn);
});

// ── Mirror select ─────────────────────────────────────────────────────────────
document.getElementById('distorterMirrorSelect').addEventListener('change', function() {
  mirrorMode = this.value;
});

// ── Play / pause ──────────────────────────────────────────────────────────────
document.getElementById('playPauseBtn').addEventListener('click', function() {
  playing = !playing;
  this.textContent = playing ? '⏸ pause' : '▶ play';
});

// ── Camera flip ───────────────────────────────────────────────────────────────
document.getElementById('flipCamBtn').addEventListener('click', function() {
  usingFrontCam = !usingFrontCam;
  this.textContent = usingFrontCam ? 'front' : 'back';
  if (captureP5 && p5Instance) {
    captureP5.remove();
    captureP5 = p5Instance.createCapture({ video: { facingMode: usingFrontCam ? 'user' : 'environment' }, audio: false });
    captureP5.hide();
  }
});

// ── Sliders ───────────────────────────────────────────────────────────────────
SLIDER_IDS.forEach(id => {
  const slider = document.getElementById(id);
  slider.addEventListener('input', () => {
    targets[id] = parseFloat(slider.value);
  });
});

document.querySelectorAll('.reset-btn[data-id]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.id;
    targets[id] = defaultParams[id];
    document.getElementById(id).value = defaultParams[id];
  });
});

// ── File input ────────────────────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  if (p5Instance) {
    p5Instance.loadImage(url, img => {
      userImage = img;
      URL.revokeObjectURL(url);
    });
  }
  e.target.value = '';
});

// ── Reset all ─────────────────────────────────────────────────────────────────
function resetAll() {
  SLIDER_IDS.forEach(id => {
    targets[id] = defaultParams[id];
    document.getElementById(id).value = defaultParams[id];
  });
  mirrorMode = 'none';
  document.querySelectorAll('#mirror-buttons .ratio-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#mirror-buttons .ratio-btn').classList.add('active');
}

// ── Save ──────────────────────────────────────────────────────────────────────
function doSave() {
  const src = getActiveSource();
  if (!src || !pg) return;

  const ratio = RATIOS[currentRatioIdx];
  const LONG  = 1920;
  const saveW = ratio.w >= ratio.h ? LONG : Math.round(LONG * ratio.w / ratio.h);
  const saveH = ratio.h >  ratio.w ? LONG : Math.round(LONG * ratio.h / ratio.w);

  const origW = pg.width;
  const origH = pg.height;

  pg.resizeCanvas(saveW, saveH);
  pg.camera();
  pg.background(0);
  drawDistorted(src);

  const expCanvas    = document.createElement('canvas');
  expCanvas.width    = pg.elt.width;
  expCanvas.height   = pg.elt.height;
  expCanvas.getContext('2d').drawImage(pg.elt, 0, 0);

  pg.resizeCanvas(origW, origH);
  pg.camera();

  const dataURL = expCanvas.toDataURL('image/jpeg', 0.92);
  const a       = document.createElement('a');
  a.href        = dataURL;
  a.download    = 'distorted.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Active source (uploaded photo takes priority over live camera) ────────────
function getActiveSource() {
  return userImage || (captureP5 && captureP5.width > 1 ? captureP5 : null);
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────
function getCanvasDimensions() {
  const ratio     = RATIOS[currentRatioIdx];
  const container = document.getElementById('canvas-container');
  const availW    = container.clientWidth;
  const availH    = container.clientHeight - 8; // subtract bottom padding

  let w, h;
  if (ratio.h > ratio.w) {
    // portrait — longer side is height
    h = availH;
    w = Math.round(h * ratio.w / ratio.h);
    if (w > availW) { w = availW; h = Math.round(w * ratio.h / ratio.w); }
  } else if (ratio.w > ratio.h) {
    // landscape — longer side is width
    w = availW;
    h = Math.round(w * ratio.h / ratio.w);
    if (h > availH) { h = availH; w = Math.round(h * ratio.w / ratio.h); }
  } else {
    // square — fit within smaller dimension
    const side = Math.min(availW, availH);
    w = side; h = side;
  }

  return { w: Math.max(w, 10), h: Math.max(h, 10) };
}

function resizeToRatio() {
  if (!p5Instance || !pg) return;
  const { w, h } = getCanvasDimensions();
  p5Instance.resizeCanvas(w, h);
  pg.resizeCanvas(w, h);
}

// ── p5.js sketch ──────────────────────────────────────────────────────────────
new p5(function(p) {
  p5Instance = p;

  p.setup = function() {
    const { w, h } = getCanvasDimensions();
    const cnv = p.createCanvas(w, h);
    cnv.parent('canvas-container');

    const _orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, attrs) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
        attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
      }
      return _orig.call(this, type, attrs);
    };
    pg = p.createGraphics(w, h, p.WEBGL);
    HTMLCanvasElement.prototype.getContext = _orig;

    pg.textureMode(pg.IMAGE);
    pg.noStroke();
    p.noStroke();

    captureP5 = p.createCapture({ video: { facingMode: 'user' }, audio: false });
    captureP5.hide();

    // Re-sync canvas size now that p5Instance is ready
    setTimeout(() => { if (typeof updateSheetH === 'function') updateSheetH(); }, 0);
  };

  p.draw = function() {
    if (playing) noiseTime += 0.005;

    params.resolution = targets.resolution;
    params.noiseSeed  = targets.noiseSeed;

    const ease = 0.12;
    ['noiseScale', 'noiseOffX', 'noiseOffY'].forEach(id => {
      const diff = targets[id] - params[id];
      params[id] = Math.abs(diff) < 0.5 ? targets[id] : params[id] + diff * ease;
    });

    pg.background(0);
    const src = getActiveSource();
    if (!src) {
      drawPlaceholder();
    } else {
      drawDistorted(src);
    }
    p.image(pg, 0, 0);
  };

  p.windowResized = function() {
    resizeToRatio();
  };
});

function drawPlaceholder() {
  pg.fill(25);
  pg.rectMode(pg.CENTER);
  pg.rect(0, 0, pg.width, pg.height);
  pg.fill(90);
  pg.textAlign(pg.CENTER, pg.CENTER);
  pg.textSize(15);
  pg.text('upload a photo', 0, 0);
}

function drawDistorted(src) {
  const res = Math.max(2, Math.round(params.resolution));
  const hw  = pg.width  / 2;
  const hh  = pg.height / 2;
  const iw  = src.width;
  const ih  = src.height;

  // Cover-fit UV base
  const imgAspect    = iw / ih;
  const canvasAspect = pg.width / pg.height;
  let uvW, uvH, uvX, uvY;
  if (imgAspect > canvasAspect) {
    uvH = ih;  uvW = ih * canvasAspect;
    uvX = (iw - uvW) / 2;  uvY = 0;
  } else {
    uvW = iw;  uvH = iw / canvasAspect;
    uvX = 0;   uvY = (ih - uvH) / 2;
  }

  const freq = params.noiseScale / 100;
  const ox   = params.noiseOffX  / 200;
  const oy   = params.noiseOffY  / 200;

  p5Instance.noiseSeed(params.noiseSeed);

  // Sample noise-displaced UV at a given effective (te, se) position
  function sampleUV(te, se) {
    const nx = te * freq + ox;
    const ny = se * freq + oy;
    const du = (p5Instance.noise(nx,       ny,       noiseTime)       - 0.5) * uvW * freq * 2;
    const dv = (p5Instance.noise(nx + 100, ny + 100, noiseTime + 0.5) - 0.5) * uvH * freq * 2;
    return { u: uvX + te * uvW + du, v: uvY + se * uvH + dv };
  }

  // Fold [0,1] into a mirror: 0→0, 0.5→1, 1→0
  function fold(v) { return v < 0.5 ? v * 2 : (1 - v) * 2; }

  const modeX = mirrorMode === 'x'  || mirrorMode === 'xy';
  const modeY = mirrorMode === 'y'  || mirrorMode === 'xy';

  pg.texture(src);
  pg.beginShape(pg.TRIANGLES);

  if (mirrorMode === 'random') {
    // Per-cell independent mirroring — each cell mirrors around its own center
    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const t0 = c / res,       t1 = (c + 1) / res;
        const s0 = r / res,       s1 = (r + 1) / res;
        const tc = (t0 + t1) * 0.5;
        const sc = (s0 + s1) * 0.5;

        // Hash this cell to get independent flip flags
        let h = (c * 1997 + r * 9377 + params.noiseSeed * 7919) | 0;
        h ^= h >>> 16;
        h  = Math.imul(h, 0x45d9f3b);
        h ^= h >>> 16;
        const fx = (h & 1) !== 0;
        const fy = (h & 2) !== 0;

        const cv = (t, s) => {
          const uv = sampleUV(fx ? tc * 2 - t : t, fy ? sc * 2 - s : s);
          return { x: -hw + t * pg.width, y: -hh + s * pg.height, u: uv.u, v: uv.v };
        };

        const tl = cv(t0, s0), tr = cv(t1, s0);
        const br = cv(t1, s1), bl = cv(t0, s1);

        pg.vertex(tl.x, tl.y, 0, tl.u, tl.v);
        pg.vertex(tr.x, tr.y, 0, tr.u, tr.v);
        pg.vertex(br.x, br.y, 0, br.u, br.v);
        pg.vertex(tl.x, tl.y, 0, tl.u, tl.v);
        pg.vertex(br.x, br.y, 0, br.u, br.v);
        pg.vertex(bl.x, bl.y, 0, bl.u, bl.v);
      }
    }
  } else {
    // Shared vertex grid for none / x / y / xy
    const verts = [];
    for (let r = 0; r <= res; r++) {
      verts[r] = [];
      for (let c = 0; c <= res; c++) {
        const t  = c / res,  s  = r / res;
        const te = modeX ? fold(t) : t;
        const se = modeY ? fold(s) : s;
        const uv = sampleUV(te, se);
        verts[r][c] = { x: -hw + t * pg.width, y: -hh + s * pg.height, u: uv.u, v: uv.v };
      }
    }

    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const tl = verts[r][c],     tr = verts[r][c + 1];
        const br = verts[r + 1][c + 1], bl = verts[r + 1][c];

        pg.vertex(tl.x, tl.y, 0, tl.u, tl.v);
        pg.vertex(tr.x, tr.y, 0, tr.u, tr.v);
        pg.vertex(br.x, br.y, 0, br.u, br.v);
        pg.vertex(tl.x, tl.y, 0, tl.u, tl.v);
        pg.vertex(br.x, br.y, 0, br.u, br.v);
        pg.vertex(bl.x, bl.y, 0, bl.u, bl.v);
      }
    }
  }

  pg.endShape();
}
