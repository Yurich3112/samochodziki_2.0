// Centripetal Catmull-Rom smoothing + uniform arc-length resampling.
// The centripetal form avoids overshoot loops on sharp corners.

function distPow(a, b, alpha = 0.5) {
  return Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha);
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function safePoint(p) {
  return { x: Number.isFinite(p.x) ? p.x : 0, y: Number.isFinite(p.y) ? p.y : 0 };
}

function catmullRomCentripetal(p0, p1, p2, p3, t) {
  const t0 = 0;
  const t1 = t0 + Math.max(1e-4, distPow(p0, p1));
  const t2 = t1 + Math.max(1e-4, distPow(p1, p2));
  const t3 = t2 + Math.max(1e-4, distPow(p2, p3));
  const tt = t1 + (t2 - t1) * t;

  const a1 = lerp(p0, p1, (tt - t0) / (t1 - t0));
  const a2 = lerp(p1, p2, (tt - t1) / (t2 - t1));
  const a3 = lerp(p2, p3, (tt - t2) / (t3 - t2));
  const b1 = lerp(a1, a2, (tt - t0) / (t2 - t0));
  const b2 = lerp(a2, a3, (tt - t1) / (t3 - t1));
  return safePoint(lerp(b1, b2, (tt - t1) / (t2 - t1)));
}

export function smoothPath(points, samplesPerSegment = 10, isClosed = false) {
  if (points.length < 2) return points.slice();
  if (points.length === 2) return points.slice();
  
  let pad;
  if (isClosed) {
    // Wrap around for seamless centripetal spline
    pad = [
      points[points.length - 2], 
      ...points, 
      points[1], 
      points[2]
    ];
  } else {
    pad = [points[0], ...points, points[points.length - 1]];
  }

  const out = [];
  // For closed, we evaluate exactly points.length - 1 segments
  const limit = isClosed ? points.length - 1 : pad.length - 3;
  // If closed, the first actual segment starts at pad[1] to pad[2], which is points[0] to points[1].
  // pad[0] is points[len-2], pad[1] is points[0], pad[2] is points[1], pad[3] is points[2].
  const startIdx = isClosed ? 0 : 0;
  
  for (let i = startIdx; i < limit + startIdx; i++) {
    for (let j = 0; j < samplesPerSegment; j++) {
      out.push(catmullRomCentripetal(pad[i], pad[i + 1], pad[i + 2], pad[i + 3], j / samplesPerSegment));
    }
  }
  
  if (!isClosed) {
    out.push(points[points.length - 1]);
  } else {
    out.push({ ...out[0] }); // Ensure exact closure
  }
  return out;
}

export function smoothUserInput(points, minDist = 8, passes = 2, isClosed = false) {
  if (points.length < 3) return points.slice();

  const cleaned = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) {
      cleaned.push(points[i]);
    }
  }
  
  if (!isClosed) {
    const final = points[points.length - 1];
    const last = cleaned[cleaned.length - 1];
    if (last && Math.hypot(final.x - last.x, final.y - last.y) > minDist * 0.35) {
      cleaned.push(final);
    }
  } else {
    // Closed paths are smoothed as a true ring. If we leave a duplicate endpoint
    // in the working list, the first/last join behaves like a pinned corner.
    const last = cleaned[cleaned.length - 1];
    if (last && Math.hypot(last.x - cleaned[0].x, last.y - cleaned[0].y) < minDist * 1.5) {
      cleaned.pop();
    }
  }

  let out = cleaned;
  for (let pass = 0; pass < passes; pass++) {
    if (out.length < 3) break;
    const next = [];
    
    if (isClosed) {
      const n = out.length;
      for (let i = 0; i < n; i++) {
        const a = out[i];
        const b = out[(i + 1) % n];
        next.push({
          x: a.x * 0.75 + b.x * 0.25,
          y: a.y * 0.75 + b.y * 0.25,
        });
        next.push({
          x: a.x * 0.25 + b.x * 0.75,
          y: a.y * 0.25 + b.y * 0.75,
        });
      }
    } else {
      // Open path: pin the endpoints
      next.push(out[0]);
      for (let i = 0; i < out.length - 1; i++) {
        const a = out[i];
        const b = out[i + 1];
        next.push({
          x: a.x * 0.75 + b.x * 0.25,
          y: a.y * 0.75 + b.y * 0.25,
        });
        next.push({
          x: a.x * 0.25 + b.x * 0.75,
          y: a.y * 0.25 + b.y * 0.75,
        });
      }
      next.push(out[out.length - 1]);
    }
    
    out = next;
  }
  if (isClosed) out.push({ ...out[0] });
  return out;
}

// Resample a polyline to roughly uniform arc-length spacing.
export function resample(points, spacing, isClosed = false) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let prev = points[0];
  let i = 1;
  let remaining = spacing;
  while (i < points.length) {
    const dx = points[i].x - prev.x;
    const dy = points[i].y - prev.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) { i++; continue; }
    if (segLen >= remaining) {
      const t = remaining / segLen;
      const np = { x: prev.x + dx * t, y: prev.y + dy * t };
      out.push(np);
      prev = np;
      remaining = spacing;
    } else {
      remaining -= segLen;
      prev = points[i];
      i++;
    }
  }
  
  if (isClosed) {
    // If closed, the exact final point must be identical to the start
    out.push({ ...out[0] });
  } else {
    const last = out[out.length - 1];
    const final = points[points.length - 1];
    if (Math.hypot(final.x - last.x, final.y - last.y) > spacing * 0.4) {
      out.push(final);
    }
  }
  return out;
}

// Distance from point (px,py) to segment a->b.
export function pointToSegmentDist(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

// Robust intersection of segment [a,b] with [c,d]. Returns {x,y,tAB} or null.
export function segIntersect(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t, tAB: t };
}

// Arc length of polyline.
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

// Build cumulative arc-length table for a polyline.
export function arcLengths(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return out;
}
