import { GeneticAlgorithm } from './brain.js';
import { bridgeElevation, bridgeStateAt, bridgeVisualElevation, arcDistance } from './bridges.js';
import { getCarModel } from './carModels.js';

const SENSOR_ANGLES = [-0.9, -0.55, -0.25, 0, 0.25, 0.55, 0.9, Math.PI];
const SENSOR_RANGE = 170;
const CAR_LENGTH = 34;
const CAR_WIDTH = 17;
const CAR_BRIDGE_VISUAL_MARGIN = CAR_LENGTH * 0.95;
const COLORS = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#a855f7', '#fb923c', '#f8fafc', '#14b8a6'];
const FINISH_REWARD = 100000;
const STAGE_LEARNING = 'learning';
const STAGE_RACE = 'race';

export class Simulation {
  constructor(track) {
    this.track = track;
    this.ga = new GeneticAlgorithm(30);
    this.running = false;
    this.trackStroke = null;
    this.wallSegments = [];
    this.wallCache = null;
    this.agents = [];
    this.leader = null;
    this.generationTime = 0;
    this.timeScale = 1;
    this.generationHistory = [];
    this.progressBenchmark = 0;
    this.skidMarks = [];
    this.status = 'IDLE';
    this.stage = STAGE_LEARNING;
    this.bestTrackTime = Infinity;
    this.bestTimes = [];
    this.selectedCarModelId = 'sport';
    this.carSelectionLocked = false;
  }

  start() {
    if (!this.prepare()) return false;
    this.running = true;
    this.carSelectionLocked = true;
    this.status = statusForStage(this.stage);
    return true;
  }

  prepare() {
    if (!this.track.strokes.length) {
      this.status = 'DRAW TRACK FIRST';
      return false;
    }
    const selected = selectTrackStroke(this.track);
    if (this.trackStroke !== selected || this.agents.length === 0) {
      if (this.trackStroke !== selected) {
        this.resetStageProgress();
        this.carSelectionLocked = false;
      }
      this.trackStroke = selected;
      this.spawnGeneration();
    }
    if (!this.running) this.status = 'READY';
    return true;
  }

  stop() {
    this.running = false;
    this.status = 'PAUSED';
  }

  toggle() {
    if (this.running) {
      this.stop();
      return true;
    }
    return this.start();
  }

  reset() {
    this.ga = new GeneticAlgorithm(30);
    this.generationHistory = [];
    this.progressBenchmark = 0;
    this.skidMarks = [];
    this.generationTime = 0;
    this.resetStageProgress();
    this.spawnGeneration();
    this.running = false;
    this.carSelectionLocked = false;
    this.status = 'READY';
  }

  resetStageProgress() {
    this.stage = STAGE_LEARNING;
    this.bestTrackTime = Infinity;
    this.bestTimes = [];
  }

  setCarModel(id) {
    if (this.carSelectionLocked) return false;
    if (getCarModel(id).id !== id) return false;
    this.selectedCarModelId = id;
    if (this.trackStroke && this.agents.length) this.spawnGeneration();
    return true;
  }

  skipGeneration() {
    if (!this.prepare()) return false;
    this.carSelectionLocked = true;
    this.running = true;
    this.advanceGeneration();
    return true;
  }

  spawnGeneration() {
    if (!this.trackStroke) this.trackStroke = selectTrackStroke(this.track);
    if (!this.trackStroke) return;
    
    if (!this.wallSegments || this._lastWallStroke !== this.trackStroke) {
      this.wallSegments = buildWallSegments(this.trackStroke);
      this.wallCache = new WallGrid(this.wallSegments);
      this._lastWallStroke = this.trackStroke;
    }
    this.generationTime = 0;
    this.progressBenchmark = bestHistoricalDistance(this.generationHistory);
    this.skidMarks = this.skidMarks.slice(-250);

    const start = this.trackStroke.center[0];
    const next = this.trackStroke.center[1] ?? start;
    const heading = Math.atan2(next.y - start.y, next.x - start.x);
    this.agents = this.ga.networks.map((brain, i) => ({
      id: i,
      brain,
      color: COLORS[i % COLORS.length],
      modelId: this.selectedCarModelId,
      x: start.x,
      y: start.y,
      prevX: start.x,
      prevY: start.y,
      heading,
      velocity: 0,
      steer: 0,
      steerLeft: 0,
      steerRight: 0,
      throttle: 0,
      brake: 0,
      alive: true,
      crashed: false,
      finished: false,
      finishTime: null,
      progress: 0,
      lap: 0,
      bestS: 0,
      lastS: 0,
      centerIndex: 1,
      totalProgress: 0,
      maxProgress: 0,
      reward: 1,
      fitness: 1,
      idleTime: 0,
      speedScore: 0,
      speedSamples: 0,
      peakProgressSpeed: 0,
      crashSpeed: 0,
      elevation: 0,
      renderElevation: 0,
      sensors: SENSOR_ANGLES.map(() => SENSOR_RANGE),
      sensorHits: [],
      age: 0,
    }));
    this.leader = this.agents[0] ?? null;
  }

  update(dt, isLastTick = true) {
    if (!this.running || !this.trackStroke) return;
    const step = Math.min(dt, 1 / 30);
    this.generationTime += step;

    if (this.timeScale > 1 && this.skidMarks.length > 0) {
      this.skidMarks = [];
    }

    let firstFinisher = null;
    let anyAlive = false;
    const activeSkids = this.timeScale === 1 ? this.skidMarks : null;
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      anyAlive = true;
      updateAgent(agent, this.trackStroke, this.wallSegments, this.wallCache, step, activeSkids, this.progressBenchmark, this.stage, isLastTick);
      if (agent.finished && !firstFinisher) {
        firstFinisher = agent;
      }
      if (agent.finished) {
        this.recordBestTrackTime(agent);
      }
    }

    if (firstFinisher && this.stage === STAGE_LEARNING) {
      this.leader = firstFinisher;
      this.advanceGeneration(STAGE_RACE);
      return;
    }

    // Only update leader / trim skids on the last tick of a batch — they're visual-only.
    if (isLastTick) {
      this.leader = selectStageLeader(this.agents, this.stage);
      trimSkids(this.skidMarks);
    }

    if (!anyAlive) {
      this.advanceGeneration();
    }
  }

  advanceGeneration(nextStage = this.stage) {
    this.recordGeneration();
    this.stage = nextStage;
    this.ga.nextGeneration(this.agents);
    this.spawnGeneration();
    this.status = statusForStage(this.stage);
  }

  recordGeneration() {
    if (!this.agents.length) return;
    const best = selectGenerationWinner(this.agents, this.stage);
    const bestTime = minFinishTime(this.agents);
    this.generationHistory.push({
      generation: this.ga.generation,
      stage: this.stage,
      distance: Math.max(...this.agents.map(a => a.maxProgress ?? 0)),
      fitness: best.fitness,
      finished: !!best.finished,
      bestTime,
    });
    if (this.generationHistory.length > 80) this.generationHistory.shift();
  }

  recordBestTrackTime(agent) {
    if (!Number.isFinite(agent.finishTime)) return;
    if (this.bestTimes.some(result => result.generation === this.ga.generation && result.carId === agent.id)) return;
    this.bestTrackTime = Math.min(this.bestTrackTime, agent.finishTime);
    this.bestTimes.push({
      generation: this.ga.generation,
      carId: agent.id,
      time: agent.finishTime,
    });
    this.bestTimes.sort((a, b) => a.time - b.time);
    if (this.bestTimes.length > 12) this.bestTimes.length = 12;
  }

  getStats() {
    const active = this.agents.filter(a => a.alive).length;
    const bestFitness = Math.max(this.ga.bestFitness, ...this.agents.map(a => a.fitness));
    const bestDistance = Math.max(0, ...this.agents.map(a => a.maxProgress ?? 0), ...this.generationHistory.map(g => g.distance ?? 0));
    const leaderProgress = progressPercent(this.leader, this.trackStroke);
    return {
      status: this.status,
      stage: this.stage,
      selectedCarModel: getCarModel(this.selectedCarModelId),
      carSelectionLocked: this.carSelectionLocked,
      generation: this.ga.generation,
      active,
      total: this.agents.length,
      generationTime: this.generationTime,
      progress: leaderProgress,
      bestFitness,
      bestDistance,
      bestTrackTime: Number.isFinite(this.bestTrackTime) ? this.bestTrackTime : null,
      bestTimes: this.bestTimes,
      leaderFitness: this.leader?.fitness ?? 0,
      trackLength: this.trackStroke?.totalLength ?? 0,
      history: this.generationHistory,
      timeScale: this.timeScale,
    };
  }
}

// Pre-allocated input buffer — avoids creating a new array with spread+map
// on every tick for every agent (480 allocations/frame at 16x → 0).
const _inputBuf = new Float64Array(SENSOR_ANGLES.length + 2);

function updateAgent(agent, stroke, walls, wallCache, dt, skidMarks, progressBenchmark = 0, stage = STAGE_LEARNING, isLastTick = true) {
  const carModel = getCarModel(agent.modelId);
  const physics = carModel.physics;
  const maxVelocity = 310 * physics.topSpeed;
  agent.age += dt;
  agent.prevX = agent.x;
  agent.prevY = agent.y;
  const prevVelocity = agent.velocity;
  const prevSteer = agent.steer;

  const speedNorm = clamp(agent.velocity / (270 * physics.topSpeed), -1, 1);
  const center = nearestCenterline(stroke, agent.x, agent.y, agent.lastS);
  agent.centerIndex = center.index;
  const bridgeState = bridgeStateAt(stroke, center.s);
  agent.elevation = bridgeState.elevation;
  castSensors(agent, stroke, wallCache, agent.sensors, agent.sensorHits);
  const angleToRoad = wrapAngle(center.heading - agent.heading) / Math.PI;

  // Fill pre-allocated input buffer instead of allocating a new array.
  const sLen = SENSOR_ANGLES.length;
  const invRange = 1 / SENSOR_RANGE;
  for (let si = 0; si < sLen; si++) _inputBuf[si] = agent.sensors[si] * invRange;
  _inputBuf[sLen] = speedNorm;
  _inputBuf[sLen + 1] = angleToRoad;
  const [leftOut, rightOut, gasOut, brakeOut] = agent.brain.think(_inputBuf);

  const steerLeft = positiveOutput(leftOut);
  const steerRight = positiveOutput(rightOut);
  const targetSteer = clamp(steerRight - steerLeft, -1, 1);
  agent.steerLeft = steerLeft;
  agent.steerRight = steerRight;
  // Tighter corners need quicker steer response; |angleToRoad|≈1 is ~180° misalignment.
  const steerUrgency = 7 + 26 * Math.min(1, Math.abs(angleToRoad) * 1.35);
  agent.steer += (targetSteer - agent.steer) * Math.min(1, dt * steerUrgency);
  const throttle = positiveOutput(gasOut);
  const brake = positiveOutput(brakeOut);
  agent.throttle = throttle;
  agent.brake = brake;
  const rollingDrag = 28 + agent.velocity * (0.035 / physics.topSpeed);
  const accel = throttle * 285 * physics.acceleration - brake * 540 * physics.braking - rollingDrag;
  agent.velocity += accel * dt;
  agent.velocity *= Math.pow(0.985, dt * 60);
  if (brake > 0.25 && agent.velocity < 6) agent.velocity = 0;
  agent.velocity = clamp(agent.velocity, 0, maxVelocity);

  const turnRate = agent.steer * ((3.15 * physics.handling) / (1 + Math.abs(agent.velocity) * 0.0065));
  // Turn rate must be 0 when stationary so cars can't spin in place.
  // Ramp up turn factor linearly at low speeds, then cap at higher speeds.
  const absVel = Math.abs(agent.velocity);
  const turnSpeedFactor = clamp(absVel / 45, 0, 1.18);
  agent.heading += turnRate * dt * turnSpeedFactor;
  const drift = clamp(Math.abs(agent.steer) * absVel / (260 * physics.grip), 0, 1);
  const moveHeading = agent.heading - agent.steer * drift * (0.28 / physics.grip);
  agent.x += Math.cos(moveHeading) * agent.velocity * dt;
  agent.y += Math.sin(moveHeading) * agent.velocity * dt;

  // Skid marks are visual-only — skip on intermediate ticks at high speed.
  if (isLastTick && drift > 0.34 && absVel > 90) {
    addSkid(agent, skidMarks, drift);
  }

  const afterCenter = nearestCenterline(stroke, agent.x, agent.y, agent.lastS);
  agent.centerIndex = afterCenter.index;
  const afterBridgeState = bridgeStateAt(stroke, afterCenter.s);
  agent.elevation = afterBridgeState.elevation;
  // Visual elevation is only needed for rendering — skip on intermediate ticks.
  if (isLastTick) {
    agent.renderElevation = bridgeVisualElevation(stroke, afterCenter.s, CAR_BRIDGE_VISUAL_MARGIN);
  }
  agent.bridgeLayer = afterBridgeState.layer;
  const swept = segmentHitsWalls(agent, stroke, afterBridgeState.elevation, { x: agent.prevX, y: agent.prevY }, { x: agent.x, y: agent.y }, wallCache);
  const inside = pointOnRoad(stroke, agent.x, agent.y, agent.lastS);
  if (swept || !inside) {
    agent.alive = false;
    agent.crashed = true;
    agent.crashSpeed = Math.max(agent.crashSpeed, agent.velocity);
    agent.velocity = 0;
  }

  updateFitness(agent, stroke, dt, prevVelocity, prevSteer, afterCenter, afterBridgeState.elevation, progressBenchmark, stage, carModel);
}

function updateFitness(agent, stroke, dt, prevVelocity, prevSteer, centerSample = null, precomputedElevation = null, progressBenchmark = 0, stage = STAGE_LEARNING, carModel = getCarModel(agent.modelId)) {
  const p = centerSample ?? nearestCenterline(stroke, agent.x, agent.y, agent.lastS);
  const racing = stage === STAGE_RACE;
  const maxVelocity = 310 * carModel.physics.topSpeed;
  agent.centerIndex = p.index;
  agent.elevation = precomputedElevation ?? bridgeStateAt(stroke, p.s).elevation;
  const s = p.s;
  const prevS = agent.lastS;
  let delta = s - agent.lastS;
  let crossedForward = false;

  if (stroke.closed) {
    const halfTrack = stroke.totalLength * 0.5;
    if (delta < -halfTrack) {
      // Forward wrap across start/finish.
      delta += stroke.totalLength;
      crossedForward = true;
    } else if (delta > halfTrack) {
      // Backing over the start line should be negative progress, not a free lap.
      delta -= stroke.totalLength;
    }
  }

  agent.totalProgress += delta;
  agent.maxProgress = Math.max(agent.maxProgress, agent.totalProgress);

  const forwardDelta = Math.max(0, delta);
  const crossedGate = stroke.closed && crossedFinishGate(agent, stroke, prevS, s);
  
  if (forwardDelta > 1.5) {
    agent.idleTime = 0;
    if (crossedForward || crossedGate) agent.lap += 1;
    agent.bestS = s;
    agent.speedScore += Math.max(0, agent.velocity);
    agent.speedSamples += 1;
    agent.peakProgressSpeed = Math.max(agent.peakProgressSpeed, agent.velocity);

    const alignment = Math.max(0, Math.cos(wrapAngle(p.heading - agent.heading)));
    const speedNorm = clamp(agent.velocity / maxVelocity, 0, 1);
    const centerRatio = clamp(p.dist / (stroke.width * 0.5), 0, 1);
    const benchmarkScale = racing ? 1 : progressRewardScale(agent.totalProgress, progressBenchmark, stroke.width);
    const centerBonus = (1 - centerRatio) * forwardDelta * (racing ? 0.9 : 1.6);
    const alignedSpeedBonus = forwardDelta * speedNorm * alignment * (racing ? 10 : 5.5);
    const clearPathBonus = Math.min(agent.sensors[2], agent.sensors[3], agent.sensors[4]) / SENSOR_RANGE * forwardDelta * (racing ? 0.7 : 1.4);
    const progressReward = forwardDelta * (racing ? 5.5 : 10);
    agent.reward += (progressReward + alignedSpeedBonus + centerBonus + clearPathBonus) * benchmarkScale;
  } else {
    agent.idleTime += dt;
    agent.reward -= dt * (racing ? 3.5 : 1.2);
  }

  const frontDistance = Math.min(agent.sensors[2], agent.sensors[3], agent.sensors[4]) / SENSOR_RANGE;
  const braking = Math.max(0, prevVelocity - agent.velocity);
  if (frontDistance < 0.25 && braking > 0.5) {
    agent.reward += braking * (0.25 - frontDistance) * 0.08;
  }
  agent.reward -= agent.brake * dt * (racing ? 4.4 : 2.4 + Math.max(0, frontDistance - 0.25) * 5.5);

  const steerJitter = Math.abs(agent.steer - prevSteer);
  agent.reward -= steerJitter * (racing ? 1.1 : 0.9);
  if (racing) agent.reward -= dt * 2.5;

  agent.lastS = s;
  agent.progress = s;
  const crashPenalty = agent.crashed ? 1 - clamp(agent.crashSpeed / maxVelocity, 0, 1) * 0.55 : 1;
  agent.fitness = Math.max(1, agent.reward * crashPenalty);
  const finishDistance = stroke.closed ? stroke.totalLength * 0.5 : Math.max(0, stroke.totalLength - stroke.width * 0.5);
  const finishedClosedLap = stroke.closed && crossedGate;
  const finishedOpenTrack = !stroke.closed && agent.totalProgress >= finishDistance;
  if (!agent.crashed && (finishedClosedLap || finishedOpenTrack)) {
    agent.finishTime = agent.age;
    const timeBonus = Math.max(0, 1 - agent.age / 60) * FINISH_REWARD * 0.35;
    const speedBonus = clamp(agent.peakProgressSpeed / maxVelocity, 0, 1) * FINISH_REWARD * 0.2;
    agent.finished = true;
    agent.alive = false;
    if (racing) {
      const fastFinishScore = (FINISH_REWARD * 120) / Math.max(1, agent.finishTime);
      agent.reward += FINISH_REWARD * 1.2 + agent.maxProgress * 2 + speedBonus;
      agent.fitness = FINISH_REWARD * 20 + fastFinishScore + speedBonus + Math.max(0, agent.reward) * 0.05;
    } else {
      agent.reward += FINISH_REWARD + agent.maxProgress * 10 + timeBonus + speedBonus;
      agent.fitness = agent.reward;
    }
  }
  if (agent.idleTime > 4.5) agent.alive = false;
}

function progressRewardScale(totalProgress, benchmark, roadWidth) {
  if (benchmark < roadWidth * 4) return 1;
  const breakthroughStart = benchmark - roadWidth * 0.8;
  if (totalProgress < breakthroughStart) return 0.45;
  if (totalProgress <= benchmark) return 0.75;
  const breakthrough = Math.min(1, (totalProgress - benchmark) / Math.max(roadWidth * 2, 1));
  return 1.2 + breakthrough * 1.4;
}

function crossedFinishGate(agent, stroke, prevS, currentS) {
  if ((agent.age ?? 0) < 1 || (agent.totalProgress ?? 0) < stroke.totalLength * 0.45) return false;
  const wrappedByArc = prevS > stroke.totalLength * 0.55 && currentS < stroke.totalLength * 0.45;
  if (wrappedByArc) return true;
  const gate = finishGateLine(stroke);
  if (!gate) return false;
  return segmentsIntersect(
    { x: agent.prevX, y: agent.prevY },
    { x: agent.x, y: agent.y },
    gate.a,
    gate.b,
  );
}

function finishGateLine(stroke) {
  if (!stroke.center.length || stroke.center.length < 2) return null;
  const p = stroke.center[0];
  const next = stroke.center[1];
  const tx = next.x - p.x;
  const ty = next.y - p.y;
  const len = Math.hypot(tx, ty) || 1;
  const normal = { x: -ty / len, y: tx / len };
  const half = stroke.width * 0.62;
  return {
    a: { x: p.x + normal.x * half, y: p.y + normal.y * half },
    b: { x: p.x - normal.x * half, y: p.y - normal.y * half },
  };
}

function progressPercent(agent, stroke) {
  if (!agent || !stroke?.totalLength) return 0;
  if (agent.finished) return 100;
  if (stroke.closed) {
    const lapProgress = (agent.progress ?? 0) / stroke.totalLength;
    return Math.max(0, Math.min(99.9, lapProgress * 100));
  }
  return Math.min(100, ((agent.maxProgress ?? 0) / stroke.totalLength) * 100);
}

function bestHistoricalDistance(history) {
  return Math.max(0, ...history.map(g => g.distance ?? 0));
}

function selectStageLeader(agents, stage) {
  if (stage === STAGE_RACE) {
    const fastest = agents
      .filter(agent => agent.finished && Number.isFinite(agent.finishTime))
      .sort((a, b) => a.finishTime - b.finishTime)[0];
    if (fastest) return fastest;
  }
  return selectAliveLeader(agents);
}

function selectGenerationWinner(agents, stage) {
  if (stage === STAGE_RACE) {
    const fastest = agents
      .filter(agent => agent.finished && Number.isFinite(agent.finishTime))
      .sort((a, b) => a.finishTime - b.finishTime)[0];
    if (fastest) return fastest;
  }
  return agents.reduce((winner, agent) => agent.fitness > winner.fitness ? agent : winner, agents[0]);
}

function selectAliveLeader(agents) {
  let best = null;
  for (const agent of agents) {
    if (!agent.alive) continue;
    if (!best || agent.fitness > best.fitness) best = agent;
  }
  return best ?? agents[0] ?? null;
}

function minFinishTime(agents) {
  const times = agents
    .map(agent => agent.finishTime)
    .filter(time => Number.isFinite(time));
  return times.length ? Math.min(...times) : null;
}

function statusForStage(stage) {
  return stage === STAGE_RACE ? 'RACING' : 'LEARNING';
}

function castSensors(agent, stroke, wallSource, distances, hits) {
  const myLevel = agent.elevation;
  const useGrid = wallSource instanceof WallGrid;
  for (let i = 0; i < SENSOR_ANGLES.length; i++) {
    const rel = SENSOR_ANGLES[i];
    const angle = agent.heading + rel;
    const rx = Math.cos(angle) * SENSOR_RANGE;
    const ry = Math.sin(angle) * SENSOR_RANGE;
    const endX = agent.x + rx;
    const endY = agent.y + ry;
    
    let best = SENSOR_RANGE;
    let hitPoint = { x: endX, y: endY };

    if (useGrid) {
      const walls = wallSource.queryRay(agent.x, agent.y, endX, endY);
      for (let w = 0; w < walls.length; w++) {
        const wall = walls[w];
        if (wall.elev !== myLevel && arcDistance(stroke, wall.sMid, agent.lastS) > SENSOR_RANGE * 1.5) continue;
        
        const sx = wall.b.x - wall.a.x;
        const sy = wall.b.y - wall.a.y;
        const denom = rx * sy - ry * sx;
        if (denom === 0) continue;
        
        const t = ((wall.a.x - agent.x) * sy - (wall.a.y - agent.y) * sx) / denom;
        if (t < 0 || t > 1) continue;
        const u = ((wall.a.x - agent.x) * ry - (wall.a.y - agent.y) * rx) / denom;
        if (u < 0 || u > 1) continue;
        
        const dist = t * SENSOR_RANGE;
        if (dist < best) {
          best = dist;
          hitPoint = { x: agent.x + rx * t, y: agent.y + ry * t };
        }
      }
    } else {
      const rayBox = {
        minX: Math.min(agent.x, endX),
        maxX: Math.max(agent.x, endX),
        minY: Math.min(agent.y, endY),
        maxY: Math.max(agent.y, endY),
      };
      for (const wall of wallSource) {
        if (wall.elev !== myLevel && arcDistance(stroke, wall.sMid, agent.lastS) > SENSOR_RANGE * 1.5) continue;
        if (!boxesOverlap(rayBox, wall)) continue;
        
        const sx = wall.b.x - wall.a.x;
        const sy = wall.b.y - wall.a.y;
        const denom = rx * sy - ry * sx;
        if (denom === 0) continue;
        
        const t = ((wall.a.x - agent.x) * sy - (wall.a.y - agent.y) * sx) / denom;
        if (t < 0 || t > 1) continue;
        const u = ((wall.a.x - agent.x) * ry - (wall.a.y - agent.y) * rx) / denom;
        if (u < 0 || u > 1) continue;
        
        const dist = t * SENSOR_RANGE;
        if (dist < best) {
          best = dist;
          hitPoint = { x: agent.x + rx * t, y: agent.y + ry * t };
        }
      }
    }
    distances[i] = best;
    hits[i] = hitPoint;
  }
}

function buildWallSegments(stroke) {
  const out = [];
  const roadW2 = stroke.width * 0.48; // slightly less than half to avoid edge precision issues

  for (const side of [stroke.left, stroke.right]) {
    for (let i = 1; i < side.length; i++) {
      const sMid = (stroke.lengths[i - 1] + stroke.lengths[i]) * 0.5;
      const midX = (side[i - 1].x + side[i].x) * 0.5;
      const midY = (side[i - 1].y + side[i].y) * 0.5;

      let isInternal = false;
      const wallElev = bridgeElevation(stroke, sMid);

      for (let j = 0; j < stroke.center.length; j++) {
        const sOther = stroke.lengths[j];
        if (Math.abs(sOther - sMid) < stroke.width * 2.0) continue;

        if (Math.hypot(midX - stroke.center[j].x, midY - stroke.center[j].y) < roadW2) {
          const otherElev = bridgeElevation(stroke, sOther);
          if (wallElev === otherElev) {
            isInternal = true; break;
          }
        }
      }

      if (!isInternal) {
        out.push({
          a: side[i - 1],
          b: side[i],
          sMid,
          elev: wallElev,
          minX: Math.min(side[i - 1].x, side[i].x),
          maxX: Math.max(side[i - 1].x, side[i].x),
          minY: Math.min(side[i - 1].y, side[i].y),
          maxY: Math.max(side[i - 1].y, side[i].y),
        });
      }
    }
  }
  return out;
}



function pointOnRoad(stroke, x, y, referenceS = null) {
  const p = nearestCenterline(stroke, x, y, referenceS);
  return p.dist <= stroke.width * 0.46;
}

function nearestCenterline(stroke, x, y, referenceS = null) {
  // Hot path: called 2× per agent per tick. Avoid object allocation in inner loop.
  let bestDist = Infinity, bestScore = Infinity, bestS = 0, bestHeading = 0, bestIndex = 0;
  const continuityWindow = referenceS == null ? Infinity : Math.max(stroke.width * 2.4, 160);
  const numRanges = getCenterlineSearchRanges(stroke, referenceS, continuityWindow);
  const centerPts = stroke.center;
  const lengths = stroke.lengths;
  const closed = stroke.closed;
  const totalLen = stroke.totalLength;
  const hasRef = referenceS != null;
  for (let r = 0; r < numRanges; r++) {
    const rStart = _rangesBuf[r][0], rEnd = _rangesBuf[r][1];
    for (let i = rStart; i <= rEnd; i++) {
      const a = centerPts[i - 1];
      const b = centerPts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const ex = x - (a.x + dx * t);
      const ey = y - (a.y + dy * t);
      const dist = Math.sqrt(ex * ex + ey * ey);
      const segLen = lengths[i] - lengths[i - 1];
      const s = lengths[i - 1] + segLen * t;
      let score = dist;
      if (hasRef) {
        const d = Math.abs(s - referenceS);
        score += (closed ? Math.min(d, totalLen - d) : d) * 0.18;
      }
      if (score < bestScore) {
        bestDist = dist;
        bestScore = score;
        bestS = s;
        bestHeading = Math.atan2(dy, dx);
        bestIndex = i;
      }
    }
  }
  if (!Number.isFinite(bestDist) && hasRef) {
    return nearestCenterline(stroke, x, y, null);
  }
  return { dist: bestDist, score: bestScore, s: bestS, heading: bestHeading, index: bestIndex };
}

function arcDistanceForSearch(stroke, a, b) {
  const d = Math.abs(a - b);
  return stroke.closed ? Math.min(d, stroke.totalLength - d) : d;
}

const _rangesBuf = [[0, 0], [0, 0], [0, 0]];

function getCenterlineSearchRanges(stroke, referenceS, window) {
  const maxSeg = stroke.center.length - 1;
  if (referenceS == null || !Number.isFinite(window)) {
    _rangesBuf[0][0] = 1; _rangesBuf[0][1] = maxSeg;
    return 1;
  }

  const total = stroke.totalLength;
  const lengths = stroke.lengths;
  let count = 0;
  
  const addRange = (a, b) => {
    const start = Math.max(1, lowerBound(lengths, Math.max(0, a)) - 1);
    const end = Math.min(maxSeg, lowerBound(lengths, Math.min(total, b)) + 1);
    if (start <= end) {
      _rangesBuf[count][0] = start;
      _rangesBuf[count][1] = end;
      count++;
    }
  };

  const lo = referenceS - window;
  const hi = referenceS + window;
  if (stroke.closed) {
    if (lo < 0) {
      addRange(total + lo, total);
      addRange(0, hi);
    } else if (hi > total) {
      addRange(lo, total);
      addRange(0, hi - total);
    } else {
      addRange(lo, hi);
    }
  } else {
    addRange(lo, hi);
  }
  
  if (count === 0) {
    _rangesBuf[0][0] = 1; _rangesBuf[0][1] = maxSeg;
    return 1;
  }
  return count;
}

function lowerBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function segmentHitsWalls(agent, stroke, myLevel, a, b, wallSource) {
  if (wallSource instanceof WallGrid) {
    const walls = wallSource.queryRay(a.x, a.y, b.x, b.y);
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      if (wall.elev !== myLevel && arcDistance(stroke, wall.sMid, agent.lastS) > SENSOR_RANGE * 1.5) continue;
      if (segmentsIntersect(a, b, wall.a, wall.b)) return true;
    }
    return false;
  }
  const box = {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  };
  for (const wall of wallSource) {
    if (wall.elev !== myLevel && arcDistance(stroke, wall.sMid, agent.lastS) > SENSOR_RANGE * 1.5) continue;
    if (!boxesOverlap(box, wall)) continue;
    if (segmentsIntersect(a, b, wall.a, wall.b)) return true;
  }
  return false;
}

function boxesOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function raySegment(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  const p = { x: a.x + rx * t, y: a.y + ry * t };
  return { p, dist: Math.hypot(p.x - a.x, p.y - a.y) };
}

function segmentsIntersect(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return false;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function addSkid(agent, skidMarks, drift) {
  if (!skidMarks) return;
  const side = { x: Math.cos(agent.heading + Math.PI / 2), y: Math.sin(agent.heading + Math.PI / 2) };
  const back = { x: Math.cos(agent.heading + Math.PI) * CAR_LENGTH * 0.22, y: Math.sin(agent.heading + Math.PI) * CAR_LENGTH * 0.22 };
  const half = CAR_WIDTH * 0.55;
  for (const sign of [-1, 1]) {
    skidMarks.push({
      x1: agent.prevX + side.x * half * sign + back.x,
      y1: agent.prevY + side.y * half * sign + back.y,
      x2: agent.x + side.x * half * sign + back.x,
      y2: agent.y + side.y * half * sign + back.y,
      alpha: 0.16 + drift * 0.18,
      life: 1,
    });
  }
}

function trimSkids(skids) {
  if (skids.length > 520) skids.splice(0, skids.length - 520);
}

function selectTrackStroke(track) {
  return track.strokes
    .slice()
    .sort((a, b) => b.totalLength - a.totalLength)[0] ?? null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function positiveOutput(v) {
  return clamp(v, 0, 1);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ─── Spatial grid for wall segments ──────────────────────────────────
//
// Partitions wall segments into a uniform grid so sensor raycasts and
// swept collision tests only check walls in cells the ray traverses.
// Reduces sensor casting from O(N walls) to O(cells × density).

class WallGrid {
  constructor(walls) {
    this.walls = walls;
    if (walls.length === 0) {
      this.cells = null;
      this.cols = 0;
      this.rows = 0;
      return;
    }

    // Determine bounds of all walls.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of walls) {
      if (w.minX < minX) minX = w.minX;
      if (w.maxX > maxX) maxX = w.maxX;
      if (w.minY < minY) minY = w.minY;
      if (w.maxY > maxY) maxY = w.maxY;
    }

    // Cell size ≈ SENSOR_RANGE so most rays cross only a few cells.
    const cellSize = Math.max(80, SENSOR_RANGE * 0.85);
    this.ox = minX - cellSize;
    this.oy = minY - cellSize;
    this.cellSize = cellSize;
    this.cols = Math.ceil((maxX - this.ox + cellSize) / cellSize) + 1;
    this.rows = Math.ceil((maxY - this.oy + cellSize) / cellSize) + 1;
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = null;

    // Insert each wall into every cell it overlaps.
    for (const w of walls) {
      const c0 = Math.max(0, ((w.minX - this.ox) / cellSize) | 0);
      const c1 = Math.min(this.cols - 1, ((w.maxX - this.ox) / cellSize) | 0);
      const r0 = Math.max(0, ((w.minY - this.oy) / cellSize) | 0);
      const r1 = Math.min(this.rows - 1, ((w.maxY - this.oy) / cellSize) | 0);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const idx = r * this.cols + c;
          if (!this.cells[idx]) this.cells[idx] = [];
          this.cells[idx].push(w);
        }
      }
    }

    // Dedup stamp — used to avoid returning the same wall twice across cells.
    this._stamp = 0;
    // Reusable result buffer for queryRay — avoids allocating a new array each call.
    this._queryBuf = [];
  }

  /**
   * Return all wall segments in cells that the axis-aligned bounding box
   * of the ray from (x0,y0) to (x1,y1) overlaps.  Uses a simple AABB
   * cell walk which is cheap and sufficient for short sensor rays.
   *
   * IMPORTANT: the returned array is reused across calls — callers must
   * consume or copy it before the next queryRay call on this grid.
   */
  queryRay(x0, y0, x1, y1) {
    if (!this.cells) return this.walls; // fallback for empty grids
    const stamp = ++this._stamp;
    const cs = this.cellSize;
    const ox = this.ox, oy = this.oy;

    const rMinX = Math.min(x0, x1);
    const rMaxX = Math.max(x0, x1);
    const rMinY = Math.min(y0, y1);
    const rMaxY = Math.max(y0, y1);
    const c0 = Math.max(0, ((rMinX - ox) / cs) | 0);
    const c1 = Math.min(this.cols - 1, ((rMaxX - ox) / cs) | 0);
    const r0 = Math.max(0, ((rMinY - oy) / cs) | 0);
    const r1 = Math.min(this.rows - 1, ((rMaxY - oy) / cs) | 0);

    // Reuse a shared buffer to avoid allocating a new array every call.
    const result = this._queryBuf;
    let idx = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const bucket = this.cells[r * this.cols + c];
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const w = bucket[i];
          if (w._gs === stamp) continue; // already added
          w._gs = stamp;
          result[idx++] = w;
        }
      }
    }
    result.length = idx;
    return result;
  }
}
