export function bridgeSpanFor(roadWidth, lowerWidth = roadWidth, angleSin = 1) {
  const sin = Math.max(0.28, Math.min(1, angleSin || 1));
  const projectedHalfWidth = Math.min(lowerWidth * 1.9, lowerWidth / (2 * sin));
  return projectedHalfWidth + roadWidth * 0.5;
}

export function bridgeZoneSpan(stroke, bridge) {
  if (bridge.overlapSpan != null) {
    return bridge.overlapSpan * 0.5 + stroke.width * 0.85;
  }
  return bridgeSpanFor(stroke.width, bridge.otherWidth ?? stroke.width, bridge.angleSin) + stroke.width * 0.85;
}

// Hot-path optimisation: cache computed spans directly on the bridge object.
function cachedBridgeZoneSpan(stroke, bridge) {
  if (bridge._cachedSpan === undefined) {
    bridge._cachedSpan = bridgeZoneSpan(stroke, bridge);
  }
  return bridge._cachedSpan;
}

export function bridgeElevation(stroke, s) {
  return surfaceLevelAt(stroke, s, resolvedBridgeLevels(stroke));
}

export function bridgeVisualElevation(stroke, s, margin = 0) {
  return surfaceLevelAt(stroke, s, resolvedBridgeLevels(stroke), null, margin);
}

export function bridgeStateAt(stroke, s) {
  const bridges = stroke.bridgesOver ?? [];
  const levels = resolvedBridgeLevels(stroke);
  const elevation = surfaceLevelAt(stroke, s, levels);
  let upperState = null;
  let lowerState = null;

  for (let i = 0; i < bridges.length; i++) {
    const bridge = bridges[i];
    if (!bridge.self || bridge.lowerS == null) continue;
    const span = cachedBridgeZoneSpan(stroke, bridge);
    const upperDist = arcDistance(stroke, s, bridge.s);
    let lowerDist = -1;
    
    if (upperDist <= span) {
      lowerDist = arcDistance(stroke, s, bridge.lowerS);
      if (upperDist <= lowerDist) {
        const bridgeElevation = levels.get(bridge) ?? elevation;
        if (!upperState || bridgeElevation > upperState.elevation) {
          upperState = { layer: 'upper', bridge, span, index: i, elevation: bridgeElevation };
        }
        continue;
      }
    }
    
    if (lowerDist === -1) lowerDist = arcDistance(stroke, s, bridge.lowerS);
    if (lowerDist <= span && lowerDist < upperDist) {
      if (!lowerState || elevation > lowerState.elevation) {
        lowerState = { layer: 'lower', bridge, span, index: i, elevation };
      }
    }
  }

  if (upperState) return upperState;
  if (lowerState) return lowerState;
  return { layer: 'normal', bridge: null, span: 0, index: -1, elevation };
}

export function bridgeDeckElevation(stroke, bridge) {
  return resolvedBridgeLevels(stroke).get(bridge) ?? Math.max(1, bridgeElevation(stroke, bridge.s));
}

export function collectBridgeLayers(strokes) {
  const bridgeLayers = new Map();
  let maxElevation = 0;

  for (const stroke of strokes) {
    for (const bridge of stroke.bridgesOver ?? []) {
      const elevation = bridgeDeckElevation(stroke, bridge);
      maxElevation = Math.max(maxElevation, elevation);
      if (!bridgeLayers.has(elevation)) bridgeLayers.set(elevation, []);
      bridgeLayers.get(elevation).push({ s: stroke, b: bridge });
    }
  }

  for (const bridges of bridgeLayers.values()) {
    bridges.sort((a, b) => bridgeUnderCount(b.s, b.b) - bridgeUnderCount(a.s, a.b));
  }

  return { bridgeLayers, maxElevation };
}

function bridgeUnderCount(stroke, bridge) {
  if (!bridge.self) return 0;
  let count = 0;
  for (const other of stroke.bridgesOver ?? []) {
    if (other === bridge || !other.self || other.lowerS == null) continue;
    const span = cachedBridgeZoneSpan(stroke, other);
    if (arcDistance(stroke, bridge.s, other.lowerS) <= span) {
      count += 1;
    }
  }
  return count;
}

function resolvedBridgeLevels(stroke) {
  const bridges = (stroke.bridgesOver ?? []).filter(bridge => bridge.self && bridge.lowerS != null);
  const cached = stroke._bridgeLevelCache;
  if (cached?.bridges === stroke.bridgesOver && cached.count === bridges.length) {
    return cached.levels;
  }

  const levels = new Map();
  for (const bridge of bridges) levels.set(bridge, 1);

  for (let pass = 0; pass < bridges.length; pass++) {
    let changed = false;
    for (const bridge of bridges) {
      const lowerLevel = bridgeSupportLevel(stroke, bridge, levels);
      const nextLevel = lowerLevel + 1;
      if ((levels.get(bridge) ?? 1) < nextLevel) {
        levels.set(bridge, nextLevel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  stroke._bridgeLevelCache = { bridges: stroke.bridgesOver, count: bridges.length, levels };
  return levels;
}

function bridgeSupportLevel(stroke, bridge, levels) {
  let level = surfaceLevelAt(stroke, bridge.lowerS, levels, bridge);
  const contactMargin = stroke.width * 0.45;
  const lowerSpan = cachedBridgeZoneSpan(stroke, bridge) + contactMargin;

  for (const other of stroke.bridgesOver ?? []) {
    if (other === bridge || !other.self || other.lowerS == null) continue;
    const span = cachedBridgeZoneSpan(stroke, other) + contactMargin;
    // If this bridge's lower pass sits on another bridge deck, it must be one
    // level above that deck, not merely one level above ground.
    if (arcDistance(stroke, bridge.lowerS, other.s) <= lowerSpan + span) {
      level = Math.max(level, levels.get(other) ?? 1);
    }

    // Adjacent upper zones (e.g. figure-8): if two bridges' elevated decks
    // overlap or are nearly contiguous on the road, one must be raised above
    // the other so they don't visually merge at the same level.
    const upperGap = arcDistance(stroke, bridge.s, other.s);
    const upperOverlapThreshold = cachedBridgeZoneSpan(stroke, bridge) + cachedBridgeZoneSpan(stroke, other) + stroke.width * 0.5;
    if (upperGap < upperOverlapThreshold) {
      // The bridge whose upper-s comes later on the road goes on top.
      // For closed tracks, compare by which direction is "forward".
      const bridgeIsLater = bridge.s > other.s;
      if (bridgeIsLater) {
        level = Math.max(level, levels.get(other) ?? 1);
      }
    }
  }

  return level;
}

function surfaceLevelAt(stroke, s, levels, ignoreBridge = null, margin = 0) {
  let level = 0;
  const bridges = stroke.bridgesOver ?? [];
  for (let i = 0; i < bridges.length; i++) {
    const bridge = bridges[i];
    if (bridge === ignoreBridge || !bridge.self || bridge.lowerS == null) continue;
    const span = cachedBridgeZoneSpan(stroke, bridge) + margin;
    const upperDist = arcDistance(stroke, s, bridge.s);
    if (upperDist > span) continue;
    const lowerDist = arcDistance(stroke, s, bridge.lowerS);
    if (upperDist <= lowerDist) {
      level = Math.max(level, levels.get(bridge) ?? 1);
    }
  }
  return level;
}

function isUpperBridgeZone(stroke, bridge, s, span = bridgeZoneSpan(stroke, bridge)) {
  const upperDist = arcDistance(stroke, s, bridge.s);
  if (upperDist > span) return false;
  const lowerDist = arcDistance(stroke, s, bridge.lowerS);
  return upperDist <= lowerDist;
}

function isLowerBridgeZone(stroke, bridge, s, span = bridgeZoneSpan(stroke, bridge)) {
  const lowerDist = arcDistance(stroke, s, bridge.lowerS);
  if (lowerDist > span) return false;
  const upperDist = arcDistance(stroke, s, bridge.s);
  return lowerDist < upperDist;
}

export function arcDistance(stroke, a, b) {
  const d = Math.abs(a - b);
  return stroke.closed ? Math.min(d, stroke.totalLength - d) : d;
}
