# Changes Summary — Session 2026-05-11

## Files Modified

| File | Changes |
|---|---|
| [render.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/render.js) | Rendering pipeline optimizations, bridge shadow rework |
| [simulation.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/simulation.js) | Simulation hot-path optimizations for 16x speed |
| [brain.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/brain.js) | Pre-allocated NN buffers |
| [carSprite.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/carSprite.js) | Path2D cache, brake light fix, darken cache |
| [main.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/main.js) | 16x time scale, `isLastTick` batching |
| [bridges.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/bridges.js) | Adjacent upper-zone elevation fix |
| [track.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/track.js) | Self-overlap dedup fix |

---

## 1. Performance Optimizations

### Rendering Pipeline (`render.js`, `carSprite.js`)

| What | Before → After | Impact |
|---|---|---|
| **Off-screen canvas caching** | Full track redrawn every frame → Static scene cached, blitted with single `drawImage()` | 🔴 Huge — eliminates hundreds of stroke/fill calls per frame during simulation |
| **`sampleAt()` binary search** | Linear O(n) scan → O(log n) binary search | 🔴 High — called hundreds of times per frame |
| **Eliminated `ctx.filter='blur()'`** on tree/tyre shadows | CSS blur per prop → Layered semi-transparent ellipses | 🔴 High — CSS blur triggers compositor flushes |
| **`Path2D` caching** | ~900 `new Path2D(svgString)` per frame → Cached, parsed once | 🟡 Medium |
| **Eliminated `ctx.shadowBlur`** on brake lights | Software-rasterized shadow → Gradient halo | 🟡 Medium |
| **Batched skid marks** | ~520 individual strokes → ~10 batches by quantized alpha | 🟡 Medium |
| **`darken()` memoization** | Hex parse every call → Cached results | 🟢 Low |
| **Tree variant limit** | 32 (28 404s) → 6 (matching actual assets 3–6) | 🟢 Low |

### Simulation Hot Path (`simulation.js`, `brain.js`, `main.js`)

| What | Before → After | Impact |
|---|---|---|
| **16x time scale** | Max 8x → Cycles through 1x/2x/4x/8x/16x | Feature |
| **`isLastTick` skipping** | Visual work every tick → Skid marks, render elevation, leader selection, skid trim skipped on 15/16 ticks | 🔴 High |
| **Pre-allocated input buffer** | `[...sensors.map(), speed, angle]` per agent per tick → Shared `Float64Array` | 🟡 Medium |
| **Pre-allocated NN buffers** | `new Array(HIDDEN)` + `new Array(OUTPUTS)` per `think()` → Instance `Float64Array` fields | 🟡 Medium |
| **`nearestCenterline` optimization** | Object allocation per inner-loop iteration + `Math.hypot` calls → Scalar variables + inline `sqrt(dx²+dy²)` | 🟡 Medium |
| **Early generation advance** | `.every()` re-scan → `anyAlive` flag | 🟢 Low |
| **Early exit on generation end** | Frame loop continues all 16 ticks → Breaks if generation advances mid-batch | 🟢 Low |

---

## 2. Bridge Elevation Fix (`bridges.js`)

**Problem:** Figure-8 tracks with two adjacent crossings rendered both bridges at the same elevation level — visually overlapping.

**Root cause:** `bridgeSupportLevel()` only checked if a bridge's **lower** pass sat under another bridge's **upper** zone. In a figure-8, the two crossings have adjacent **upper** zones without either's lower pass being under the other.

**Fix:** Added upper-zone overlap detection — when `arcDistance(bridge.s, other.s) < spanA + spanB + margin`, the bridge with the later arc-length position gets elevated above the other.

---

## 3. Bridge Shadow Rework (`render.js`)

**Problem:** Bridge shadows were too dark and stacked additively when multiple bridges overlapped.

**Fixes:**
- Rewrote `drawBridgeShadow` — replaced `ctx.shadowBlur` (expensive, uncontrollable) with 3 concentric stroke bands at low opacity (0.08 / 0.12 / 0.14)
- Added `globalCompositeOperation = 'darken'` so overlapping shadows clamp to the darkest single value instead of summing
- Reduced ground road drop shadow: `0.45` → `0.25` alpha

---

## 4. Spurious Bridge Records Fix (`track.js`)

**Problem:** Self-overlap detection created extra bridge records near self-crossing points, causing "bridge underneath" artifacts.

**Root cause:** Dedup only compared `b.s` (upper) against `ov.upperS`. Overlaps detected near `b.lowerS` slipped through.

**Fix:** Now checks all four combinations (`b.s`↔`ov.upperS`, `b.lowerS`↔`ov.upperS`, `b.s`↔`ov.lowerS`, `b.lowerS`↔`ov.lowerS`) with a wider radius (`width * 2.0` → `width * 3.5`).
