# Performance Optimizations Summary

## Problem
At 16x simulation speed, the application lagged due to:
1. **Sensor raycasting**: brute-force O(N) wall scan per sensor per agent per tick
2. **Car rendering**: 30-50 procedural canvas calls per car per frame
3. **Redundant bridge computations**: from previous session

## Changes Made

### 1. Spatial Grid for Wall Segments (`simulation.js`)

> [!IMPORTANT]
> This is the single largest performance win — estimated **10-30× speedup** for sensor casting.

- Added `WallGrid` class: uniform spatial grid that partitions wall segments into cells
- Cell size tuned to `SENSOR_RANGE` (~144px) so most sensor rays cross only 2-4 cells
- `queryRay()` uses AABB cell walk with stamp-based dedup (no Set allocation)
- Reusable `_queryBuf` array eliminates ~4300 array allocations per frame at 16x
- `buildWallCache` now builds per-elevation `WallGrid` instances instead of flat arrays
- `castSensors` and `segmentHitsWalls` both use grid-accelerated queries

**Before**: 8 sensors × ~1000 walls × 30 agents × 16 ticks = **~3.8M ray-segment tests/frame**  
**After**: 8 sensors × ~20-40 walls × 30 agents × 16 ticks = **~150K ray-segment tests/frame**

### 2. Car Sprite Caching (`carSprite.js`)

- Each unique `(modelId, color, scale)` combo is pre-rendered to an off-screen canvas
- Simulation frames use a single `drawImage` blit per car instead of 30-50 procedural calls
- Brake lights drawn as overlay only when car is actually braking (brake > 0.18)
- Cache key includes scale, so preview (0.86) and sim (0.25) sprites are separate entries

**Before**: 30 cars × ~35 canvas operations = **~1050 draw calls/frame**  
**After**: 30 cars × 1 drawImage + occasional brake overlay = **~35 draw calls/frame**

### 3. Bridge Deck Overlay Caching (`render.js`) — from previous session

- Per-elevation off-screen canvases cache the expensive bridge deck rendering
- `_ensureBridgeCaches()` builds/reuses canvases keyed by track stamp + view toggles
- `_getBridgeLayers()` caches `collectBridgeLayers` results
- Bridge shadows changed from `darken` to `source-over` for off-screen canvas compatibility

### 4. Bridge Zone Span Caching (`bridges.js`) — from previous session  

- `cachedBridgeZoneSpan()` with WeakMap eliminates redundant trig across hundreds of calls
- Redundant `bridgeStateAt` call in `updateFitness` eliminated by passing pre-computed elevation

## Files Modified

| File | Changes |
|------|---------|
| [simulation.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/simulation.js) | WallGrid spatial index, reusable query buffer, grid-accelerated sensors/collisions |
| [carSprite.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/carSprite.js) | Off-screen sprite cache, brake-only overlay rendering |
| [render.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/render.js) | Bridge deck overlay caching, bridge layer result caching |
| [bridges.js](file:///c:/Users/golov/Documents/samochodziki_v2/src/bridges.js) | Bridge zone span caching |
