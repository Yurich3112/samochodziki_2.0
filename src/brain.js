const INPUTS = 10;
const HIDDEN = 12;
const OUTPUTS = 4;

export class NeuralNetwork {
  constructor(weights = randomWeights()) {
    this.weights = weights.length === weightCount() ? weights : randomWeights();
    // Pre-allocated buffers — avoids creating two new Arrays on every think() call.
    // At 16x speed with 30 agents this saves ~960 array allocations per frame.
    this._hidden = new Float64Array(HIDDEN);
    this._outputs = new Float64Array(OUTPUTS);
  }

  static random() {
    return new NeuralNetwork();
  }

  clone() {
    return new NeuralNetwork(this.weights.slice());
  }

  think(inputs) {
    const w = this.weights;
    const hidden = this._hidden;
    const outputs = this._outputs;
    let k = 0;
    for (let h = 0; h < HIDDEN; h++) {
      let sum = w[k++]; // bias
      for (let i = 0; i < INPUTS; i++) sum += inputs[i] * w[k++];
      hidden[h] = Math.tanh(sum);
    }

    for (let o = 0; o < OUTPUTS; o++) {
      let sum = w[k++];
      for (let h = 0; h < HIDDEN; h++) sum += hidden[h] * w[k++];
      outputs[o] = Math.tanh(sum);
    }
    return outputs;
  }
}

export class GeneticAlgorithm {
  constructor(populationSize = 30) {
    this.populationSize = populationSize;
    this.generation = 1;
    this.bestFitness = 0;
    this.bestProgress = 0;
    this.bestEver = null;
    this.networks = Array.from({ length: populationSize }, () => NeuralNetwork.random());
  }

  nextGeneration(agents) {
    const ranked = agents
      .slice()
      .sort((a, b) => b.fitness - a.fitness);
    const champion = ranked[0];

    const championProgress = champion?.maxProgress ?? 0;
    if (champion && (championProgress > this.bestProgress || champion.fitness > this.bestFitness)) {
      this.bestProgress = Math.max(this.bestProgress, championProgress);
      this.bestFitness = Math.max(this.bestFitness, champion.fitness);
      this.bestEver = champion.brain.clone();
    }

    const elites = ranked.slice(0, Math.max(2, Math.floor(this.populationSize * 0.18)));
    const next = [];
    const randomCount = Math.floor(this.populationSize * 0.2);
    const experimentCount = Math.floor(this.populationSize * 0.1);
    const crossoverLimit = this.populationSize - randomCount - experimentCount;
    if (this.bestEver) next.push(this.bestEver.clone());
    if (champion) next.push(champion.brain.clone());

    // Many children descend from the champion, but we keep room for crossovers
    // and fresh experiments so the population can discover new cornering lines.
    while (champion && next.length < Math.floor(this.populationSize * 0.38)) {
      const weights = champion.brain.weights.slice();
      mutate(weights, 0.12, 0.32);
      next.push(new NeuralNetwork(weights));
    }

    while (next.length < crossoverLimit) {
      const a = Math.random() < 0.72 && champion ? champion : pickWeighted(elites);
      const b = pickWeighted(elites);
      const weights = crossover(a.brain.weights, b.brain.weights);
      mutate(weights, 0.07, 0.38);
      next.push(new NeuralNetwork(weights));
    }

    while (next.length < this.populationSize - randomCount) {
      const source = champion?.brain ?? NeuralNetwork.random();
      const weights = source.weights.slice();
      mutate(weights, 0.22, 0.8);
      next.push(new NeuralNetwork(weights));
    }

    while (next.length < this.populationSize) {
      next.push(NeuralNetwork.random());
    }

    this.networks = next.slice(0, this.populationSize);
    this.generation += 1;
  }
}

export const networkShape = {
  inputs: INPUTS,
  hidden: HIDDEN,
  outputs: OUTPUTS,
  weightsPerNetwork: weightCount(),
};

function weightCount() {
  return HIDDEN * (INPUTS + 1) + OUTPUTS * (HIDDEN + 1);
}

function randomWeights() {
  return Array.from({ length: weightCount() }, () => rand(-1, 1));
}

function crossover(a, b) {
  const out = new Array(a.length);
  const cut = Math.floor(Math.random() * a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = i < cut ? a[i] : b[i];
  }
  return out;
}

function mutate(weights, rate, strength) {
  for (let i = 0; i < weights.length; i++) {
    if (Math.random() < rate) {
      weights[i] = clamp(weights[i] + gaussian() * strength, -2.5, 2.5);
    }
  }
}

function pickWeighted(agents) {
  const total = agents.reduce((sum, a, i) => sum + Math.max(1, a.fitness) / (i + 1), 0);
  let roll = Math.random() * total;
  for (let i = 0; i < agents.length; i++) {
    roll -= Math.max(1, agents[i].fitness) / (i + 1);
    if (roll <= 0) return agents[i];
  }
  return agents[0];
}

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
