import { drawCar } from './carSprite.js';
import { bridgeZoneSpan, collectBridgeLayers } from './bridges.js';

// Track renderer.
//
// Render order per stroke (oldest to newest, so newer strokes form bridges):
//   1. drop shadow (offset, slightly larger, dark)        — "elevation"
//   2. wall ring (wider, very dark)                        — outer barrier
//   3. asphalt                                             — drivable surface
//   4. left curb (red/white striped, dashed)               — visual edge
//   5. right curb (red/white striped, dashed)
//   6. center yellow dashes                                — racing line cue
//
// Bridge crossings: after all strokes, each bridge span is drawn again on top
// (opaque deck + details) so the lower road cannot show through, then guardrails.

const STRIPE_LEN = 28;
const CENTER_DASH = [22, 24];
const ASPHALT_TOP = '#3d424b';
const ASPHALT_BOT = '#2c3038';
const WALL_DARK = '#0b0d11';
const SAND_INNER = 'rgba(178, 151, 94, 0.58)';
const SAND_OUTER = 'rgba(139, 125, 77, 0.24)';
const TREE_VARIANT_LIMIT = 6;
const ROCK_SHAPES = [
  [[-0.62, -0.18], [-0.32, -0.56], [0.28, -0.52], [0.58, -0.14], [0.46, 0.34], [0.02, 0.54], [-0.48, 0.32]],
  [[-0.52, -0.34], [-0.08, -0.58], [0.46, -0.42], [0.62, 0.04], [0.26, 0.48], [-0.28, 0.44], [-0.62, 0.02]],
  [[-0.68, -0.04], [-0.38, -0.42], [0.1, -0.58], [0.54, -0.3], [0.64, 0.16], [0.18, 0.52], [-0.42, 0.42]],
  [[-0.46, -0.48], [0.18, -0.6], [0.62, -0.22], [0.5, 0.28], [0.08, 0.58], [-0.52, 0.3], [-0.68, -0.12]],
  [[-0.6, -0.26], [-0.16, -0.54], [0.36, -0.48], [0.68, -0.02], [0.34, 0.46], [-0.18, 0.56], [-0.58, 0.18]],
];

export class TrackRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this._grass = null;
    this._resize();
    window.addEventListener('resize', () => this._resize());
    
    // Off-screen cache for the static track layer (road, props, bridges, gates).
    // This avoids re-computing hundreds of sampleAt/strokePath calls every frame
    // when only the cars/skids/sensors are changing.
    this._trackCache = null;      // OffscreenCanvas or HTMLCanvasElement
    this._trackCacheStamp = null;  // Track content fingerprint
    this._trackCacheView = null;   // Serialised view toggles

    // Per-elevation off-screen caches for bridge deck overlays.
    // Bridge decks are expensive (arc sampling, shadow, curbs, asphalt) but
    // static — they only change when the track changes.  By caching them we
    // avoid hundreds of sampleAt + strokePath calls every frame.
    this._bridgeCaches = new Map();   // elevation → HTMLCanvasElement
    this._bridgeCacheStamp = null;
    this._bridgeCacheView = null;
    this._cachedBridgeLayers = null;  // cached collectBridgeLayers result
    this._cachedBridgeStamp = null;
    this._cachedMaxElevation = 0;

    // Load props
    this.loadedProps = {};
    this.treeProps = [];
    const propSources = {
      rocks: './public/props/rocks.svg',
      tyre_stack_1: './public/props/tyre_stack_1.svg',
    };
    for (const [name, src] of Object.entries(propSources)) {
      const img = new Image();
      img.src = src;
      this.loadedProps[name] = img;
    }
    for (let i = 3; i <= TREE_VARIANT_LIMIT; i++) {
      const img = new Image();
      img.onload = () => {
        if (!this.treeProps.includes(img)) {
          this.treeProps.push(img);
          this._trackCacheStamp = null; // Invalidate — new tree loaded.
        }
      };
      img.src = `./public/props/png/trees/tree_${i}.png`;
    }
  }

  _resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._grass = makeGrassPattern(this.ctx);
    this._trackCacheStamp = null; // Canvas size changed, force rebuild.
    this._bridgeCacheStamp = null;
  }

  /** Fingerprint that changes when strokes are added/removed or props regenerated. */
  _trackStamp(track) {
    // Fast — no serialisation, just IDs + count.
    return track.strokes.map(s => s.id).join(',') + '|' + (track.props?.length ?? 0);
  }

  /** Cached collectBridgeLayers — only rebuilt when the track stamp changes. */
  _getBridgeLayers(track) {
    const stamp = this._trackStamp(track);
    if (this._cachedBridgeStamp === stamp && this._cachedBridgeLayers) {
      return { bridgeLayers: this._cachedBridgeLayers, maxElevation: this._cachedMaxElevation };
    }
    const result = collectBridgeLayers(track.strokes);
    this._cachedBridgeLayers = result.bridgeLayers;
    this._cachedMaxElevation = result.maxElevation;
    this._cachedBridgeStamp = stamp;
    return result;
  }

  /**
   * Build (or reuse) per-elevation off-screen canvases with pre-rendered bridge
   * deck overlays.  Returns a Map<elevation, HTMLCanvasElement>.
   */
  _ensureBridgeCaches(track, view) {
    const stamp = this._trackStamp(track);
    const viewKey = this._viewKey(view);
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    if (
      this._bridgeCacheStamp === stamp &&
      this._bridgeCacheView === viewKey &&
      this._bridgeCaches.size > 0
    ) {
      // Verify canvas sizes haven't changed.
      let sizeOk = true;
      for (const c of this._bridgeCaches.values()) {
        if (c.width !== cw || c.height !== ch) { sizeOk = false; break; }
      }
      if (sizeOk) return this._bridgeCaches;
    }

    const { bridgeLayers, maxElevation } = this._getBridgeLayers(track);

    // Clear old caches.
    this._bridgeCaches.clear();

    for (let elev = 1; elev <= Math.max(1, maxElevation); elev++) {
      const bridges = bridgeLayers.get(elev);
      if (!bridges || bridges.length === 0) continue;

      let offCanvas = document.createElement('canvas');
      offCanvas.width = cw;
      offCanvas.height = ch;
      const octx = offCanvas.getContext('2d');
      octx.clearRect(0, 0, cw, ch);
      octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      drawBridgeDeckOverlays(octx, bridges, view);

      this._bridgeCaches.set(elev, offCanvas);
    }

    this._bridgeCacheStamp = stamp;
    this._bridgeCacheView = viewKey;
    return this._bridgeCaches;
  }

  /** Serialised view toggles that affect the cached static layer. */
  _viewKey(view) {
    return `${view.showTrack ?? true}|${view.showWalls ?? true}|${view.showCenterline ?? true}`;
  }

  /** Build (or reuse) an off-screen canvas with the full static track scene. */
  _ensureTrackCache(track, view) {
    const stamp = this._trackStamp(track);
    const viewKey = this._viewKey(view);
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    if (
      this._trackCache &&
      this._trackCacheStamp === stamp &&
      this._trackCacheView === viewKey &&
      this._trackCache.width === cw &&
      this._trackCache.height === ch
    ) {
      return this._trackCache;
    }

    // Create or resize the off-screen canvas.
    if (!this._trackCache || this._trackCache.width !== cw || this._trackCache.height !== ch) {
      this._trackCache = document.createElement('canvas');
      this._trackCache.width = cw;
      this._trackCache.height = ch;
    }

    const octx = this._trackCache.getContext('2d');
    octx.clearRect(0, 0, cw, ch);
    octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    // --- background grass ---
    octx.fillStyle = this._grass || '#48622a';
    octx.fillRect(0, 0, w, h);
    const grad = octx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    octx.fillStyle = grad;
    octx.fillRect(0, 0, w, h);

    // --- ground layer ---
    for (const s of track.strokes) drawStroke(octx, s, view);

    // --- props ---
    if (track.props) {
      const baseSizes = { tyre_stack_1: 120, rocks: 100 };
      for (const p of track.props) {
        if (p.type === 'rocks') continue;
        if (p.type === 'tree' || p.type === 'tree_1' || p.type === 'tree_2') {
          const fallbackIndex = p.type === 'tree_2' ? 1 : 0;
          drawTreeProp(octx, p, this.treeProps, fallbackIndex);
          continue;
        }
        const img = this.loadedProps[p.type];
        if (img && img.complete && img.naturalWidth > 0) {
          const base = baseSizes[p.type] ?? 120;
          const aspect = img.naturalWidth / img.naturalHeight;
          const ph = base * p.scale;
          const pw = ph * aspect;
          if (p.type === 'tyre_stack_1') drawTyreShadow(octx, p.x, p.y, pw, ph);
          octx.drawImage(img, p.x - pw / 2, p.y - ph / 2, pw, ph);
        }
      }
    }

    // NOTE: bridge deck overlays are NOT cached here — they must be drawn
    // dynamically between car elevation layers so ground-level cars go UNDER them.

    // --- start / finish gates ---
    if (view.showTrack ?? true) {
      for (const s of track.strokes) drawStrokeGates(octx, s);
    }

    this._trackCacheStamp = stamp;
    this._trackCacheView = viewKey;
    return this._trackCache;
  }

  draw({ track, editor, view, simulation = null }) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    if (simulation && !editor.enabled && !editor.drawing) {
      // ── Fast path: blit cached static track, then draw dynamic elements only ──
      const cache = this._ensureTrackCache(track, view);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cache, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // Bridge deck overlays are cached on per-elevation off-screen canvases.
      // We blit them between car elevation layers so ground-level cars go UNDER.
      const bridgeCaches = this._ensureBridgeCaches(track, view);
      const { maxElevation } = this._getBridgeLayers(track);
      const maxCarElevation = Math.max(0, ...simulation.agents.map(a => a.renderElevation ?? a.elevation ?? 0));

      drawSimulation(ctx, simulation, view, 0);

      for (let elev = 1; elev <= Math.max(1, maxElevation, maxCarElevation); elev++) {
        const bridgeCanvas = bridgeCaches.get(elev);
        if (bridgeCanvas) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(bridgeCanvas, 0, 0);
          ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
        drawSimulation(ctx, simulation, view, elev);
      }

      if (simulation) drawSimulationOverlays(ctx, simulation, view);

      return;
    }

    // ── Full path (editor mode / no simulation) ──
    // Invalidate the cache when in editor mode so the next sim frame rebuilds it.
    this._trackCacheStamp = null;
    this._bridgeCacheStamp = null;

    // --- background grass ---
    ctx.fillStyle = this._grass || '#48622a';
    ctx.fillRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // --- ground layer (0) ---
    for (const s of track.strokes) drawStroke(ctx, s, view);

    // --- props ---
    if (track.props) {
      const baseSizes = { tyre_stack_1: 120, rocks: 100 };
      for (const p of track.props) {
        if (p.type === 'rocks') continue;
        if (p.type === 'tree' || p.type === 'tree_1' || p.type === 'tree_2') {
          const fallbackIndex = p.type === 'tree_2' ? 1 : 0;
          drawTreeProp(ctx, p, this.treeProps, fallbackIndex);
          continue;
        }
        const img = this.loadedProps[p.type];
        if (img && img.complete && img.naturalWidth > 0) {
          const base = baseSizes[p.type] ?? 120;
          const aspect = img.naturalWidth / img.naturalHeight;
          const ph = base * p.scale;
          const pw = ph * aspect;
          if (p.type === 'tyre_stack_1') drawTyreShadow(ctx, p.x, p.y, pw, ph);
          ctx.drawImage(img, p.x - pw / 2, p.y - ph / 2, pw, ph);
        }
      }
    }

    const { bridgeLayers, maxElevation } = collectBridgeLayers(track.strokes);
    const maxCarElevation = simulation
      ? Math.max(0, ...simulation.agents.map(agent => agent.renderElevation ?? agent.elevation ?? 0))
      : 0;

    if (simulation) drawSimulation(ctx, simulation, view, 0);

    for (let elev = 1; elev <= Math.max(1, maxElevation, maxCarElevation); elev++) {
      const bridges = bridgeLayers.get(elev) || [];
      drawBridgeDeckOverlays(ctx, bridges, view);
      if (simulation) drawSimulation(ctx, simulation, view, elev);
    }

    if (simulation) drawSimulationOverlays(ctx, simulation, view);

    // --- start / finish gates ---
    if (view.showTrack ?? true) {
      for (const s of track.strokes) drawStrokeGates(ctx, s);
    }

    // --- in-progress stroke preview ---
    if (editor.enabled && editor.drawing && editor.currentPoints.length >= 2) {
      drawDrawingPreview(ctx, editor.currentPoints, editor.brushSize);
    }

    // --- eraser hover highlight ---
    if (editor.enabled && editor.tool === 'eraser' && editor.hoveredStroke) {
      drawEraseHighlight(ctx, editor.hoveredStroke);
    }

    // --- cursor preview ---
    if (editor.enabled && editor.cursor) {
      if (!editor.drawing) {
        if (editor.strokeCommitted && editor.tool !== 'eraser') {
          drawCursorLocked(ctx, editor.cursor, editor.brushSize);
        } else {
          drawCursor(ctx, editor.cursor, editor.tool, editor.brushSize);
        }
      } else if (editor.brushPos) {
        drawLazyBrush(ctx, editor.cursor, editor.brushPos, editor.brushSize);
      }
    }

    // --- one-stroke hint overlay ---
    if (editor.strokeCommitted && editor.enabled && !editor.drawing) {
      drawStrokeLockedHint(ctx, w, h);
    }
  }
}

function drawRockProp(ctx, p) {
  const shape = ROCK_SHAPES[(p.variant ?? 0) % ROCK_SHAPES.length];
  const shade = p.shade ?? 0.5;
  const size = 32 * (p.scale ?? 1);
  const center = {
    x: -0.04 + (shade - 0.5) * 0.08,
    y: -0.02 + (((p.variant ?? 0) % 3) - 1) * 0.035,
  };
  const palette = {
    light: shade < 0.33 ? '#b3b7b5' : shade < 0.66 ? '#a8adaf' : '#9da4a7',
    mid: shade < 0.33 ? '#8c918e' : shade < 0.66 ? '#82898b' : '#788083',
    dark: shade < 0.33 ? '#626965' : shade < 0.66 ? '#596166' : '#515a5e',
    deepest: '#3f474b',
  };

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation ?? 0);
  ctx.scale(size, size * (0.82 + ((p.variant ?? 0) % 2) * 0.08));

  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(0.08, 0.18, 0.56, 0.32, 0.08, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < shape.length; i++) {
    const a = shape[i];
    const b = shape[(i + 1) % shape.length];
    const side = (a[0] + b[0]) * 0.5;
    const depth = (a[1] + b[1]) * 0.5;
    ctx.fillStyle = depth < -0.22
      ? palette.light
      : side < -0.1
        ? palette.mid
        : depth > 0.24
          ? palette.deepest
          : palette.dark;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.closePath();
    ctx.fill();
  }

  ctx.lineWidth = 0.09;
  ctx.strokeStyle = '#151719';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(shape[0][0], shape[0][1]);
  for (let i = 1; i < shape.length; i++) ctx.lineTo(shape[i][0], shape[i][1]);
  ctx.closePath();
  ctx.stroke();

  ctx.lineWidth = 0.045;
  ctx.strokeStyle = 'rgba(20, 22, 24, 0.45)';
  ctx.beginPath();
  ctx.moveTo(center.x, center.y);
  const crack = shape[(p.variant ?? 0) % shape.length];
  ctx.lineTo(crack[0] * 0.55, crack[1] * 0.55);
  ctx.stroke();

  ctx.restore();
}

function drawTyreShadow(ctx, x, y, w, h) {
  // Layered ellipses instead of blur filter for performance.
  ctx.save();
  ctx.translate(x + w * 0.04, y + h * 0.2);
  ctx.rotate(-0.12);
  const rx = w * 0.22, ry = h * 0.12;
  const layers = [
    [rx + 4, ry + 2, 'rgba(0, 0, 0, 0.10)'],
    [rx + 2, ry + 1, 'rgba(0, 0, 0, 0.16)'],
    [rx,     ry,     'rgba(0, 0, 0, 0.16)'],
  ];
  for (const [lrx, lry, fill] of layers) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, lrx, lry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTreeProp(ctx, p, treeProps, fallbackIndex = 0) {
  if (!treeProps.length) return;
  const img = treeProps[(p.variant ?? fallbackIndex) % treeProps.length];
  if (!img?.complete || img.naturalWidth <= 0) return;

  const base = 150;
  const aspect = img.naturalWidth / img.naturalHeight;
  const h = base * (p.scale ?? 1);
  const w = h * aspect;
  drawTreeShadow(ctx, p.x, p.y, w, h);
  ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h);
}

function drawTreeShadow(ctx, x, y, w, h) {
  // Approximate Gaussian blur with layered ellipses — avoids the extremely
  // expensive ctx.filter='blur()' which triggers compositor pipeline flushes.
  ctx.save();
  ctx.translate(x + w * 0.13, y + h * 0.28);
  ctx.rotate(-0.18);
  const rx = w * 0.34, ry = h * 0.16;
  const layers = [
    [rx + 8, ry + 4, 'rgba(0, 0, 0, 0.06)'],
    [rx + 4, ry + 2, 'rgba(0, 0, 0, 0.10)'],
    [rx,     ry,     'rgba(0, 0, 0, 0.16)'],
  ];
  for (const [lrx, lry, fill] of layers) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, lrx, lry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawStroke(ctx, s, view) {
  const { center, width } = s;
  const curbW = Math.max(8, width * 0.14);
  const showTrack = view.showTrack ?? true;
  const showWalls = view.showWalls ?? true;
  const showCenter = view.showCenterline ?? true;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (showTrack) drawRoadShoulders(ctx, s, curbW);

  // 1. drop shadow (gives subtle elevation cue)
  ctx.save();
  ctx.translate(2, 4);
  ctx.lineWidth = width + curbW * 1.4 + 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  strokePath(ctx, center);
  ctx.restore();

  // 2. wall ring — slightly wider dark stroke, frames asphalt + curbs
  if (showWalls) {
    ctx.lineWidth = width + curbW * 1.4;
    ctx.strokeStyle = WALL_DARK;
    strokePath(ctx, center);
  }

  if (showTrack) {
    // 3. curbs as a centerline band. This avoids offset-edge self-intersections
    // on tight turns; asphalt is repainted over the middle immediately after.
    drawCurbBands(ctx, s, 0, s.totalLength, curbW);

    drawAsphaltSurface(ctx, center, width);
  }

  // 6. center yellow dashes
  if (showCenter) {
    drawCenterline(ctx, s, 0, s.totalLength, 'rgba(240, 198, 70, 0.9)');
    ctx.lineCap = 'round';
  }
}

/** Dense samples along arc length [sLo, sHi] with normals (for bridge overlay). */
function sliceArcSamples(stroke, sLo, sHi, step = 3.5) {
  const { totalLength } = stroke;
  let a = Math.min(sLo, sHi);
  let b = Math.max(sLo, sHi);
  a = Math.max(0, Math.min(totalLength, a));
  b = Math.max(0, Math.min(totalLength, b));
  if (b - a < 0.5) return [];

  const out = [];
  for (let s = a; s < b; s += step) {
    const sm = sampleAt(stroke, s);
    if (sm) out.push({ p: sm.p, normal: sm.normal });
  }
  const endSm = sampleAt(stroke, b);
  if (!endSm) return out;
  const last = out[out.length - 1];
  if (!last || Math.hypot(last.p.x - endSm.p.x, last.p.y - endSm.p.y) > 0.5) {
    out.push({ p: endSm.p, normal: endSm.normal });
  }
  return out;
}

/** Full road stack along bridge span only — paints over lower layer roads. */
function drawBridgeDeckOverlays(ctx, bridgeItems, view) {
  const groups = mergeBridgeItems(bridgeItems);
  for (const group of groups) {
    drawBridgeDeckOverlay(ctx, group.stroke, group, view);
  }
}

function mergeBridgeItems(bridgeItems) {
  const byStroke = new Map();
  for (const item of bridgeItems) {
    if (!byStroke.has(item.s)) byStroke.set(item.s, []);
    byStroke.get(item.s).push(item.b);
  }

  const groups = [];
  for (const [stroke, bridges] of byStroke) {
    const joinGap = Math.max(20, stroke.width * 0.65);
    const ranges = bridges
      .map(bridge => {
        const span = bridgeZoneSpan(stroke, bridge);
        return {
          stroke,
          bridge,
          start: bridge.s - span,
          end: bridge.s + span,
          bridges: [bridge],
        };
      })
      .sort((a, b) => a.start - b.start);

    for (const range of ranges) {
      const last = groups[groups.length - 1];
      if (last?.stroke === stroke && range.start <= last.end + joinGap) {
        last.start = Math.min(last.start, range.start);
        last.end = Math.max(last.end, range.end);
        last.bridges.push(range.bridge);
      } else {
        groups.push(range);
      }
    }
  }

  return groups;
}

function drawBridgeDeckOverlay(ctx, stroke, bridge, view) {
  const showTrack = view.showTrack ?? true;
  const showWalls = view.showWalls ?? true;
  const showCenter = view.showCenterline ?? true;
  const { width } = stroke;
  const curbW = Math.max(8, width * 0.14);
  const s0 = bridge.start ?? bridge.s - bridgeZoneSpan(stroke, bridge);
  const s1 = bridge.end ?? bridge.s + bridgeZoneSpan(stroke, bridge);
  const asphaltOverlap = Math.max(5, width * 0.06);

  const samples = sliceArcSamples(stroke, s0, s1, 3);
  if (samples.length < 2) return;
  const asphaltSamples = sliceArcSamples(stroke, s0 - asphaltOverlap, s1 + asphaltOverlap, 3);

  const center = samples.map(s => s.p);
  const asphaltCenter = asphaltSamples.length >= 2 ? asphaltSamples.map(s => s.p) : center;

  // Use butt caps so this pass does not create a visible "capsule" patch.
  // Bridge-only curb details must not spill onto normal red/white curbs.
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  drawBridgeShadow(ctx, stroke, bridge, width, curbW);

  if (showTrack) {
    // Repaint the whole bridge footprint first to hide lower-road details.
    ctx.lineWidth = width + curbW * 2.15;
    ctx.strokeStyle = ASPHALT_BOT;
    strokePath(ctx, center);

    drawCurbBands(ctx, stroke, s0, s1, curbW, 'butt', ['#c0c3ca', '#888b93']);

    // Slightly overpaint only the asphalt so the bridge cap edge does not leave a hairline.
    // The wider deck and grey curbs stay clipped to the true bridge span.
    drawAsphaltSurface(ctx, asphaltCenter, width);
  } else if (showWalls) {
    // Track hidden: still block lower road with an opaque band.
    ctx.lineWidth = width + curbW * 0.8;
    ctx.strokeStyle = WALL_DARK;
    strokePath(ctx, center);
  }

  if (showCenter && showTrack) {
    drawCenterline(ctx, stroke, s0 - asphaltOverlap, s1 + asphaltOverlap, 'rgba(240, 198, 70, 0.9)');
  }

  // Restore defaults for other passes.
  ctx.lineCap = 'round';
}

function drawRoadShoulders(ctx, stroke, curbW) {
  const shoulder = Math.max(24, stroke.width * 0.24);
  const segments = shoulderSegments(stroke);

  for (const segment of segments) {
    const { start, end, fadeStart, fadeEnd } = segment;
    const startS = start;
    const endS = end;
    if (endS - startS < 2) continue;
    for (const side of [-1, 1]) {
      drawShoulderSide(ctx, stroke, segment, side, curbW, shoulder + 16, SAND_OUTER, 1.15, fadeStart, fadeEnd);
      drawShoulderSide(ctx, stroke, segment, side, curbW, shoulder, SAND_INNER, 1, fadeStart, fadeEnd);
    }
  }
}

function drawShoulderSide(ctx, stroke, segment, side, curbW, shoulderWidth, color, jitterScale, fadeStart, fadeEnd) {
  const innerOffset = stroke.width / 2 + curbW * 0.74;
  const step = 8;
  const startS = segment.start;
  const endS = segment.end;
  const inner = [];
  const outer = [];

  for (let s = startS; s < endS; s += step) {
    addShoulderSample(stroke, side, s, segment, innerOffset, shoulderWidth, jitterScale, fadeStart, fadeEnd, inner, outer);
  }
  addShoulderSample(stroke, side, endS, segment, innerOffset, shoulderWidth, jitterScale, fadeStart, fadeEnd, inner, outer);
  if (inner.length < 2 || outer.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(inner[0].x, inner[0].y);
  for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
  for (let i = outer.length - 1; i >= 0; i--) ctx.lineTo(outer[i].x, outer[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function addShoulderSample(stroke, side, s, segment, innerOffset, shoulderWidth, jitterScale, fadeStart, fadeEnd, inner, outer) {
  const sample = sampleAt(stroke, s);
  if (!sample) return;

  const jitter = shoulderJitter(stroke.id ?? 1, side, s) * 10 * jitterScale;
  const fade = shoulderFadeAt(s, segment, fadeStart, fadeEnd);
  const innerDist = innerOffset * side;
  const outerDist = (innerOffset + Math.max(0, shoulderWidth + jitter) * fade) * side;
  inner.push({
    x: sample.p.x + sample.normal.x * innerDist,
    y: sample.p.y + sample.normal.y * innerDist,
  });
  outer.push({
    x: sample.p.x + sample.normal.x * outerDist,
    y: sample.p.y + sample.normal.y * outerDist,
  });
}

function shoulderFadeAt(s, segment, fadeStart, fadeEnd) {
  const fadeLen = Math.min(54, Math.max(18, (segment.end - segment.start) * 0.35));
  let fade = 1;
  if (fadeStart) fade = Math.min(fade, smoothstep(0, fadeLen, s - segment.start));
  if (fadeEnd) fade = Math.min(fade, smoothstep(0, fadeLen, segment.end - s));
  return fade;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function shoulderSegments(stroke) {
  const total = stroke.totalLength;
  if (total <= 0) return [];
  const ranges = bridgeShoulderExclusions(stroke);
  if (!ranges.length) return [{ start: 0, end: total, fadeStart: false, fadeEnd: false }];

  const segments = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor + 1) {
      segments.push({
        start: cursor,
        end: range.start,
        fadeStart: cursor > 0 || stroke.closed,
        fadeEnd: true,
      });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < total - 1) {
    segments.push({
      start: cursor,
      end: total,
      fadeStart: true,
      fadeEnd: stroke.closed,
    });
  }
  return segments;
}

function bridgeShoulderExclusions(stroke) {
  const total = stroke.totalLength;
  const ranges = [];

  for (const bridge of stroke.bridgesOver ?? []) {
    const span = bridgeZoneSpan(stroke, bridge) + stroke.width * 0.18;
    addShoulderExclusion(ranges, bridge.s, span, total, stroke.closed);
  }

  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function addShoulderExclusion(ranges, centerS, span, total, closed) {
  if (!Number.isFinite(centerS)) return;
  if (!closed) {
    ranges.push({
      start: Math.max(0, centerS - span),
      end: Math.min(total, centerS + span),
    });
    return;
  }

  const start = centerS - span;
  const end = centerS + span;
  if (start < 0) {
    ranges.push({ start: 0, end: Math.min(total, end) });
    ranges.push({ start: total + start, end: total });
  } else if (end > total) {
    ranges.push({ start, end: total });
    ranges.push({ start: 0, end: end - total });
  } else {
    ranges.push({ start, end });
  }
}

function shoulderJitter(strokeId, side, s) {
  return (noise1d(strokeId * 17 + side * 31 + s * 0.035) - 0.5)
    + (noise1d(strokeId * 23 + side * 47 + s * 0.11) - 0.5) * 0.55;
}

function noise1d(n) {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

function drawAsphaltSurface(ctx, center, width) {
  // Keep this shared so bridge overlays match the base road exactly.
  ctx.lineWidth = width;
  ctx.strokeStyle = ASPHALT_BOT;
  strokePath(ctx, center);
  ctx.lineWidth = Math.max(0, width - 6);
  ctx.strokeStyle = ASPHALT_TOP;
  strokePath(ctx, center);
  ctx.lineWidth = Math.max(0, width * 0.45);
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  strokePath(ctx, center);
  ctx.lineCap = 'round';
}

function drawBridgeShadow(ctx, stroke, bridge, width, curbW) {
  const shadowStart = bridge.start != null
    ? bridge.start + width * 0.18
    : bridge.s - Math.max(width * 0.5, bridgeZoneSpan(stroke, bridge) - width * 0.28);
  const shadowEnd = bridge.end != null
    ? bridge.end - width * 0.18
    : bridge.s + Math.max(width * 0.5, bridgeZoneSpan(stroke, bridge) - width * 0.28);
  const shadowSamples = sliceArcSamples(stroke, shadowStart, shadowEnd, 3);
  if (shadowSamples.length < 2) return;

  // Draw a single wide shadow band under the bridge deck.
  // Uses regular source-over so it works correctly when pre-rendered on a
  // transparent off-screen canvas.  The semi-transparent black strokes
  // preserve their alpha in the cache and correctly darken the underlying
  // content when the cache is composited onto the main canvas.
  const centerPath = shadowSamples.map(s => s.p);

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  // Outer soft penumbra
  ctx.translate(5, 8);
  ctx.lineWidth = width + curbW * 2.4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
  strokePath(ctx, centerPath);

  // Mid shadow
  ctx.lineWidth = width + curbW * 1.6;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)';
  strokePath(ctx, centerPath);

  // Core shadow
  ctx.lineWidth = width + curbW * 0.6;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  strokePath(ctx, centerPath);

  ctx.restore();
}

function drawBridgeAbutments(ctx, upper, bridge, view) {
  if (!(view.showWalls ?? true)) return;
  // Render side guardrails parallel to the upper road across the full deck span.
  const span = bridgeZoneSpan(upper, bridge) + upper.width * 0.08;
  const edgeOffset = upper.width / 2 + Math.max(8, upper.width * 0.14) * 0.55;
  for (const side of [-1, 1]) {
    const start = sampleAt(upper, bridge.s - span);
    const end = sampleAt(upper, bridge.s + span);
    const mid = sampleAt(upper, bridge.s);
    if (!start || !end || !mid) continue;

    const pushStart = {
      x: start.p.x + start.normal.x * side * edgeOffset,
      y: start.p.y + start.normal.y * side * edgeOffset,
    };
    const pushMid = {
      x: mid.p.x + mid.normal.x * side * edgeOffset,
      y: mid.p.y + mid.normal.y * side * edgeOffset,
    };
    const pushEnd = {
      x: end.p.x + end.normal.x * side * edgeOffset,
      y: end.p.y + end.normal.y * side * edgeOffset,
    };

    // Dark underlay for depth.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.58)';
    ctx.beginPath();
    ctx.moveTo(pushStart.x, pushStart.y);
    ctx.quadraticCurveTo(pushMid.x, pushMid.y, pushEnd.x, pushEnd.y);
    ctx.stroke();

    // Concrete rail.
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = '#b5b2a6';
    ctx.beginPath();
    ctx.moveTo(pushStart.x, pushStart.y);
    ctx.quadraticCurveTo(pushMid.x, pushMid.y, pushEnd.x, pushEnd.y);
    ctx.stroke();
  }
}

function drawStrokeGates(ctx, stroke) {
  if (!stroke.gates?.length) return;
  for (const gate of stroke.gates) drawGate(ctx, stroke, gate);
}

function drawGate(ctx, stroke, gate) {
  const sample = sampleGate(stroke, gate.index);
  if (!sample) return;

  const { p, normal } = sample;
  const halfW = stroke.width / 2;
  const curbW = Math.max(8, stroke.width * 0.14);
  const gateW = stroke.width + curbW * 0.35;
  const gateDepth = Math.max(12, stroke.width * 0.16);
  const cells = 8;
  const cellW = gateW / cells;

  const along = { x: -normal.y, y: normal.x };
  const leftCenter = { x: p.x + normal.x * (gateW / 2), y: p.y + normal.y * (gateW / 2) };
  const origin = {
    x: leftCenter.x - along.x * gateDepth / 2,
    y: leftCenter.y - along.y * gateDepth / 2,
  };

  ctx.save();
  ctx.lineJoin = 'miter';

  // Small colored lip makes open-track start/finish distinct without covering the checkers.
  const accent =
    gate.type === 'start' ? 'rgba(76, 213, 118, 0.92)' :
    gate.type === 'finish' ? 'rgba(233, 90, 90, 0.92)' :
    'rgba(245, 245, 245, 0.9)';
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  drawGateLine(ctx, p, normal, gateW + 4);
  ctx.strokeStyle = accent;
  drawGateLine(ctx, {
    x: p.x - along.x * (gateDepth * 0.72),
    y: p.y - along.y * (gateDepth * 0.72),
  }, normal, gateW + 3);

  // Checkered strip, two cells deep along the direction of travel.
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < cells; col++) {
      const isDark = (row + col) % 2 === 0;
      const a = {
        x: origin.x - normal.x * (col * cellW),
        y: origin.y - normal.y * (col * cellW),
      };
      const b = {
        x: origin.x - normal.x * ((col + 1) * cellW),
        y: origin.y - normal.y * ((col + 1) * cellW),
      };
      const c = {
        x: b.x + along.x * (gateDepth / 2),
        y: b.y + along.y * (gateDepth / 2),
      };
      const d = {
        x: a.x + along.x * (gateDepth / 2),
        y: a.y + along.y * (gateDepth / 2),
      };
      const rowShift = { x: along.x * row * (gateDepth / 2), y: along.y * row * (gateDepth / 2) };
      ctx.fillStyle = isDark ? '#111318' : '#f2f0e8';
      ctx.beginPath();
      ctx.moveTo(a.x + rowShift.x, a.y + rowShift.y);
      ctx.lineTo(b.x + rowShift.x, b.y + rowShift.y);
      ctx.lineTo(c.x + rowShift.x, c.y + rowShift.y);
      ctx.lineTo(d.x + rowShift.x, d.y + rowShift.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  drawGateLine(ctx, p, normal, gateW);
  ctx.restore();
}

function drawGateLine(ctx, p, normal, width) {
  ctx.beginPath();
  ctx.moveTo(p.x + normal.x * width / 2, p.y + normal.y * width / 2);
  ctx.lineTo(p.x - normal.x * width / 2, p.y - normal.y * width / 2);
  ctx.stroke();
}

function drawSimulation(ctx, simulation, view, targetElevation = 0) {
  if (targetElevation === 0) drawSkidMarks(ctx, simulation.skidMarks);

  for (const agent of simulation.agents) {
    if (!agent.alive && !agent.crashed) continue;
    const renderElevation = agent.renderElevation ?? agent.elevation;
    if (renderElevation !== targetElevation) continue;
    
    ctx.globalAlpha = agent.alive ? 1 : 0.35;
    drawCar(ctx, agent, 0.25);
    ctx.globalAlpha = 1;
  }
}

function drawSimulationOverlays(ctx, simulation, view) {
  if (!simulation.leader?.alive) return;
  
  if (view.showSensors) {
    drawSensors(ctx, simulation.leader);
  }
  
  drawLeaderTag(ctx, simulation.leader);
}

function drawSkidMarks(ctx, skids) {
  if (!skids.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  // Batch skid marks by quantized alpha to reduce draw calls from ~500 to ~10.
  const buckets = new Map();
  for (const skid of skids) {
    const a = Math.round(skid.alpha * skid.life * 20) / 20; // quantize to 0.05 steps
    if (a <= 0) continue;
    if (!buckets.has(a)) buckets.set(a, []);
    buckets.get(a).push(skid);
  }
  for (const [alpha, batch] of buckets) {
    ctx.strokeStyle = `rgba(5, 7, 12, ${alpha})`;
    ctx.beginPath();
    for (const skid of batch) {
      ctx.moveTo(skid.x1, skid.y1);
      ctx.lineTo(skid.x2, skid.y2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawSensors(ctx, car) {
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i < car.sensorHits.length; i++) {
    const hit = car.sensorHits[i];
    const near = car.sensors[i] / 170;
    ctx.strokeStyle = `rgba(96, 165, 250, ${0.18 + (1 - near) * 0.35})`;
    ctx.beginPath();
    ctx.moveTo(car.x, car.y);
    ctx.lineTo(hit.x, hit.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(96, 165, 250, 0.65)';
    ctx.beginPath();
    ctx.arc(hit.x, hit.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLeaderTag(ctx, car) {
  const x = car.x;
  const y = car.y - 34;
  ctx.save();
  ctx.font = '700 11px Inter, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(14, 17, 22, 0.85)';
  roundRectPath(ctx, x - 28, y - 12, 56, 22, 5);
  ctx.fill();
  ctx.strokeStyle = '#ffc933';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffc933';
  ctx.fillText('LEADER', x, y);
  ctx.beginPath();
  ctx.moveTo(x, y + 12);
  ctx.lineTo(x - 6, y + 22);
  ctx.lineTo(x + 6, y + 22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function sampleGate(stroke, index) {
  const i = Math.max(0, Math.min(stroke.center.length - 1, index));
  const p = stroke.center[i];
  if (!p) return null;

  let a;
  let b;
  if (i === 0) {
    a = stroke.center[0];
    b = stroke.center[1] ?? stroke.center[0];
  } else if (i === stroke.center.length - 1) {
    a = stroke.center[i - 1] ?? stroke.center[i];
    b = stroke.center[i];
  } else {
    a = stroke.center[i - 1];
    b = stroke.center[i + 1];
  }

  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const l = Math.hypot(tx, ty) || 1;
  return { p, normal: { x: -ty / l, y: tx / l } };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCurbBands(ctx, stroke, startS, endS, curbW, cap = 'round', colors = ['#f1efea', '#d23838']) {
  const a = Math.max(0, Math.min(stroke.totalLength, startS));
  const b = Math.max(0, Math.min(stroke.totalLength, endS));

  // Draw one wide striped road-following band, then the asphalt pass covers
  // the center. This is much more stable than drawing two offset edge paths.
  drawAlternatingOffsetPath(
    ctx,
    stroke,
    0,
    a,
    b,
    stroke.width + curbW * 1.55,
    STRIPE_LEN,
    colors,
    cap,
  );
}

function drawCenterline(ctx, stroke, startS, endS, color) {
  const dash = CENTER_DASH[0];
  const gap = CENTER_DASH[1];
  const cycle = dash + gap;
  let s = Math.max(0, Math.min(stroke.totalLength, startS));
  const end = Math.max(0, Math.min(stroke.totalLength, endS));

  while (s < end - 0.1) {
    const phase = positiveModulo(s, cycle);
    const boundary = s + (phase < dash ? dash - phase : cycle - phase);
    const next = Math.min(end, boundary);
    if (phase < dash && next - s > 0.5) {
      drawOffsetArc(ctx, stroke, 0, s, next, 2, color, 3.5, 'round');
    }
    s = next + 0.01;
  }
}

function drawAlternatingOffsetPath(ctx, stroke, offset, startS, endS, lineWidth, segmentLen, colors, cap = 'round') {
  let s = Math.max(0, Math.min(stroke.totalLength, startS));
  const end = Math.max(0, Math.min(stroke.totalLength, endS));

  while (s < end - 0.1) {
    const phase = positiveModulo(s, segmentLen * colors.length);
    const colorIdx = Math.floor(phase / segmentLen) % colors.length;
    const nextBoundary = s + (segmentLen - (phase % segmentLen));
    const next = Math.min(end, nextBoundary);
    if (next - s > 0.5) {
      drawOffsetArc(ctx, stroke, offset, s, next, lineWidth, colors[colorIdx], 3.5, cap);
    }
    s = next + 0.01;
  }
}

function drawOffsetArc(ctx, stroke, offset, startS, endS, lineWidth, color, step = 4, cap = 'round') {
  const a = Math.max(0, Math.min(stroke.totalLength, Math.min(startS, endS)));
  const b = Math.max(0, Math.min(stroke.totalLength, Math.max(startS, endS)));
  if (b - a < 0.5) return;

  const points = [];
  for (let s = a; s < b; s += step) {
    const sm = sampleAt(stroke, s);
    if (sm) points.push({
      x: sm.p.x + sm.normal.x * offset,
      y: sm.p.y + sm.normal.y * offset,
    });
  }
  const endSm = sampleAt(stroke, b);
  if (endSm) {
    points.push({
      x: endSm.p.x + endSm.normal.x * offset,
      y: endSm.p.y + endSm.normal.y * offset,
    });
  }
  if (points.length < 2) return;

  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  strokePath(ctx, points);
}

function positiveModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function drawDrawingPreview(ctx, points, width) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = 'rgba(60, 65, 75, 0.55)';
  strokePath(ctx, points);
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(255, 201, 51, 0.85)';
  strokePath(ctx, points);
  ctx.setLineDash([]);
}

function drawEraseHighlight(ctx, stroke) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width + 8;
  ctx.strokeStyle = 'rgba(233, 90, 90, 0.35)';
  strokePath(ctx, stroke.center);
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = 'rgba(233, 90, 90, 0.95)';
  strokePath(ctx, stroke.center);
  ctx.setLineDash([]);
}

function drawCursor(ctx, p, tool, brushSize) {
  ctx.save();
  ctx.lineWidth = 1.5;
  if (tool === 'eraser') {
    ctx.strokeStyle = 'rgba(233, 90, 90, 0.9)';
    ctx.fillStyle = 'rgba(233, 90, 90, 0.12)';
    const r = 14;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6);
    ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(255, 201, 51, 0.85)';
    ctx.fillStyle = 'rgba(255, 201, 51, 0.10)';
    const r = brushSize / 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 201, 51, 0.9)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawCursorLocked(ctx, p, brushSize) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(140, 140, 160, 0.4)';
  ctx.fillStyle = 'rgba(140, 140, 160, 0.06)';
  const r = brushSize / 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Small lock icon
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(200, 200, 210, 0.7)';
  ctx.beginPath();
  ctx.moveTo(p.x - 4, p.y - 4); ctx.lineTo(p.x + 4, p.y + 4);
  ctx.moveTo(p.x + 4, p.y - 4); ctx.lineTo(p.x - 4, p.y + 4);
  ctx.stroke();
  ctx.restore();
}

function drawLazyBrush(ctx, cursor, brushPos, brushSize) {
  ctx.save();
  
  // The string
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cursor.x, cursor.y);
  ctx.lineTo(brushPos.x, brushPos.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // The actual brush head (the circle where the track is drawn)
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.arc(brushPos.x, brushPos.y, brushSize / 2, 0, Math.PI * 2);
  ctx.stroke();

  // The cursor position (where the user's mouse is)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(cursor.x, cursor.y, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawStrokeLockedHint(ctx, w, h) {
  ctx.save();
  const text = 'Track drawn — press Start to simulate, or Clear to redraw';
  ctx.font = '600 13px Inter, Segoe UI, sans-serif';
  const tw = ctx.measureText(text).width;
  const padH = 16;
  const padV = 10;
  const bw = tw + padH * 2;
  const bh = 32;
  const bx = (w - bw) / 2;
  const by = 18;

  ctx.fillStyle = 'rgba(14, 17, 22, 0.75)';
  roundRectPath(ctx, bx, by, bw, bh, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 201, 51, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 201, 51, 0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, by + bh / 2);
  ctx.restore();
}

// ---------- helpers ----------

function strokePath(ctx, points) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

// Sample (point + outward normal) at arc-length s along stroke's centerline.
function sampleAt(stroke, s) {
  const { center, lengths, totalLength } = stroke;
  if (totalLength <= 0) return null;
  const sc = Math.max(0, Math.min(totalLength, s));
  // Binary search for the segment containing arc-length sc.
  let lo = 1, hi = lengths.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] < sc) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const segLen = (lengths[i] - lengths[i - 1]) || 1;
  const t = (sc - lengths[i - 1]) / segLen;
  const a = center[i - 1], b = center[i];
  const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const tx = b.x - a.x, ty = b.y - a.y;
  const l = Math.hypot(tx, ty) || 1;
  const normal = { x: -ty / l, y: tx / l };
  return { p, normal };
}

function makeGrassPattern(ctx) {
  const size = 256;
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const o = off.getContext('2d');
  // base tone
  o.fillStyle = '#48622a';
  o.fillRect(0, 0, size, size);
  // noisy speckle for texture
  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = Math.random();
    const r = (58 + v * 48) | 0;
    const g = (82 + v * 62) | 0;
    const b = (28 + v * 26) | 0;
    o.fillStyle = `rgba(${r},${g},${b},${0.35 + v * 0.4})`;
    const s = 1 + Math.random() * 1.4;
    o.fillRect(x, y, s, s);
  }
  // sparse grass blade ticks
  for (let i = 0; i < 700; i++) {
    o.strokeStyle = `rgba(${(78 + Math.random() * 46) | 0}, ${(118 + Math.random() * 54) | 0}, ${(42 + Math.random() * 24) | 0}, 0.55)`;
    o.lineWidth = 0.7;
    const x = Math.random() * size;
    const y = Math.random() * size;
    o.beginPath();
    o.moveTo(x, y);
    o.lineTo(x + (Math.random() - 0.5) * 3, y - 1.5 - Math.random() * 2);
    o.stroke();
  }
  return ctx.createPattern(off, 'repeat');
}
