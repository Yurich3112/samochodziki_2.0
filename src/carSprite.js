export function drawCar(ctx, car, scale = 0.28) {
  const modelId = car.modelId ?? car.model?.id ?? 'sport';
  if (modelId === 'f1') return drawF1Car(ctx, car, scale);
  if (modelId === 'gt') return drawGtCar(ctx, car, scale);
  if (modelId === 'hypercar') return drawHypercar(ctx, car, scale);
  if (modelId === 'rally') return drawRallyCar(ctx, car, scale);
  return drawSportCar(ctx, car, scale);
}

function drawSportCar(ctx, car, scale = 0.28) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading + Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.translate(-50, -100);

  const bodyGrad = ctx.createLinearGradient(0, 20, 0, 180);
  bodyGrad.addColorStop(0, car.color ?? '#ef4444');
  bodyGrad.addColorStop(1, darken(car.color ?? '#ef4444', 0.55));
  const glassGrad = ctx.createLinearGradient(0, 70, 0, 125);
  glassGrad.addColorStop(0, '#0f172a');
  glassGrad.addColorStop(1, '#1e293b');

  // Front splitter
  path(ctx, 'M 20 20 C 30 15, 70 15, 80 20 L 85 40 L 15 40 Z', '#1f2937');
  path(ctx, 'M 25 18 C 50 14, 50 14, 75 18 L 78 22 L 22 22 Z', '#fbbf24');

  // Tires
  roundedRect(ctx, 12, 30, 14, 30, 2, '#030712');
  roundedRect(ctx, 74, 30, 14, 30, 2, '#030712');
  roundedRect(ctx, 12, 140, 16, 35, 2, '#030712');
  roundedRect(ctx, 72, 140, 16, 35, 2, '#030712');

  // Body
  path(ctx, 'M 25 25 C 40 20, 60 20, 75 25 L 82 80 C 85 110, 85 140, 82 170 C 70 180, 30 180, 18 170 C 15 140, 15 110, 18 80 Z', bodyGrad);

  // Hood vents
  path(ctx, 'M 35 40 L 45 35 L 45 55 L 35 50 Z', '#111827');
  path(ctx, 'M 65 40 L 55 35 L 55 55 L 65 50 Z', '#111827');
  strokeLine(ctx, 37, 42, 43, 39, '#374151', 1.5);
  strokeLine(ctx, 37, 46, 43, 43, '#374151', 1.5);
  strokeLine(ctx, 37, 50, 43, 47, '#374151', 1.5);
  strokeLine(ctx, 63, 42, 57, 39, '#374151', 1.5);
  strokeLine(ctx, 63, 46, 57, 43, '#374151', 1.5);
  strokeLine(ctx, 63, 50, 57, 47, '#374151', 1.5);

  // Canopy / windshield
  path(ctx, 'M 30 85 C 40 70, 60 70, 70 85 L 65 115 C 60 125, 40 125, 35 115 Z', glassGrad);
  path(ctx, 'M 32 87 C 40 74, 60 74, 68 87 L 63 113 C 58 121, 42 121, 37 113 Z', '#0f172a');
  path(ctx, 'M 38 90 C 45 85, 55 85, 62 90 L 58 120 C 55 125, 45 125, 42 120 Z', darken(car.color ?? '#ef4444', 0.72));
  circle(ctx, 50, 100, 2, '#1f2937');

  // Rear window & engine bay
  path(ctx, 'M 40 125 L 60 125 L 55 155 L 45 155 Z', '#1f2937');
  strokeLine(ctx, 50, 125, 50, 155, '#374151', 2);
  strokeLine(ctx, 45, 130, 55, 130, '#374151', 1);
  strokeLine(ctx, 46, 140, 54, 140, '#374151', 1);
  strokeLine(ctx, 47, 150, 53, 150, '#374151', 1);

  // Rear diffuser and wing
  path(ctx, 'M 25 170 L 75 170 L 70 185 L 30 185 Z', '#111827');
  strokeLine(ctx, 35, 170, 35, 185, '#374151', 2);
  strokeLine(ctx, 50, 170, 50, 185, '#374151', 2);
  strokeLine(ctx, 65, 170, 65, 185, '#374151', 2);
  roundedRect(ctx, 15, 160, 70, 14, 2, '#0f172a');
  roundedRect(ctx, 18, 163, 64, 8, 1, '#1e293b');
  path(ctx, 'M 13 155 L 18 155 L 18 175 L 13 175 Z', car.color ?? '#ef4444');
  path(ctx, 'M 82 155 L 87 155 L 87 175 L 82 175 Z', car.color ?? '#ef4444');

  drawBrakeLights(ctx, clamp(car.brake ?? 0, 0, 1), [
    { x: 27, y: 176, w: 12, h: 5 },
    { x: 61, y: 176, w: 12, h: 5 },
  ]);

  ctx.restore();
}

function drawF1Car(ctx, car, scale = 0.28) {
  const color = car.color ?? '#fbbf24';
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading + Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.translate(-50, -100);

  const bodyGrad = ctx.createLinearGradient(0, 18, 0, 184);
  bodyGrad.addColorStop(0, color);
  bodyGrad.addColorStop(1, darken(color, 0.55));

  roundedRect(ctx, 20, 9, 60, 12, 2, '#111827');
  roundedRect(ctx, 17, 12, 8, 20, 2, color);
  roundedRect(ctx, 75, 12, 8, 20, 2, color);
  roundedRect(ctx, 15, 170, 70, 14, 2, '#111827');
  roundedRect(ctx, 18, 173, 64, 8, 1, '#1f2937');

  roundedRect(ctx, 7, 28, 12, 30, 3, '#030712');
  roundedRect(ctx, 81, 28, 12, 30, 3, '#030712');
  roundedRect(ctx, 5, 137, 16, 39, 3, '#030712');
  roundedRect(ctx, 79, 137, 16, 39, 3, '#030712');
  strokeLine(ctx, 18, 48, 38, 60, '#374151', 2);
  strokeLine(ctx, 82, 48, 62, 60, '#374151', 2);
  strokeLine(ctx, 18, 142, 37, 134, '#374151', 2);
  strokeLine(ctx, 82, 142, 63, 134, '#374151', 2);

  path(ctx, 'M 43 15 L 57 15 L 61 78 L 69 98 L 65 160 L 35 160 L 31 98 L 39 78 Z', bodyGrad);
  path(ctx, 'M 48 18 L 52 18 L 54 75 L 46 75 Z', '#fff7b8');
  path(ctx, 'M 36 84 L 25 103 L 27 151 L 37 160 Z', darken(color, 0.7));
  path(ctx, 'M 64 84 L 75 103 L 73 151 L 63 160 Z', darken(color, 0.7));
  path(ctx, 'M 38 96 C 38 78, 62 78, 62 96 L 58 112 C 58 84, 42 84, 42 112 Z', '#0b0f19');
  circle(ctx, 50, 96, 5.5, '#fef08a');
  path(ctx, 'M 44 94 Q 50 89, 56 94 L 55 98 Q 50 101, 45 98 Z', '#111827');
  path(ctx, 'M 47 115 L 53 115 L 55 160 L 45 160 Z', '#111827');

  drawBrakeLights(ctx, clamp(car.brake ?? 0, 0, 1), [
    { x: 29, y: 177, w: 12, h: 4 },
    { x: 59, y: 177, w: 12, h: 4 },
    { x: 47, y: 184, w: 6, h: 4 },
  ]);
  ctx.restore();
}

function drawGtCar(ctx, car, scale = 0.28) {
  const color = car.color ?? '#fbbf24';
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading + Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.translate(-50, -100);

  const bodyGrad = ctx.createLinearGradient(0, 20, 0, 180);
  bodyGrad.addColorStop(0, color);
  bodyGrad.addColorStop(1, darken(color, 0.5));

  roundedRect(ctx, 9, 45, 13, 31, 3, '#030712');
  roundedRect(ctx, 78, 45, 13, 31, 3, '#030712');
  roundedRect(ctx, 9, 132, 13, 34, 3, '#030712');
  roundedRect(ctx, 78, 132, 13, 34, 3, '#030712');
  path(ctx, 'M 21 20 L 79 20 C 90 24, 91 47, 88 73 L 91 132 C 91 163, 83 181, 72 184 L 28 184 C 17 181, 9 163, 9 132 L 12 73 C 9 47, 10 24, 21 20 Z', bodyGrad);
  path(ctx, 'M 19 20 L 34 18 L 38 33 L 21 33 Z', '#fef3c7');
  path(ctx, 'M 81 20 L 66 18 L 62 33 L 79 33 Z', '#fef3c7');
  path(ctx, 'M 29 68 L 71 68 L 79 88 L 79 132 L 71 154 L 29 154 L 21 132 L 21 88 Z', '#111827');
  path(ctx, 'M 32 82 L 68 82 L 68 139 L 32 139 Z', bodyGrad);
  roundedRect(ctx, 43, 20, 5, 162, 1, '#f8fafc');
  roundedRect(ctx, 52, 20, 5, 162, 1, '#f8fafc');
  path(ctx, 'M 28 44 L 41 40 L 41 56 L 28 58 Z', '#111827');
  path(ctx, 'M 72 44 L 59 40 L 59 56 L 72 58 Z', '#111827');
  roundedRect(ctx, 12, 175, 76, 9, 2, '#111827');
  roundedRect(ctx, 15, 177, 70, 5, 1, '#1f2937');

  drawBrakeLights(ctx, clamp(car.brake ?? 0, 0, 1), [
    { x: 22, y: 176, w: 14, h: 5 },
    { x: 64, y: 176, w: 14, h: 5 },
  ]);
  ctx.restore();
}

function drawHypercar(ctx, car, scale = 0.28) {
  const color = car.color ?? '#fbbf24';
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading + Math.PI / 2);
  // Draw this model in the same 400x800 proportions as the source SVG, then
  // scale it uniformly into the common car footprint used by the simulation.
  ctx.scale(scale * 0.25, scale * 0.25);
  ctx.translate(-200, -400);

  const accent = color;
  const body = '#f4f4f5';

  path(ctx, 'M 60 80 L 340 80 L 340 750 L 280 750 L 280 770 L 120 770 L 120 750 L 60 750 Z', '#0f0f0f');
  for (const x of [130, 160, 198, 236, 266]) roundedRect(ctx, x, 750, 4, 25, 0, '#333');

  path(ctx, 'M 70 50 L 330 50 L 340 90 L 60 90 Z', '#1a1a1a');
  path(ctx, 'M 60 70 L 120 70 L 110 50 L 70 50 Z', accent);
  path(ctx, 'M 340 70 L 280 70 L 290 50 L 330 50 Z', accent);
  path(ctx, 'M 50 110 L 80 130 L 80 140 L 45 115 Z', '#111');
  path(ctx, 'M 350 110 L 320 130 L 320 140 L 355 115 Z', '#111');

  roundedRect(ctx, 50, 120, 40, 90, 4, '#050505');
  roundedRect(ctx, 310, 120, 40, 90, 4, '#050505');
  roundedRect(ctx, 50, 550, 40, 100, 4, '#050505');
  roundedRect(ctx, 310, 550, 40, 100, 4, '#050505');
  path(ctx, 'M 120 150 L 280 150 L 280 500 L 120 500 Z', '#0a0a0a');

  path(ctx, 'M 140 40 L 260 40 C 290 40 330 90 330 160 L 330 230 C 330 250 280 270 280 360 L 280 480 C 280 520 340 540 340 620 L 330 730 L 270 730 L 260 710 L 140 710 L 130 730 L 70 730 L 60 620 C 60 540 120 520 120 480 L 120 360 C 120 270 70 250 70 230 L 70 160 C 70 90 110 40 140 40 Z', body);
  path(ctx, 'M 140 40 L 260 40 L 280 180 L 200 240 L 120 180 Z', accent);
  path(ctx, 'M 280 360 L 330 280 L 330 230 L 280 260 Z', accent);
  path(ctx, 'M 120 360 L 70 280 L 70 230 L 120 260 Z', accent);
  path(ctx, 'M 140 710 L 200 640 L 260 710 Z', '#111');
  path(ctx, 'M 60 620 L 120 550 L 120 710 L 70 730 Z', accent);
  path(ctx, 'M 340 620 L 280 550 L 280 710 L 330 730 Z', accent);

  path(ctx, 'M 120 90 L 150 90 L 140 160 L 100 160 Z', '#111');
  path(ctx, 'M 280 90 L 250 90 L 260 160 L 300 160 Z', '#111');
  path(ctx, 'M 160 50 L 240 50 L 220 110 L 180 110 Z', '#050505');
  path(ctx, 'M 75 70 L 115 60 L 125 140 L 85 140 Z', '#0a0a0a');
  path(ctx, 'M 325 70 L 285 60 L 275 140 L 315 140 Z', '#0a0a0a');

  for (const y of [80, 95, 110]) {
    strokeLine(ctx, 90 - (y - 80) * 0.13, y, 110 - (y - 80) * 0.13, y + 5, '#fef08a', 4);
    strokeLine(ctx, 310 + (y - 80) * 0.13, y, 290 + (y - 80) * 0.13, y + 5, '#fef08a', 4);
  }
  for (const y of [170, 185, 200, 215, 230]) {
    strokeLine(ctx, 85, y, 120, y - 10, '#0a0a0a', 4);
    strokeLine(ctx, 315, y, 280, y - 10, '#0a0a0a', 4);
  }
  strokeLine(ctx, 120, 130, 160, 140, '#444', 3);
  strokeLine(ctx, 120, 150, 160, 140, '#444', 3);
  strokeLine(ctx, 280, 130, 240, 140, '#444', 3);
  strokeLine(ctx, 280, 150, 240, 140, '#444', 3);

  path(ctx, 'M 120 360 L 160 360 L 170 420 L 120 400 Z', '#050505');
  path(ctx, 'M 280 360 L 240 360 L 230 420 L 280 400 Z', '#050505');
  path(ctx, 'M 110 340 L 140 340 L 140 420 L 120 400 Z', '#1a1a1a');
  path(ctx, 'M 290 340 L 260 340 L 260 420 L 280 400 Z', '#1a1a1a');

  path(ctx, 'M 200 240 C 260 240 270 330 250 440 C 235 520 210 560 200 560 C 190 560 165 520 150 440 C 130 330 140 240 200 240 Z', '#0a0a0a');
  path(ctx, 'M 200 250 C 235 250 245 300 240 350 L 160 350 C 155 300 165 250 200 250 Z', '#1a202c');
  path(ctx, 'M 162 350 L 238 350 L 230 410 L 170 410 Z', '#111827');
  path(ctx, 'M 175 260 L 205 330 L 180 340 Z', '#374151');
  strokeLine(ctx, 200, 360, 200, 280, '#333', 3);
  strokeLine(ctx, 200, 280, 215, 255, '#333', 2);

  path(ctx, 'M 185 410 L 215 410 L 210 480 L 190 480 Z', '#1a1a1a');
  path(ctx, 'M 190 415 L 210 415 L 205 440 L 195 440 Z', '#000');
  roundedRect(ctx, 195, 380, 2, 15, 0, body);
  circle(ctx, 196, 380, 2, '#ef4444');
  roundedRect(ctx, 203, 385, 2, 10, 0, body);
  roundedRect(ctx, 197, 480, 6, 230, 0, '#111');
  roundedRect(ctx, 198, 480, 2, 230, 0, accent);
  path(ctx, 'M 197 550 L 203 550 L 203 600 L 197 580 Z', '#222');

  path(ctx, 'M 150 520 L 170 500 L 170 560 L 150 550 Z', '#0a0a0a');
  path(ctx, 'M 250 520 L 230 500 L 230 560 L 250 550 Z', '#0a0a0a');
  strokeLine(ctx, 152, 530, 168, 515, '#222', 2);
  strokeLine(ctx, 152, 540, 168, 525, '#222', 2);
  strokeLine(ctx, 248, 530, 232, 515, '#222', 2);
  strokeLine(ctx, 248, 540, 232, 525, '#222', 2);

  path(ctx, 'M 140 680 L 260 680 L 250 730 L 150 730 Z', '#111');
  strokeLine(ctx, 140, 690, 190, 710, '#444', 4);
  strokeLine(ctx, 260, 690, 210, 710, '#444', 4);
  circle(ctx, 200, 710, 10, '#222');
  circle(ctx, 170, 670, 9, '#050505');
  circle(ctx, 230, 670, 9, '#050505');

  path(ctx, 'M 165 650 L 175 650 L 175 730 L 160 730 Z', '#1a1a1a');
  path(ctx, 'M 235 650 L 225 650 L 225 730 L 240 730 Z', '#1a1a1a');
  roundedRect(ctx, 100, 710, 200, 15, 2, '#0a0a0a');
  roundedRect(ctx, 50, 690, 300, 30, 4, '#111');
  roundedRect(ctx, 55, 705, 290, 10, 0, '#222');
  path(ctx, 'M 50 650 L 60 650 L 60 740 L 50 730 Z', accent);
  path(ctx, 'M 350 650 L 340 650 L 340 740 L 350 730 Z', accent);
  strokeLine(ctx, 52, 670, 58, 670, '#111', 2);
  strokeLine(ctx, 52, 680, 58, 680, '#111', 2);
  strokeLine(ctx, 342, 670, 348, 670, '#111', 2);
  strokeLine(ctx, 342, 680, 348, 680, '#111', 2);

  drawBrakeLights(ctx, clamp(car.brake ?? 0, 0, 1), [
    { x: 80, y: 720, w: 48, h: 8 },
    { x: 272, y: 720, w: 48, h: 8 },
    { x: 196, y: 740, w: 8, h: 8 },
  ]);
  ctx.restore();
}

function drawRallyCar(ctx, car, scale = 0.28) {
  const color = car.color ?? '#fbbf24';
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading + Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.translate(-50, -100);

  const bodyGrad = ctx.createLinearGradient(0, 16, 0, 184);
  bodyGrad.addColorStop(0, color);
  bodyGrad.addColorStop(1, darken(color, 0.54));
  const accent = darken(color, 0.62);

  // Chunky gravel tires and red mudflaps.
  roundedRect(ctx, 5, 38, 15, 33, 2, '#030712');
  roundedRect(ctx, 80, 38, 15, 33, 2, '#030712');
  roundedRect(ctx, 5, 130, 15, 35, 2, '#030712');
  roundedRect(ctx, 80, 130, 15, 35, 2, '#030712');
  roundedRect(ctx, 3, 68, 20, 5, 1, '#dc2626');
  roundedRect(ctx, 77, 68, 20, 5, 1, '#dc2626');
  roundedRect(ctx, 3, 160, 20, 6, 1, '#dc2626');
  roundedRect(ctx, 77, 160, 20, 6, 1, '#dc2626');

  path(ctx, 'M 18 23 L 82 23 L 82 174 L 70 186 L 30 186 L 18 174 Z', '#111827');
  path(ctx, 'M 27 24 L 73 24 C 85 24, 90 38, 90 60 L 80 78 L 80 128 L 90 148 C 90 171, 82 180, 71 180 L 29 180 C 18 180, 10 171, 10 148 L 20 128 L 20 78 L 10 60 C 10 38, 15 24, 27 24 Z', bodyGrad);
  path(ctx, 'M 28 65 L 72 65 L 63 40 L 37 40 Z', accent);
  path(ctx, 'M 32 65 L 68 65 L 59 43 L 41 43 Z', '#111827');
  path(ctx, 'M 10 60 L 20 78 L 20 128 L 10 148 L 10 132 L 16 118 L 16 88 L 10 74 Z', accent);
  path(ctx, 'M 90 60 L 80 78 L 80 128 L 90 148 L 90 132 L 84 118 L 84 88 L 90 74 Z', accent);
  path(ctx, 'M 30 23 L 70 23 L 72 30 L 28 30 Z', '#111827');
  roundedRect(ctx, 32, 38, 10, 7, 2, '#111827');
  roundedRect(ctx, 58, 38, 10, 7, 2, '#111827');
  path(ctx, 'M 23 68 L 77 68 C 71 86, 68 89, 64 89 L 36 89 C 32 89, 29 86, 23 68 Z', '#111827');
  path(ctx, 'M 24 74 L 39 92 L 40 132 L 28 124 Z', '#111827');
  path(ctx, 'M 76 74 L 61 92 L 60 132 L 72 124 Z', '#111827');
  path(ctx, 'M 39 89 L 61 89 L 59 135 L 41 135 Z', bodyGrad);
  path(ctx, 'M 44 92 L 56 92 L 54 105 L 46 105 Z', '#e5e7eb');
  path(ctx, 'M 45 94 L 55 94 L 54 97 L 46 97 Z', '#111827');
  path(ctx, 'M 41 135 L 59 135 L 65 156 L 35 156 Z', '#111827');
  strokeLine(ctx, 42, 140, 58, 153, '#fef08a', 1.5);
  strokeLine(ctx, 58, 140, 42, 153, '#fef08a', 1.5);
  roundedRect(ctx, 23, 170, 54, 7, 2, '#374151');
  roundedRect(ctx, 12, 181, 76, 8, 2, '#111827');
  roundedRect(ctx, 10, 166, 5, 23, 1, '#dc2626');
  roundedRect(ctx, 85, 166, 5, 23, 1, '#dc2626');
  circle(ctx, 68, 184, 3.3, '#1f2937');
  circle(ctx, 68, 184, 2.1, '#d1d5db');

  drawBrakeLights(ctx, clamp(car.brake ?? 0, 0, 1), [
    { x: 23, y: 176, w: 14, h: 5 },
    { x: 63, y: 176, w: 14, h: 5 },
    { x: 47, y: 184, w: 6, h: 4 },
  ]);
  ctx.restore();
}

// Cache parsed Path2D objects by SVG path string — each car model draws the
// same ~30 paths every frame for every one of ~30 cars. Without caching that's
// ~900 Path2D constructions per frame; with caching it's ~30 total ever.
const _pathCache = new Map();

function path(ctx, d, fill) {
  let p = _pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    _pathCache.set(d, p);
  }
  ctx.fillStyle = fill;
  ctx.fill(p);
}

function roundedRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function strokeLine(ctx, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function circle(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawBrakeLights(ctx, brake, lights = [
  { x: 27, y: 176, w: 12, h: 5 },
  { x: 61, y: 176, w: 12, h: 5 },
]) {
  const isOn = brake > 0.18;

  // Brake-off state: dim rectangles, no glow — cheap.
  if (!isOn) {
    ctx.fillStyle = 'rgba(150, 25, 25, 0.25)';
    for (const light of lights) {
      roundedRect(ctx, light.x, light.y, light.w, light.h, Math.min(2, light.h / 2), ctx.fillStyle);
    }
    return;
  }

  // Brake-on state: bright rectangles + halo glow.
  // Avoids ctx.shadowBlur which triggers expensive software rasterisation.
  const center = lights.reduce((sum, light) => ({
    x: sum.x + light.x + light.w / 2,
    y: sum.y + light.y + light.h / 2,
  }), { x: 0, y: 0 });
  center.x /= lights.length;
  center.y /= lights.length;

  ctx.fillStyle = 'rgba(255, 36, 36, 1)';
  for (const light of lights) {
    roundedRect(ctx, light.x, light.y, light.w, light.h, Math.min(2, light.h / 2), ctx.fillStyle);
  }

  const halo = ctx.createRadialGradient(center.x, center.y, 4, center.x, center.y, 38);
  halo.addColorStop(0, 'rgba(255, 46, 46, 0.45)');
  halo.addColorStop(1, 'rgba(255, 30, 30, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, 42, 18, 0, 0, Math.PI * 2);
  ctx.fill();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const _darkenCache = new Map();

function darken(hex, factor) {
  const key = hex + '|' + factor;
  let result = _darkenCache.get(key);
  if (result) return result;
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  result = `rgb(${r}, ${g}, ${b})`;
  _darkenCache.set(key, result);
  return result;
}
