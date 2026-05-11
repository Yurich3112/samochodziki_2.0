import { GeneticAlgorithm } from './brain.js';
import { bridgeElevation, bridgeStateAt, bridgeVisualElevation } from './bridges.js';
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
      this.wallSegments = buildWallSegments(this.trackStroke);
      this.wallCache = buildWallCache(this.trackStroke, this.wallSegments);
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
    this.wallSegments = buildWallSegments(this.trackStroke);
    this.wallCache = buildWallCache(this.trackStroke, this.wallSegments);
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

  update(dt) {
    if (!this.running || !this.trackStroke) return;
    const step = Math.min(dt, 1 / 30);
    this.generationTime += step;

    let firstFinisher = null;
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      updateAgent(agent, this.trackStroke, this.wallSegments, this.wallCache, step, this.skidMarks, this.progressBenchmark, this.stage);
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

    this.leader = selectStageLeader(this.agents, this.stage);
    trimSkids(this.skidMarks);

    if (this.agents.every(agent => !agent.alive)) {
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

function updateAgent(agent, stroke, walls, wallCache, dt, skidMarks, progressBenchmark = 0, stage = STAGE_LEARNING) {
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
  const activeWalls = bridgeAwareWalls(stroke, walls, bridgeState, wallCache);
  castSensors(agent, activeWalls, agent.sensors, agent.sensorHits);
  const angleToRoad = wrapAngle(center.heading - agent.heading) / Math.PI;
  const inputs = [
    ...agent.sensors.map(d => d / SENSOR_RANGE),
    speedNorm,
    angleToRoad,
  ];
  const [leftOut, rightOut, gasOut, brakeOut] = agent.brain.think(inputs);

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
  const drift = clamp(Math.abs(agent.steer) * Math.abs(agent.velocity) / (260 * physics.grip), 0, 1);
  const moveHeading = agent.heading - agent.steer * drift * (0.28 / physics.grip);
  agent.x += Math.cos(moveHeading) * agent.velocity * dt;
  agent.y += Math.sin(moveHeading) * agent.velocity * dt;

  if (drift > 0.34 && Math.abs(agent.velocity) > 90) {
    addSkid(agent, skidMarks, drift);
  }

  const afterCenter = nearestCenterline(stroke, agent.x, agent.y, agent.lastS);
  agent.centerIndex = afterCenter.index;
  const afterBridgeState = bridgeStateAt(stroke, afterCenter.s);
  agent.elevation = afterBridgeState.elevation;
  agent.renderElevation = bridgeVisualElevation(stroke, afterCenter.s, CAR_BRIDGE_VISUAL_MARGIN);
  agent.bridgeLayer = afterBridgeState.layer;
  const collisionWalls = bridgeAwareWalls(stroke, walls, afterBridgeState, wallCache);
  const swept = segmentHitsWalls({ x: agent.prevX, y: agent.prevY }, { x: agent.x, y: agent.y }, collisionWalls);
  const inside = pointOnRoad(stroke, agent.x, agent.y, agent.lastS);
  if (swept || !inside) {
    agent.alive = false;
    agent.crashed = true;
    agent.crashSpeed = Math.max(agent.crashSpeed, agent.velocity);
    agent.velocity = 0;
  }

  updateFitness(agent, stroke, dt, prevVelocity, prevSteer, afterCenter, progressBenchmark, stage, carModel);
}

function updateFitness(agent, stroke, dt, prevVelocity, prevSteer, centerSample = null, progressBenchmark = 0, stage = STAGE_LEARNING, carModel = getCarModel(agent.modelId)) {
  const p = centerSample ?? nearestCenterline(stroke, agent.x, agent.y, agent.lastS);
  const racing = stage === STAGE_RACE;
  const maxVelocity = 310 * carModel.physics.topSpeed;
  agent.centerIndex = p.index;
  agent.elevation = bridgeStateAt(stroke, p.s).elevation;
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

  const forwardDelta = Math.max(0, delta);
  const crossedGate = stroke.closed && crossedFinishGate(agent, stroke, prevS, s);
  if (forwardDelta > 1.5) {
    agent.idleTime = 0;
    agent.totalProgress += forwardDelta;
    if (crossedForward || crossedGate) agent.lap += 1;
    agent.bestS = s;
    agent.maxProgress = Math.max(agent.maxProgress, agent.totalProgress);
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

function castSensors(agent, walls, distances, hits) {
  for (let i = 0; i < SENSOR_ANGLES.length; i++) {
    const rel = SENSOR_ANGLES[i];
    const angle = agent.heading + rel;
    const end = {
      x: agent.x + Math.cos(angle) * SENSOR_RANGE,
      y: agent.y + Math.sin(angle) * SENSOR_RANGE,
    };
    const rayBox = {
      minX: Math.min(agent.x, end.x),
      maxX: Math.max(agent.x, end.x),
      minY: Math.min(agent.y, end.y),
      maxY: Math.max(agent.y, end.y),
    };
    let best = SENSOR_RANGE;
    let hitPoint = end;
    for (const wall of walls) {
      if (!boxesOverlap(rayBox, wall)) continue;
      const hit = raySegment(agent, end, wall.a, wall.b);
      if (hit && hit.dist < best) {
        best = hit.dist;
        hitPoint = hit.p;
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

function buildWallCache(stroke, walls) {
  // Pre-compute wall elevation levels for fast lookup
  const wallLevels = walls.map(w => bridgeElevation(stroke, w.sMid));
  // Cache: for each elevation level, only walls on that same level
  const cache = new Map();
  const levels = new Set(wallLevels);
  for (const lvl of levels) {
    cache.set(lvl, walls.filter((_, i) => wallLevels[i] === lvl));
  }
  return cache;
}

function bridgeAwareWalls(stroke, walls, state, cache = null) {
  const myLevel = state.elevation ?? 0;
  const cached = cache?.get(myLevel);
  if (cached) return cached;
  // Fallback: filter walls to only those on the same elevation
  return walls.filter(w => bridgeElevation(stroke, w.sMid) === myLevel);
}

function pointOnRoad(stroke, x, y, referenceS = null) {
  const p = nearestCenterline(stroke, x, y, referenceS);
  return p.dist <= stroke.width * 0.46;
}

function nearestCenterline(stroke, x, y, referenceS = null) {
  let best = { dist: Infinity, score: Infinity, s: 0, heading: 0 };
  const continuityWindow = referenceS == null ? Infinity : Math.max(stroke.width * 2.4, 160);
  const ranges = centerlineSearchRanges(stroke, referenceS, continuityWindow);
  for (const [start, end] of ranges) {
    for (let i = start; i <= end; i++) {
      const a = stroke.center[i - 1];
      const b = stroke.center[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1);
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const dist = Math.hypot(x - px, y - py);
      const s = stroke.lengths[i - 1] + Math.hypot(dx, dy) * t;
      const arcPenalty = referenceS == null ? 0 : arcDistanceForSearch(stroke, s, referenceS) * 0.18;
      const score = dist + arcPenalty;
      if (score < best.score) {
        best = {
          dist,
          score,
          s,
          heading: Math.atan2(dy, dx),
          index: i,
        };
      }
    }
  }
  if (!Number.isFinite(best.dist) && referenceS != null) {
    return nearestCenterline(stroke, x, y, null);
  }
  return best;
}

function arcDistanceForSearch(stroke, a, b) {
  const d = Math.abs(a - b);
  return stroke.closed ? Math.min(d, stroke.totalLength - d) : d;
}

function centerlineSearchRanges(stroke, referenceS, window) {
  const maxSeg = stroke.center.length - 1;
  if (referenceS == null || !Number.isFinite(window)) return [[1, maxSeg]];

  const total = stroke.totalLength;
  const ranges = [];
  const addRange = (a, b) => {
    const start = Math.max(1, lowerBound(stroke.lengths, Math.max(0, a)) - 1);
    const end = Math.min(maxSeg, lowerBound(stroke.lengths, Math.min(total, b)) + 1);
    if (start <= end) ranges.push([start, end]);
  };

  let lo = referenceS - window;
  let hi = referenceS + window;
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
  return ranges.length ? ranges : [[1, maxSeg]];
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

function segmentHitsWalls(a, b, walls) {
  const box = {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  };
  for (const wall of walls) {
    if (!boxesOverlap(box, wall)) continue;
    if (segmentsIntersect(a, b, wall.a, wall.b)) return true;
  }
  return false;
}

function boxesOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function raySegment(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  const p = { x: a.x + r.x * t, y: a.y + r.y * t };
  return { p, dist: Math.hypot(p.x - a.x, p.y - a.y) };
}

function segmentsIntersect(a, b, c, d) {
  return !!raySegment(a, b, c, d);
}

function addSkid(agent, skidMarks, drift) {
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
