export const CAR_MODELS = [
  {
    id: 'sport',
    name: 'Sport Prototype',
    description: 'Balanced baseline for learning the track.',
    stats: {
      acceleration: 0.78,
      braking: 0.74,
      handling: 0.76,
      topSpeed: 0.72,
    },
    physics: {
      acceleration: 1,
      braking: 1,
      handling: 1,
      topSpeed: 1,
      grip: 1,
    },
  },
  {
    id: 'f1',
    name: 'F1 Style',
    description: 'Sharp steering and acceleration, less forgiving under braking.',
    stats: {
      acceleration: 0.92,
      braking: 0.68,
      handling: 0.95,
      topSpeed: 0.88,
    },
    physics: {
      acceleration: 1.16,
      braking: 0.92,
      handling: 1.18,
      topSpeed: 1.08,
      grip: 1.14,
    },
  },
  {
    id: 'gt',
    name: 'GT Racecar',
    description: 'Stable and strong on brakes, but slower to rotate.',
    stats: {
      acceleration: 0.7,
      braking: 0.9,
      handling: 0.64,
      topSpeed: 0.78,
    },
    physics: {
      acceleration: 0.92,
      braking: 1.18,
      handling: 0.88,
      topSpeed: 1.01,
      grip: 1.05,
    },
  },
  {
    id: 'hypercar',
    name: 'Le Mans Hypercar',
    description: 'Fastest on straights, needs smoother inputs in corners.',
    stats: {
      acceleration: 0.84,
      braking: 0.82,
      handling: 0.7,
      topSpeed: 0.96,
    },
    physics: {
      acceleration: 1.04,
      braking: 1.08,
      handling: 0.94,
      topSpeed: 1.15,
      grip: 0.98,
    },
  },
  {
    id: 'rally',
    name: 'Rally Cross',
    description: 'Punchy and forgiving through tight, messy corners.',
    stats: {
      acceleration: 0.86,
      braking: 0.72,
      handling: 0.9,
      topSpeed: 0.66,
    },
    physics: {
      acceleration: 1.1,
      braking: 0.96,
      handling: 1.12,
      topSpeed: 0.92,
      grip: 1.22,
    },
  },
];

export function getCarModel(id) {
  return CAR_MODELS.find(model => model.id === id) ?? CAR_MODELS[0];
}
