import { Track } from './track.js';
import { TrackEditor } from './editor.js';
import { TrackRenderer } from './render.js';
import { Simulation } from './simulation.js';
import { networkShape } from './brain.js';

const canvas = document.getElementById('stage-canvas');
const track = new Track();
const renderer = new TrackRenderer(canvas);
const simulation = new Simulation(track);

const view = {
  showTrack: true,
  showWalls: true,
  showCenterline: true,
  showSensors: true,
};

let dirty = true;
const requestRedraw = () => { dirty = true; };
let mode = 'editor';
let lastT = performance.now();
let lastHudT = 0;
const timeScales = [1, 2, 4, 8];
let timeScaleIndex = 0;

const editor = new TrackEditor(canvas, track, {
  brushSize: 90,
  onChange: requestRedraw,
});

// --- HUD wiring ---

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  if (mode === 'simulate') {
    editor.enabled = false;
    simulation.start();
  } else {
    simulation.stop();
    editor.enabled = true;
  }
  requestRedraw();
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editor.setTool(btn.dataset.tool);
  });
});

const brushSlider = document.getElementById('brush-size');
const brushValue  = document.getElementById('brush-size-value');
brushSlider.addEventListener('input', () => {
  const v = parseInt(brushSlider.value, 10);
  brushValue.textContent = v;
  editor.setBrushSize(v);
});

const bind = (id, key) => {
  const el = document.getElementById(id);
  el.addEventListener('change', () => { view[key] = el.checked; requestRedraw(); });
};
bind('show-track', 'showTrack');
bind('show-walls', 'showWalls');
bind('show-centerline', 'showCenterline');
bind('show-sensors', 'showSensors');

document.getElementById('clear-track').addEventListener('click', () => {
  simulation.stop();
  track.clear();
  editor.resetCommit();
  setMode('editor');
  requestRedraw();
});

document.getElementById('start-pause').addEventListener('click', () => {
  if (mode !== 'simulate') {
    setMode('simulate');
  } else {
    simulation.toggle();
  }
  requestRedraw();
});
document.getElementById('fast-forward').addEventListener('click', () => {
  timeScaleIndex = (timeScaleIndex + 1) % timeScales.length;
  simulation.timeScale = timeScales[timeScaleIndex];
  updateFastForwardButton();
});
document.getElementById('next-generation').addEventListener('click', () => {
  if (!simulation.trackStroke && !simulation.start()) return;
  simulation.ga.nextGeneration(simulation.agents);
  simulation.spawnGeneration();
  simulation.running = true;
  simulation.status = 'RUNNING';
  setMode('simulate');
});
document.getElementById('reset-simulation').addEventListener('click', () => {
  if (!track.strokes.length) return;
  simulation.trackStroke = null;
  simulation.reset();
  setMode('simulate');
});

// --- render loop ---
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (simulation.running) {
    for (let i = 0; i < simulation.timeScale; i++) {
      simulation.update(dt);
    }
    dirty = true;
  }
  updateHud(t);
  if (dirty) {
    renderer.draw({ track, editor, view, simulation: mode === 'simulate' ? simulation : null });
    dirty = false;
  }
  requestAnimationFrame(frame);
}
window.addEventListener('resize', requestRedraw);
requestAnimationFrame(frame);
updateFastForwardButton();

function updateHud(t = performance.now()) {
  if (t - lastHudT < 120) return;
  lastHudT = t;
  const stats = simulation.getStats();
  text('generation-count', stats.generation);
  text('best-distance', Math.round(stats.bestDistance));
  text('sim-status', stats.status);
  text('active-cars', stats.active);
  text('total-cars', stats.total);
  text('generation-time', formatTime(stats.generationTime));
  text('time-scale', `${stats.timeScale.toFixed(1)}x`);
  const progress = document.getElementById('generation-progress');
  if (progress) progress.style.width = `${stats.progress.toFixed(1)}%`;
  updateLeaderboard();
  drawNetwork();
  drawHistory(stats);
}

function updateFastForwardButton() {
  const btn = document.getElementById('fast-forward');
  if (!btn) return;
  btn.classList.toggle('active', simulation.timeScale > 1);
  const label = btn.querySelector('span:last-child');
  if (label) label.textContent = `Fast forward ${simulation.timeScale}x`;
}

function updateLeaderboard() {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  const rows = simulation.agents
    .slice()
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, 5)
    .map((a, i) => `<li><span>${i + 1}. car ${a.id + 1}</span><strong>${Math.round(a.maxProgress)} m</strong></li>`)
    .join('');
  el.innerHTML = rows || '<li><span>No cars yet</span><strong>0 m</strong></li>';
}

function drawHistory(stats) {
  const c = document.getElementById('history-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(10, 13, 19, 0.9)';
  ctx.fillRect(0, 0, w, h);

  const history = stats.history ?? [];
  if (!history.length) {
    ctx.fillStyle = '#5d6776';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText('No completed generations yet', 42, h / 2);
    return;
  }

  const padL = 28;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const maxY = Math.max(1, stats.trackLength || 0, ...history.map(p => p.distance));
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padT + (plotH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#b8ef63';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = padL + (history.length === 1 ? plotW : (i / (history.length - 1)) * plotW);
    const y = padT + plotH - (p.distance / maxY) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#b8ef63';
  history.forEach((p, i) => {
    const x = padL + (history.length === 1 ? plotW : (i / (history.length - 1)) * plotW);
    const y = padT + plotH - (p.distance / maxY) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, p.finished ? 3.2 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#8e98a8';
  ctx.font = '10px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(maxY)}m`, 2, padT + 4);
  ctx.fillText('0', 12, h - padB + 3);
  ctx.textAlign = 'center';
  ctx.fillText('Generation', padL + plotW / 2, h - 7);
}

function drawNetwork() {
  const c = document.getElementById('network-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(10, 13, 19, 0.9)';
  ctx.fillRect(0, 0, w, h);
  const brain = simulation.leader?.brain;
  if (!brain) {
    ctx.fillStyle = '#5d6776';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText('Waiting for simulation...', 38, h / 2);
    return;
  }

  const xs = [34, w / 2, w - 34];
  const layers = [networkShape.inputs, networkShape.hidden, networkShape.outputs];
  const points = layers.map((count, li) => Array.from({ length: count }, (_, i) => ({
    x: xs[li],
    y: 20 + i * ((h - 40) / Math.max(1, count - 1)),
  })));

  const weights = brain.weights;
  const inputHiddenCount = networkShape.hidden * (networkShape.inputs + 1);
  drawConnections(ctx, points[0], points[1], weights.slice(0, inputHiddenCount), true);
  drawConnections(ctx, points[1], points[2], weights.slice(inputHiddenCount), true);

  for (let li = 0; li < points.length; li++) {
    for (const p of points[li]) {
      ctx.fillStyle = li === 0 ? '#60a5fa' : li === 1 ? '#4ade80' : '#a78bfa';
      ctx.beginPath();
      ctx.arc(p.x, p.y, li === 1 ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawConnections(ctx, from, to, weights, hasBias) {
  let k = 0;
  for (let j = 0; j < to.length; j++) {
    if (hasBias) k += 1;
    for (let i = 0; i < from.length; i++) {
      const w = weights[k++] ?? 0;
      ctx.strokeStyle = w >= 0 ? `rgba(59,130,246,${Math.min(0.55, Math.abs(w) * 0.22)})` : `rgba(239,68,68,${Math.min(0.55, Math.abs(w) * 0.22)})`;
      ctx.lineWidth = 0.6 + Math.min(2.2, Math.abs(w));
      ctx.beginPath();
      ctx.moveTo(from[i].x, from[i].y);
      ctx.lineTo(to[j].x, to[j].y);
      ctx.stroke();
    }
  }
}

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatTime(seconds) {
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
