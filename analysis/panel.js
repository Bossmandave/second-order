/* The bench screen.
 *
 * Drawn into a plain 2D canvas that the 3D scene uses as a texture. Keeping
 * the instrument as 2D canvas rather than building it from geometry is not a
 * shortcut: text, axes and one-pixel traces are exactly what canvas is good
 * at and exactly what a 3D scene is bad at, and a real bench screen IS a flat
 * panel, so there is nothing to gain by faking it in three dimensions.
 *
 * Same Trace and PhasePath as the flat page, so the decimation that keeps a
 * spike alive applies here too.
 */

const C = {
  bg: '#07090b', grid: 'rgba(255,255,255,.05)', axis: 'rgba(255,255,255,.14)',
  dim: '#5a636e', text: '#c9ced6', amber: '#e8a35c', cyan: '#5cc8e8',
  violet: '#a98cf0', red: '#e8605c',
};
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

/* The panel is authored at this size and scaled to whatever canvas it is
 * handed. Every position and font size below is a literal pixel value, which
 * is readable and perfectly fine - as long as something maps them onto the
 * real canvas. Without this, halving the texture to save memory would not
 * make the panel smaller, it would make the text 1.6x too big and push the
 * traces off the edge. */
const REF_W = 1024, REF_H = 668;

export function drawPanel(ctx, W, H, { title, traces, names, phase, meta, failure, t, armed, ghosts, ghostPhase }) {
  ctx.save();
  ctx.scale(W / REF_W, H / REF_H);
  W = REF_W; H = REF_H;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.font = `500 20px ${MONO}`;
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '3px';
  ctx.fillText(title.toUpperCase(), 26, 38);
  ctx.letterSpacing = '0px';

  ctx.textAlign = 'right';
  ctx.fillStyle = failure ? C.red : (armed ? C.amber : C.dim);
  ctx.fillText(failure ? 'FAILED' : armed ? 'RUNNING' : 'STANDBY', W - 26, 38);

  const padT = 58, gap = 14;
  const plotH = (H - padT - 230 - gap) / 2;
  trace(ctx, 26, padT, W - 52, plotH, traces[0], C.cyan, names[0], ghosts?.[0]);
  trace(ctx, 26, padT + plotH + gap, W - 52, plotH, traces[1], C.amber, names[1], ghosts?.[1]);

  const by = padT + 2 * plotH + gap * 2;
  phasePlot(ctx, 26, by, 236, 196, phase);
  readout(ctx, 290, by, W - 316, 196, { meta, failure, t });
  ctx.restore();
}

function trace(ctx, x, y, w, h, tr, colour, label, ghost) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.012)';
  ctx.fillRect(x, y, w, h);

  const [lo, hi] = tr.range();
  const padL = 86;
  const X = (i) => x + padL + (i / tr.n) * (w - padL - 10);
  const Y = (v) => y + 16 + (1 - (v - lo) / (hi - lo)) * (h - 38);

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.font = `14px ${MONO}`; ctx.fillStyle = C.dim; ctx.textAlign = 'right';
  for (let g = 0; g <= 3; g++) {
    const v = lo + ((hi - lo) * g) / 3, yy = Math.round(Y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x + padL, yy); ctx.lineTo(x + w - 10, yy); ctx.stroke();
    ctx.fillText(fmt(v), x + padL - 10, yy + 5);
  }
  if (lo < 0 && hi > 0) {
    ctx.strokeStyle = C.axis;
    const yy = Math.round(Y(0)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x + padL, yy); ctx.lineTo(x + w - 10, yy); ctx.stroke();
  }

  // the previous attempt, behind this one
  if (ghost) {
    ctx.strokeStyle = 'rgba(120,130,142,.42)'; ctx.lineWidth = 1.2;
    for (const which of ['max', 'min']) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < ghost.used; i++) {
        if (!Number.isFinite(ghost[which][i])) continue;
        const a = X(i), b = Y(ghost[which][i]);
        started ? ctx.lineTo(a, b) : (ctx.moveTo(a, b), started = true);
      }
      ctx.stroke();
    }
  }

  const top = [], bot = [];
  for (let i = 0; i < tr.used; i++) {
    if (!Number.isFinite(tr.min[i])) continue;
    top.push([X(i), Y(tr.max[i])]);
    bot.push([X(i), Y(tr.min[i])]);
  }
  if (top.length) {
    ctx.beginPath();
    top.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
    ctx.fillStyle = hexA(colour, 0.17); ctx.fill();
    ctx.strokeStyle = colour; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    for (const list of [top, bot]) {
      ctx.beginPath();
      list.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.stroke();
    }
  }

  ctx.textAlign = 'left'; ctx.fillStyle = C.dim; ctx.font = `13px ${MONO}`;
  ctx.fillText((label ?? '').toUpperCase(), x + padL, y + 12);
  ctx.textAlign = 'right';
  ctx.fillText(`0 → ${fmtTime(tr.window)}`, x + w - 10, y + h - 6);
  ctx.restore();
}

function phasePlot(ctx, x, y, w, h, phase) {
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.font = `13px ${MONO}`; ctx.fillStyle = C.dim; ctx.textAlign = 'left';
  ctx.fillText('PHASE', x + 10, y + 20);
  if (!phase || phase.pts.length < 2) return;

  const [x0, x1, y0, y1] = phase.bounds();
  const P = 24;
  const PX = (a) => x + P + ((a - x0) / (x1 - x0)) * (w - P * 2);
  const PY = (b) => y + h - P - ((b - y0) / (y1 - y0)) * (h - P * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.09)';
  ctx.beginPath();
  ctx.moveTo(x + P, PY(0)); ctx.lineTo(x + w - P, PY(0));
  ctx.moveTo(PX(0), y + P); ctx.lineTo(PX(0), y + h - P);
  ctx.stroke();

  ctx.strokeStyle = C.violet; ctx.lineWidth = 1.7;
  ctx.beginPath();
  phase.pts.forEach(([a, b], i) => (i ? ctx.lineTo(PX(a), PY(b)) : ctx.moveTo(PX(a), PY(b))));
  ctx.stroke();
  const [lx, ly] = phase.pts[phase.pts.length - 1];
  ctx.fillStyle = C.violet;
  ctx.beginPath(); ctx.arc(PX(lx), PY(ly), 3.4, 0, Math.PI * 2); ctx.fill();
}

function readout(ctx, x, y, w, h, { meta, failure, t }) {
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.font = `13px ${MONO}`; ctx.textAlign = 'left';
  ctx.fillStyle = failure ? C.red : C.dim;
  ctx.fillText(failure ? `FAILURE — ${failure.ref}` : 'ANALYSIS', x + 14, y + 20);

  const rows = [];
  if (failure) {
    rows.push(['part', failure.part]);
    rows.push(['cause', failure.cause]);
    rows.push([failure.cause, `${failure.value.toPrecision(3)} ${failure.unit}  /  ${failure.limit} ${failure.unit}`]);
    if (failure.overBy) rows.push(['of rating', `${(failure.overBy * 100).toFixed(0)}%`]);
    if (failure.peakT != null) rows.push(['peak temp', `${failure.peakT.toFixed(0)} °C / ${failure.tMax} °C`]);
    rows.push(['survived', `${failure.survived.toFixed(2)} s`]);
    rows.push(['failed', failure.mode]);
  } else {
    if (meta) {
      rows.push(['damping ζ', meta.zeta.toFixed(3)]);
      rows.push(['ωₙ', `${meta.omegaN.toFixed(1)} rad/s`]);
      rows.push(['fₙ', `${(meta.omegaN / (2 * Math.PI)).toFixed(1)} Hz`]);
      rows.push(['regime', meta.zeta < 0.999 ? 'underdamped' : meta.zeta > 1.001 ? 'overdamped' : 'critical']);
    }
    rows.push(['elapsed', `${t.toFixed(3)} s`]);
  }

  ctx.font = `15px ${MONO}`;
  rows.forEach(([k, v], i) => {
    const yy = y + 48 + i * 21;
    if (yy > y + h - 8) return;
    ctx.fillStyle = C.dim; ctx.textAlign = 'left';
    ctx.fillText(k, x + 14, yy);
    ctx.fillStyle = failure ? C.red : C.text; ctx.textAlign = 'right';
    ctx.fillText(String(v), x + w - 14, yy);
  });
}

const fmt = (v) => {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a < 1e-3) return v.toExponential(1);
  if (a < 1) return v.toFixed(3);
  if (a < 100) return v.toFixed(2);
  return v.toFixed(0);
};
const fmtTime = (s) =>
  s < 1e-3 ? `${(s * 1e6).toFixed(0)} μs` : s < 1 ? `${(s * 1e3).toFixed(0)} ms` : `${s.toFixed(1)} s`;
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
