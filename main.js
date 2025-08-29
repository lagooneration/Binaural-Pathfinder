/*
  Binaural Pathfinding — Concept Visualization
  - Three.js scene with two speakers, a subject, and an evolving path.
  - Evolutionary strategy (toy) to demonstrate generational improvement visually.

  Note: This is a concept animation, not a physically accurate acoustics sim.
*/

// ---------- Utilities ----------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function seedRandom(seed) {
  let s = seed >>> 0;
  return function rand() {
    // xorshift32
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Distance attenuation for speaker loudness; not physically accurate, just illustrative
function intensityAtPoint(point, speakerPos, power = 1.0) {
  const d = point.distanceTo(speakerPos) + 0.2; // avoid div by 0
  const I = power / (d * d); // inverse-square approximation
  return I;
}

// ---------- Scene Setup ----------
let renderer, scene, camera, controls, container;
let subjectMesh, speakerL, speakerR, goalMesh, fieldMesh, labelA, labelB;
let ringsL = [], ringsR = [];
let population = [];
let bestPathLine, bestPathHead;
let gen = 0;
let rand = seedRandom(12345);
let TARGET = 'either'; // 'either' | 'left' | 'right'

const WORLD = {
  width: 40,
  depth: 28,
  A: new THREE.Vector3(-16, 0, 10), // start
  B: new THREE.Vector3(16, 0, -8),   // goal
  speakerL: new THREE.Vector3(-10, 0, -6),
  speakerR: new THREE.Vector3(12, 0, 6),
};

const PARAMS = {
  popSize: 28,
  ctrlCount: 4, // number of control points between A and B per genome
  mutationProb: 0.25,
  mutationScale: 4.0,
  crossProb: 0.8,
  stepsPerPath: 140,
  generations: 45,
  autoplay: false,
};

function init() {
  container = document.getElementById('three-container');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 200);
  camera.position.set(0, 26, 38);

  // Controls (robust to missing OrbitControls)
  if (THREE.OrbitControls) {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
  } else {
    controls = enableBasicDragControls(camera, renderer.domElement);
  }

  // Lights
  scene.add(new THREE.HemisphereLight(0x5468ff, 0x0b0c10, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(20, 30, 10);
  scene.add(dir);

  // Ground plane with shader encoding binaural field
  fieldMesh = createFieldMesh(WORLD, 180, 140);
  scene.add(fieldMesh);

  // Speakers (icon sprites)
  speakerL = createSpeaker(0x3b82f6); // blue
  speakerL.position.copy(WORLD.speakerL);
  scene.add(speakerL);
  ringsL = createSpeakerRings(speakerL.position, 0x3b82f6);
  ringsL.forEach(r => scene.add(r));

  speakerR = createSpeaker(0xef4444); // red
  speakerR.position.copy(WORLD.speakerR);
  scene.add(speakerR);
  ringsR = createSpeakerRings(speakerR.position, 0xef4444);
  ringsR.forEach(r => scene.add(r));

  // Start (A) and Goal (B)
  const Amesh = createMarker(0xffffff);
  Amesh.position.copy(WORLD.A);
  scene.add(Amesh);
  labelA = createTextSprite('A', '#e6e9ef');
  labelA.position.copy(WORLD.A).add(new THREE.Vector3(0, 1.4, 0));
  scene.add(labelA);

  goalMesh = createMarker(0x22c55e);
  goalMesh.position.copy(WORLD.B);
  scene.add(goalMesh);
  labelB = createTextSprite('B', '#22c55e');
  labelB.position.copy(WORLD.B).add(new THREE.Vector3(0, 1.4, 0));
  scene.add(labelB);

  // Subject (head)
  const headGeo = new THREE.SphereGeometry(0.7, 20, 16);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, metalness: 0.1, roughness: 0.5 });
  subjectMesh = new THREE.Mesh(headGeo, headMat);
  subjectMesh.position.copy(WORLD.A);
  scene.add(subjectMesh);

  // Best path visuals
  bestPathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }));
  scene.add(bestPathLine);
  bestPathHead = subjectMesh.clone();
  bestPathHead.material = headMat.clone();
  bestPathHead.material.color.set(0x8b5cf6);
  bestPathHead.visible = false;
  scene.add(bestPathHead);

  // Populate initial genomes
  population = makeInitialPopulation();
  // cache base speaker positions for jitter reference
  if (!WORLD.baseSpeakerL) { WORLD.baseSpeakerL = WORLD.speakerL.clone(); }
  if (!WORLD.baseSpeakerR) { WORLD.baseSpeakerR = WORLD.speakerR.clone(); }
  updateHUD();

  window.addEventListener('resize', onResize);
  document.getElementById('year').textContent = new Date().getFullYear();
  document.getElementById('playBtn').addEventListener('click', () => runEvolution(true, TARGET));
  document.getElementById('rerunBtn').addEventListener('click', () => runEvolution(false, TARGET));
  document.getElementById('restartLink').addEventListener('click', (e) => { e.preventDefault(); runEvolution(false, TARGET);});

  // Click picking to choose target speaker
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([speakerL, speakerR], true);
    if (hits.length) {
      const obj = hits[0].object;
      if (obj === speakerL || obj.parent === speakerL) {
        TARGET = 'left';
        updateHUD();
        runEvolution(true, 'left');
      } else if (obj === speakerR || obj.parent === speakerR) {
        TARGET = 'right';
        updateHUD();
        runEvolution(true, 'right');
      }
    }
  });

  animate();

  // Ensure A/B and speakers are framed on first load
  frameImportant();
}

function onResize() {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const w = Math.max(1, rect.width|0), h = Math.max(1, rect.height|0);
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

// ---------- Field Shader ----------
function createFieldMesh(world, nx = 120, nz = 80) {
  const geo = new THREE.PlaneGeometry(world.width, world.depth, nx, nz);
  geo.rotateX(-Math.PI / 2);

  const uniforms = {
    uSpeakerL: { value: world.speakerL },
    uSpeakerR: { value: world.speakerR },
    uTime: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: `
      varying vec3 vPos;
      void main(){
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vPos;
      uniform vec3 uSpeakerL; // blue
      uniform vec3 uSpeakerR; // red
      uniform float uTime;

      float intensity(vec3 p, vec3 s){
        float d = distance(p, s) + 0.2;
        return 1.0 / (d*d);
      }

      void main(){
        float Il = intensity(vPos, uSpeakerL);
        float Ir = intensity(vPos, uSpeakerR);
        float sum = max(Il + Ir, 1e-4);
        float blueness = clamp(Il / sum, 0.0, 1.0);
        float redness  = clamp(Ir / sum, 0.0, 1.0);
        float balance = 1.0 - abs(blueness - redness);
        vec3 color = mix(vec3(0.06,0.18,0.53), vec3(0.86,0.27,0.27), redness);
        color = mix(color, vec3(0.56,0.37,0.96), balance*0.4);
        float grid = 0.1*(abs(fract(vPos.x*0.125-0.5)-0.5)+abs(fract(vPos.z*0.125-0.5)-0.5));
        float alpha = 0.75;
        gl_FragColor = vec4(color - grid, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  mesh.receiveShadow = false;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

// ---------- Scene Elements ----------
function createSpeaker(color) {
  const tex = makeIconTexture(color);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.0, 3.0, 1);
  sprite.position.y = 1.0;
  return sprite;
}

function createSpeakerRings(origin, color) {
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.RingGeometry(0.5 + i*0.4, 0.52 + i*0.4, 48);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI/2;
  mesh.position.copy(origin);
  mesh.position.y = 0.02; // slightly above ground to avoid z-fighting
    rings.push(mesh);
  }
  return rings;
}

function createMarker(color) {
  const g = new THREE.TorusKnotGeometry(0.5, 0.18, 80, 14);
  const m = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.1), roughness: 0.6 });
  const mesh = new THREE.Mesh(g, m);
  return mesh;
}

function createTextSprite(text, color = '#fff') {
  const canvas = document.createElement('canvas');
  const size = 256; canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,size,size);
  ctx.font = 'bold 170px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 18; ctx.strokeText(text, size/2, size/2);
  ctx.fillStyle = color; ctx.fillText(text, size/2, size/2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.0, 2.0, 1);
  return sprite;
}

function makeIconTexture(color) {
  const hex = new THREE.Color(color).getHexString();
  const svg = `<?xml version="1.0"?><svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0' stop-color='#20263a'/>
        <stop offset='1' stop-color='#121624'/>
      </linearGradient>
    </defs>
    <rect x='0' y='0' width='128' height='128' rx='20' fill='url(#g)'/>
    <g fill='none' stroke='#${hex}' stroke-width='6' stroke-linecap='round'>
      <polygon points='22,64 52,42 52,86' fill='#${hex}' stroke='#${hex}'/>
      <path d='M66 46 Q88 64 66 82'/>
      <path d='M80 34 Q114 64 80 94'/>
    </g>
  </svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  const loader = new THREE.TextureLoader();
  const texture = loader.load(url);
  texture.anisotropy = 4;
  return texture;
}

// ---------- Paths and Fitness ----------
function makeGenome() {
  // ctrlCount control points in XZ plane, y fixed at 0
  const pts = [];
  for (let i = 0; i < PARAMS.ctrlCount; i++) {
    pts.push(new THREE.Vector3(
      lerp(WORLD.A.x, WORLD.B.x, (i+1)/(PARAMS.ctrlCount+1)) + (rand()*2-1)*8,
      0,
      lerp(WORLD.A.z, WORLD.B.z, (i+1)/(PARAMS.ctrlCount+1)) + (rand()*2-1)*6
    ));
  }
  return { ctrl: pts, fitness: -Infinity };
}

function makeInitialPopulation() {
  const pop = [];
  for (let i = 0; i < PARAMS.popSize; i++) pop.push(makeGenome());
  return pop;
}

function pathPoints(genome, steps = PARAMS.stepsPerPath) {
  const pts = [WORLD.A, ...genome.ctrl, WORLD.B];
  // Catmull-Rom like interpolation via THREE.CurvePath with Quadratic Beziers
  const curves = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i-1)];
    const p1 = pts[i];
    const p2 = pts[i+1];
    const p3 = pts[Math.min(pts.length-1, i+2)];
    // create control by finite differences
    const t = 0.5;
    const cp1 = new THREE.Vector3().addVectors(p1, new THREE.Vector3().subVectors(p2, p0).multiplyScalar(t/3));
    const cp2 = new THREE.Vector3().addVectors(p2, new THREE.Vector3().subVectors(p1, p3).multiplyScalar(t/3));
    const curve = new THREE.CubicBezierCurve3(p1.clone(), cp1, cp2, p2.clone());
    curves.push(curve);
  }
  const path = new THREE.CurvePath();
  curves.forEach(c => path.add(c));
  return path.getSpacedPoints(steps);
}

function evaluateFitness(genome) {
  const pts = pathPoints(genome, 80);
  let sum = 0;
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const Il = intensityAtPoint(p, WORLD.speakerL, 1.0);
    const Ir = intensityAtPoint(p, WORLD.speakerR, 1.0);
  let loud;
  if (TARGET === 'left') loud = Il; else if (TARGET === 'right') loud = Ir; else loud = Math.max(Il, Ir);
    sum += loud;
    if (i>0) len += pts[i-1].distanceTo(p);
  }
  const distanceCost = len / 80; // normalize
  const goalBonus = 1.0; // always reaches B by construction
  const fitness = sum - 0.25 * distanceCost + goalBonus;
  genome.fitness = fitness;
  return fitness;
}

function tournamentSelect(pop, k = 3) {
  let best = null;
  for (let i = 0; i < k; i++) {
    const g = pop[(rand()*pop.length)|0];
    if (!best || g.fitness > best.fitness) best = g;
  }
  return cloneGenome(best);
}

function crossover(a, b) {
  const child = { ctrl: [], fitness: -Infinity };
  for (let i = 0; i < PARAMS.ctrlCount; i++) {
    const pickA = rand() < 0.5;
    const pa = a.ctrl[i];
    const pb = b.ctrl[i];
    const t = rand();
    const x = pickA ? lerp(pa.x, pb.x, t) : lerp(pb.x, pa.x, t);
    const z = pickA ? lerp(pa.z, pb.z, t) : lerp(pb.z, pa.z, t);
    child.ctrl.push(new THREE.Vector3(x, 0, z));
  }
  return child;
}

function mutate(g) {
  const m = cloneGenome(g);
  for (let i = 0; i < m.ctrl.length; i++) {
    if (rand() < PARAMS.mutationProb) {
      m.ctrl[i].x += (rand()*2-1) * PARAMS.mutationScale;
      m.ctrl[i].z += (rand()*2-1) * PARAMS.mutationScale * 0.8;
    }
  }
  return m;
}

function cloneGenome(g) {
  return { ctrl: g.ctrl.map(p => p.clone()), fitness: g.fitness };
}

// ---------- Evolution Loop & Visualization ----------
let running = false;
let animT = 0;
let animPath = [];
let lastBest = null;

function runEvolution(play = true, target = 'either') {
  if (running) return;
  running = true;
  gen = 0;
  rand = seedRandom((Math.random()*1e9)|0);
  // Add variation: jitter speaker positions only on reseed (not on autoplay)
  if (!play) jitterSpeakers(2.5);
  TARGET = target || TARGET;
  population = makeInitialPopulation();

  // evaluate initial
  population.forEach(evaluateFitness);
  population.sort((a,b)=>b.fitness-a.fitness);
  lastBest = cloneGenome(population[0]);
  showBest(lastBest);
  updateHUD();

  const generations = PARAMS.generations;
  let i = 0;

  function stepGen() {
    if (i >= generations) {
      running = false;
      if (play) playBestPath();
      return;
    }
    i++; gen++;

    const newPop = [];
    // elitism
    newPop.push(cloneGenome(population[0]));

    while (newPop.length < PARAMS.popSize) {
      const p1 = tournamentSelect(population);
      const p2 = tournamentSelect(population);
      let c = rand() < PARAMS.crossProb ? crossover(p1, p2) : (rand()<0.5 ? cloneGenome(p1) : cloneGenome(p2));
      c = mutate(c);
      newPop.push(c);
    }

    newPop.forEach(evaluateFitness);
    newPop.sort((a,b)=>b.fitness-a.fitness);
    population = newPop;

    if (!lastBest || population[0].fitness > lastBest.fitness) {
      lastBest = cloneGenome(population[0]);
      showBest(lastBest);
    }

    updateHUD();

    // animate rings subtly each generation
    pulseRingsOnce();

    // schedule next generation for smooth UI
    setTimeout(stepGen, 250);
  }

  stepGen();
}

function showBest(genome) {
  // Compute spaced points for visual line with per-vertex color reflecting binaural balance
  const pts = pathPoints(genome, 180);
  animPath = pts;

  const positions = new Float32Array(pts.length * 3);
  const colors = new Float32Array(pts.length * 3);
  const color = new THREE.Color();

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    positions[i*3] = p.x; positions[i*3+1] = p.y; positions[i*3+2] = p.z;
    const Il = intensityAtPoint(p, WORLD.speakerL);
    const Ir = intensityAtPoint(p, WORLD.speakerR);
    const sum = Math.max(Il + Ir, 1e-5);
    const blueness = clamp(Il / sum, 0, 1);
    const redness = clamp(Ir / sum, 0, 1);
    // Blend to purple when balanced
    color.setRGB(0.06*blueness + 0.86*redness, 0.18*blueness + 0.27*redness, 0.53*blueness + 0.27*redness);
    colors[i*3] = color.r; colors[i*3+1] = color.g; colors[i*3+2] = color.b;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  bestPathLine.geometry.dispose();
  bestPathLine.geometry = geom;
  bestPathLine.material.opacity = 1.0;

  animT = 0;
  bestPathHead.visible = false;
  subjectMesh.position.copy(WORLD.A);
}

function playBestPath() {
  animT = 0;
  bestPathHead.visible = true;
}

function pulseRingsOnce() {
  const play = (rings) => {
    rings.forEach((r, i) => {
      r.scale.setScalar(1 + i*0.02);
      r.material.opacity = 0.7;
    });
  };
  play(ringsL); play(ringsR);
}

function updateHUD() {
  document.getElementById('genLabel').textContent = String(gen);
  const best = population && population[0] ? population[0].fitness : 0;
  document.getElementById('fitLabel').textContent = best.toFixed(3);
  const tgt = TARGET === 'left' ? 'Left' : TARGET === 'right' ? 'Right' : 'Either';
  const el = document.getElementById('targetLabel'); if (el) el.textContent = tgt;
}

// ---------- Main Animation Loop ----------
function animate() {
  requestAnimationFrame(animate);

  // ring breathing
  const t = performance.now() * 0.001;
  [...ringsL, ...ringsR].forEach((r, i) => {
    const s = 1 + 0.15*Math.sin(t*1.8 + i*0.8);
    r.scale.setScalar(s);
    r.material.opacity = 0.36 + 0.28*Math.sin(t*2.0 + i*0.6 + (r.position.x>0?1:0));
  });

  if (fieldMesh && fieldMesh.userData.uniforms) {
    fieldMesh.userData.uniforms.uTime.value = t;
  }

  // move head along animPath when playing
  if (bestPathHead.visible && animPath.length>1) {
    animT = Math.min(1, animT + 0.005);
    const f = animT * (animPath.length - 1);
    const i = Math.floor(f);
    const a = animPath[i], b = animPath[Math.min(animPath.length-1, i+1)];
    const p = new THREE.Vector3().lerpVectors(a, b, f - i);
    bestPathHead.position.copy(p);

    // color shift according to balance at p
    const Il = intensityAtPoint(p, WORLD.speakerL);
    const Ir = intensityAtPoint(p, WORLD.speakerR);
    const sum = Math.max(Il + Ir, 1e-5);
    const blueness = clamp(Il / sum, 0, 1);
    const redness = clamp(Ir / sum, 0, 1);
    const c = new THREE.Color(0.06*blueness + 0.86*redness, 0.18*blueness + 0.27*redness, 0.53*blueness + 0.27*redness);
    bestPathHead.material.color.copy(c);
  }

  controls.update();
  renderer.render(scene, camera);
}

// ---------- Bootstrap ----------
window.addEventListener('DOMContentLoaded', init);

// Basic drag controls fallback (left drag orbit, wheel zoom)
function enableBasicDragControls(cam, dom) {
  let isDown = false; let lx=0, ly=0; let theta=0.8, phi=0.9; let radius = 46; const target = new THREE.Vector3(0,0,0);
  function updateCam(){
    radius = Math.max(6, Math.min(120, radius));
    phi = Math.max(0.05, Math.min(Math.PI-0.05, phi));
    const x = target.x + radius * Math.sin(phi) * Math.sin(theta);
    const y = target.y + radius * Math.cos(phi);
    const z = target.z + radius * Math.sin(phi) * Math.cos(theta);
    cam.position.set(x,y,z);
    cam.lookAt(target);
  }
  updateCam();
  dom.addEventListener('pointerdown', e=>{ isDown = true; lx = e.clientX; ly = e.clientY; dom.setPointerCapture(e.pointerId); });
  dom.addEventListener('pointerup', e=>{ isDown = false; dom.releasePointerCapture(e.pointerId); });
  dom.addEventListener('pointermove', e=>{
    if (!isDown) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    theta -= dx * 0.005; phi -= dy * 0.005; updateCam();
  });
  dom.addEventListener('wheel', e=>{ radius += Math.sign(e.deltaY) * 2.0; updateCam(); });
  return {
    update: ()=>{},
    setTargetRadius: (center, r)=>{ target.copy(center); radius = r; updateCam(); }
  };
}

// --- Speaker jitter to vary the field on reseed ---
function jitterSpeakers(amount = 2.5) {
  // keep around original bases
  const baseL = WORLD.baseSpeakerL || WORLD.speakerL.clone();
  const baseR = WORLD.baseSpeakerR || WORLD.speakerR.clone();
  const j = () => (rand()*2 - 1) * amount;
  WORLD.speakerL.set(baseL.x + j(), 0, baseL.z + j());
  WORLD.speakerR.set(baseR.x + j(), 0, baseR.z + j());
  // keep them separate (min distance)
  const minDist = 6.0;
  if (WORLD.speakerL.distanceTo(WORLD.speakerR) < minDist) {
    // push R away from L along x
    if (WORLD.speakerR.x <= WORLD.speakerL.x) WORLD.speakerR.x = WORLD.speakerL.x + minDist;
    else WORLD.speakerR.x = WORLD.speakerL.x - minDist;
  }
  // reflect in scene objects
  speakerL.position.copy(WORLD.speakerL);
  speakerR.position.copy(WORLD.speakerR);
  ringsL.forEach(r=>{ r.position.x = WORLD.speakerL.x; r.position.z = WORLD.speakerL.z; });
  ringsR.forEach(r=>{ r.position.x = WORLD.speakerR.x; r.position.z = WORLD.speakerR.z; });
  if (fieldMesh && fieldMesh.userData && fieldMesh.userData.uniforms) {
    // uniforms reference the same vectors, so set() above already updates; ensure render picks it up
    fieldMesh.userData.uniforms.uSpeakerL.value = WORLD.speakerL;
    fieldMesh.userData.uniforms.uSpeakerR.value = WORLD.speakerR;
  }
  frameImportant();
}

// Frame camera to include A/B and speakers
function frameImportant(pad = 1.25) {
  const pts = [WORLD.A, WORLD.B, WORLD.speakerL, WORLD.speakerR];
  const box = new THREE.Box3();
  pts.forEach(p=> box.expandByPoint(p));
  const center = new THREE.Vector3(); box.getCenter(center);
  const size = new THREE.Vector3(); box.getSize(size);
  const radius = 0.5 * Math.max(size.x, size.z) * pad + 6;

  if (controls && controls.target) {
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    controls.target.copy(center);
    camera.position.copy(center).add(dir.multiplyScalar(Math.max(radius, 16)));
  } else if (controls && typeof controls.setTargetRadius === 'function') {
    controls.setTargetRadius(center, Math.max(radius, 16));
  } else {
    camera.position.set(center.x + Math.max(radius, 16), center.y + Math.max(radius*0.6, 10), center.z + Math.max(radius, 16));
    camera.lookAt(center);
  }
  camera.updateProjectionMatrix();
}
