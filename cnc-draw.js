/**
 * ArcForge Designs - "Cut Your Own Part" drawing pad
 * Loaded only on cut-your-own.html (after cnc-sim.js). Visitors sketch one outline with
 * mouse, pen or finger; the stroke is smoothed, snapped closed when it ends near its start,
 * and handed to the virtual plasma table to cut. No dependencies.
 */

document.addEventListener('DOMContentLoaded', () => {
  initCncDraw();
});

function initCncDraw() {
  const pad = document.getElementById('draw-pad');
  const machineCanvas = document.querySelector('canvas[data-cnc-sim]');
  const cutBtn = document.getElementById('draw-cut-btn');
  const resetBtn = document.getElementById('draw-reset-btn');
  const sampleBtn = document.getElementById('draw-sample-btn');
  const hint = document.getElementById('draw-hint');

  if (!pad || !machineCanvas || !machineCanvas.cncMachine) return;

  const machine = machineCanvas.cncMachine;
  const ctx = pad.getContext('2d');

  const HINTS = {
    start: 'Draw one continuous outline. Finish near your start point to close it.',
    drawing: 'Keep going, and come back to your start point to close the shape.',
    release: 'Release to snap the shape closed.',
    closed: 'Shape closed. Press "Cut Part" to send it to the machine.',
    open: 'Shape isn\'t closed. "Cut Part" will join the ends with a straight line.',
    small: 'That\'s a bit small. Draw a larger shape.',
    thin: 'That shape is too thin to cut out. Try a fuller outline.',
    cutting: 'Cutting your part. Watch the table!',
    done: 'Done! Your part has dropped out of the sheet. Draw another, or press Reset.',
  };

  let W = 0;
  let H = 0;
  let dpr = 1;
  let raw = [];        // points while drawing, normalised to 0..1 of the pad
  let shape = null;    // { pts: smoothed normalised points, closed }
  let drawing = false;
  let nearStart = false;
  let travelled = 0;   // px drawn in the current stroke
  let busy = false;    // machine is cutting the visitor's part
  let renderQueued = false;

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const toPx = (p) => [p[0] * W, p[1] * H];
  const snapRadius = () => Math.max(22, Math.min(W, H) * 0.08);

  function setHint(key) {
    if (hint) hint.textContent = HINTS[key];
  }

  function syncButtons() {
    if (cutBtn) cutBtn.disabled = !shape || busy;
  }

  function eventPoint(e) {
    const r = pad.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  }

  // ---- Path processing ------------------------------------------------------------
  // Evenly spaced points along the stroke (removes jitter from uneven pointer sampling)
  function resample(pts, step, closed) {
    const src = closed ? pts.concat([pts[0]]) : pts;
    const out = [src[0]];
    let carry = 0;
    for (let i = 1; i < src.length; i++) {
      const a = src[i - 1];
      const b = src[i];
      const seg = dist(a, b);
      let d = step - carry;
      while (d <= seg) {
        const t = d / seg;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        d += step;
      }
      carry = seg - (d - step);
    }
    if (closed) {
      if (out.length > 2 && dist(out[out.length - 1], out[0]) < step * 0.5) out.pop();
    } else {
      out.push(src[src.length - 1]);
    }
    return out;
  }

  // Repeated [1 2 1] averaging; closed shapes wrap around, open ones keep their ends
  function smooth(pts, closed, passes) {
    let cur = pts;
    const n = pts.length;
    for (let pass = 0; pass < passes; pass++) {
      cur = cur.map((p, i) => {
        if (!closed && (i === 0 || i === n - 1)) return p;
        const a = cur[(i - 1 + n) % n];
        const b = cur[(i + 1) % n];
        return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
      });
    }
    return cur;
  }

  function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a / 2);
  }

  function finishStroke() {
    const px = raw.map(toPx);
    const xs = px.map((p) => p[0]);
    const ys = px.map((p) => p[1]);
    const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

    shape = null;
    if (px.length < 6 || diag < Math.min(W, H) * 0.15) {
      setHint('small');
      return;
    }

    const snap = snapRadius();
    const closed = travelled > snap * 3 && dist(px[px.length - 1], px[0]) < snap;
    let pts = px.slice();
    if (closed) {
      // Trim the tail that overlaps the start so the join is clean
      while (pts.length > 6 && dist(pts[pts.length - 1], pts[0]) < snap * 0.5) pts.pop();
    }
    pts = smooth(resample(pts, diag / 110, closed), closed, 4);

    if (polyArea(pts) < diag * diag * 0.02) {
      setHint('thin');
      return;
    }
    shape = { pts: pts.map(([x, y]) => [x / W, y / H]), closed };
    setHint(closed ? 'closed' : 'open');
  }

  // ---- Rendering -------------------------------------------------------------------
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    if (!W || !H) return;
    const light = document.documentElement.classList.contains('light');
    const accent = light ? '2,132,199' : '0,229,255';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // CAD-style grid
    const cell = 20;
    ctx.lineWidth = 1;
    for (let i = 0, x = 0; x <= W; i++, x += cell) {
      ctx.strokeStyle = i % 5 ? (light ? 'rgba(15,23,42,0.05)' : 'rgba(148,163,184,0.07)') : `rgba(${accent},${light ? 0.16 : 0.13})`;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
      ctx.stroke();
    }
    for (let i = 0, y = 0; y <= H; i++, y += cell) {
      ctx.strokeStyle = i % 5 ? (light ? 'rgba(15,23,42,0.05)' : 'rgba(148,163,184,0.07)') : `rgba(${accent},${light ? 0.16 : 0.13})`;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
      ctx.stroke();
    }

    const pts = (shape ? shape.pts : raw).map(toPx);
    if (!pts.length) {
      ctx.fillStyle = light ? 'rgba(71,85,105,0.7)' : 'rgba(148,163,184,0.6)';
      ctx.font = '600 14px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Draw your part here', W / 2, H / 2);
      return;
    }

    const outline = new Path2D();
    pts.forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
    if (shape && shape.closed) outline.closePath();

    if (shape && shape.closed) {
      ctx.fillStyle = `rgba(${accent},0.1)`;
      ctx.fill(outline);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${accent},0.25)`;
    ctx.lineWidth = 7;
    ctx.stroke(outline);
    ctx.strokeStyle = `rgb(${accent})`;
    ctx.lineWidth = 2.25;
    ctx.stroke(outline);

    // Open shape: show the straight closing line that Cut will add
    if (shape && !shape.closed) {
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = light ? '#d97706' : '#f59e0b';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.lineTo(pts[0][0], pts[0][1]);
      ctx.stroke();
      ctx.restore();
    }

    // Start point, plus the snap target while the pen is near it
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${accent})`;
    ctx.fill();
    if (drawing && nearStart) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = light ? '#059669' : '#34d399';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], snapRadius(), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function resize() {
    const w = Math.round(pad.clientWidth);
    const h = Math.round(pad.clientHeight);
    const d = Math.min(window.devicePixelRatio || 1, 3);
    if (!w || !h || (w === W && h === H && d === dpr)) return;
    W = w;
    H = h;
    dpr = d;
    pad.width = Math.round(W * dpr);
    pad.height = Math.round(H * dpr);
    render();
  }

  // ---- Pointer input (mouse, pen and touch) ---------------------------------------------
  pad.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    try {
      pad.setPointerCapture(e.pointerId);
    } catch (err) {
      // Capture is a nicety (keeps the stroke going outside the pad); drawing works without it
    }
    drawing = true;
    nearStart = false;
    travelled = 0;
    shape = null;
    raw = [eventPoint(e)];
    setHint('drawing');
    syncButtons();
    requestRender();
  });

  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    (events.length ? events : [e]).forEach((ev) => {
      const p = eventPoint(ev);
      const d = dist(toPx(p), toPx(raw[raw.length - 1]));
      if (d >= 1.5) {
        raw.push(p);
        travelled += d;
      }
    });
    const wasNear = nearStart;
    nearStart = travelled > snapRadius() * 3 && dist(toPx(raw[raw.length - 1]), toPx(raw[0])) < snapRadius();
    if (wasNear !== nearStart) setHint(nearStart ? 'release' : 'drawing');
    requestRender();
  });

  const endStroke = () => {
    if (!drawing) return;
    drawing = false;
    finishStroke();
    syncButtons();
    requestRender();
  };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);

  // ---- Buttons ------------------------------------------------------------------------
  if (cutBtn) {
    cutBtn.addEventListener('click', () => {
      if (!shape || busy) return;
      busy = true;
      syncButtons();
      setHint('cutting');
      // The pad's y axis points down; the machine's points up
      machine.cutCustom(shape.pts.map(([x, y]) => [x * W, -y * H]));

      // On stacked (mobile) layouts, bring the machine into view
      const r = machineCanvas.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        machineCanvas.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      raw = [];
      shape = null;
      drawing = false;
      busy = false;
      machine.reset();
      setHint('start');
      syncButtons();
      requestRender();
    });
  }

  // Keyboard-friendly alternative to drawing: a ready-made heart outline
  if (sampleBtn) {
    sampleBtn.addEventListener('click', () => {
      const pts = [];
      for (let i = 0; i < 120; i++) {
        const t = (i / 120) * Math.PI * 2;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([0.5 + (x / 17) * 0.3 * (H / W), 0.47 - (y / 17) * 0.3]);
      }
      raw = [];
      drawing = false;
      shape = { pts, closed: true };
      setHint('closed');
      syncButtons();
      requestRender();
    });
  }

  machineCanvas.addEventListener('cnc:state', (e) => {
    if (e.detail && e.detail.state === 'custom-done') {
      busy = false;
      setHint('done');
      syncButtons();
    }
  });

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(pad);
  window.addEventListener('resize', resize);
  new MutationObserver(requestRender).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  setHint('start');
  syncButtons();
  resize();
}
