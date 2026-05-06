# SAMOchodziki 2.0

Neuroevolution racing simulator built as a static browser app. Draw a track, generate one automatically, then watch a population of small cars learn to drive it over generations.

## Features

- Draw or erase a custom track directly on the canvas.
- Generate a random closed track when you want to start quickly.
- Simulate cars driven by simple neural networks and genetic evolution.
- Watch generation progress, best distance, leaderboard, and the leader network.
- Toggle track, walls, centerline, and sensor visualization.
- Decorative environment with trees, tyre barriers, rocks, bridges, and start/finish gates.

## Getting Started

Requirements:

- Node.js 18+ recommended.
- A local static file server.

Run locally:

```bash
npx serve -l 5173
```

Then open:

```text
http://localhost:5173
```

Build static output:

```bash
npm run build
```

## How To Use

1. Open the app in the browser.
2. In Track editor mode, either draw a track manually or click Random track.
3. Use Eraser or Clear track if you want to redraw.
4. Switch to Simulate or press Start / pause.
5. Let cars run through generations and compare progress in the telemetry panel.

Notes:

- The editor currently supports one active track at a time.
- Once a track is drawn or generated, drawing is locked until the track is cleared.
- Simulation mode disables drawing tools so the track cannot be edited mid-run.

## Project Structure

```text
index.html              App shell and UI markup
styles.css              UI and canvas styling
src/main.js             App state, UI wiring, render loop
src/editor.js           Canvas drawing and erasing input
src/track.js            Track geometry, bridges, props, gates
src/render.js           Canvas renderer for track, props, cars, UI overlays
src/simulation.js       Car simulation and generation lifecycle
src/brain.js            Neural network and genetic algorithm helpers
src/carSprite.js        Car rendering
src/bridges.js          Bridge detection/rendering helpers
public/props/           SVG prop assets
scripts/build-static.mjs Static build script
```

## Deployment

The project is designed to deploy as a static site. Build with:

```bash
npm run build
```

Serve or upload the generated static output according to your hosting provider.

