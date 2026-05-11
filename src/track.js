import { smoothPath, smoothUserInput, resample, pointToSegmentDist, segIntersect, arcLengths } from './spline.js';
import { arcDistance, bridgeZoneSpan } from './bridges.js';

// A Stroke is one continuous user-drawn track piece:
//   { id, width, raw[], center[], left[], right[], normals[], lengths[], totalLength,
//     bridgesOver: [{strokeId, t}] }
//
// Strokes are rendered in draw order so that newer ones overlap older ones,
// which gives natural "bridge over" semantics at intersections.

export class Track {
  constructor() {
    this.strokes = [];
    this.props = [];
    this._nextId = 1;
  }

  addStroke(rawPoints, width) {
    if (rawPoints.length < 2) return null;

    // === 1. Aggressive path optimisation ===
    // a) Remove duplicate / near-duplicate points so tiny loops and jitter vanish.
    const optimized = optimizeRawPath(rawPoints, width);
    if (optimized.length < 2) return null;

    // b) Determine closure early
    const rawDist = Math.hypot(
      optimized[0].x - optimized[optimized.length - 1].x,
      optimized[0].y - optimized[optimized.length - 1].y
    );
    let closed = rawDist < width * 1.2 && optimized.length > 8;

    // Denoise → spline smooth → resample to uniform spacing.
    const filtered = smoothUserInput(optimized, Math.max(12, width * 0.15), 4, closed);
    if (closed) {
      // Force exact match on filtered endpoints so the spline wrapper aligns perfectly
      filtered[filtered.length - 1] = { ...filtered[0] };
    }

    const smoothed = smoothPath(filtered, 12, closed);
    const center = resample(smoothed, 5, closed);
    if (center.length < 2) return null;

    let finalCenter = center;
    if (closed) {
      finalCenter = shiftToStraight(center);
    }

    const normals = computeNormals(finalCenter, closed);
    const half = width / 2;
    const left = finalCenter.map((p, i) => ({ x: p.x + normals[i].x * half, y: p.y + normals[i].y * half }));
    const right = finalCenter.map((p, i) => ({ x: p.x - normals[i].x * half, y: p.y - normals[i].y * half }));
    const lengths = arcLengths(finalCenter);

    const stroke = {
      id: this._nextId++,
      width,
      closed,
      raw: rawPoints.slice(),
      center: finalCenter,
      left,
      right,
      normals,
      lengths,
      totalLength: lengths[lengths.length - 1],
      bridgesOver: [],
      gates: buildGates(finalCenter, closed),
    };

    // === 2. Detect crossings against existing strokes ===
    for (const older of this.strokes) {
      // a) Centerline segment crossings (existing logic).
      for (let i = 1; i < finalCenter.length; i++) {
        for (let j = 1; j < older.center.length; j++) {
          const hit = segIntersect(finalCenter[i - 1], finalCenter[i], older.center[j - 1], older.center[j]);
          if (!hit) continue;
          const segLen = lengths[i] - lengths[i - 1];
          const s = lengths[i - 1] + hit.tAB * segLen;
          stroke.bridgesOver.push({
            strokeId: older.id,
            x: hit.x,
            y: hit.y,
            s,
            otherWidth: older.width,
            angleSin: crossingAngleSin(finalCenter[i - 1], finalCenter[i], older.center[j - 1], older.center[j]),
          });
        }
      }

      // b) Partial overlap detection
      const overlapBridges = detectOverlapBridges(stroke, older, finalCenter, lengths);
      for (const ob of overlapBridges) {
        stroke.bridgesOver.push(ob);
      }
    }

    // === 3. Self-crossings (e.g. infinity sign) ===
    const selfCrossings = findSelfCrossings(finalCenter, lengths, closed, width);
    for (const c of selfCrossings) {
      stroke.bridgesOver.push({
        strokeId: stroke.id,
        x: c.x,
        y: c.y,
        s: c.upperS,
        lowerS: c.lowerS,
        otherWidth: width,
        angleSin: c.angleSin,
        self: true,
      });
    }

    // === 4. Self-overlaps (road runs parallel alongside itself) ===
    const selfOverlaps = findSelfOverlaps(finalCenter, lengths, closed, width);
    for (const ov of selfOverlaps) {
      // If an existing self-crossing bridge covers this zone, upgrade it with our measured overlap span.
      // Check against both upper (b.s) and lower (b.lowerS) arc-lengths — the overlap may be
      // detected on either side of the crossing point.
      let isDup = false;
      const dupRadius = width * 3.5;
      for (const b of stroke.bridgesOver) {
        if (!b.self) continue;
        const nearUpper = Math.abs(b.s - ov.upperS) < dupRadius;
        const nearLower = b.lowerS != null && Math.abs(b.lowerS - ov.upperS) < dupRadius;
        const nearUpperToLower = Math.abs(b.s - ov.lowerS) < dupRadius;
        const nearLowerToLower = b.lowerS != null && Math.abs(b.lowerS - ov.lowerS) < dupRadius;
        if (nearUpper || nearLower || nearUpperToLower || nearLowerToLower) {
          isDup = true; 
          // Only upgrade overlapSpan if the existing bridge already uses overlap
          // geometry. Don't set it on a crossing bridge — that would switch it to
          // the overlap span formula, producing a much larger zone.
          if (b.overlapSpan != null && ov.overlapSpan > b.overlapSpan) {
            b.overlapSpan = ov.overlapSpan;
            b.s = ov.upperS;
            b.lowerS = ov.lowerS;
          }
          break; 
        }
      }
      if (!isDup) {
        stroke.bridgesOver.push({
          strokeId: stroke.id,
          x: ov.x,
          y: ov.y,
          s: ov.upperS,
          lowerS: ov.lowerS,
          otherWidth: width,
          angleSin: ov.angleSin,
          self: true,
          overlapSpan: ov.overlapSpan,
        });
      }
    }

    recalculateSelfBridgeLayers(stroke);
    moveClosedStrokeStartAwayFromBridges(stroke);

    this.strokes.push(stroke);
    this.generateProps();
    return stroke;
  }

  // Remove the topmost stroke whose centerline passes within width/2 of (x,y).
  removeStrokeAt(x, y) {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      const half = s.width / 2;
      let hit = false;
      for (let j = 1; j < s.center.length; j++) {
        if (pointToSegmentDist(x, y, s.center[j - 1], s.center[j]) <= half) { hit = true; break; }
      }
      if (hit) {
        const removedId = s.id;
        this.strokes.splice(i, 1);
        this.props = this.props.filter(p => p.type !== 'tyre_stack_1');
        // Drop bridge records that pointed at the removed stroke.
        for (const other of this.strokes) {
          other.bridgesOver = other.bridgesOver.filter(b => b.strokeId !== removedId);
        }
        return true;
      }
    }
    return false;
  }

  // Find the topmost stroke under the cursor (for hover highlight in eraser mode).
  pickStrokeAt(x, y) {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      const half = s.width / 2;
      for (let j = 1; j < s.center.length; j++) {
        if (pointToSegmentDist(x, y, s.center[j - 1], s.center[j]) <= half) return s;
      }
    }
    return null;
  }

  clear() {
    this.strokes = [];
    this.props = [];
  }

  generateProps() {
    this.props = [];
    if (this.strokes.length === 0) return;
    
    // 1. Scatter environment props.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.strokes) {
      for (const p of s.center) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    
    // Expand bounds significantly for off-track scattering
    minX -= 500; minY -= 500; maxX += 500; maxY += 500;
    
    const area = (maxX - minX) * (maxY - minY);
    const numTrees = Math.floor(area / 150000);
    const bounds = { minX, minY, maxX, maxY };

    for (let i = 0; i < numTrees; i++) {
      const spot = findPropSpot(this.strokes, bounds, 90, 14);
      if (!spot) continue;
      this.props.push({
        type: 'tree',
        x: spot.x,
        y: spot.y,
        scale: 1.0 + Math.random() * 0.45,
        variant: Math.floor(Math.random() * 32),
      });
    }

    // 2. Tyre barriers on curved corners (outside of turns only)
    for (const s of this.strokes) {
      const tyreScale = 0.5;
      const tyreSpacing = 48 * tyreScale * 0.68;
      let nextTyreS = 0;
      let inTyreRun = false;
      const step = 10;
      for (let i = step; i < s.center.length - step; i++) {
        const prev = s.center[i - step];
        const cur = s.center[i];
        const next = s.center[i + step];

        const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
        const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
        let diff = a2 - a1;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (Math.abs(diff) > 0.25) {
          const currentS = s.lengths[i];
          if (isInBridgeZone(s, currentS)) {
            inTyreRun = false;
            continue;
          }

          if (!inTyreRun) {
            nextTyreS = currentS;
            inTyreRun = true;
          }

          // Outside of curve: normals point left; right turn = outside is left (-1)
          const dir = diff > 0 ? -1 : 1;
          const curbW = Math.max(8, s.width * 0.14);
          const sandShoulder = Math.max(24, s.width * 0.24) + 16;
          const offsetDist = s.width / 2 + curbW + sandShoulder + 18;

          while (nextTyreS <= currentS) {
            if (!isInBridgeZone(s, nextTyreS)) {
              const sample = sampleRoadAt(s, nextTyreS);
              if (sample) {
                const px = sample.p.x + sample.normal.x * offsetDist * dir;
                const py = sample.p.y + sample.normal.y * offsetDist * dir;
                addTyreStack(this.props, this.strokes, px, py, tyreScale);
              }
            }
            nextTyreS += tyreSpacing;
          }
        } else {
          inTyreRun = false;
        }
      }

      addStartLineTyres(this.props, s, this.strokes);
    }

    // 3. Sort by visual layer first, then Y. Trees intentionally render above rocks.
    this.props.sort((a, b) => propLayer(a.type) - propLayer(b.type) || a.y - b.y);
  }
}

function findPropSpot(strokes, bounds, clearance, attempts) {
  for (let i = 0; i < attempts; i++) {
    const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
    const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
    if (isPropSpotClear(strokes, x, y, clearance)) return { x, y };
  }
  return null;
}

function isPropSpotClear(strokes, x, y, clearance) {
  for (const s of strokes) {
    const minDist = s.width * 0.9 + clearance;
    for (let i = 1; i < s.center.length; i++) {
      if (pointToSegmentDist(x, y, s.center[i - 1], s.center[i]) < minDist) return false;
    }
  }
  return true;
}

function propLayer(type) {
  if (type === 'rocks') return 0;
  if (type === 'tyre_stack_1') return 1;
  return 2;
}

function addTyreStack(props, strokes, x, y, scale) {
  if (!isPropSpotClear(strokes, x, y, 12)) return false;
  props.push({ type: 'tyre_stack_1', x, y, scale });
  return true;
}

function addStartLineTyres(props, stroke, strokes) {
  const gate = stroke.gates?.find(g => g.type === 'startFinish' || g.type === 'start');
  if (!gate) return;

  const s = stroke.lengths[gate.index] ?? 0;
  const sample = sampleRoadAt(stroke, s);
  if (!sample) return;

  const curbW = Math.max(8, stroke.width * 0.14);
  const along = { x: -sample.normal.y, y: sample.normal.x };
  const offsetDist = stroke.width / 2 + curbW + 18;
  const spacing = 25;
  const tyreScale = 0.5;

  for (const side of [-1, 1]) {
    const base = {
      x: sample.p.x + sample.normal.x * offsetDist * side,
      y: sample.p.y + sample.normal.y * offsetDist * side,
    };

    for (const alongOffset of [-spacing, 0, spacing]) {
      addTyreStack(
        props,
        strokes,
        base.x + along.x * alongOffset,
        base.y + along.y * alongOffset,
        tyreScale,
      );
    }
  }
}

// ─── Path optimisation helpers ───────────────────────────────────────

/**
 * Pre-process raw pointer input:
 *  - Remove near-duplicate points (distance < minSpacing).
 *  - Detect and excise tiny self-intersecting loops (user drawing little circles).
 *  - Cap maximum curvature to avoid physically impossible hairpins.
 */
function optimizeRawPath(raw, roadWidth) {
  if (raw.length < 3) return raw.slice();
  const minSpacing = Math.max(40, roadWidth * 0.65);

  // 1. Remove points that are too close to the previous kept point.
  let pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = pts[pts.length - 1];
    if (Math.hypot(raw[i].x - last.x, raw[i].y - last.y) >= minSpacing) {
      pts.push(raw[i]);
    }
  }
  // Keep the last point if it's meaningfully far from last kept.
  const finalPt = raw[raw.length - 1];
  const lastKept = pts[pts.length - 1];
  if (Math.hypot(finalPt.x - lastKept.x, finalPt.y - lastKept.y) > minSpacing * 0.4) {
    pts.push(finalPt);
  }

  // 2. Excise tiny loops: if a later point comes very close to an earlier point
  pts = removeSmallLoops(pts, roadWidth);

  // 3. Apply a Laplacian moving average smoothing pass to relax any remaining zig-zags
  for (let iter = 0; iter < 3; iter++) {
    if (pts.length < 3) break;
    const smoothed = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      smoothed.push({
        x: pts[i].x * 0.5 + (pts[i - 1].x + pts[i + 1].x) * 0.25,
        y: pts[i].y * 0.5 + (pts[i - 1].y + pts[i + 1].y) * 0.25,
      });
    }
    smoothed.push(pts[pts.length - 1]);
    pts = smoothed;
  }

  // 4. Cap maximum turning angle between consecutive segments.
  pts = capMaxCurvature(pts, roadWidth);

  return pts;
}

/** Remove sections where the path loops back and crosses near itself within a short arc. */
function removeSmallLoops(pts, roadWidth) {
  const minLoopArc = Math.max(30, roadWidth * 0.5);  // minimum arc length to be a real loop
  const snapDist = Math.max(15, roadWidth * 0.35);

  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < pts.length; i++) {
      let arcLen = 0;
      for (let j = i + 2; j < pts.length; j++) {
        arcLen += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
        if (arcLen > minLoopArc * 3) break;  // too far, stop searching
        if (arcLen < minLoopArc) continue;    // not a meaningful loop yet

        const d = Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
        if (d < snapDist) {
          // Found a small loop from i to j — remove the interior.
          pts.splice(i + 1, j - i - 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return pts;
}

/** Limit maximum turning angle between consecutive segments to prevent impossible corners. */
function capMaxCurvature(pts, roadWidth) {
  if (pts.length < 3) return pts;
  const maxAngle = Math.PI * 0.35;  // ~63° per step - enforces smoother turns over the new longer segments

  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i++) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    const c = pts[i];

    const abx = b.x - a.x, aby = b.y - a.y;
    const bcx = c.x - b.x, bcy = c.y - b.y;
    const abLen = Math.hypot(abx, aby);
    const bcLen = Math.hypot(bcx, bcy);
    if (abLen < 0.1 || bcLen < 0.1) { out.push(c); continue; }

    const dot = (abx * bcx + aby * bcy) / (abLen * bcLen);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (angle > maxAngle) {
      // Rotate the segment b→c to cap at maxAngle relative to a→b.
      const cross = abx * bcy - aby * bcx;
      const dir = cross >= 0 ? 1 : -1;
      const baseAngle = Math.atan2(aby, abx);
      const cappedAngle = baseAngle + dir * (Math.PI - maxAngle);
      out.push({
        x: b.x + Math.cos(cappedAngle) * bcLen,
        y: b.y + Math.sin(cappedAngle) * bcLen,
      });
    } else {
      out.push(c);
    }
  }
  return out;
}

// ─── Overlap bridge detection ────────────────────────────────────────

/**
 * Detect stretches where the new stroke runs parallel to / overlaps with
 * an older stroke, without their centerlines actually crossing.
 * Returns bridge-like records that will elevate the new road over those zones.
 */
function detectOverlapBridges(newStroke, oldStroke, center, lengths) {
  const results = [];
  const threshold = (newStroke.width + oldStroke.width) * 0.48;
  const minOverlapLen = Math.max(20, Math.min(newStroke.width, oldStroke.width) * 0.3);

  // Walk the new centerline and measure distance to the old centerline.
  // Collect runs of "too close" points, then create a bridge record for each run.
  let runStart = -1;
  let runSumX = 0, runSumY = 0, runCount = 0;

  for (let i = 0; i < center.length; i++) {
    const p = center[i];
    let minDist = Infinity;
    for (let j = 1; j < oldStroke.center.length; j++) {
      const d = ptSegDist(p, oldStroke.center[j - 1], oldStroke.center[j]);
      if (d < minDist) minDist = d;
    }

    if (minDist < threshold) {
      if (runStart < 0) {
        runStart = i;
        runSumX = 0; runSumY = 0; runCount = 0;
      }
      runSumX += p.x;
      runSumY += p.y;
      runCount++;
    } else if (runStart >= 0) {
      // Emit bridge for completed run.
      const runEnd = i - 1;
      const arcLen = lengths[runEnd] - lengths[runStart];
      if (arcLen >= minOverlapLen && runCount >= 2) {
        const midS = (lengths[runStart] + lengths[runEnd]) * 0.5;
        results.push({
          strokeId: oldStroke.id,
          x: runSumX / runCount,
          y: runSumY / runCount,
          s: midS,
          otherWidth: oldStroke.width,
          angleSin: estimateOverlapAngleSin(center, oldStroke.center, runStart, runEnd),
          overlapSpan: arcLen,
        });
      }
      runStart = -1;
    }
  }

  // Flush any run that reaches the end of the centerline.
  if (runStart >= 0) {
    const runEnd = center.length - 1;
    const arcLen = lengths[runEnd] - lengths[runStart];
    if (arcLen >= minOverlapLen && runCount >= 2) {
      const midS = (lengths[runStart] + lengths[runEnd]) * 0.5;
      results.push({
        strokeId: oldStroke.id,
        x: runSumX / runCount,
        y: runSumY / runCount,
        s: midS,
        otherWidth: oldStroke.width,
        angleSin: estimateOverlapAngleSin(center, oldStroke.center, runStart, runEnd),
        overlapSpan: arcLen,
      });
    }
  }

  // De-dup: if a crossing intersection already covers this zone, skip.
  return deduplicateOverlapBridges(results, newStroke.bridgesOver, newStroke.width);
}

function deduplicateOverlapBridges(overlaps, existingBridges, width) {
  return overlaps.filter(ob => {
    for (const eb of existingBridges) {
      if (Math.hypot(ob.x - eb.x, ob.y - eb.y) < width * 0.7) return false;
    }
    return true;
  });
}

/** Estimate sine of crossing angle for an overlap zone. */
function estimateOverlapAngleSin(newCenter, oldCenter, iStart, iEnd) {
  // Use tangent at the midpoint of the overlap on each road.
  const mid = Math.floor((iStart + iEnd) / 2);
  const a0 = newCenter[Math.max(0, mid - 1)];
  const a1 = newCenter[Math.min(newCenter.length - 1, mid + 1)];

  // Find nearest point on old center to midpoint.
  const mp = newCenter[mid];
  let bestJ = 1;
  let bestDist = Infinity;
  for (let j = 1; j < oldCenter.length; j++) {
    const d = ptSegDist(mp, oldCenter[j - 1], oldCenter[j]);
    if (d < bestDist) { bestDist = d; bestJ = j; }
  }
  const b0 = oldCenter[Math.max(0, bestJ - 1)];
  const b1 = oldCenter[Math.min(oldCenter.length - 1, bestJ)];

  return crossingAngleSin(a0, a1, b0, b1);
}

function ptSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// ─── Existing helpers ────────────────────────────────────────────────

// Per-vertex unit normal pointing to the "left" side of travel.
function computeNormals(points, closed) {
  const n = points.length;
  const tangents = new Array(n);
  for (let i = 0; i < n; i++) {
    let prev, next;
    if (closed) {
      prev = points[(i - 1 + n) % n];
      next = points[(i + 1) % n];
    } else {
      prev = points[Math.max(0, i - 1)];
      next = points[Math.min(n - 1, i + 1)];
    }
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const l = Math.hypot(tx, ty) || 1;
    tangents[i] = { x: tx / l, y: ty / l };
  }
  return tangents.map(t => ({ x: -t.y, y: t.x }));
}

function buildGates(center, closed) {
  if (center.length < 2) return [];
  if (closed) {
    return [{ type: 'startFinish', index: 0, label: 'START / FINISH' }];
  }
  return [
    { type: 'start', index: 0, label: 'START' },
    { type: 'finish', index: center.length - 1, label: 'FINISH' },
  ];
}

function findSelfCrossings(center, lengths, closed, width) {
  const out = [];
  const n = center.length;
  const segCount = n - 1;
  if (segCount < 4) return out;
  const totalLength = lengths[lengths.length - 1] ?? 0;
  const nearMissTolerance = Math.max(8, width * 0.18);

  for (let i = 1; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // Adjacent segments share a vertex and are not crossings.
      if (Math.abs(i - j) <= 1) continue;
      // In closed loops, first and last segments are also adjacent.
      if (closed && i === 1 && j === n - 1) continue;

      const a0 = center[i - 1];
      const a1 = center[i];
      const b0 = center[j - 1];
      const b1 = center[j];
      const angleSin = crossingAngleSin(a0, a1, b0, b1);
      const exactHit = segIntersect(a0, a1, b0, b1);
      let hit = exactHit;
      let tA = exactHit?.tAB;
      let tB = null;

      if (exactHit) {
        tB = segmentParameter(exactHit, b0, b1);
      } else {
        const closest = closestPointsOnSegments(a0, a1, b0, b1);
        if (closest.dist > nearMissTolerance || angleSin < 0.18) continue;
        hit = {
          x: (closest.a.x + closest.b.x) * 0.5,
          y: (closest.a.y + closest.b.y) * 0.5,
        };
        tA = closest.tA;
        tB = closest.tB;
      }

      const segLenA = lengths[i] - lengths[i - 1];
      const sA = lengths[i - 1] + tA * segLenA;
      const segLenB = lengths[j] - lengths[j - 1];
      const sB = lengths[j - 1] + Math.max(0, Math.min(1, tB)) * segLenB;
      const arcGap = closed ? Math.min(Math.abs(sA - sB), totalLength - Math.abs(sA - sB)) : Math.abs(sA - sB);
      if (arcGap < width * 0.8) continue;
      const upperS = Math.max(sA, sB);
      const lowerS = Math.min(sA, sB);

      // De-dup near-identical crossings.
      let duplicate = false;
      for (const e of out) {
        if (Math.hypot(e.x - hit.x, e.y - hit.y) < 3) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) {
        out.push({
          x: hit.x,
          y: hit.y,
          upperS,
          lowerS,
          angleSin,
        });
      }
    }
  }
  return out;
}

function segmentParameter(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
}

function closestPointsOnSegments(a0, a1, b0, b1) {
  const ux = a1.x - a0.x;
  const uy = a1.y - a0.y;
  const vx = b1.x - b0.x;
  const vy = b1.y - b0.y;
  const wx = a0.x - b0.x;
  const wy = a0.y - b0.y;
  const a = ux * ux + uy * uy;
  const b = ux * vx + uy * vy;
  const c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy;
  const e = vx * wx + vy * wy;
  const denom = a * c - b * b;
  let tA = denom === 0 ? 0 : (b * e - c * d) / denom;
  let tB = denom === 0 ? 0 : (a * e - b * d) / denom;
  tA = Math.max(0, Math.min(1, tA));
  tB = Math.max(0, Math.min(1, tB));

  // Re-clamp each side after the other side moves to an endpoint.
  if (a > 0) tA = Math.max(0, Math.min(1, (b * tB - d) / a));
  if (c > 0) tB = Math.max(0, Math.min(1, (b * tA + e) / c));

  const pa = { x: a0.x + ux * tA, y: a0.y + uy * tA };
  const pb = { x: b0.x + vx * tB, y: b0.y + vy * tB };
  return {
    a: pa,
    b: pb,
    tA,
    tB,
    dist: Math.hypot(pa.x - pb.x, pa.y - pb.y),
  };
}

function crossingAngleSin(a0, a1, b0, b1) {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const al = Math.hypot(ax, ay) || 1;
  const bl = Math.hypot(bx, by) || 1;
  return Math.abs((ax / al) * (by / bl) - (ay / al) * (bx / bl));
}

function recalculateSelfBridgeLayers(stroke) {
  for (const bridge of stroke.bridgesOver ?? []) {
    if (!bridge.self || bridge.lowerS == null) continue;
    const upperS = preferredUpperS(stroke, bridge.s, bridge.lowerS);
    bridge.lowerS = upperS === bridge.s ? bridge.lowerS : bridge.s;
    bridge.s = upperS;
  }
}

function moveClosedStrokeStartAwayFromBridges(stroke) {
  if (!stroke.closed || stroke.center.length < 4) return;
  if (!(stroke.bridgesOver ?? []).length) return;
  const index = chooseSafeStartIndex(stroke);
  if (index <= 0) return;

  const oldTotalLength = stroke.totalLength;
  const offsetS = stroke.lengths[index];
  const points = stroke.center.slice(0, -1);
  stroke.center = [
    ...points.slice(index),
    ...points.slice(0, index),
  ];
  stroke.center.push({ ...stroke.center[0] });
  stroke.lengths = arcLengths(stroke.center);
  stroke.totalLength = stroke.lengths[stroke.lengths.length - 1];
  stroke.normals = computeNormals(stroke.center, true);
  const half = stroke.width / 2;
  stroke.left = stroke.center.map((p, i) => ({ x: p.x + stroke.normals[i].x * half, y: p.y + stroke.normals[i].y * half }));
  stroke.right = stroke.center.map((p, i) => ({ x: p.x - stroke.normals[i].x * half, y: p.y - stroke.normals[i].y * half }));
  stroke.gates = buildGates(stroke.center, true);

  for (const bridge of stroke.bridgesOver ?? []) {
    bridge.s = remapClosedArc(bridge.s, offsetS, oldTotalLength);
    if (bridge.lowerS != null) {
      bridge.lowerS = remapClosedArc(bridge.lowerS, offsetS, oldTotalLength);
    }
  }
}

function chooseSafeStartIndex(stroke) {
  const n = stroke.center.length - 1;
  const bridgePadding = stroke.width * 2.6;
  const window = Math.min(36, Math.max(8, Math.floor(n / 12)));
  let best = 0;
  let bestScore = Infinity;

  for (let i = 0; i < n; i++) {
    const s = stroke.lengths[i];
    const bridgeClearance = distanceToNearestBridgeZone(stroke, s) - bridgePadding;
    const bridgePenalty = bridgeClearance < 0 ? 100000 + Math.abs(bridgeClearance) * 100 : 0;
    const curvaturePenalty = localCurvature(stroke.center, i, window) * 1200;
    const score = bridgePenalty + curvaturePenalty - Math.max(0, bridgeClearance);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return best;
}

function distanceToNearestBridgeZone(stroke, s) {
  let nearest = Infinity;
  for (const bridge of stroke.bridgesOver ?? []) {
    const span = bridgeZoneSpan(stroke, bridge);
    nearest = Math.min(nearest, arcDistance(stroke, s, bridge.s) - span);
    if (bridge.lowerS != null) {
      nearest = Math.min(nearest, arcDistance(stroke, s, bridge.lowerS) - span);
    }
  }
  return nearest;
}

function isInBridgeZone(stroke, s) {
  return distanceToNearestBridgeZone(stroke, s) <= 0;
}

function sampleRoadAt(stroke, s) {
  const { center, lengths, totalLength } = stroke;
  if (center.length < 2 || totalLength <= 0) return null;
  const sc = Math.max(0, Math.min(totalLength, s));
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < sc) i++;
  const a = center[i - 1];
  const b = center[i];
  const segLen = lengths[i] - lengths[i - 1] || 1;
  const t = (sc - lengths[i - 1]) / segLen;
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const len = Math.hypot(tx, ty) || 1;
  return {
    p: { x: a.x + tx * t, y: a.y + ty * t },
    normal: { x: -ty / len, y: tx / len },
  };
}

function localCurvature(points, index, window) {
  const n = points.length - 1;
  const prev = points[(index - window + n) % n];
  const cur = points[index];
  const next = points[(index + window) % n];
  const ax = cur.x - prev.x;
  const ay = cur.y - prev.y;
  const bx = next.x - cur.x;
  const by = next.y - cur.y;
  const al = Math.hypot(ax, ay) || 1;
  const bl = Math.hypot(bx, by) || 1;
  const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (al * bl)));
  return Math.acos(dot);
}

function remapClosedArc(s, offset, totalLength) {
  return ((s - offset) % totalLength + totalLength) % totalLength;
}

function preferredUpperS(stroke, aS, bS) {
  const a = sampleTangentAt(stroke, aS);
  const b = sampleTangentAt(stroke, bS);
  if (a && b) {
    const aHorizontal = horizontalScore(a);
    const bHorizontal = horizontalScore(b);
    if (Math.abs(aHorizontal - bHorizontal) > 0.18) {
      return aHorizontal > bHorizontal ? aS : bS;
    }
  }
  return Math.max(aS, bS);
}

function horizontalScore(tangent) {
  const ax = Math.abs(tangent.x);
  const ay = Math.abs(tangent.y);
  return ax / (ax + ay || 1);
}

function sampleTangentAt(stroke, s) {
  const { center, lengths, totalLength } = stroke;
  if (center.length < 2 || totalLength <= 0) return null;
  const sc = Math.max(0, Math.min(totalLength, s));
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < sc) i++;
  const a = center[i - 1];
  const b = center[i];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/**
 * Detect stretches where the road runs parallel alongside itself (self-overlap).
 * For each center point, find the nearest point that is far in arc-length but
 * close in Euclidean distance.  Group consecutive such points into zones and
 * emit a bridge record for the section with higher arc-length (the "upper" pass).
 */
function findSelfOverlaps(center, lengths, closed, width) {
  const results = [];
  const n = center.length;
  if (n < 12) return results;

  const threshold = width * 1.6;   // centerline-to-centerline distance
  const minArcGap = width * 4.5;
  const totalLength = lengths[n - 1];

  // For each point, find closest distant-in-arc point.
  const nearIdx = new Array(n).fill(-1);
  const nearDist = new Array(n).fill(Infinity);

  for (let i = 0; i < n; i++) {
    const px = center[i].x, py = center[i].y;
    for (let j = 0; j < n; j++) {
      let arcD = Math.abs(lengths[j] - lengths[i]);
      if (closed) arcD = Math.min(arcD, totalLength - arcD);
      if (arcD < minArcGap) continue;

      const d = Math.hypot(px - center[j].x, py - center[j].y);
      if (d < nearDist[i] && d < threshold) {
        nearDist[i] = d;
        nearIdx[i] = j;
      }
    }
  }

  // Group consecutive overlapping points into runs.
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const overlapping = i < n && nearIdx[i] >= 0;
    if (overlapping && runStart < 0) {
      runStart = i;
    } else if (!overlapping && runStart >= 0) {
      emitSelfOverlapZone(results, center, lengths, nearIdx, runStart, i - 1, width, totalLength);
      runStart = -1;
    }
  }

  return results;
}

function emitSelfOverlapZone(results, center, lengths, nearIdx, runStart, runEnd, width, totalLength) {
  const arcLen = lengths[runEnd] - lengths[runStart];
  if (arcLen < width * 0.25) return; // too short

  // Average target arc position.
  let sumTargetS = 0, count = 0;
  for (let k = runStart; k <= runEnd; k++) {
    const j = nearIdx[k];
    if (j >= 0) { sumTargetS += lengths[j]; count++; }
  }
  if (count === 0) return;

  const myS = (lengths[runStart] + lengths[runEnd]) * 0.5;
  const targetS = sumTargetS / count;

  // Only emit the bridge from the section with higher arc-length.
  if (myS <= targetS) return;

  const midIdx = Math.floor((runStart + runEnd) / 2);

  // Estimate crossing angle between the two parallel sections.
  const a0 = center[Math.max(0, midIdx - 2)];
  const a1 = center[Math.min(center.length - 1, midIdx + 2)];
  const tIdx = nearIdx[midIdx];
  const b0 = center[Math.max(0, tIdx - 2)];
  const b1 = center[Math.min(center.length - 1, tIdx + 2)];

  // Dedup against already-emitted zones.
  for (const prev of results) {
    if (Math.hypot(prev.x - center[midIdx].x, prev.y - center[midIdx].y) < width * 0.8) return;
  }

  results.push({
    x: center[midIdx].x,
    y: center[midIdx].y,
    upperS: myS,
    lowerS: targetS,
    angleSin: crossingAngleSin(a0, a1, b0, b1),
    overlapSpan: arcLen,
  });
}

/**
 * Shifts the center array of a closed track so that the start/finish line (index 0)
 * falls exactly in the middle of the straightest section of the track.
 */
function shiftToStraight(center) {
  const n = center.length - 1;
  const angles = [];
  for (let i = 0; i < n; i++) {
    const p1 = center[i];
    const p2 = center[(i + 1) % n];
    angles.push(Math.atan2(p2.y - p1.y, p2.x - p1.x));
  }
  
  const angleDiffs = [];
  for (let i = 0; i < n; i++) {
    const a1 = angles[i];
    const a2 = angles[(i + 1) % n];
    let diff = Math.abs(a2 - a1);
    while (diff > Math.PI) diff -= Math.PI * 2;
    angleDiffs.push(Math.abs(diff));
  }
  
  // Find a window of points with minimum sum of angle diffs (the straightest part)
  const windowSize = Math.min(40, Math.floor(n / 4));
  let bestSum = Infinity;
  let bestIdx = 0;
  
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      sum += angleDiffs[(i + j) % n];
    }
    if (sum < bestSum) {
      bestSum = sum;
      bestIdx = (i + Math.floor(windowSize / 2)) % n;
    }
  }
  
  const shifted = [];
  for (let i = 0; i < n; i++) {
    shifted.push(center[(bestIdx + i) % n]);
  }
  shifted.push({ ...shifted[0] });
  return shifted;
}
