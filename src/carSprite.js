export function drawCar(ctx, car, scale = 0.28) {
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

  drawBrakeLights(ctx, clamp(car.brake ?? 0, 0, 1));

  ctx.restore();
}

function path(ctx, d, fill) {
  const p = new Path2D(d);
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

function drawBrakeLights(ctx, brake) {
  const isOn = brake > 0.18;
  const intensity = isOn ? 1 : 0.22;
  const glow = isOn ? 34 : 0;

  ctx.save();
  ctx.shadowColor = isOn ? 'rgba(255, 22, 22, 1)' : 'rgba(255, 22, 22, 0)';
  ctx.shadowBlur = glow;
  ctx.fillStyle = isOn ? `rgba(255, 36, 36, ${intensity})` : 'rgba(150, 25, 25, 0.25)';
  roundedRect(ctx, 27, 176, 12, 5, 2, ctx.fillStyle);
  roundedRect(ctx, 61, 176, 12, 5, 2, ctx.fillStyle);

  if (isOn) {
    const halo = ctx.createRadialGradient(50, 180, 4, 50, 180, 38);
    halo.addColorStop(0, 'rgba(255, 46, 46, 0.45)');
    halo.addColorStop(1, 'rgba(255, 30, 30, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(50, 180, 42, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function darken(hex, factor) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}
