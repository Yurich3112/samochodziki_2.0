import { Track } from './track.js';
import { TrackEditor } from './editor.js';
import { TrackRenderer } from './render.js';
import { Simulation } from './simulation.js';
import { networkShape } from './brain.js';
import { CAR_MODELS } from './carModels.js';
import { drawCar } from './carSprite.js';

const canvas = document.getElementById('stage-canvas');
const track = new Track();
const renderer = new TrackRenderer(canvas);
const simulation = new Simulation(track);

const view = {
  showTrack: true,
  showWalls: true,
  showCenterline: true,
  showSensors: true,
  showFps: false,
};

let mode = 'editor';
let dirty = true;
const requestRedraw = () => {
  dirty = true;
  updateEditorUiState();
};
let lastT = performance.now();
let lastHudT = 0;
const timeScales = [1, 2, 4, 8, 16];
let timeScaleIndex = 0;
let selectedCarIndex = 0;

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
    simulation.prepare();
  } else {
    simulation.stop();
    editor.enabled = true;
  }
  updateEditorUiState();
  requestRedraw();
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editor.setTool(btn.dataset.tool);
  });
});

document.getElementById('random-track').addEventListener('click', () => {
  if (mode === 'simulate' || track.strokes.length > 0) return;

  simulation.stop();
  editor.resetCommit();
  const stroke = track.addStroke(generateRandomTrackPoints(), editor.brushSize);
  editor.strokeCommitted = Boolean(stroke);
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const drawBtn = document.querySelector('.tool-btn[data-tool="draw"]');
  drawBtn?.classList.add('active');
  editor.setTool('draw');
  updateEditorUiState();
  requestRedraw();
});

const brushSlider = document.getElementById('brush-size');
const brushValue  = document.getElementById('brush-size-value');
brushSlider.addEventListener('input', () => {
  const v = parseInt(brushSlider.value, 10);
  brushValue.textContent = v;
  editor.setBrushSize(v);
});

const bind = (id, key, onChange = null) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => { 
    view[key] = el.checked; 
    if (onChange) onChange(el.checked);
    requestRedraw(); 
  });
};
bind('show-track', 'showTrack');
bind('show-walls', 'showWalls');
bind('show-centerline', 'showCenterline');
bind('show-sensors', 'showSensors');
bind('show-fps', 'showFps', (checked) => {
  document.getElementById('stats-overlay')?.classList.toggle('visible', checked);
});

document.getElementById('clear-track').addEventListener('click', () => {
  simulation.stop();
  track.clear();
  editor.resetCommit();
  setMode('editor');
  updateEditorUiState();
  requestRedraw();
});

document.getElementById('start-pause').addEventListener('click', () => {
  if (mode !== 'simulate') {
    setMode('simulate');
  }
  simulation.toggle();
  requestRedraw();
});
document.getElementById('fast-forward').addEventListener('click', () => {
  timeScaleIndex = (timeScaleIndex + 1) % timeScales.length;
  simulation.timeScale = timeScales[timeScaleIndex];
  updateFastForwardButton();
});
document.getElementById('next-generation').addEventListener('click', () => {
  if (!simulation.skipGeneration()) return;
  setMode('simulate');
});
document.getElementById('reset-simulation').addEventListener('click', () => {
  if (!track.strokes.length) return;
  simulation.trackStroke = null;
  simulation.reset();
  setMode('simulate');
});
document.getElementById('car-prev')?.addEventListener('click', () => selectCar(-1));
document.getElementById('car-next')?.addEventListener('click', () => selectCar(1));

// --- render loop ---
let fpsCount = 0;
let fpsLastTime = performance.now();
let currentFps = 0;

function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  fpsCount++;
  if (t - fpsLastTime >= 1000) {
    currentFps = Math.round((fpsCount * 1000) / (t - fpsLastTime));
    fpsCount = 0;
    fpsLastTime = t;
  }

  const simStart = performance.now();
  if (simulation.running) {
    const scale = simulation.timeScale;
    for (let i = 0; i < scale; i++) {
      const isLastTick = i === scale - 1;
      simulation.update(dt, isLastTick);
      // Early exit if generation ended mid-batch (all agents dead / advanced).
      if (!simulation.running) break;
    }
    dirty = true;
  }
  const simEnd = performance.now();

  updateHud(t);

  const drawStart = performance.now();
  if (dirty || view.showFps) {
    renderer.draw({ track, editor, view, simulation: mode === 'simulate' ? simulation : null });
    dirty = false;
  }
  const drawEnd = performance.now();

  if (view.showFps) {
    const elFps = document.getElementById('stat-fps');
    const elSim = document.getElementById('stat-sim');
    const elDraw = document.getElementById('stat-draw');
    if (elFps) elFps.textContent = currentFps;
    if (elSim) elSim.textContent = (simEnd - simStart).toFixed(1);
    if (elDraw) elDraw.textContent = (drawEnd - drawStart).toFixed(1);
  }

  requestAnimationFrame(frame);
}
window.addEventListener('resize', requestRedraw);
requestAnimationFrame(frame);
updateFastForwardButton();
updateEditorUiState();
updateCarSelector();

function updateHud(t = performance.now()) {
  if (t - lastHudT < 120) return;
  lastHudT = t;
  updateEditorUiState();
  const stats = simulation.getStats();
  const racing = stats.stage === 'race';
  text('generation-count', stats.generation);
  text('stage-label', racing ? 'Stage 2: Race for best time' : 'Stage 1: Learn track');
  text('best-metric-label', racing ? 'Best track time' : 'Best distance');
  text('best-distance', racing ? formatPreciseTime(stats.bestTrackTime) : Math.round(stats.bestDistance));
  text('best-distance-unit', racing ? '' : ' m');
  text('sim-status', stats.status);
  text('active-cars', stats.active);
  text('total-cars', stats.total);
  text('generation-time', formatTime(stats.generationTime));
  text('time-scale', `${stats.timeScale.toFixed(1)}x`);
  const progress = document.getElementById('generation-progress');
  if (progress) progress.style.width = `${stats.progress.toFixed(1)}%`;
  updateLeaderboard(stats);
  updateCarSelector(stats);
  drawNetwork();
  drawHistory(stats);
}

function updateEditorUiState() {
  const hasTrack = track.strokes.length > 0;
  const simMode = mode === 'simulate';
  const hintBar = document.querySelector('.hint-bar');
  if (hintBar) {
    hintBar.hidden = simMode || hasTrack;
  }

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.disabled = simMode;
  });

  const randomTrackBtn = document.getElementById('random-track');
  if (randomTrackBtn) {
    randomTrackBtn.disabled = simMode || hasTrack;
  }
}

function generateRandomTrackPoints() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const margin = Math.max(130, editor.brushSize * 1.7);
  const cx = w / 2 + randomBetween(-w * 0.06, w * 0.06);
  const cy = h / 2 + randomBetween(-h * 0.05, h * 0.05);
  const maxRx = Math.max(170, w / 2 - margin);
  const maxRy = Math.max(140, h / 2 - margin);
  const base = Math.min(maxRx, maxRy);
  const rx = Math.min(maxRx, base * randomBetween(1.05, 1.45));
  const ry = Math.min(maxRy, base * randomBetween(0.72, 1.05));
  const rotation = randomBetween(-0.45, 0.45);
  const wobbleA = Math.random() * Math.PI * 2;
  const wobbleB = Math.random() * Math.PI * 2;
  const count = 15 + Math.floor(Math.random() * 5);
  const points = [];

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = 1
      + Math.sin(a * 2 + wobbleA) * 0.14
      + Math.sin(a * 3 + wobbleB) * 0.08
      + randomBetween(-0.045, 0.045);
    const localX = Math.cos(a) * rx * r;
    const localY = Math.sin(a) * ry * r;
    const x = cx + localX * Math.cos(rotation) - localY * Math.sin(rotation);
    const y = cy + localX * Math.sin(rotation) + localY * Math.cos(rotation);
    points.push({
      x: Math.max(margin, Math.min(w - margin, x)),
      y: Math.max(margin, Math.min(h - margin, y)),
    });
  }

  points.push({ ...points[0] });
  return points;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function updateFastForwardButton() {
  const btn = document.getElementById('fast-forward');
  if (!btn) return;
  btn.classList.toggle('active', simulation.timeScale > 1);
  const label = btn.querySelector('span:last-child');
  if (label) label.textContent = `Fast forward ${simulation.timeScale}x`;
}

function updateLeaderboard(stats = simulation.getStats()) {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  const racing = stats.stage === 'race';
  text('leaderboard-title', racing ? 'Best track time leaderboard' : 'Distance leaderboard');
  if (racing) {
    const rows = (stats.bestTimes ?? [])
      .slice(0, 5)
      .map((result, i) => `<li><span>${i + 1}. gen ${result.generation}, car ${result.carId + 1}</span><strong>${formatPreciseTime(result.time)}</strong></li>`)
      .join('');
    el.innerHTML = rows || '<li><span>Waiting for finish</span><strong>--:--.--</strong></li>';
    return;
  }
  const rows = simulation.agents
    .slice()
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, 5)
    .map((a, i) => `<li><span>${i + 1}. car ${a.id + 1}</span><strong>${Math.round(a.maxProgress)} m</strong></li>`)
    .join('');
  el.innerHTML = rows || '<li><span>No cars yet</span><strong>0 m</strong></li>';
}

function selectCar(direction) {
  const stats = simulation.getStats();
  if (stats.carSelectionLocked) return;
  selectedCarIndex = (selectedCarIndex + direction + CAR_MODELS.length) % CAR_MODELS.length;
  simulation.setCarModel(CAR_MODELS[selectedCarIndex].id);
  updateCarSelector(simulation.getStats());
  requestRedraw();
}

function updateCarSelector(stats = simulation.getStats()) {
  const selected = stats.selectedCarModel ?? CAR_MODELS[selectedCarIndex];
  selectedCarIndex = Math.max(0, CAR_MODELS.findIndex(model => model.id === selected.id));
  text('car-selector-name', selected.name);
  text('car-selector-desc', selected.description);
  text('car-lock-note', stats.carSelectionLocked
    ? 'Car locked until Reset simulation.'
    : 'Choose a car before starting the simulation.');

  const prev = document.getElementById('car-prev');
  const next = document.getElementById('car-next');
  if (prev) prev.disabled = stats.carSelectionLocked;
  if (next) next.disabled = stats.carSelectionLocked;

  const statList = document.getElementById('car-stat-list');
  if (statList) {
    const labels = {
      acceleration: 'Acceleration',
      braking: 'Braking',
      handling: 'Handling',
      topSpeed: 'Top speed',
    };
    statList.innerHTML = Object.entries(selected.stats)
      .map(([key, value]) => `
        <div class="car-stat">
          <div class="car-stat-label"><span>${labels[key] ?? key}</span><strong>${Math.round(value * 100)}</strong></div>
          <div class="car-stat-bar"><div style="width:${Math.round(value * 100)}%"></div></div>
        </div>
      `)
      .join('');
  }

  drawCarPreview(selected.id);
}

function drawCarPreview(modelId) {
  const c = document.getElementById('car-preview-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w / 2, h / 2, 12, w / 2, h / 2, 96);
  glow.addColorStop(0, 'rgba(255, 201, 51, 0.18)');
  glow.addColorStop(1, 'rgba(255, 201, 51, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  drawCar(ctx, {
    x: w / 2,
    y: h / 2 + 2,
    heading: -Math.PI / 2,
    color: '#ffc933',
    modelId,
    brake: 0,
  }, 0.86);
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

  const racing = stats.stage === 'race';
  text('history-title', racing ? 'Best track time over generations' : 'Best distance over generations');
  const history = racing
    ? (stats.history ?? []).filter(p => Number.isFinite(p.bestTime))
    : (stats.history ?? []);
  if (!history.length) {
    ctx.fillStyle = '#5d6776';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText(racing ? 'No completed race times yet' : 'No completed generations yet', 42, h / 2);
    return;
  }

  const padL = 28;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const valueFor = p => racing ? p.bestTime : p.distance;
  const maxY = Math.max(1, racing ? 0 : stats.trackLength || 0, ...history.map(valueFor));
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
    const value = valueFor(p);
    const y = racing ? padT + (value / maxY) * plotH : padT + plotH - (value / maxY) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#b8ef63';
  history.forEach((p, i) => {
    const x = padL + (history.length === 1 ? plotW : (i / (history.length - 1)) * plotW);
    const value = valueFor(p);
    const y = racing ? padT + (value / maxY) * plotH : padT + plotH - (value / maxY) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, p.finished ? 3.2 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#8e98a8';
  ctx.font = '10px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(racing ? '0s' : `${Math.round(maxY)}m`, 2, padT + 4);
  ctx.fillText(racing ? `${maxY.toFixed(1)}s` : '0', 6, h - padB + 3);
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

  const xs = [28, w / 2 - 12, w - 68];
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

  const outputLabels = ['Left', 'Right', 'Gas', 'Brake'];
  ctx.font = '9px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < points[2].length; i++) {
    const p = points[2][i];
    ctx.fillStyle = '#8e98a8';
    ctx.fillText(outputLabels[i] ?? `Out ${i + 1}`, p.x + 11, p.y);
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

function formatPreciseTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--.--';
  const whole = Math.floor(seconds);
  const centiseconds = Math.floor((seconds - whole) * 100).toString().padStart(2, '0');
  const s = (whole % 60).toString().padStart(2, '0');
  const m = Math.floor(whole / 60).toString().padStart(2, '0');
  return `${m}:${s}.${centiseconds}`;
}
