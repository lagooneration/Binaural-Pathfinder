# Binaural Pathfinding — Concept Proposal

An interactive 3D concept showing evolution-inspired pathfinding for a subject traveling from A→B in a scene with two speakers. The ground visualizes a binaural sound field; the evolving path is colored by left/right loudness balance.

## Features
- Three.js 3D scene (no build tools; CDN only)
- Evolving paths via a small evolutionary strategy (generations shown in HUD)
- Speaker rings and ground shader to suggest acoustic fields
- UI to play the concept animation and re-run evolution

## Run locally
Use any static server. Examples below.

### Option 1: Python (built-in on many systems)
```pwsh
# Serve the current folder on http://localhost:5500
python -m http.server 5500 --directory "p:\ML\binaural"
```

### Option 2: Node (if you have npx)
```pwsh
npx serve -l 5500 "p:\ML\binaural"
```

Then open:
```
http://localhost:5500/
```

## Structure
- `index.html`: Page layout and UI
- `styles.css`: Visual design
- `main.js`: Three.js scene, evolution loop, and animation

## Notes
This is an illustrative concept, not a physically accurate acoustics simulation. Fitness uses a simple inverse-square intensity heuristic and a small distance penalty to encourage efficient but acoustically favorable routes.

## How to run
I started a local server on your machine (port 5500). If you need to run it again, pick one:
```pwsh
# Python
python -m http.server 5500 --directory "p:\ML\binaural"
```
```pwsh
# Node (optional)
npx serve -l 5500 "p:\ML\binaural"
```

Then open:
```
http://localhost:5500/
```

## Usage

Click “Play Concept Animation” to evolve and then animate the best path.
Click “Re-run Evolution” anytime to reseed and compare outcomes.
Drag to orbit the camera.