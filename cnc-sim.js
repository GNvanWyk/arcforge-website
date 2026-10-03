/**
 * ArcForge Designs - Virtual CNC Plasma Table
 * Top-down canvas simulation of a plasma table cutting randomly generated parts,
 * driving the live "torch_controller" terminal readout next to it.
 *
 * Loaded only on pages with a <canvas data-cnc-sim> (index.html, cut-your-own.html).
 * Plain JS + canvas, no dependencies. Pauses when off-screen or when the tab is hidden,
 * and shows a static finished sheet for prefers-reduced-motion.
 *
 * Canvas data attributes:
 *   data-cnc-speed         - time-lapse factor for the idle loop (e.g. 3.5 = 3.5x real speed)
 *   data-cnc-custom-speed  - time-lapse factor for a visitor's own part (cut-your-own page)
 * Terminal elements (optional, found by attribute anywhere on the page):
 *   data-cnc-field="status|voltage|feed|file|material|stage"
 *
 * Public API (used by cnc-draw.js): canvas.cncMachine.cutCustom(points), .reset(),
 * and 'cnc:state' events ({ detail: { state: 'custom-start' | 'custom-done' } }) on the canvas.
 */

document.addEventListener('DOMContentLoaded', () => {
  initCncSim();
});

function initCncSim() {
  const canvases = document.querySelectorAll('canvas[data-cnc-sim]');
  if (!canvases.length || !window.ArcForgeCNC) return;
  canvases.forEach((canvas) => {
    const speed = parseFloat(canvas.getAttribute('data-cnc-speed')) || 3.5;
    const customSpeed = parseFloat(canvas.getAttribute('data-cnc-custom-speed')) || speed;
    canvas.cncMachine = window.ArcForgeCNC.create(canvas, { speed, customSpeed });
  });
}

(function () {
  'use strict';

  // ---- Machine constants (millimetres, seconds) ----
  const SHEET_W = 1200;
  const SHEET_H = 800;
  const CUT_FEED = 2400;                // mm/min shown while cutting
  const RAPID_FEED = 15000;             // mm/min shown while traversing
  const CUT_SPEED = CUT_FEED / 60;      // mm/s at 1x
  const RAPID_SPEED = RAPID_FEED / 60;  // mm/s at 1x
  const KERF_COOL = 1.4;                // s for the glowing kerf to cool to grey
  const DROP_TIME = 0.8;                // s for a cut piece to fall out of the sheet
  const REVEAL_TIME = 1.1;              // s for the table "opening" reveal
  const SHEET_SWAP_TIME = 1.8;          // s to unload the old sheet and slide in a new one
  const HEAT_STEPS = 10;                // colour buckets used to draw the cooling kerf
  const CUSTOM_BLOCKS = [[2, 2], [2, 1], [1, 2]]; // nest slots a visitor's part may span (never a single small slot)

  const STAGE = {
    pierce: 'Piercing',
    cut: 'Active',
    rapid: 'Traversing',
    park: 'Parked at 0;0',
    sheet: 'Loading New Sheet',
  };
  const STAGE_CLASSES = {
    Piercing: 'text-amber-500',
    Active: 'text-emerald-400',
    Traversing: 'text-[#00e5ff]',
    'Parked at 0;0': 'text-slate-400',
    'Loading New Sheet': 'text-slate-400',
  };
  const STATUS_ON = ['bg-[#00e5ff]/10', 'text-[#00e5ff]', 'border-[#00e5ff]/30'];
  const STATUS_OFF = ['bg-slate-900/60', 'text-slate-400', 'border-slate-700/70'];

  // Weighted so mild steel (the bread-and-butter job) comes up most often
  const MATERIALS = [
    { name: 'Mild Steel S275JR', weight: 5, t: [1, 1.6, 2, 3, 4, 5, 6, 8, 10, 12, 16] },
    { name: 'Stainless Steel 304', weight: 1.5, t: [1, 1.5, 2, 3, 4, 5, 6, 8, 10] },
    { name: 'Stainless Steel 316', weight: 1, t: [1, 1.5, 2, 3, 4, 5, 6, 8] },
    { name: 'Aluminium Plate', weight: 1.5, t: [2, 3, 4, 5, 6, 8, 10] },
    { name: 'Checkered Tread Plate', weight: 1, t: [3, 4.5, 6, 8] },
  ];

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round5 = (v) => Math.round(v / 5) * 5;
  const easeInOut = (p) => 0.5 - Math.cos(p * Math.PI) / 2;
  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
  const easeInCubic = (p) => p * p * p;

  function seededRandom(seed) {
    // mulberry32 - so a sheet's surface texture can be redrawn identically after a resize
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickMaterial() {
    const total = MATERIALS.reduce((s, m) => s + m.weight, 0);
    let r = Math.random() * total;
    const mat = MATERIALS.find((m) => (r -= m.weight) < 0) || MATERIALS[0];
    const t = pick(mat.t);
    return { name: mat.name, thickness: t, label: `${mat.name} (${t.toFixed(1)}mm)` };
  }

  function isLightTheme() {
    return document.documentElement.classList.contains('light');
  }

  // ---------------------------------------------------------------------------
  // Geometry: part profiles generated in code (local mm coords, centred on 0,0)
  // ---------------------------------------------------------------------------
  function circle(cx, cy, r, a0 = 0) {
    const n = clamp(Math.round((TAU * r) / 5), 20, 72);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }

  // Polygon with filleted corners; r may be a number or one radius per vertex
  function rounded(verts, r) {
    const out = [];
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const p = verts[i];
      const a = verts[(i + n - 1) % n];
      const b = verts[(i + 1) % n];
      const rr = Array.isArray(r) ? r[i] : r;
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const d = Math.min(rr, la / 2, lb / 2);
      if (d < 0.5) {
        out.push(p);
        continue;
      }
      const p1 = [p[0] + ((a[0] - p[0]) / la) * d, p[1] + ((a[1] - p[1]) / la) * d];
      const p2 = [p[0] + ((b[0] - p[0]) / lb) * d, p[1] + ((b[1] - p[1]) / lb) * d];
      for (let s = 0; s <= 6; s++) {
        const t = s / 6;
        const u = 1 - t;
        out.push([u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]]);
      }
    }
    return out;
  }

  function rotatePts(pts, ang, tx = 0, ty = 0) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return pts.map(([x, y]) => [x * c - y * s + tx, x * s + y * c + ty]);
  }

  // Slot (stadium) hole
  function slot(cx, cy, len, r, ang) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI;
      pts.push([len / 2 + Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI / 2 + (i / 10) * Math.PI;
      pts.push([-len / 2 + Math.cos(a) * r, Math.sin(a) * r]);
    }
    return rotatePts(pts, ang, cx, cy);
  }

  // Each generator returns { name, outer, holes, spin } fitting inside an s x s box
  const SHAPES = {
    gear(s) {
      const teeth = pick([12, 16, 18, 20, 24, 28, 32]);
      const rTip = s / 2;
      const rRoot = rTip * (teeth >= 24 ? 0.89 : 0.85);
      const pitch = TAU / teeth;
      const outer = [];
      for (let i = 0; i < teeth; i++) {
        [[rRoot, 0], [rRoot, 0.18], [rTip, 0.36], [rTip, 0.64], [rRoot, 0.82]].forEach(([r, f]) => {
          const a = (i + f) * pitch;
          outer.push([Math.cos(a) * r, Math.sin(a) * r]);
        });
      }
      const holes = [circle(0, 0, rTip * 0.2)];
      if (teeth >= 20) {
        const n = teeth >= 28 ? 6 : 4;
        for (let i = 0; i < n; i++) {
          const a = ((i + 0.5) / n) * TAU;
          holes.push(circle(Math.cos(a) * rRoot * 0.56, Math.sin(a) * rRoot * 0.56, rRoot * 0.17));
        }
      }
      return { name: `Gear_${teeth}T.dxf`, outer, holes, spin: true };
    },

    flange(s) {
      const R = s / 2;
      const n = pick([4, 6, 8]);
      const holes = [circle(0, 0, R * 0.36)];
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * TAU;
        holes.push(circle(Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7, R * 0.085));
      }
      return { name: `Flange_${n}H_${round5(s)}mm.dxf`, outer: circle(0, 0, R), holes, spin: true };
    },

    gusset(s) {
      const h = s * rand(0.72, 1);
      const x0 = -s / 2;
      const y0 = -s / 2;
      const c = s * 0.12; // weld-clearance chamfer in the right-angle corner
      const outer = rounded(
        [[x0 + c, y0], [x0 + s, y0], [x0, y0 + h], [x0, y0 + c]],
        [0, s * 0.04, s * 0.04, 0]
      );
      const holes = [circle(x0 + s * 0.28, y0 + h * 0.28, s * 0.07)];
      return { name: `Gusset_${round5(s)}x${round5(h)}.dxf`, outer, holes };
    },

    bracket(s) {
      const t = s * rand(0.32, 0.4);
      const x0 = -s / 2;
      const y0 = -s / 2;
      const rc = s * 0.05;
      const outer = rounded(
        [[x0, y0], [x0 + s, y0], [x0 + s, y0 + t], [x0 + t, y0 + t], [x0 + t, y0 + s], [x0, y0 + s]],
        [rc, rc, rc, t * 0.35, rc, rc]
      );
      const leg = s - t;
      const holes = [
        circle(x0 + t + leg * 0.35, y0 + t / 2, t * 0.17),
        circle(x0 + t + leg * 0.75, y0 + t / 2, t * 0.17),
        slot(x0 + t / 2, y0 + t + leg * 0.55, leg * 0.35, t * 0.15, Math.PI / 2),
      ];
      return { name: 'Bracket_L90.dxf', outer, holes };
    },

    star(s) {
      const n = pick([5, 6, 8]);
      const R = s / 2;
      const r = R * rand(0.42, 0.55);
      const verts = [];
      for (let i = 0; i < n * 2; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / n;
        const rr = i % 2 ? r : R;
        verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      return { name: `Star_${n}P.dxf`, outer: rounded(verts, s * 0.015), holes: [circle(0, 0, r * 0.3)], spin: true };
    },

    plate(s) {
      const w = s;
      const h = s * rand(0.55, 0.85);
      const cr = h * 0.14;
      const outer = rounded([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], cr);
      const ix = w / 2 - cr;
      const iy = h / 2 - cr;
      const holes = [[-ix, -iy], [ix, -iy], [ix, iy], [-ix, iy]].map(([x, y]) => circle(x, y, h * 0.07));
      holes.push(Math.random() < 0.5 ? slot(0, 0, w * 0.35, h * 0.1, 0) : circle(0, 0, h * 0.2));
      return { name: `Plate_${round5(w)}x${round5(h)}_4H.dxf`, outer, holes };
    },
  };
  const SHAPE_KEYS = Object.keys(SHAPES);

  function bounds(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // Rotate a local shape and move it so its bounding box is centred on (cx, cy)
  function placeShape(shape, ang, cx, cy) {
    const outer = rotatePts(shape.outer, ang);
    const holes = shape.holes.map((h) => rotatePts(h, ang));
    const b = bounds(outer);
    const dx = cx - (b.minX + b.maxX) / 2;
    const dy = cy - (b.minY + b.maxY) / 2;
    const move = (pts) => pts.map(([x, y]) => [x + dx, y + dy]);
    return { name: shape.name, outer: move(outer), holes: holes.map(move) };
  }

  function randomShape(block) {
    const s = Math.min(block.w, block.h) * rand(0.74, 0.84);
    const shape = SHAPES[pick(SHAPE_KEYS)](s);
    const ang = shape.spin ? rand(0, TAU) : Math.floor(rand(0, 4)) * (Math.PI / 2);
    return placeShape(shape, ang, block.cx + rand(-0.03, 0.03) * block.w, block.cy + rand(-0.03, 0.03) * block.h);
  }

  // Scale a user-drawn outline (any units, y-up) to fit the given sheet block
  function fitCustomShape(points, block) {
    const b = bounds(points);
    const scale = Math.min((block.w * 0.86) / Math.max(b.w, 1), (block.h * 0.86) / Math.max(b.h, 1));
    const outer = points.map(([x, y]) => [(x - (b.minX + b.maxX) / 2) * scale, (y - (b.minY + b.maxY) / 2) * scale]);
    return placeShape({ name: 'Custom_Part.dxf', outer, holes: [] }, 0, block.cx, block.cy);
  }

  function centroid(pts) {
    let x = 0, y = 0;
    pts.forEach((p) => { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  }

  // Cut order like real CAM: inner contours (holes) nearest-first, outer profile last.
  // Each contour gets a lead-in from a pierce point in the scrap side.
  function planContours(shape, from) {
    const plans = [];
    let pos = from;
    const holes = shape.holes.slice();
    const plan = (pts, isHole) => {
      let best = 0, bestD = Infinity;
      pts.forEach((p, i) => {
        const d = (p[0] - pos[0]) ** 2 + (p[1] - pos[1]) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      const ordered = pts.slice(best).concat(pts.slice(0, best));
      const start = ordered[0];
      const c = centroid(pts);
      const dist = Math.hypot(start[0] - c[0], start[1] - c[1]) || 1;
      const ux = (start[0] - c[0]) / dist;
      const uy = (start[1] - c[1]) / dist;
      const lead = isHole ? Math.min(9, dist * 0.45) : 9;
      const sign = isHole ? -1 : 1;
      const pierce = [start[0] + ux * lead * sign, start[1] + uy * lead * sign];
      const path = [pierce].concat(ordered, [start]);
      plans.push({ pierce, path, poly: pts });
      pos = start;
    };
    while (holes.length) {
      let best = 0, bestD = Infinity;
      holes.forEach((h, i) => {
        const c = centroid(h);
        const d = (c[0] - pos[0]) ** 2 + (c[1] - pos[1]) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      plan(holes.splice(best, 1)[0], true);
    }
    plan(shape.outer, false);
    return plans;
  }

  function pathLengths(path) {
    const cum = [0];
    for (let i = 1; i < path.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    }
    return cum;
  }

  // Kerf colour ramp: white-hot -> orange -> dull red -> cooled dark grey
  const HEAT_RAMP = [
    [0, [255, 244, 214]],
    [0.12, [255, 190, 90]],
    [0.35, [255, 110, 20]],
    [0.65, [140, 45, 18]],
    [1, [43, 48, 54]],
  ];
  const HEAT_COLORS = [];
  for (let i = 0; i <= HEAT_STEPS; i++) {
    const f = i / HEAT_STEPS;
    let j = 1;
    while (j < HEAT_RAMP.length - 1 && HEAT_RAMP[j][0] < f) j++;
    const [f0, c0] = HEAT_RAMP[j - 1];
    const [f1, c1] = HEAT_RAMP[j];
    const t = clamp((f - f0) / (f1 - f0), 0, 1);
    HEAT_COLORS.push(`rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(',')})`);
  }
  const KERF_GREY = HEAT_COLORS[HEAT_STEPS];

  function makeGlowSprite(stops) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    stops.forEach(([o, col]) => grad.addColorStop(o, col));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function palette() {
    return isLightTheme()
      ? {
          frame: '#dde4ec', frameEdge: '#c3ccd8', rail: '#c5cfdb', railTick: 'rgba(15,23,42,0.22)',
          accent: '#0284c7', bed: '#0b0f14', slat: '#2a2521', slatHi: 'rgba(255,190,140,0.08)',
          gantry: '#2b3445', gantryEdge: '#475569', carriage: '#334155', text: '#475569',
        }
      : {
          frame: '#141a27', frameEdge: '#242f44', rail: '#0d111a', railTick: 'rgba(148,163,184,0.22)',
          accent: '#00e5ff', bed: '#05070a', slat: '#211d1a', slatHi: 'rgba(255,190,140,0.06)',
          gantry: '#1b2333', gantryEdge: '#334155', carriage: '#242f44', text: '#94a3b8',
        };
  }

  // ---------------------------------------------------------------------------
  // The machine
  // ---------------------------------------------------------------------------
  class PlasmaTable {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.timeScale = opts.speed || 3.5;
      this.customScale = opts.customSpeed || this.timeScale;

      this.bgLayer = document.createElement('canvas');
      this.sheetLayer = document.createElement('canvas');
      this.torchGlow = makeGlowSprite([[0, 'rgba(255,255,240,1)'], [0.25, 'rgba(255,190,90,0.75)'], [1, 'rgba(255,90,10,0)']]);
      this.flashGlow = makeGlowSprite([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(190,245,255,0.85)'], [1, 'rgba(0,229,255,0)']]);

      this.fields = {};
      ['status', 'voltage', 'feed', 'file', 'material', 'stage'].forEach((f) => {
        this.fields[f] = document.querySelector(`[data-cnc-field="${f}"]`);
      });
      this.fieldCache = {};

      this.clock = 0;
      this.torch = { x: 0, y: 0 };
      this.torchOn = false;
      this.queue = [];
      this.action = null;
      this.kerfs = [];
      this.drops = [];
      this.sparks = [];
      this.sparkDebt = 0;
      this.mode = 'idle'; // 'idle' | 'custom' | 'custom-parked'
      this.pendingCustom = null;
      this.revealT = 0;
      this.revealStarted = false;
      this.inView = false;
      this.pageVisible = !document.hidden;
      this.raf = null;
      this.lastTs = null;
      this.voltage = { value: 0, next: 0, base: 128 };
      this.stage = STAGE.park;
      this.feed = 0;

      const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.reduced = !!(mq && mq.matches);
      if (this.reduced) this.revealT = 1;

      this.resize(true);
      this.newSheet();
      if (this.reduced) this.fillStaticSheet();
      this.buildSheetLayer();
      this.updateTerminal(true);
      if (this.reduced) this.render();

      this.frame = this.frame.bind(this);
      this.observe(mq);
    }

    observe(mq) {
      if ('ResizeObserver' in window) {
        new ResizeObserver(() => this.resize()).observe(this.canvas);
      }
      window.addEventListener('resize', () => this.resize());

      if ('IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
          this.inView = entries[entries.length - 1].isIntersecting;
          if (this.inView) this.revealStarted = true;
          this.wake();
        }, { threshold: 0.2 }).observe(this.canvas);
      } else {
        this.inView = this.revealStarted = true;
      }

      document.addEventListener('visibilitychange', () => {
        this.pageVisible = !document.hidden;
        this.wake();
      });

      // Re-tint the frame when the site's dark/light toggle flips the <html> class
      let wasLight = isLightTheme();
      new MutationObserver(() => {
        if (isLightTheme() === wasLight) return;
        wasLight = isLightTheme();
        this.buildBgLayer();
        this.render();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

      if (mq) {
        const onChange = () => {
          this.reduced = mq.matches;
          if (this.reduced) this.goStatic();
          else this.wake();
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
      this.wake();
    }

    // ---- Sizing -------------------------------------------------------------
    resize(force) {
      const W = Math.round(this.canvas.clientWidth);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (!W || (!force && W === this.W && dpr === this.dpr)) return;
      this.W = W;
      this.dpr = dpr;

      const r = clamp(W * 0.035, 8, 16);       // gantry rail strips (top/bottom)
      const m = clamp(W * 0.025, 6, 12);       // side frame
      const b = clamp(W * 0.014, 3, 7);        // bed margin around the sheet
      const bw = W - 2 * m;
      const sw = bw - 2 * b;
      const k = sw / SHEET_W;                  // px per mm
      const sh = SHEET_H * k;
      const bh = sh + 2 * b;
      const H = Math.round(bh + 2 * r);
      this.H = H;
      this.L = { r, m, b, bx: m, by: r, bw, bh, sx: m + b, sy: r + b, sw, sh, k,
        gw: clamp(W * 0.03, 7, 14), kw: Math.max(1.1, 3 * k) };

      this.canvas.style.height = `${H}px`;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);

      this.reserveFieldSpace();

      // Pixel-space effects can't survive a rescale; drop them
      this.drops = [];
      this.sparks = [];
      this.buildBgLayer();
      if (this.sheet) this.buildSheetLayer();
      this.render();
    }

    // ---- Sheet state ----------------------------------------------------------
    newSheet() {
      // Fewer, larger nest slots on narrow (phone) canvases so parts stay legible
      const narrow = this.W < 380;
      const cols = narrow ? 3 : 4;
      const rows = narrow ? 2 : 3;
      this.sheet = {
        seed: Math.floor(Math.random() * 1e9),
        cols,
        rows,
        occ: new Array(cols * rows).fill(false),
        committed: [],
      };
    }

    findBlock(sizes) {
      const { cols, rows, occ } = this.sheet;
      const sw = SHEET_W / cols;
      const shh = SHEET_H / rows;
      for (const [bw, bh] of sizes) {
        const free = [];
        for (let c = 0; c + bw <= cols; c++) {
          for (let r = 0; r + bh <= rows; r++) {
            let ok = true;
            for (let i = 0; i < bw && ok; i++) for (let j = 0; j < bh && ok; j++) if (occ[(r + j) * cols + c + i]) ok = false;
            if (ok) free.push({ c, r });
          }
        }
        if (free.length) {
          const { c, r } = pick(free);
          return { c, r, bw, bh, w: bw * sw, h: bh * shh, cx: (c + bw / 2) * sw, cy: (r + bh / 2) * shh };
        }
      }
      return null;
    }

    occupy(block) {
      const { cols, occ } = this.sheet;
      for (let i = 0; i < block.bw; i++) for (let j = 0; j < block.bh; j++) occ[(block.r + j) * cols + block.c + i] = true;
    }

    // ---- Layers -------------------------------------------------------------------
    buildBgLayer() {
      const { W, H, L, dpr } = this;
      if (!L) return;
      const c = this.bgLayer;
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const P = palette();

      roundRect(g, 0.5, 0.5, W - 1, H - 1, 8);
      g.fillStyle = P.frame;
      g.fill();
      g.strokeStyle = P.frameEdge;
      g.lineWidth = 1;
      g.stroke();

      // Gantry rails with rack teeth
      [[2, L.r - 3], [H - L.r + 1, L.r - 3]].forEach(([y, h]) => {
        g.fillStyle = P.rail;
        g.fillRect(5, y, W - 10, h);
        g.fillStyle = P.railTick;
        for (let x = 7; x < W - 7; x += 4) g.fillRect(x, y + h * 0.3, 1, h * 0.4);
      });
      g.globalAlpha = 0.55;
      g.fillStyle = P.accent;
      g.fillRect(L.bx, L.by - 1.5, L.bw, 1);
      g.fillRect(L.bx, L.by + L.bh + 0.5, L.bw, 1);
      g.globalAlpha = 1;

      // Bed with slats (only visible through cut-outs and when the sheet is swapped)
      g.fillStyle = P.bed;
      g.fillRect(L.bx, L.by, L.bw, L.bh);
      const slatW = Math.max(1, 4 * L.k);
      for (let x = 25; x < SHEET_W; x += 50) {
        const px = L.sx + x * L.k;
        g.fillStyle = P.slat;
        g.fillRect(px - slatW / 2, L.by, slatW, L.bh);
        g.fillStyle = P.slatHi;
        g.fillRect(px - slatW / 2, L.by, Math.max(0.5, slatW * 0.35), L.bh);
      }
    }

    buildSheetLayer() {
      const { L, dpr } = this;
      if (!L || !this.sheet) return;
      const c = this.sheetLayer;
      c.width = Math.max(1, Math.round(L.sw * dpr));
      c.height = Math.max(1, Math.round(L.sh * dpr));
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { sw, sh } = L;

      const grad = g.createLinearGradient(0, 0, sw, sh);
      grad.addColorStop(0, '#646f7c');
      grad.addColorStop(0.5, '#56606c');
      grad.addColorStop(1, '#5e6976');
      g.fillStyle = grad;
      g.fillRect(0, 0, sw, sh);

      // Mill-scale streaks and blotches, seeded per sheet
      const rnd = seededRandom(this.sheet.seed);
      for (let i = 0; i < 46; i++) {
        g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.015 + rnd() * 0.035})` : `rgba(10,15,25,${0.03 + rnd() * 0.05})`;
        g.fillRect(0, rnd() * sh, sw, 0.5 + rnd() * 2.5);
      }
      for (let i = 0; i < 10; i++) {
        g.fillStyle = `rgba(20,25,35,${0.025 + rnd() * 0.035})`;
        g.beginPath();
        g.ellipse(rnd() * sw, rnd() * sh, 10 + rnd() * sw * 0.15, 4 + rnd() * sh * 0.06, rnd() * 0.4, 0, TAU);
        g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,0.2)';
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, sw - 1, sh - 1);

      this.sheet.committed.forEach((item) => this.drawCommitted(g, item));
    }

    sheetPath(pts, closed) {
      const k = this.L.k;
      const p = new Path2D();
      pts.forEach(([x, y], i) => {
        const px = x * k;
        const py = (SHEET_H - y) * k;
        if (i) p.lineTo(px, py);
        else p.moveTo(px, py);
      });
      if (closed) p.closePath();
      return p;
    }

    drawCommitted(g, item) {
      if (item.kind === 'hole') {
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000'; // must be opaque: destination-out erases by the fill's alpha
        g.fill(this.sheetPath(item.pts, true));
        g.restore();
        return;
      }
      const path = this.sheetPath(item.pts, false);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(70,45,30,0.28)'; // faint heat tint beside the kerf
      g.lineWidth = this.L.kw * 3;
      g.stroke(path);
      g.strokeStyle = KERF_GREY;
      g.lineWidth = this.L.kw;
      g.stroke(path);
    }

    commit(item) {
      this.sheet.committed.push(item);
      const g = this.sheetLayer.getContext('2d');
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawCommitted(g, item);
    }

    // Capture the piece's pixels before punching it out, so it can visibly fall away
    dropPiece(poly) {
      const s = this.L.k * this.dpr;
      const px = poly.map(([x, y]) => [x * s, (SHEET_H - y) * s]);
      const b = bounds(px);
      const x0 = Math.floor(b.minX) - 2;
      const y0 = Math.floor(b.minY) - 2;
      const w = Math.ceil(b.w) + 4;
      const h = Math.ceil(b.h) + 4;
      if (w > 2 && h > 2) {
        const spr = document.createElement('canvas');
        spr.width = w;
        spr.height = h;
        const g = spr.getContext('2d');
        const clip = new Path2D();
        px.forEach(([x, y], i) => (i ? clip.lineTo(x - x0, y - y0) : clip.moveTo(x - x0, y - y0)));
        clip.closePath();
        g.clip(clip);
        g.drawImage(this.sheetLayer, -x0, -y0);
        this.drops.push({ spr, x0, y0, w, h, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, t: 0, rot: rand(-0.3, 0.3) });
      }
      this.commit({ kind: 'hole', pts: poly });
    }

    // ---- Job planning -----------------------------------------------------------
    planNext() {
      if (this.pendingCustom) {
        const pts = this.pendingCustom;
        this.pendingCustom = null;
        this.mode = 'custom';
        this.planJob(pts);
      } else if (this.mode === 'idle') {
        this.planJob(null);
      }
    }

    planJob(customPts) {
      const custom = !!customPts;
      const block = this.findBlock(custom ? CUSTOM_BLOCKS : [[1, 1]]);
      if (!block) {
        // Sheet is full: return home, swap in a fresh sheet, then plan again
        if (Math.hypot(this.torch.x, this.torch.y) > 0.5) this.queue.push({ type: 'rapid', x: 0, y: 0 });
        this.queue.push({ type: 'sheet' });
        this.queue.push({ type: 'call', fn: () => this.planJob(customPts) });
        return;
      }
      this.occupy(block);
      const shape = custom ? fitCustomShape(customPts, block) : randomShape(block);
      const material = pickMaterial();
      this.queue.push({ type: 'call', fn: () => {
        this.setField('file', shape.name);
        this.setField('material', material.label);
        this.voltage.base = clamp(124 + material.thickness * 0.6, 125, 136);
        if (custom) this.emit('custom-start');
      } });
      planContours(shape, [this.torch.x, this.torch.y]).forEach((c) => {
        this.queue.push({ type: 'rapid', x: c.pierce[0], y: c.pierce[1] });
        this.queue.push({ type: 'pierce' });
        this.queue.push({ type: 'cut', path: c.path, cum: pathLengths(c.path), poly: c.poly });
      });
      this.queue.push({ type: 'rapid', x: 0, y: 0 });
      this.queue.push({ type: 'park', dur: rand(2, 3) });
      if (custom) this.queue.push({ type: 'call', fn: () => {
        this.mode = 'custom-parked';
        this.emit('custom-done');
      } });
    }

    emit(state) {
      this.canvas.dispatchEvent(new CustomEvent('cnc:state', { detail: { state } }));
    }

    // Stop whatever the machine is doing (keeps any partial kerf on the sheet)
    abort() {
      const a = this.action;
      if (a && a.type === 'cut' && a.kerf && !a.kerf.committed) {
        a.kerf.committed = true;
        this.commit({ kind: 'kerf', pts: a.kerf.pts.map((p) => [p.x, p.y]) });
      }
      this.action = null;
      this.queue = [];
      this.torchOn = false;
      this.pierce = null;
    }

    // ---- Public API (cnc-draw.js) -------------------------------------------------
    cutCustom(points) {
      if (!points || points.length < 3) return;
      if (this.reduced) {
        this.mode = 'custom-parked';
        let block = this.findBlock(CUSTOM_BLOCKS);
        if (!block) {
          this.newSheet();
          block = this.findBlock([[2, 2]]);
        }
        this.occupy(block);
        const shape = fitCustomShape(points, block);
        planContours(shape, [0, 0]).forEach((c) => {
          this.sheet.committed.push({ kind: 'hole', pts: c.poly }, { kind: 'kerf', pts: c.path });
        });
        this.setField('file', shape.name);
        this.setField('material', pickMaterial().label);
        this.buildSheetLayer();
        this.render();
        this.emit('custom-start');
        this.emit('custom-done');
        return;
      }
      this.pendingCustom = points;
      // A sheet swap can't be interrupted; the custom job starts right after it
      if (!this.action || this.action.type !== 'sheet') this.abort();
      else this.queue = [];
      this.wake();
    }

    reset() {
      this.pendingCustom = null;
      this.mode = 'idle';
      if (this.reduced) {
        this.newSheet();
        this.fillStaticSheet();
        this.buildSheetLayer();
        this.updateTerminal(true);
        this.render();
        return;
      }
      if (this.action && this.action.type === 'sheet') {
        this.queue = [];
      } else {
        this.abort();
        this.queue.push({ type: 'rapid', x: 0, y: 0 }, { type: 'sheet' });
      }
      this.wake();
    }

    // ---- Reduced motion: a static, finished sheet ------------------------------------
    fillStaticSheet() {
      const { cols, rows } = this.sheet;
      const total = cols * rows;
      const count = Math.max(2, Math.round(total * 0.75));
      let last = null;
      for (let i = 0; i < count; i++) {
        const block = this.findBlock([[1, 1]]);
        if (!block) break;
        this.occupy(block);
        last = randomShape(block);
        planContours(last, [0, 0]).forEach((c) => {
          this.sheet.committed.push({ kind: 'hole', pts: c.poly }, { kind: 'kerf', pts: c.path });
        });
      }
      if (last) {
        this.setField('file', last.name);
        this.setField('material', pickMaterial().label);
      }
    }

    goStatic() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.abort();
      this.pendingCustom = null;
      this.mode = 'idle';
      this.kerfs = [];
      this.drops = [];
      this.sparks = [];
      this.torch = { x: 0, y: 0 };
      this.revealT = 1;
      this.newSheet();
      this.fillStaticSheet();
      this.buildSheetLayer();
      this.stage = STAGE.park;
      this.feed = 0;
      this.updateTerminal(true);
      this.render();
    }

    // ---- Animation loop -----------------------------------------------------------------
    shouldRun() {
      return !this.reduced && this.inView && this.pageVisible && this.revealStarted;
    }

    wake() {
      if (this.shouldRun() && !this.raf) {
        this.lastTs = null;
        this.raf = requestAnimationFrame(this.frame);
      }
    }

    // Nothing moving and nothing left to animate (e.g. parked after a custom cut)
    isQuiet() {
      if (this.action || this.queue.length || this.pendingCustom || this.mode === 'idle') return false;
      if (this.revealT < 1 || this.drops.length || this.sparks.length) return false;
      return !this.kerfs.some((kf) => this.clock - kf.pts[kf.pts.length - 1].t < KERF_COOL);
    }

    frame(ts) {
      this.raf = null;
      if (!this.shouldRun()) return;
      const dt = this.lastTs === null ? 1 / 60 : Math.min(0.05, (ts - this.lastTs) / 1000);
      this.lastTs = ts;
      this.update(dt);
      this.render();
      if (!this.isQuiet()) this.raf = requestAnimationFrame(this.frame);
    }

    update(dt) {
      this.clock += dt;
      if (this.revealT < 1) {
        this.revealT = Math.min(1, this.revealT + dt / REVEAL_TIME);
      } else {
        if (!this.action) {
          if (!this.queue.length) this.planNext();
          // Run instant 'call' steps straight away so they don't cost a frame each
          while (this.queue.length) {
            const next = this.queue.shift();
            if (next.type === 'call') { next.fn(); continue; }
            this.action = next;
            break;
          }
          if (!this.action && !this.queue.length && this.mode === 'idle') this.planNext();
        }
        if (this.action && this.step(this.action, dt)) this.action = null;
      }

      this.updateEffects(dt);
      this.updateTerminal(false, dt);
    }

    step(a, dt) {
      const ts = this.mode === 'custom' ? this.customScale : this.timeScale;
      const torch = this.torch;
      const first = a.t === undefined;
      if (first) a.t = 0;
      a.t += dt;

      switch (a.type) {
        case 'rapid': {
          if (first) {
            a.fx = torch.x;
            a.fy = torch.y;
            const d = Math.hypot(a.x - a.fx, a.y - a.fy);
            a.dur = d < 0.5 ? 0 : Math.max(0.25, d / (RAPID_SPEED * ts) + 0.2);
            this.torchOn = false;
            this.stage = STAGE.rapid;
            this.feed = RAPID_FEED;
          }
          const p = a.dur ? Math.min(1, a.t / a.dur) : 1;
          const e = easeInOut(p);
          torch.x = a.fx + (a.x - a.fx) * e;
          torch.y = a.fy + (a.y - a.fy) * e;
          return p >= 1;
        }
        case 'pierce': {
          if (first) {
            a.dur = clamp(1 / ts, 0.35, 0.7);
            this.torchOn = true;
            this.stage = STAGE.pierce;
            this.feed = CUT_FEED;
            this.burst(28);
          }
          a.p = Math.min(1, a.t / a.dur);
          this.pierce = a;
          if (a.p >= 1) {
            this.pierce = null;
            return true;
          }
          return false;
        }
        case 'cut': {
          if (first) {
            a.s = 0;
            a.i = 0;
            a.kerf = { pts: [{ x: a.path[0][0], y: a.path[0][1], t: this.clock }], committed: false };
            this.kerfs.push(a.kerf);
            this.torchOn = true;
            this.stage = STAGE.cut;
            this.feed = CUT_FEED;
          }
          const { path, cum } = a;
          const total = cum[cum.length - 1];
          a.s = Math.min(total, a.s + CUT_SPEED * ts * dt);
          while (a.i < path.length - 2 && cum[a.i + 1] <= a.s) {
            a.i++;
            a.kerf.pts.push({ x: path[a.i][0], y: path[a.i][1], t: this.clock });
          }
          const segLen = cum[a.i + 1] - cum[a.i] || 1;
          const f = clamp((a.s - cum[a.i]) / segLen, 0, 1);
          const p0 = path[a.i];
          const p1 = path[a.i + 1];
          torch.x = p0[0] + (p1[0] - p0[0]) * f;
          torch.y = p0[1] + (p1[1] - p0[1]) * f;
          a.kerf.pts.push({ x: torch.x, y: torch.y, t: this.clock });
          this.emitCutSparks(dt, p1[0] - p0[0], p1[1] - p0[1]);

          if (a.s >= total) {
            this.torchOn = false;
            this.dropPiece(a.poly);
            a.kerf.committed = true;
            this.commit({ kind: 'kerf', pts: a.kerf.pts.map((p) => [p.x, p.y]) });
            return true;
          }
          return false;
        }
        case 'park': {
          if (first) {
            this.torchOn = false;
            this.stage = STAGE.park;
            this.feed = 0;
          }
          return a.t >= a.dur;
        }
        case 'sheet': {
          if (first) {
            this.torchOn = false;
            this.stage = STAGE.sheet;
            this.feed = 0;
          }
          if (!a.swapped && a.t >= SHEET_SWAP_TIME * 0.5) {
            a.swapped = true;
            this.kerfs = [];
            this.drops = [];
            this.newSheet();
            this.buildSheetLayer();
          }
          return a.t >= SHEET_SWAP_TIME;
        }
        default:
          return true;
      }
    }

    // ---- Sparks & effects ---------------------------------------------------------------
    torchPx() {
      const L = this.L;
      return [L.sx + this.torch.x * L.k, L.sy + (SHEET_H - this.torch.y) * L.k];
    }

    addSpark(x, y, ang, speed, life) {
      if (this.sparks.length > 160) return;
      this.sparks.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life, max: life });
    }

    burst(n) {
      const [x, y] = this.torchPx();
      const sc = clamp(this.W / 400, 0.6, 1.3);
      for (let i = 0; i < n * sc; i++) this.addSpark(x, y, rand(0, TAU), rand(30, 150) * sc, rand(0.2, 0.5));
    }

    emitCutSparks(dt, dx, dy) {
      const sc = clamp(this.W / 400, 0.6, 1.3);
      this.sparkDebt += dt * 110 * sc;
      const [x, y] = this.torchPx();
      // Screen-space travel direction (sheet y is flipped); sparks trail behind the torch
      const back = Math.atan2(dy, -dx);
      while (this.sparkDebt >= 1) {
        this.sparkDebt -= 1;
        const ang = Math.random() < 0.75 ? back + rand(-0.9, 0.9) : rand(0, TAU);
        this.addSpark(x, y, ang, rand(25, 130) * sc, rand(0.15, 0.45));
      }
    }

    updateEffects(dt) {
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const p = this.sparks[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.sparks.splice(i, 1);
          continue;
        }
        const drag = Math.max(0, 1 - 3.2 * dt);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let i = this.drops.length - 1; i >= 0; i--) {
        this.drops[i].t += dt;
        if (this.drops[i].t >= DROP_TIME) this.drops.splice(i, 1);
      }
    }

    // ---- Terminal readout ---------------------------------------------------------------
    // Live values wrap differently as they change; reserve each readout row's tallest
    // possible height so the panel (and the hero beside it) never jumps while cutting.
    reserveFieldSpace() {
      const candidates = {
        file: ['Plate_888x888_4H.dxf', 'Flange_8H_888mm.dxf', 'Gusset_888x888.dxf', 'Bracket_L90.dxf', 'Custom_Part.dxf', 'Gear_88T.dxf'],
        material: [].concat(...MATERIALS.map((m) => m.t.map((t) => `${m.name} (${t.toFixed(1)}mm)`))),
        stage: Object.keys(STAGE_CLASSES),
      };
      Object.keys(candidates).forEach((name) => {
        const el = this.fields[name];
        const row = el && el.parentElement;
        if (!row) return;
        const current = el.textContent;
        row.style.minHeight = '';
        let max = 0;
        candidates[name].concat(current).forEach((text) => {
          el.textContent = text;
          max = Math.max(max, row.offsetHeight);
        });
        el.textContent = current;
        row.style.minHeight = `${max}px`;
      });
    }

    setField(name, text) {
      const el = this.fields[name];
      if (!el || this.fieldCache[name] === text) return;
      this.fieldCache[name] = text;
      el.textContent = text;
    }

    updateTerminal(force, dt = 0) {
      const v = this.voltage;
      v.next -= dt;
      if (force || v.next <= 0) {
        v.next = 0.12;
        if (!this.torchOn) {
          v.value = 0;
        } else if (this.pierce) {
          // Arc voltage is higher at pierce height and settles as the torch drops to cut height
          v.value = v.base + 16 * (1 - this.pierce.p) + rand(-1.5, 1.5);
        } else {
          v.value = v.value ? v.value + (v.base - v.value) * 0.3 + rand(-1.6, 1.6) : v.base;
        }
        this.setField('voltage', `${Math.round(v.value)}V`);
      }

      this.setField('feed', `${this.feed} mm/min`);

      const stageEl = this.fields.stage;
      if (stageEl && this.fieldCache.stage !== this.stage) {
        stageEl.classList.remove('text-emerald-400', ...Object.values(STAGE_CLASSES));
        stageEl.classList.add(STAGE_CLASSES[this.stage]);
      }
      this.setField('stage', this.stage);

      const statusEl = this.fields.status;
      const statusText = this.torchOn ? 'PLASMA ACTIVE' : 'PLASMA OFF';
      if (statusEl && this.fieldCache.status !== statusText) {
        statusEl.classList.remove(...(this.torchOn ? STATUS_OFF : STATUS_ON));
        statusEl.classList.add(...(this.torchOn ? STATUS_ON : STATUS_OFF));
      }
      this.setField('status', statusText);
    }

    // ---- Rendering ----------------------------------------------------------------------
    sheetShift() {
      const a = this.action;
      if (!a || a.type !== 'sheet' || a.t === undefined) return 0;
      const p = a.t / SHEET_SWAP_TIME;
      const travel = this.L.bh + 6;
      if (p < 0.42) return easeInCubic(p / 0.42) * travel;       // old sheet out the bottom
      if (p < 0.55) return travel;                              // bed empty for a beat
      return -(1 - easeOutCubic((p - 0.55) / 0.45)) * travel;   // new sheet in from the top
    }

    render() {
      const { ctx, W, H, L, dpr } = this;
      if (!L) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const e = easeOutCubic(this.revealT);
      if (e <= 0) return;

      ctx.save();
      if (e < 1) {
        // Table "opens" from the top while the sheet slides into place
        ctx.beginPath();
        ctx.rect(0, 0, W, H * e);
        ctx.clip();
      }
      ctx.drawImage(this.bgLayer, 0, 0, W, H);

      const shift = this.sheetShift() - (1 - e) * L.sh * 0.6;
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.bx, L.by, L.bw, L.bh);
      ctx.clip();
      ctx.translate(L.sx, L.sy + shift);
      ctx.drawImage(this.sheetLayer, 0, 0, L.sw, L.sh);
      this.renderDrops(ctx);
      this.renderKerfs(ctx);
      ctx.restore();

      this.renderOrigin(ctx);
      const gantryAlpha = clamp((e - 0.55) / 0.45, 0, 1);
      if (gantryAlpha > 0) {
        ctx.globalAlpha = gantryAlpha;
        this.renderGantry(ctx);
        ctx.globalAlpha = 1;
      }
      this.renderSparks(ctx);
      ctx.restore();
    }

    renderDrops(ctx) {
      const dpr = this.dpr;
      this.drops.forEach((d) => {
        const p = d.t / DROP_TIME;
        const fall = easeInCubic(p);
        ctx.save();
        ctx.globalAlpha = 1 - p * p;
        ctx.translate(d.cx / dpr, d.cy / dpr + fall * 3);
        ctx.rotate(d.rot * fall);
        ctx.scale(1 - 0.25 * fall, 1 - 0.25 * fall);
        ctx.drawImage(d.spr, (d.x0 - d.cx) / dpr, (d.y0 - d.cy) / dpr, d.w / dpr, d.h / dpr);
        ctx.restore();
      });
    }

    renderKerfs(ctx) {
      const { k, kw } = this.L;
      const now = this.clock;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const bucketOf = (pt) => Math.min(HEAT_STEPS, Math.floor(((now - pt.t) / KERF_COOL) * HEAT_STEPS));
      const strokeRun = (pts, from, to, b, committed) => {
        if (b === HEAT_STEPS && committed) return; // already baked into the sheet layer
        ctx.beginPath();
        for (let i = from; i <= to; i++) {
          const x = pts[i].x * k;
          const y = (SHEET_H - pts[i].y) * k;
          if (i === from) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        if (b < 4) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = `rgba(255,140,40,${0.32 * (1 - b / 4)})`;
          ctx.lineWidth = kw * 4;
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.strokeStyle = HEAT_COLORS[b];
        ctx.lineWidth = kw * (b < 3 ? 1.3 : 1);
        ctx.stroke();
      };

      for (let n = this.kerfs.length - 1; n >= 0; n--) {
        const kf = this.kerfs[n];
        const pts = kf.pts;
        if (kf.committed && now - pts[pts.length - 1].t > KERF_COOL) {
          this.kerfs.splice(n, 1);
          continue;
        }
        if (pts.length < 2) continue;
        let from = 0;
        let cur = bucketOf(pts[1]);
        for (let j = 2; j < pts.length; j++) {
          const b = bucketOf(pts[j]);
          if (b !== cur) {
            strokeRun(pts, from, j - 1, cur, kf.committed);
            from = j - 1;
            cur = b;
          }
        }
        strokeRun(pts, from, pts.length - 1, cur, kf.committed);
      }
    }

    renderOrigin(ctx) {
      const L = this.L;
      const P = palette();
      const x = L.sx;
      const y = L.sy + L.sh;
      const len = clamp(this.W * 0.03, 7, 14);
      ctx.strokeStyle = P.accent;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - len);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    renderGantry(ctx) {
      const { L, H, W } = this;
      const P = palette();
      const [tx, ty] = this.torchPx();
      const gw = L.gw;
      const bx = tx + gw * 0.95; // torch hangs off the side of the gantry beam

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(bx - gw / 2 + 2, L.r, gw, H - 2 * L.r);
      ctx.fillStyle = P.gantry;
      ctx.fillRect(bx - gw / 2, 2, gw, H - 4);
      ctx.strokeStyle = P.gantryEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - gw / 2 + 0.5, 2.5, gw - 1, H - 5);
      ctx.fillStyle = P.accent;
      ctx.globalAlpha *= 0.8;
      ctx.fillRect(bx - 0.6, L.r + 2, 1.2, H - 2 * L.r - 4);
      ctx.globalAlpha /= 0.8;

      // End trucks riding the rails
      ctx.fillStyle = P.carriage;
      roundRect(ctx, bx - gw, 1, gw * 2, L.r - 1, 2);
      ctx.fill();
      roundRect(ctx, bx - gw, H - L.r, gw * 2, L.r - 1, 2);
      ctx.fill();

      // Y carriage and torch
      const ch = gw * 1.5;
      const cx0 = tx - gw * 0.7;
      roundRect(ctx, cx0, ty - ch / 2, bx + gw / 2 - cx0, ch, 2);
      ctx.fillStyle = P.carriage;
      ctx.fill();
      ctx.strokeStyle = P.gantryEdge;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(tx, ty, gw * 0.42, 0, TAU);
      ctx.fillStyle = '#0b1015';
      ctx.fill();
      ctx.strokeStyle = this.torchOn ? P.accent : '#64748b';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, gw * 0.15, 0, TAU);
      ctx.fillStyle = this.torchOn ? '#fff4d6' : '#475569';
      ctx.fill();

      // Arc glow / pierce flash
      ctx.globalCompositeOperation = 'lighter';
      if (this.pierce) {
        const p = this.pierce.p;
        const amp = (p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8 * 0.6) * rand(0.85, 1.1);
        const r = clamp(W * 0.08, 18, 38) * amp;
        ctx.drawImage(this.flashGlow, tx - r, ty - r, r * 2, r * 2);
      }
      if (this.torchOn) {
        const r = clamp(W * 0.032, 8, 16) * rand(0.85, 1.15);
        ctx.drawImage(this.torchGlow, tx - r, ty - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';

      // Small DRO on the top rail when there's room
      if (W >= 300 && L.r >= 10) {
        ctx.font = `600 ${Math.round(L.r * 0.55)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = P.text;
        ctx.fillText(`X ${this.torch.x.toFixed(1)}  Y ${this.torch.y.toFixed(1)}`, W - L.m - 4, L.r / 2 + 0.5);
      }
    }

    renderSparks(ctx) {
      if (!this.sparks.length) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      const groups = [['#fff6c8', 0.6], ['#ffb23f', 0.3], ['#ff5a14', 0]];
      groups.forEach(([color, min], gi) => {
        ctx.beginPath();
        this.sparks.forEach((p) => {
          const f = p.life / p.max;
          if (f <= min || (gi > 0 && f > groups[gi - 1][1])) return;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        });
        ctx.strokeStyle = color;
        ctx.stroke();
      });
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  window.ArcForgeCNC = {
    create: (canvas, opts = {}) => new PlasmaTable(canvas, opts),
  };
})();
