// DRIFTLINE - main game loop, menus, race orchestration.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { TRACKS, Track } from './track.js';
import { buildWorld } from './world.js';
import { CAR_LIST, PAINTS, CarFactory, Vehicle } from './vehicle.js';
import { RacerAI, TrafficManager, PoliceManager } from './ai.js';
import { Particles, GlowPoints, SkidMarks, GroundQuads, SpeedLines, radialTexture, GradeShader } from './fx.js';
import { AudioEngine } from './audio.js';
import { HUD, fmtTime, ordinal } from './hud.js';
import { Input } from './input.js';
import { Career, UPGRADES, MAX_LEVEL, upgradedSpec, money } from './career.js';

const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (a, b, k, dt) => a + wrapA(b - a) * (1 - Math.exp(-k * dt));

// ------------------------------------------------------------------ settings
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const DEFAULTS = { volume: 0.8, quality: 'high', camera: 0, autoGas: false, tilt: false, fps: false, car: 0, paint: 7, stripes: true, track: 0, difficulty: 'normal', traffic: true, police: true };
// AI pace: skill scaling, slow-down when ahead of you, catch-up when behind you
const DIFFICULTY = {
  easy: { label: 'Easy', skill: s => s * 0.9, ahead: 0.11, behind: 0.03 },
  normal: { label: 'Medium', skill: s => s, ahead: 0.075, behind: 0.075 },
  hard: { label: 'Hard', skill: s => 1 - (1 - s) * 0.35, ahead: 0.03, behind: 0.09 },
};
function updateRaceOpts() {
  document.querySelectorAll('[data-diff]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.diff === settings.difficulty)));
  document.querySelectorAll('[data-opt]').forEach(b => b.setAttribute('aria-pressed', String(!!settings[b.dataset.opt])));
  $('diffName').textContent = diff().label;
}
const diff = () => DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('driftline.v2') || '{}')); } catch (e) { /* storage unavailable */ }
// phones: start on Medium graphics so the GPU and memory budget hold up (can be raised in Settings)
if (!('quality' in (() => { try { return JSON.parse(localStorage.getItem('driftline.v2') || '{}'); } catch (e) { return {}; } })())
  && isTouch && Math.min(screen.width, screen.height) < 500) settings.quality = 'medium';
const saveSettings = () => { try { localStorage.setItem('driftline.v2', JSON.stringify(settings)); } catch (e) { /* ignore */ } };

// ------------------------------------------------------------------ renderer
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
let composer, renderPass, ao = null, bloom, grade, pixelRatio = 1, maxPR = 1;
// ambient occlusion runs at a fraction of the screen resolution
const AO_SCALE = { high: 0.5, ultra: 1 };
const speedLines = new SpeedLines($('speedlines'));

function setupComposer() {
  const q = settings.quality;
  setupReflections();
  maxPR = Math.min(window.devicePixelRatio || 1, q === 'ultra' ? 2.5 : q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
  pixelRatio = maxPR;
  renderer.setPixelRatio(pixelRatio);
  if (composer) composer.dispose();
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q === 'low' ? 0 : q === 'medium' ? 2 : 4 });
  composer = new EffectComposer(renderer, rt);
  renderPass = new RenderPass(new THREE.Scene(), camera);
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.85);
  bloom.enabled = q !== 'low';
  grade = new ShaderPass(GradeShader);
  grade.enabled = q !== 'low';
  grade.uniforms.uTaps.value = q === 'ultra' ? 10 : q === 'high' ? 7 : 0;
  composer.addPass(renderPass);
  ao = null;
  if (AO_SCALE[q]) {
    ao = new GTAOPass(new THREE.Scene(), camera, 64, 64);
    const aoScale = AO_SCALE[q];
    ao.setSize = (w, h) => GTAOPass.prototype.setSize.call(ao, Math.max(1, Math.round(w * aoScale)), Math.max(1, Math.round(h * aoScale)));
    ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.6, thickness: 2.2, scale: 1.15, samples: q === 'ultra' ? 16 : 12, distanceFallOff: 0.8, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    ao.blendIntensity = 1;
    // background layers (sky, distant hills, water: materials without fog) stay out of the occlusion pass
    const baseHide = ao.overrideVisibility.bind(ao);
    ao.overrideVisibility = () => {
      baseHide();
      ao.scene.traverse(o => { if (o.material && (o.material.fog === false || o.material.transparent)) o.visible = false; });
    };
    composer.addPass(ao);
  }
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  garageCam.aspect = w / h;
  garageCam.updateProjectionMatrix();
  speedLines.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
  const pScale = h * pixelRatio * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  if (race) for (const p of [race.fx.smoke, race.fx.sparks, race.fx.glow, ...race.world.glowPoints]) p.mat.uniforms.scale.value = pScale;
}
window.addEventListener('resize', () => resize());

// ------------------------------------------------------------------ globals
const input = new Input($('touch'));
input.autoGas = settings.autoGas;
const audio = new AudioEngine();
audio.volume = settings.volume;
const hud = new HUD();
const career = new Career();
input.tilt = settings.tilt;
let assets = null, factory = null, race = null;
let state = 'loading';
const garage = { scene: new THREE.Scene(), table: new THREE.Group(), car: null, carKey: '', angle: 0.7, spin: 0, dragX: null };
const garageCam = new THREE.PerspectiveCamera(34, 1, 0.1, 200);

if (isTouch) document.documentElement.classList.add('touch');

// ------------------------------------------------------------------ screens
const screens = ['loading', 'title', 'garage', 'pause', 'results'];
function show(name) {
  for (const s of screens) $('scr-' + s).hidden = s !== name;
  $('scr-settings').hidden = true;
  $('scr-upgrades').hidden = true;
}

function setState(s) {
  state = s;
  if (isTouch) keepAwake(s === 'race' || s === 'paused');
  document.documentElement.dataset.state = s;
}

// ------------------------------------------------------------------ garage
function studioEnv() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0xe9edf2);
  const add = (w, h, x, y, z, c) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 1, 0); s.add(m);
  };
  add(34, 6, 0, 16, 0, new THREE.Color(4, 4, 4));
  add(10, 16, -18, 5, -4, new THREE.Color(2.2, 2.2, 2.3));
  add(10, 16, 18, 5, -4, new THREE.Color(2.2, 2.2, 2.3));
  add(16, 5, 0, 3, 20, new THREE.Color(1.8, 1.8, 1.8));
  add(6, 10, -12, 3, 16, new THREE.Color(2.4, 1.3, 0.6));
  add(200, 200, 0, -5, 0, new THREE.Color(0.75, 0.77, 0.8));
  const pm = new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return t;
}

function buildGarage() {
  const s = garage.scene;
  s.background = new THREE.Color(0xeef1f5);
  s.fog = new THREE.Fog(0xeef1f5, 22, 60);
  s.environment = studioEnv();
  // seamless cyclorama: flat floor curving up into a back wall
  const cyc = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 72), new THREE.MeshStandardMaterial({ color: 0xd2d7de, roughness: 0.32, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  cyc.add(floor);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 30, 72, 1, true, Math.PI * 0.55, Math.PI * 0.9), new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.9, side: THREE.BackSide }));
  wall.position.set(0, 15, 0);
  cyc.add(wall);
  s.add(cyc);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.75, 0.12, 72), new THREE.MeshStandardMaterial({ color: 0xd3d8de, roughness: 0.25, metalness: 0.6 }));
  disc.position.y = 0.06;
  disc.receiveShadow = true;
  garage.table.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.68, 0.035, 8, 120), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.75, 0.15) }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.12;
  s.add(ring);
  s.add(garage.table);
  // softbox light panels hanging over the car
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.4) });
  for (const x of [-4, 0, 4]) {
    const pnl = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 6), panelMat);
    pnl.position.set(x, 9.5, -1);
    s.add(pnl);
  }
  s.add(new THREE.HemisphereLight(0xffffff, 0xb9bec6, 0.85));
  const key = new THREE.DirectionalLight(0xfff6ec, 2.2);
  key.position.set(5, 12, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const kc = key.shadow.camera;
  kc.left = -7; kc.right = 7; kc.top = 7; kc.bottom = -7; kc.near = 1; kc.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 6;
  s.add(key);
  const rim = new THREE.DirectionalLight(0xffd2a8, 1.1);
  rim.position.set(-8, 4, -8);
  s.add(rim);
}

function updateTrackCards() {
  document.querySelectorAll('.trackcard').forEach((b, i) => b.setAttribute('aria-pressed', String(i === settings.track)));
}

function garageCar() {
  updateTrackCards();
  const key = `${settings.car}|${settings.paint}|${settings.stripes}`;
  if (garage.carKey === key) return;
  const spec = CAR_LIST[settings.car];
  if (!garage.car || garage.carId !== spec.id) {
    if (garage.car) garage.table.remove(garage.car.root);
    garage.car = factory.create(spec.id, PAINTS[settings.paint].hex, { physical: true, flames: false, shadows: true, stripes: settings.stripes });
    garage.car.root.position.y = 0.12;
    garage.table.add(garage.car.root);
    garage.carId = spec.id;
    garage.spin = 0.9;
  } else {
    garage.car.paint.color.set(PAINTS[settings.paint].hex);
    factory.setStripes(garage.car.paint, settings.stripes);
  }
  garage.carKey = key;
  // UI
  $('carName').textContent = spec.name;
  $('carClass').textContent = spec.klass;
  updateCarStats();
  $('carIdx').textContent = `${settings.car + 1} / ${CAR_LIST.length}`;
  document.querySelectorAll('.swatch').forEach((b, i) => b.setAttribute('aria-pressed', String(i === settings.paint)));
  $('paintName').textContent = PAINTS[settings.paint].name;
  document.querySelectorAll('[data-livery]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.livery === 'stripes') === !!settings.stripes)));
}

/** stat bars (base + bought upgrades), top speed, cash and the upgrade button */
function updateCarStats() {
  const spec = CAR_LIST[settings.car];
  const lv = career.levels(spec.id);
  const up = upgradedSpec(spec, lv);
  for (const k of ['speed', 'accel', 'handling', 'drift']) {
    const b = $('bar-' + k);
    b.style.setProperty('--v', spec.bars[k]);
    b.style.setProperty('--u', up.bars[k]);
  }
  $('topSpeed').textContent = Math.round(up.top * 3.6 * 0.95 / 5) * 5 + ' km/h';
  const total = UPGRADES.reduce((n, g) => n + lv[g.key], 0);
  $('upSummary').textContent = `${total} / ${UPGRADES.length * MAX_LEVEL}`;
  const canBuy = UPGRADES.some(g => { const p = career.price(spec.id, g.key); return p !== null && p <= career.cash; });
  $('btnUpgrades').classList.toggle('can', canBuy);
  $('cashAmt').textContent = money(career.cash);
}

function renderUpgrades() {
  const spec = CAR_LIST[settings.car];
  const lv = career.levels(spec.id);
  $('upCar').textContent = spec.name;
  $('upCash').textContent = money(career.cash);
  const list = $('upList');
  list.innerHTML = '';
  for (const g of UPGRADES) {
    const row = document.createElement('div');
    row.className = 'uprow';
    const l = lv[g.key], price = career.price(spec.id, g.key);
    row.innerHTML = '<div class="un"><span></span><em></em></div><div class="ud"></div><div class="pips"></div><button class="buy"></button>';
    row.querySelector('.un span').textContent = g.name;
    row.querySelector('.un em').textContent = l ? g.fx(l) : '';
    row.querySelector('.ud').textContent = g.desc;
    const pips = row.querySelector('.pips');
    for (let i = 0; i < MAX_LEVEL; i++) { const p = document.createElement('i'); if (i < l) p.className = 'on'; pips.appendChild(p); }
    pips.setAttribute('aria-label', `Level ${l} of ${MAX_LEVEL}`);
    const b = row.querySelector('.buy');
    if (price === null) { b.className = 'buy max'; b.disabled = true; b.innerHTML = 'MAXED<small>LEVEL 5</small>'; }
    else {
      b.innerHTML = `${money(price)}<small>${price <= career.cash ? 'BUY LEVEL ' + (l + 1) : 'NEED ' + money(price - career.cash)}</small>`;
      b.disabled = price > career.cash;
      b.setAttribute('aria-label', `Buy ${g.name} level ${l + 1} for ${money(price)}`);
      b.addEventListener('click', () => {
        audio.init();
        if (!career.buy(spec.id, g.key)) return;
        audio.nitroFull();
        renderUpgrades();
        updateCarStats();
        garage.spin = 0.6;
      });
    }
    list.appendChild(row);
  }
}

function renderGarage(dt) {
  garage.spin = damp(garage.spin, 0, 2, dt);
  if (garage.dragX === null) garage.angle += dt * (0.18 + garage.spin);
  garage.table.rotation.y = garage.angle;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const r = aspect < 1.4 ? 15 : aspect < 1.9 ? 12.5 : 11.5;
  garageCam.position.set(Math.sin(0.45) * r, 2.6, Math.cos(0.45) * r);
  garageCam.lookAt(0, aspect < 1.4 ? 1.1 : 0.45, 0);
  renderPass.scene = garage.scene;
  renderPass.camera = garageCam;
  if (ao) { ao.scene = garage.scene; ao.camera = garageCam; ao.blendIntensity = 0.75; }
  bloom.enabled = false;
  if (pixelRatio !== maxPR) { pixelRatio = maxPR; renderer.setPixelRatio(pixelRatio); resize(); }
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  if (grade) { grade.uniforms.uBlur.value = 0; grade.uniforms.uSunOn.value = 0; grade.uniforms.uCA.value = 0; grade.uniforms.uVig.value = 0.12; grade.uniforms.uSat.value = 1.08; grade.uniforms.uContrast.value = 1.05; grade.uniforms.uGrain.value = 0; }
  composer.render(dt);
}

function drawTrackPreview(cv, track) {
  const g = cv.getContext('2d');
  const W = cv.width = 240, H = cv.height = 150;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < track.N; i++) { minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]); minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]); }
  const sc = Math.min((W - 30) / (maxX - minX), (H - 30) / (maxZ - minZ));
  const P = i => [W / 2 - (track.px[i] - (minX + maxX) / 2) * sc, H / 2 - (track.pz[i] - (minZ + maxZ) / 2) * sc];
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i <= track.N; i += 3) { const [x, y] = P(i % track.N); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath();
  g.strokeStyle = 'rgba(17,22,31,0.12)'; g.lineWidth = 9; g.stroke();
  g.strokeStyle = { coast: '#00a7c7', city: '#11161f', canyon: '#ff6b1a' }[track.def.theme]; g.lineWidth = 3; g.stroke();
  const [sx, sy] = P(0);
  g.fillStyle = '#ff6b1a'; g.beginPath(); g.arc(sx, sy, 4, 0, Math.PI * 2); g.fill();
}

// ------------------------------------------------------------------ race setup
const NAMES = ['KATO', 'NYX', 'BLAZE', 'ROOK', 'SABLE', 'VEX', 'MAKO', 'JINX'];
const MAP_COLORS = ['#e53935', '#f2b600', '#22a447', '#1e88e5', '#ff9f43', '#00a7c7', '#8d6e63', '#64748b'];
const UNDERGLOW = ['#ff6b1a', '#00a7c7', '#22a447', '#1e88e5', '#ff9f43', '#e53935', '#f2b600', '#64748b'];

function makeFx(scene, night, theme) {
  const smokeTex = radialTexture([[0, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
  const sparkTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,200,120,0.8)'], [1, 'rgba(0,0,0,0)']], 64);
  const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.55)'], [0.45, 'rgba(255,255,255,0.12)'], [1, 'rgba(0,0,0,0)']]);
  const blobTex = radialTexture([[0, 'rgba(0,0,0,0.75)'], [0.55, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]);
  const beamTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 256, 0, 0);
    grd.addColorStop(0, 'rgba(255,240,215,0.55)'); grd.addColorStop(0.45, 'rgba(255,240,215,0.18)'); grd.addColorStop(1, 'rgba(255,240,215,0)');
    g.filter = 'blur(10px)';
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(54, 250); g.lineTo(74, 250); g.lineTo(118, 6); g.lineTo(10, 6); g.closePath(); g.fill();
    g.filter = 'none';
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const fx = {
    smoke: new Particles(settings.quality === 'low' ? 260 : 600, smokeTex, THREE.NormalBlending),
    sparks: new Particles(300, sparkTex, THREE.AdditiveBlending),
    skid: new SkidMarks(settings.quality === 'low' ? 900 : 1800, theme === 'city' ? 0x050506 : 0x1a1410, theme === 'city' ? 0.6 : 0.5),
    shadows: new GroundQuads(40, blobTex, { opacity: 0.9 }),
    glow: new GlowPoints(320, glowTex),
    beams: night ? new GroundQuads(40, beamTex, { additive: true, opacity: 0.3 }) : null,
    under: night ? new GroundQuads(12, radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(0,0,0,0)']]), { additive: true, opacity: 0.8, colorful: true }) : null,
    dustColor: theme === 'canyon' ? [0.86, 0.74, 0.6] : [0.9, 0.9, 0.9],
    dirtColor: theme === 'canyon' ? [0.8, 0.62, 0.45] : theme === 'coast' ? [0.78, 0.72, 0.55] : [0.75, 0.75, 0.74],
  };
  scene.add(fx.smoke.points, fx.sparks.points, fx.skid.mesh, fx.shadows.mesh, fx.glow.points);
  if (fx.beams) scene.add(fx.beams.mesh);
  if (fx.under) scene.add(fx.under.mesh);
  return fx;
}

function disposeRace() {
  if (!race) return;
  race.scene.traverse(o => {
    if (o.geometry && !o.userData.shared) o.geometry.dispose?.();
  });
  race = null;
}

function startRace() {
  disposeRace();
  const def = TRACKS[settings.track];
  const track = new Track(def);
  const world = buildWorld(track, assets, { renderer, quality: settings.quality });
  const scene = world.scene;
  const fx = makeFx(scene, world.night, def.theme);
  const shadowsOn = settings.quality !== 'low';

  const pSpec = upgradedSpec(CAR_LIST[settings.car], career.levels(CAR_LIST[settings.car].id));
  const player = new Vehicle(pSpec, factory.create(pSpec.id, PAINTS[settings.paint].hex, { physical: true, shadows: shadowsOn, stripes: settings.stripes }), { name: 'YOU', isPlayer: true });
  player.mapColor = '#ff6b1a';
  player.under = '#ff6b1a';
  const ais = [];
  const paints = PAINTS.map(p => p.hex).filter((_, i) => i !== settings.paint);
  const skills = [1.0, 0.99, 0.982, 0.974, 0.966, 0.958, 0.95, 0.94];
  for (let i = 0; i < 8; i++) {
    const spec = CAR_LIST[(settings.car + 1 + i) % CAR_LIST.length];
    const vis = factory.create(spec.id, paints[i % paints.length], { physical: settings.quality === 'high' || settings.quality === 'ultra', shadows: shadowsOn, stripes: i % 3 === 0 });
    const car = new Vehicle(spec, vis, { name: NAMES[i] });
    car.mapColor = MAP_COLORS[i];
    car.under = UNDERGLOW[i];
    car.ai = new RacerAI(car, track, diff().skill(skills[i]), { drifter: i % 3 !== 1, bias: ((i % 3) - 1) * 1.6 });
    ais.push(car);
  }
  const grid = [...ais.slice(0, 6), player, ...ais.slice(6)];
  const lanes = def.width >= 20 ? [-5.5, 0, 5.5] : [-4.5, 0, 4.5];
  grid.forEach((car, k) => {
    const row = Math.floor(k / 3), col = k % 3;
    car.place(track, -8 - row * 10 - col * 1.5, lanes[col]);
    car.lapCount = -1; car.maxLap = 0;
    car.progress = car.s - track.L;
    car.splits = new Float32Array(Math.ceil(def.laps * track.L / 25) + 40);
    car.splitIdx = -1;
    scene.add(car.root);
  });

  const traffic = new TrafficManager(track, factory, scene, !settings.traffic ? 0 : settings.quality === 'low' ? (def.theme === 'city' ? 10 : 7) : (def.theme === 'city' ? 16 : def.theme === 'coast' ? 9 : 11));
  traffic.initialPlace();
  const police = new PoliceManager(track, factory, scene, {
    enabled: settings.police,
    onSpawn: n => { hud.message(n > 1 ? 'BACKUP INCOMING' : 'POLICE PURSUIT', 'police', 2); audio.heatUp(); },
    onBusted: () => { player.bustedT = 3.2; hud.message('BUSTED', 'police big', 3); audio.busted(); race.shake += 0.4; race.busts++; },
    onEscaped: () => { hud.message('ESCAPED', 'good', 2); audio.escaped(); player.nitro = Math.min(1, player.nitro + 0.35); hud.chip('ESCAPE BONUS', '+35% NITRO', 'nitro'); race.style += 2500; },
  });

  race = {
    track, world, scene, fx, player, ais, cars: grid, traffic, police,
    theme: def.theme, laps: def.laps, time: 0, phase: 'intro', phaseT: 0,
    standings: grid.slice(), finishOrder: [], style: 0, busts: 0,
    drift: { active: false, pts: 0, mul: 1, time: 0, idle: 0 },
    shake: 0, wrongWay: 0, lastCount: -1, resultsShown: false, slipT: 0, slipOn: false,
    allCars: [...grid, ...traffic.cars, ...police.pool],
    gap(c) {
      const p = this.player;
      const ahead = c.progress > p.progress;
      const idx = ahead ? p.splitIdx : c.splitIdx;
      if (idx < 0) return null;
      const tc = c.splits[idx], tp = p.splits[idx];
      if (!tc || !tp) return null;
      return ahead ? -(tp - tc) : (tc - tp);
    },
  };
  for (const cop of police.pool) scene.add(cop.root);
  carReflections(player);
  cam.init = false;
  cam.mode = settings.camera;
  hud.setupRace(race);
  resize();
  setState('race');
  show(null);
  hud.show(false);
  $('touch').hidden = !isTouch;
  audio.init();
  audio.setRaceAudio(true);
  $('introTitle').textContent = def.name;
  $('introSub').textContent = `${def.laps} LAPS · ${(track.L / 1000).toFixed(1)} KM · ${def.time.toUpperCase()}`;
  $('intro').className = 'intro on';
  if (world.setLights) world.setLights(0);
  acc = 0;
  warmUp();
}

/** compile every shader and fill the reflection map before the intro, so the fly-around doesn't stutter */
function warmUp() {
  const R = race;
  try {
    for (const c of R.allCars) if (!c.hidden) c.render(1, 0);
    chasePose(R.player, cam.mode);
    camera.position.copy(_pose.pos); camera.lookAt(_pose.look); camera.updateMatrixWorld();
    renderer.compile(R.scene, camera);
    renderPass.scene = R.scene; renderPass.camera = camera;
    if (ao) { ao.scene = R.scene; ao.camera = camera; }
    updateReflections(R);
    composer.render(0);
  } catch (e) { /* warm-up is only an optimisation */ }
  last = performance.now();
  prT = -3; // hold the resolution steady through the intro
  frameAvg = 16;
}

// ------------------------------------------------------------------ physics
const STEP = 1 / 120;
let acc = 0;
const CIRC = [1.2, -1.2];
const RAD = 1.05;

function resolveCollisions(cars, onHit) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.hidden) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.hidden) continue;
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      if (dx * dx + dz * dz > 30) continue;
      if (a.ghost > 0 || b.ghost > 0) continue;
      const as = Math.sin(a.heading), ac = Math.cos(a.heading), bs = Math.sin(b.heading), bc = Math.cos(b.heading);
      let hit = 0;
      for (const oa of CIRC) for (const ob of CIRC) {
        const ax = a.pos.x + as * oa, az = a.pos.z + ac * oa, bx = b.pos.x + bs * ob, bz = b.pos.z + bc * ob;
        let nx = ax - bx, nz = az - bz;
        const d = Math.hypot(nx, nz);
        if (d >= 2 * RAD || d < 1e-4) continue;
        nx /= d; nz /= d;
        const pen = 2 * RAD - d, ma = a.mass, mb = b.mass, tot = ma + mb;
        a.pos.x += nx * pen * mb / tot; a.pos.z += nz * pen * mb / tot;
        b.pos.x -= nx * pen * ma / tot; b.pos.z -= nz * pen * ma / tot;
        const rv = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (rv < 0) {
          const jImp = -1.25 * rv / (1 / ma + 1 / mb);
          a.vx += nx * jImp / ma; a.vz += nz * jImp / ma;
          b.vx -= nx * jImp / mb; b.vz -= nz * jImp / mb;
          const ka = a.kind === 'traffic' ? 0.5 : 0.18, kb = b.kind === 'traffic' ? 0.5 : 0.18;
          a.yawRate += oa * (ac * nx - as * nz) * jImp / ma * ka;
          b.yawRate -= ob * (bc * nx - bs * nz) * jImp / mb * kb;
          hit = Math.max(hit, jImp);
        }
      }
      if (hit > 0) onHit(a, b, hit);
    }
  }
}

function onHit(a, b, j) {
  const R = race;
  const p = R.player;
  const other = a === p ? b : b === p ? a : null;
  const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2, my = (a.pos.y + b.pos.y) / 2 + 0.6;
  for (const t of [a, b]) if (t.kind === 'traffic' && j > 5) { t.ai.spin = 2.4; t.nm.lastHit = R.time; }
  for (const [t, o] of [[a, b], [b, a]]) if (t.kind === 'police' && o !== p && o.kind !== 'police' && j > 9) t.bigHit = true;
  if (j > 3) {
    const n = Math.min(24, Math.floor(j * 1.4));
    for (let k = 0; k < n; k++) R.fx.sparks.spawn(mx, my, mz, (Math.random() - 0.5) * 12, Math.random() * 5, (Math.random() - 0.5) * 12, 0.35 + Math.random() * 0.3, 0.5, 0.15, 1, 1, 0.75, 0.4, 1.5, 9);
  }
  if (other) {
    const now = R.time;
    if (now - (p.lastCrash || 0) > 0.18) { audio.crash(j); p.lastCrash = now; }
    R.shake = Math.min(1, R.shake + j * 0.025);
    if (other.kind === 'traffic' && j > 4) R.police.addHeat(Math.min(32, 10 + j * 1.3));
    if (other.kind === 'police') R.police.addHeat(8);
  } else {
    const d = Math.hypot(mx - camera.position.x, mz - camera.position.z);
    if (d < 60 && j > 6 && R.time - (R.lastFarCrash || 0) > 0.3) { audio.crash(j * Math.max(0.1, 1 - d / 60) * 0.6); R.lastFarCrash = R.time; }
  }
}

const aiCtx = { cars: null, running: false, raceTime: 0, rubber: null };

function physicsStep(h) {
  const R = race, p = R.player, T = R.track;
  const running = R.phase === 'running' || R.phase === 'finished';
  const inp = input.read();
  if (running && !p.finished) {
    if (p.autopilot) p.autopilot.update(h, aiCtx); else Object.assign(p.ctrl, inp);
    if (p.bustedT > 0) { p.ctrl.throttle = 0; p.ctrl.nitro = false; }
  } else if (p.finished) {
    p.rubber = 1; p.topMul = 1;
    p.ai.update(h, aiCtx);
  } else {
    p.ctrl.throttle = inp.throttle; p.ctrl.brake = 0; p.ctrl.steer = 0; p.ctrl.handbrake = false; p.ctrl.nitro = false;
  }
  aiCtx.cars = R.allCars;
  aiCtx.running = running;
  aiCtx.raceTime = R.time;
  aiCtx.rubber = c => c.rubber;
  for (const c of R.ais) {
    const gap = c.progress - p.progress;
    const g = clamp(gap / 380, -1, 1), D = diff();
    c.rubber = p.finished ? 1 : 1 - g * (g > 0 ? D.ahead : D.behind);
    c.topMul = c.rubber;
    c.ai.update(h, aiCtx);
  }
  R.traffic.update(h, aiCtx);
  R.police.update(h, p, aiCtx);
  for (const c of R.cars) c.frozen = !running || (c === p && p.bustedT > 0);
  if (p.bustedT > 0) p.bustedT -= h;
  for (const c of R.allCars) if (!c.hidden) c.step(h, T);
  resolveCollisions(R.allCars, onHit);
  p.updateGear(h);

  // laps + splits
  for (const c of R.cars) {
    if (c.crossedLine === 1) {
      if (c.lapCount === 0 && c.maxLap === 0) c.lapStart = R.time;
      if (c.lapCount > c.maxLap) {
        c.maxLap = c.lapCount;
        const lt = R.time - c.lapStart;
        c.lastLap = lt;
        const newBest = !c.bestLap || lt < c.bestLap;
        if (newBest) c.bestLap = lt;
        c.lapStart = R.time;
        if (c.lapCount >= R.laps && !c.finished) {
          c.finished = true;
          c.finishTime = R.time;
          R.finishOrder.push(c);
          if (c === p) onPlayerFinish();
        } else if (c === p) {
          hud.message(c.lapCount === R.laps - 1 ? 'FINAL LAP' : `LAP ${c.lapCount + 1} / ${R.laps}`, 'lap', 2);
          audio.lap();
          if (newBest) hud.chip('BEST LAP', fmtTime(lt, true), 'lap');
        }
      }
    }
    if (running && c.progress > 0) {
      const si = Math.floor(c.progress / 25);
      if (si > c.splitIdx && si < c.splits.length) { for (let k = c.splitIdx + 1; k <= si; k++) if (k >= 0) c.splits[k] = R.time; c.splitIdx = si; }
    }
  }

  if (running && !p.finished) playerEvents(h);
}

function playerEvents(h) {
  const R = race, p = R.player, T = R.track, D = R.drift;
  // slipstream: tuck in behind a rival to gain speed and nitro
  let draft = false;
  if (p.speed > 26) for (const c of R.ais) {
    const ds = T.deltaS(p.s, c.s);
    if (ds > 3.5 && ds < 24 && Math.abs(c.d - p.d) < 2.1) { draft = true; break; }
  }
  R.slipT = draft ? Math.min(1.6, R.slipT + h) : Math.max(0, R.slipT - h * 2.5);
  const was = R.slipOn;
  R.slipOn = R.slipT > 0.45;
  p.accelMul = R.slipOn ? 1.3 : 1;
  p.topMul = R.slipOn ? 1.06 : 1;
  if (R.slipOn) p.nitro = Math.min(1, p.nitro + h * 0.035);
  if (R.slipOn && !was) audio.nearMiss();
  // kerb rumble
  if (Math.abs(T.curvS[p.si]) > 1 / 200 && Math.abs(Math.abs(p.d) - T.halfWidth) < 0.9 && p.speed > 15) R.shake = Math.max(R.shake, 0.16);
  // drift scoring & nitro fill
  if (p.drifting && p.slip > 0.18 && p.speed > 12 && p.bustedT <= 0) {
    if (!D.active) { D.active = true; D.pts = 0; D.time = 0; }
    D.idle = 0;
    D.time += h;
    D.mul = Math.min(4, 1 + D.time * 0.12);
    D.pts += h * p.speed * Math.min(1.2, p.slip) * 26;
    const before = p.nitro;
    p.nitro = Math.min(1, p.nitro + h * 0.115 * p.spec.fill * clamp(p.slip / 0.45, 0.35, 1.2));
    if (before < 1 && p.nitro >= 1) { audio.nitroFull(); hud.chip('NITRO', 'FULL', 'nitro'); }
  } else if (D.active) {
    D.idle += h;
    if (p.wallHit > 4) {
      hud.chip('DRIFT', 'LOST', 'bad');
      D.active = false;
    } else if (D.idle > 1.0) {
      const total = Math.round(D.pts * D.mul);
      if (total > 150) { R.style += total; hud.chip('DRIFT', '+' + total.toLocaleString('en-US'), 'drift'); audio.driftBank(); }
      D.active = false;
    }
  }
  // wall impacts
  if (p.wallHit > 4) {
    if (R.time - (p.lastWall || 0) > 0.25) { audio.crash(p.wallHit); p.lastWall = R.time; }
    R.shake = Math.min(1, R.shake + p.wallHit * 0.03);
    if (p.wallHit > 14 && p.speed > 25) R.police.addHeat(4);
  }
  // near misses with traffic
  for (const t of R.traffic.cars) {
    const ds = T.deltaS(p.s, t.s);
    const lat = Math.abs(t.d - p.d);
    const nm = t.nm;
    if (Math.abs(ds) < 7) {
      if (!nm.active) { nm.active = true; nm.minLat = lat; nm.startDs = ds; }
      nm.minLat = Math.min(nm.minLat, lat);
    } else if (nm.active) {
      nm.active = false;
      if (nm.startDs > 0 && ds < 0 && nm.minLat < 3.4 && p.speed > 22 && R.time - nm.lastHit > 1.5) {
        R.style += 500;
        p.nitro = Math.min(1, p.nitro + 0.08);
        hud.chip('NEAR MISS', '+500', 'near');
        audio.nearMiss();
        R.police.addHeat(3);
      }
    }
  }
  // wrong way
  const dot = Math.sin(p.heading) * p.trackTx + Math.cos(p.heading) * p.trackTz;
  R.wrongWay = dot < -0.3 && p.speed > 4 ? R.wrongWay + h : 0;
  if (R.wrongWay > 1.5 && R.time - (R.lastWW || 0) > 2.5) { hud.message('WRONG WAY', 'bad', 1.6); R.lastWW = R.time; }
}

function onPlayerFinish() {
  const R = race, p = R.player;
  const place = R.finishOrder.indexOf(p) + 1;
  R.phase = 'finished';
  R.finishT = 0;
  hud.message(place === 1 ? 'YOU WIN' : `FINISHED ${ordinal(place)}`, place <= 3 ? 'good big' : 'big', 3.5);
  audio.finish();
  p.ai = new RacerAI(p, R.track, 0.94, { drifter: false, bias: 0 });
  if (R.drift.active) { R.style += Math.round(R.drift.pts * R.drift.mul); R.drift.active = false; }
}

// ------------------------------------------------------------------ camera
const cam = { yaw: 0, h: 0, fov: 62, mode: 0, init: false, shakeT: 0 };
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const INTRO_LEN = 3.4;
const _pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
/** where the race camera sits behind a stationary car (matches updateCamera at zero speed) */
function chasePose(p, mode) {
  const s = Math.sin(p.rh), c = Math.cos(p.rh);
  if (mode === 2) {
    _pose.pos.set(p.rx + s * 0.4, p.ry + 1.12, p.rz + c * 0.4);
    _pose.look.set(p.rx + s * 30, p.ry + 0.9, p.rz + c * 30);
    _pose.fov = 68;
  } else {
    const far = mode === 1, dist = far ? 9.4 : 6.3;
    _pose.pos.set(p.rx - s * dist, p.ry + (far ? 3.3 : 2.05), p.rz - c * dist);
    _pose.look.set(p.rx + s * 5, p.ry + (far ? 1.1 : 1.15), p.rz + c * 5);
    _pose.fov = 60;
  }
  return _pose;
}

function updateCamera(dt) {
  const R = race, p = R.player;
  if (window.__camOverride) { const o = window.__camOverride; camera.position.set(...o.pos); camera.lookAt(...o.look); camera.fov = o.fov || 55; camera.updateProjectionMatrix(); return; }
  if (R.phase === 'intro') {
    // sweep around the car, then settle exactly on the chase camera so the hand-over has no jump
    const t = clamp(R.introT / INTRO_LEN, 0, 1);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t); // gentle ease in-out: starts moving right away, glides to a stop
    const a = p.rh + Math.PI * 0.85 * (1 - e);
    const r = 6.3 + (1 - e) * 3.2;
    _v.set(p.rx - Math.sin(a) * r, p.ry + 2.05 + (1 - e) * 1.6, p.rz - Math.cos(a) * r);
    // look target slides from the car body to the chase camera's point ahead of the car
    const s = Math.sin(p.rh), c = Math.cos(p.rh);
    _w.set(p.rx + s * 5 * e, p.ry + 0.8 + 0.35 * e, p.rz + c * 5 * e);
    const k = THREE.MathUtils.smoothstep(t, 0.6, 1);
    const chase = chasePose(p, cam.mode);
    _v.lerp(chase.pos, k); _w.lerp(chase.look, k);
    camera.position.copy(_v);
    camera.lookAt(_w);
    camera.fov = 52 + (chase.fov - 52) * e; camera.updateProjectionMatrix();
    cam.yaw = p.rh; cam.h = p.ry; cam.fov = chase.fov; cam.lift = 0; cam.boost = 0; cam.init = true;
    return;
  }
  const velYaw = Math.atan2(p.vx, p.vz);
  let ty = p.rh;
  if (p.speed > 4 && p.fwd > 0) ty = p.rh + wrapA(velYaw - p.rh) * (p.drifting ? 0.6 : 0.3);
  if (!cam.init) { cam.yaw = ty; cam.h = p.ry; cam.init = true; }
  cam.yaw = dampAngle(cam.yaw, ty, p.drifting ? 4.2 : 6.5, dt);
  cam.h = damp(cam.h, p.ry, 10, dt);
  const spd = clamp(p.speed / 90, 0, 1.25);
  const boost = p.boosting ? 1 : 0;
  cam.boost = damp(cam.boost || 0, boost, boost ? 5 : 2.5, dt);
  let fovT;
  if (cam.mode === 2) {
    // bumper cam
    const s = Math.sin(p.rh), c = Math.cos(p.rh);
    camera.position.set(p.rx + s * 0.4, p.ry + 1.12, p.rz + c * 0.4);
    camera.lookAt(p.rx + s * 30, p.ry + 0.9, p.rz + c * 30);
    fovT = 68 + spd * 12 + cam.boost * 8;
  } else {
    const far = cam.mode === 1;
    const dist = (far ? 9.4 : 6.3) + spd * 1.1 - cam.boost * 0.4;
    const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
    // lift the camera when another car is right behind the player
    let block = 0;
    for (const o of R.allCars) {
      if (o === p || o.hidden) continue;
      const ox = o.rx - p.rx, oz = o.rz - p.rz;
      const along = ox * s + oz * c, lat = Math.abs(ox * c - oz * s);
      if (along < -1.5 && along > -dist - 2.5 && lat < 2.6) block = Math.max(block, 1 - Math.max(0, -along - 2) / (dist + 1));
    }
    cam.lift = damp(cam.lift || 0, block, block > (cam.lift || 0) ? 6 : 2, dt);
    const height = (far ? 3.3 : 2.05) + spd * 0.15 + cam.lift * 1.9;
    camera.position.set(p.rx - s * dist, cam.h + height, p.rz - c * dist);
    _v.set(p.rx + s * 5, cam.h + (far ? 1.1 : 1.15), p.rz + c * 5);
    camera.lookAt(_v);
    fovT = 60 + spd * 13 + cam.boost * 9;
  }
  // shake
  R.shake = Math.max(0, R.shake - dt * 1.8);
  const tr = R.shake * R.shake + cam.boost * 0.02 + (spd > 0.9 ? (spd - 0.9) * 0.03 : 0);
  if (tr > 0.0005) {
    cam.shakeT += dt * 40;
    camera.position.x += (Math.sin(cam.shakeT * 1.3) + Math.sin(cam.shakeT * 2.9)) * tr * 0.18;
    camera.position.y += (Math.sin(cam.shakeT * 1.7 + 1) + Math.sin(cam.shakeT * 3.3)) * tr * 0.14;
    camera.rotation.z += Math.sin(cam.shakeT * 1.1) * tr * 0.03;
  }
  cam.fov = damp(cam.fov, fovT, 4, dt);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ fx per frame
const _tmp = { x: 0, y: 0, z: 0 };
function updateFx(dt) {
  const R = race, F = R.fx, night = R.world.night;
  F.shadows.begin(); F.glow.begin();
  if (F.beams) F.beams.begin();
  if (F.under) F.under.begin();
  const cx = camera.position.x, cz = camera.position.z;
  const [dr, dg, db] = F.dustColor;
  for (const c of R.allCars) {
    if (c.hidden) continue;
    const d2 = (c.rx - cx) ** 2 + (c.rz - cz) ** 2;
    if (d2 > 300 * 300) continue;
    const s = Math.sin(c.rh), co = Math.cos(c.rh);
    F.shadows.add(c.rx, c.ry + 0.03, c.rz, c.rh, 2.6, 5.4);
    if (night) {
      F.beams.add(c.rx + s * 11.5, c.ry + 0.04, c.rz + co * 11.5, c.rh, 8, 18);
      if (c.kind === 'racer' && F.under) F.under.add(c.rx, c.ry + 0.04, c.rz, c.rh, 3.6, 6.2, c.under);
    }
    // light glows
    if (night || c.kind === 'police') {
      for (const hl of c.vis.hl) { c.localToWorld(hl.x, hl.y, hl.z + 0.1, _tmp); F.glow.add(_tmp.x, _tmp.y, _tmp.z, night ? 2.2 : 1.0, 1, 0.95, 0.85, night ? 0.8 : 0.35); }
      const braking = c.ctrl.brake > 0.1 && c.fwd > 0.5;
      for (const tl of c.vis.tl) { c.localToWorld(tl.x, tl.y, tl.z - 0.1, _tmp); F.glow.add(_tmp.x, _tmp.y, _tmp.z, braking ? 2.2 : 1.2, 1, 0.08, 0.06, braking ? 0.95 : 0.6); }
    }
    if (c.kind === 'police') {
      const on = Math.floor(R.police.flash * 6) % 2 === 0;
      c.localToWorld(0.3, 1.55, -0.25, _tmp); F.glow.add(_tmp.x, _tmp.y, _tmp.z, on ? 9 : 3, 1, 0.1, 0.1, on ? 1 : 0.3);
      c.localToWorld(-0.3, 1.55, -0.25, _tmp); F.glow.add(_tmp.x, _tmp.y, _tmp.z, on ? 3 : 9, 0.15, 0.35, 1, on ? 0.3 : 1);
    }
    if (c.boosting) {
      for (const e of c.vis.ex) { c.localToWorld(e.x, e.y, e.z - 0.4, _tmp); F.glow.add(_tmp.x, _tmp.y, _tmp.z, 3.5, 0.4, 0.75, 1, 0.9); }
    }
    // tire smoke + skid marks
    if (d2 < 160 * 160) {
      const skidding = (c.drifting && c.slip > 0.12) || c.slip > 0.28 || (c.ctrl.brake > 0.7 && c.fwd > 14) || (c.ctrl.handbrake && c.speed > 8);
      const W = c.vis.wheels;
      for (let k = 2; k < 4; k++) {
        const wp = W[k].pivot.position;
        const key = c.root.id * 4 + k;
        if (skidding && !c.frozen) {
          c.localToWorld(wp.x, 0, wp.z, _tmp);
          F.skid.add(key, _tmp.x, c.ry, _tmp.z, -co, s, 0.28);
          const intensity = c.drifting ? Math.min(1, 0.35 + c.slip) : c.slip > 0.28 ? Math.min(1, c.slip) : c.ctrl.handbrake ? 0.35 : 0.08;
          if (Math.random() < 0.6 * intensity + 0.04) {
            F.smoke.spawn(_tmp.x, c.ry + 0.3, _tmp.z, c.vx * 0.15 + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.8, c.vz * 0.15 + (Math.random() - 0.5) * 2,
              1.0 + Math.random() * 1.2 * intensity, 1.0, 2.5 + intensity * 5, 0.12 + intensity * 0.32, dr, dg, db, 1.2, -0.4);
          }
        } else F.skid.lift(key);
      }
    }
    // dirt kicked up off the track
    if (c.offroad && c.speed > 6 && d2 < 140 * 140 && Math.random() < 0.7) {
      const [ar, ag, ab] = F.dirtColor;
      const W = c.vis.wheels;
      const wp = W[2 + Math.floor(Math.random() * 2)].pivot.position;
      c.localToWorld(wp.x, 0, wp.z - 0.3, _tmp);
      F.smoke.spawn(_tmp.x, c.ry + 0.4, _tmp.z, -c.vx * 0.2 + (Math.random() - 0.5) * 3, 1 + Math.random() * 1.5, -c.vz * 0.2 + (Math.random() - 0.5) * 3, 1.2 + Math.random(), 1.2, 4 + c.speed * 0.06, 0.45, ar, ag, ab, 1.4, 0.6);
    }
    // wall sparks
    if (c.scrape > 6 && d2 < 120 * 120) {
      const side = c.wallSide > 0 ? -1 : 1;
      c.localToWorld(side * 1.0, 0.4, (Math.random() - 0.5) * 3, _tmp);
      for (let k = 0; k < 3; k++) F.sparks.spawn(_tmp.x, _tmp.y, _tmp.z, -c.vx * 0.3 + (Math.random() - 0.5) * 5, Math.random() * 4, -c.vz * 0.3 + (Math.random() - 0.5) * 5, 0.3 + Math.random() * 0.25, 0.45, 0.1, 1, 1, 0.7, 0.35, 1, 9);
    }
  }
  F.shadows.end(); F.glow.end();
  if (F.beams) F.beams.end();
  if (F.under) F.under.end();
  F.smoke.update(dt);
  F.sparks.update(dt);
}

// ------------------------------------------------------------------ audio per frame
function updateAudio() {
  const R = race, p = R.player;
  let opp = null, od = 1e9;
  for (const c of R.ais) {
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
    if (d < od) { od = d; opp = c; }
  }
  let oppPan = 0, doppler = 1;
  if (opp) {
    const dx = opp.pos.x - p.pos.x, dz = opp.pos.z - p.pos.z;
    oppPan = clamp((dx * -Math.cos(p.heading) + dz * Math.sin(p.heading)) / Math.max(5, od), -1, 1);
    const closing = ((opp.vx - p.vx) * -dx + (opp.vz - p.vz) * -dz) / Math.max(1, od);
    doppler = clamp(1 + closing / 340, 0.8, 1.25);
  }
  audio.update({
    rpm: p.rpm, throttle: p.ctrl.throttle, speed: p.speed, boost: p.boosting,
    slip: (p.drifting || p.slip > 0.25) && p.speed > 6 ? Math.min(1, p.slip * 1.5 + 0.2) : (p.ctrl.brake > 0.7 && p.fwd > 14 ? 0.5 : 0),
    scrape: p.scrape, shiftCut: p.shiftCut, engineOn: true, rain: R.theme === 'city' && settings.quality !== 'low',
    oppRpm: opp ? clamp(opp.speed / opp.spec.top, 0.2, 1) : 0, oppLevel: opp ? clamp(1 - od / 70, 0, 1) : 0, oppPan, oppDoppler: doppler,
    siren: R.police.sirenLevel || 0, sirenPan: R.police.sirenPan || 0,
  });
  if (p.shifted) audio.shift();
  if (p.boostStarted) { audio.nitroStart(); p.boostStarted = false; }
  if (p.ctrl.throttle === 0 && p.rpm > 0.75 && !p.wasLift && p.speed > 20) { if (Math.random() < 0.5) audio.backfire(); }
  p.wasLift = p.ctrl.throttle === 0;
}

// ------------------------------------------------------------------ race frame
function raceFrame(dt) {
  const R = race;
  R.phaseT += dt;
  if (R.phase === 'intro') R.introT = (R.introT || 0) + Math.min(dt, 1 / 30);
  if (R.phase === 'intro' && R.introT > INTRO_LEN) {
    R.phase = 'countdown'; R.phaseT = 0; R.lastCount = -1;
    $('intro').className = 'intro';
    hud.show(true);
  }
  if (R.phase === 'countdown') {
    const thr = R.player.ctrl.throttle > 0;
    if (thr && !R.thrPrev) R.thrPressT = R.phaseT;
    if (!thr) R.thrPressT = -1;
    R.thrPrev = thr;
    const n = 3 - Math.floor(R.phaseT);
    if (n !== R.lastCount && n > 0) { R.lastCount = n; hud.countdown(String(n)); audio.countdown(); if (R.world.setLights) R.world.setLights(n === 3 ? 2 : n === 2 ? 4 : 5); }
    if (R.phaseT >= 3) {
      R.phase = 'running'; R.phaseT = 0;
      hud.countdown('GO!'); audio.go();
      if (R.world.setLights) R.world.setLights(0, true);
      // launch boost for a well-timed throttle
      if (R.player.ctrl.throttle > 0 && R.thrPressT >= 2.62) { R.player.vx += Math.sin(R.player.heading) * 6; R.player.vz += Math.cos(R.player.heading) * 6; hud.chip('PERFECT LAUNCH', '+BOOST', 'nitro'); }
    }
  }
  if (R.phase === 'running' || R.phase === 'finished') R.time += dt;
  if (R.phase === 'running' && R.phaseT > 2.5 && !R.lightsOff && R.world.setLights) { R.world.setLights(0); R.lightsOff = true; }

  acc += Math.min(dt, 0.1);
  let steps = 0;
  while (acc >= STEP && steps < 12) { physicsStep(STEP); acc -= STEP; steps++; }
  const alpha = acc / STEP;
  for (const c of R.allCars) if (!c.hidden) c.render(alpha, dt);

  R.traffic.recycle(R.player, R.cars);
  // standings
  R.standings.sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
  if (R.phase === 'finished') {
    R.finishT += dt;
    const allDone = R.cars.every(c => c.finished);
    if (!R.resultsShown && (R.finishT > 4.5)) showResults();
    if (R.resultsShown && allDone) refreshResults();
  }

  updateCamera(dt);
  R.world.update(dt, performance.now() / 1000, camera, R.player);
  updateFx(dt);
  updateAudio();
  if (R.phase !== 'intro' && state === 'race') { hud.update(R, dt, performance.now() / 1000); hud.updateTags(R, camera); hud.slipstream(R.slipOn); }
  hud.driftScore(R.drift.active && R.drift.pts > 30, R.drift.pts, R.drift.mul);
  const p = R.player;
  if (isTouch) touchNitro(p.nitro);
  const sl = clamp((p.speed - 50) / 40, 0, 1) * 0.65 + (p.boosting ? 0.55 : 0);
  speedLines.draw(dt, R.phase === 'intro' ? 0 : sl, p.boosting);

  const pScale = window.innerHeight * pixelRatio * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  for (const pp of [R.fx.smoke, R.fx.sparks, R.fx.glow, ...R.world.glowPoints]) pp.mat.uniforms.scale.value = pScale;
  renderPass.scene = R.scene;
  renderPass.camera = camera;
  if (ao) { ao.scene = R.scene; ao.camera = camera; ao.blendIntensity = 1; }
  updateReflections(R);
  bloom.enabled = settings.quality !== 'low';
  const bl = R.world.bloom;
  bloom.strength = bl.strength + (p.boosting ? 0.15 : 0);
  bloom.radius = bl.radius; bloom.threshold = bl.threshold;
  renderer.toneMappingExposure = R.world.exposure;
  renderer.shadowMap.enabled = settings.quality !== 'low';
  if (grade && grade.enabled) {
    const u = grade.uniforms;
    const fast = clamp((p.speed - 45) / 45, 0, 1);
    u.uBlur.value = u.uTaps.value > 0 ? fast * 0.55 + (cam.boost || 0) * 0.9 : 0;
    u.uCA.value = 0.0012 + fast * 0.003 + (cam.boost || 0) * 0.006;
    u.uVig.value = 0.3 + (cam.boost || 0) * 0.15;
    u.uSat.value = 1.02;
    u.uContrast.value = 1.12;
    u.uGrain.value = settings.quality === 'ultra' || settings.quality === 'high' ? 0.035 : 0;
    u.uTime.value = (u.uTime.value + 1.618) % 1000;
    u.uAspect.value = camera.aspect;
    const sd = R.world.sunDir;
    if (sd) {
      _v.copy(camera.position).addScaledVector(sd, 2000).project(camera);
      const onScreen = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      u.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      u.uSunOn.value = onScreen ? 1 : 0;
    } else u.uSunOn.value = 0;
  }
  composer.render(dt);
}

let tnLast = -1;
function touchNitro(n) {
  const v = Math.round(n * 100);
  if (v === tnLast) return;
  tnLast = v;
  const b = document.querySelector('.tnitro');
  b.style.setProperty('--n', (v / 100).toFixed(2));
  b.classList.toggle('full', v >= 100);
  $('tNitroPct').textContent = v + '%';
}

// ------------------------------------------------------------------ live reflections on the player's car
// A cube camera follows the car and captures the street around it; a couple of faces are refreshed per frame.
const reflect = { rt: null, cams: null, face: 0, perFrame: 2 };
function setupReflections() {
  const q = settings.quality;
  if (reflect.rt) { reflect.rt.dispose(); reflect.rt = null; }
  if (q !== 'high' && q !== 'ultra') return;
  reflect.rt = new THREE.WebGLCubeRenderTarget(q === 'ultra' ? 256 : 128, { type: THREE.HalfFloatType });
  reflect.cam = new THREE.CubeCamera(0.8, 2500, reflect.rt);
  reflect.cam.coordinateSystem = renderer.coordinateSystem;
  reflect.cam.updateCoordinateSystem();
  reflect.perFrame = q === 'ultra' ? 3 : 2;
  reflect.face = 0;
}
function carReflections(player) {
  if (!reflect.rt) return;
  const env = reflect.rt.texture;
  player.vis.paint.envMap = env;
  player.vis.paint.envMapIntensity = 1.15;
  player.vis.paint.needsUpdate = true;
  const shiny = factory.shared.shiny.clone();
  shiny.envMap = env;
  player.vis.bodyPivot.traverse(o => { if (o.isMesh && o.material === factory.shared.shiny) o.material = shiny; });
  reflect.face = 0;
  reflect.primed = false;
}
function updateReflections(R) {
  if (!reflect.rt || !R.player.vis.paint.envMap) return;
  const p = R.player, cc = reflect.cam;
  cc.position.set(p.rx, p.ry + 0.75, p.rz);
  cc.updateMatrixWorld(true);
  const cams = cc.children;
  const prevTarget = renderer.getRenderTarget();
  const autoShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow map
  p.root.visible = false;
  const fx = R.fx;
  const fxVis = [fx.smoke.points.visible, fx.sparks.points.visible];
  fx.smoke.points.visible = fx.sparks.points.visible = false;
  // first frame renders every face so the car never shows an empty reflection
  const n = reflect.primed ? reflect.perFrame : 6;
  for (let k = 0; k < n; k++) {
    const f = reflect.face;
    renderer.setRenderTarget(reflect.rt, f);
    renderer.render(R.scene, cams[f]);
    reflect.face = (f + 1) % 6;
    if (reflect.face === 0) reflect.rt.texture.needsPMREMUpdate = true;
  }
  reflect.primed = true;
  fx.smoke.points.visible = fxVis[0]; fx.sparks.points.visible = fxVis[1];
  p.root.visible = true;
  renderer.shadowMap.autoUpdate = autoShadow;
  renderer.setRenderTarget(prevTarget);
}

// ------------------------------------------------------------------ results
function resultRows() {
  const R = race;
  const avg = c => c.progress / Math.max(1, R.time);
  const est = c => c.finished ? c.finishTime : R.time + (R.laps * R.track.L - c.progress) / Math.max(10, avg(c));
  const rows = R.cars.map(c => ({ c, t: est(c), done: c.finished }));
  rows.sort((a, b) => (a.done === b.done ? a.t - b.t : a.done ? -1 : 1));
  return rows;
}
function refreshResults() {
  const R = race;
  const rows = resultRows();
  const tb = $('resBody');
  tb.innerHTML = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (r.c === R.player) tr.className = 'me';
    const car = r.c.spec.name;
    tr.innerHTML = `<td class="p">${i + 1}</td><td class="n"><i style="background:${r.c.mapColor}"></i><span></span></td><td class="c"></td><td class="t"></td><td class="b"></td>`;
    tr.children[1].querySelector('span').textContent = r.c.name;
    tr.children[2].textContent = car;
    tr.children[3].textContent = (r.done ? '' : '~') + fmtTime(r.t);
    tr.children[4].textContent = r.c.bestLap ? fmtTime(r.c.bestLap, true) : '--';
    tb.appendChild(tr);
  });
  const place = rows.findIndex(r => r.c === R.player) + 1;
  $('resTitle').textContent = place === 1 ? 'VICTORY' : `${ordinal(place)} PLACE`;
  $('resSub').textContent = `${R.track.def.name} · ${R.laps} laps`;
  $('resStyle').textContent = Math.round(R.style).toLocaleString('en-US');
  $('resBest').textContent = R.player.bestLap ? fmtTime(R.player.bestLap, true) : '--';
  $('resBusts').textContent = String(R.busts);
}
function payRace() {
  const R = race;
  if (R.paid) return;
  R.paid = true;
  const place = R.finishOrder.indexOf(R.player) + 1 || R.cars.length;
  const pay = career.payout({ place, style: R.style, busts: R.busts, difficulty: settings.difficulty });
  career.earn(pay.total);
  $('resCash').textContent = '+' + money(pay.total);
  const parts = $('resCashParts');
  parts.innerHTML = '';
  const add = (label, val) => { const s = document.createElement('span'); s.textContent = label + ' '; const b = document.createElement('b'); b.textContent = val; s.appendChild(b); parts.appendChild(s); };
  add(ordinal(place).toLowerCase() + ' place', money(pay.prize));
  add('Style', money(pay.styleBonus));
  if (pay.mul !== 1) add(diff().label + ' rivals', '×' + pay.mul);
  if (pay.fines) add('Police fines', '−' + money(pay.fines));
  add('Bank', money(career.cash));
  $('resEarn').hidden = false;
}
function showResults() {
  race.resultsShown = true;
  refreshResults();
  payRace();
  hud.show(false);
  $('touch').hidden = true;
  show('results');
  setState('results');
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let fpsAcc = 0, fpsN = 0, prT = 0, frameAvg = 16;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt < 0) dt = 0; // the frame timestamp can predate work done in an input handler (race warm-up)
  frameAvg = frameAvg * 0.95 + dt * 1000 * 0.05;
  if (settings.fps) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps · ' + pixelRatio.toFixed(2) + 'x'; fpsAcc = 0; fpsN = 0; } }
  handleActions();
  if (state === 'race' || state === 'results') {
    adaptResolution(dt); // before drawing: resizing the canvas clears it
    raceFrame(dt);
  } else if (state === 'paused') {
    // keep the frozen frame
  } else if (state === 'garage' || state === 'title' || state === 'settings') {
    renderGarage(dt);
  }
}

function adaptResolution(dt) {
  prT += dt;
  if (prT < 2) return;
  prT = 0;
  let pr = pixelRatio;
  if (frameAvg > 22 && pr > 0.7) pr = Math.max(0.7, pr - 0.15);
  else if (frameAvg < 14 && pr < maxPR) pr = Math.min(maxPR, pr + 0.1);
  if (pr !== pixelRatio) { pixelRatio = pr; renderer.setPixelRatio(pr); resize(); }
}

function handleActions() {
  if (input.consume('mute')) { const m = audio.toggleMute(); $('btnMute').setAttribute('aria-pressed', String(m)); }
  if (state === 'race') {
    if (input.consume('pause')) pause();
    if (input.consume('camera')) { cam.mode = (cam.mode + 1) % 3; settings.camera = cam.mode; saveSettings(); }
    if (input.consume('reset') && race.phase === 'running' && !race.player.finished) {
      const p = race.player;
      p.respawn(race.track, p.s - 2, clamp(p.d, -race.track.halfWidth + 3, race.track.halfWidth - 3));
      race.drift.active = false;
    }
  } else if (state === 'paused') {
    if (input.consume('pause')) resume();
  } else {
    input.consume('pause'); input.consume('camera'); input.consume('reset');
  }
}

function pause() {
  if (state !== 'race') return;
  setState('paused');
  audio.setRaceAudio(false);
  show('pause');
  hud.show(false);
  $('touch').hidden = true;
}
function resume() {
  setState('race');
  audio.setRaceAudio(true);
  show(null);
  hud.show(race.phase !== 'intro');
  $('touch').hidden = !isTouch;
  last = performance.now();
}
function toGarage() {
  if (race) { audio.setRaceAudio(false); disposeRace(); }
  hud.show(false);
  $('touch').hidden = true;
  speedLines.draw(1, 0, false);
  garage.carKey = '';
  garageCar();
  setState('garage');
  show('garage');
}

document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'race') pause(); });

// ------------------------------------------------------------------ phones
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* not supported or denied */ }
}
function phoneSetup() {
  // Android: go fullscreen and lock to landscape (iPhone Safari has no page fullscreen; Add to Home Screen does it)
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  }
  if (settings.tilt) input.enableTilt();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && (state === 'race' || state === 'paused')) keepAwake(true); });

// ------------------------------------------------------------------ UI wiring
function bindUI() {
  const click = (id, fn) => $(id).addEventListener('click', e => { audio.init(); audio.click(); fn(e); });
  click('btnPlay', () => { toGarage(); });
  click('btnPrev', () => { settings.car = (settings.car + CAR_LIST.length - 1) % CAR_LIST.length; saveSettings(); garageCar(); });
  click('btnNext', () => { settings.car = (settings.car + 1) % CAR_LIST.length; saveSettings(); garageCar(); });
  click('btnRace', () => { saveSettings(); if (isTouch) phoneSetup(); startRace(); });
  click('btnResume', () => resume());
  click('btnRestart', () => { audio.setRaceAudio(false); startRace(); });
  click('btnQuit', () => toGarage());
  click('btnAgain', () => startRace());
  click('btnResGarage', () => toGarage());
  click('btnPause', () => pause());
  click('btnMute', () => { const m = audio.toggleMute(); $('btnMute').setAttribute('aria-pressed', String(m)); });
  const openSettings = () => { $('scr-settings').hidden = false; syncSettingsUI(); };
  click('btnSettings', () => openSettings('garage'));
  click('btnSettings2', () => openSettings('pause'));
  click('btnTitleSettings', () => openSettings('title'));
  click('btnCloseSettings', () => { $('scr-settings').hidden = true; });
  click('btnUpgrades', () => { renderUpgrades(); $('scr-upgrades').hidden = false; });
  click('btnCloseUpgrades', () => { $('scr-upgrades').hidden = true; updateCarStats(); });

  const sw = $('swatches');
  PAINTS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.setProperty('--c', p.hex);
    b.setAttribute('aria-label', p.name);
    b.addEventListener('click', () => { audio.init(); audio.hover(); settings.paint = i; saveSettings(); garageCar(); });
    sw.appendChild(b);
  });
  document.querySelectorAll('[data-livery]').forEach(b => b.addEventListener('click', () => { audio.init(); audio.hover(); settings.stripes = b.dataset.livery === 'stripes'; saveSettings(); garageCar(); }));
  const tl = $('tracks');
  TRACKS.forEach((def, i) => {
    const b = document.createElement('button');
    b.className = 'trackcard ' + def.theme;
    const cv = document.createElement('canvas');
    drawTrackPreview(cv, new Track(def));
    b.appendChild(cv);
    const t = new Track(def);
    const info = document.createElement('div');
    info.className = 'ti';
    info.innerHTML = '<b></b><span></span><em></em>';
    info.children[0].textContent = def.name;
    info.children[1].textContent = def.time;
    info.children[2].textContent = `${def.laps} laps · ${(t.L / 1000).toFixed(1)} km`;
    b.appendChild(info);
    b.addEventListener('click', () => {
      audio.init(); audio.click(); settings.track = i; saveSettings(); updateTrackCards();
      b.classList.remove('picked'); void b.offsetWidth; b.classList.add('picked');
    });
    tl.appendChild(b);
  });

  // drag to rotate the garage car
  const gc = $('gl');
  gc.addEventListener('pointerdown', e => { if (state === 'garage') { garage.dragX = e.clientX; gc.setPointerCapture(e.pointerId); } });
  gc.addEventListener('pointermove', e => { if (garage.dragX !== null) { garage.angle += (e.clientX - garage.dragX) * 0.01; garage.dragX = e.clientX; } });
  const end = () => { garage.dragX = null; };
  gc.addEventListener('pointerup', end); gc.addEventListener('pointercancel', end);

  // settings controls
  $('setVolume').addEventListener('input', e => { settings.volume = +e.target.value; audio.setVolume(settings.volume); saveSettings(); });
  document.querySelectorAll('[name=quality]').forEach(r => r.addEventListener('change', e => {
    settings.quality = e.target.value; saveSettings();
    factory.quality = settings.quality;
    setupComposer();
    garage.carKey = ''; garage.carId = ''; garageCar();
    if (race) $('qualityNote').hidden = false;
  }));
  document.querySelectorAll('[name=camera]').forEach(r => r.addEventListener('change', e => { settings.camera = +e.target.value; cam.mode = settings.camera; saveSettings(); }));
  document.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => { audio.init(); audio.hover(); settings.difficulty = b.dataset.diff; saveSettings(); updateRaceOpts(); }));
  document.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => { audio.init(); audio.hover(); settings[b.dataset.opt] = !settings[b.dataset.opt]; saveSettings(); updateRaceOpts(); }));
  $('setAutoGas').addEventListener('change', e => { settings.autoGas = e.target.checked; input.autoGas = settings.autoGas; saveSettings(); });
  $('setTilt').addEventListener('change', async e => {
    const on = e.target.checked;
    // iPhone asks for motion permission, and only from a tap
    if (on && !(await input.enableTilt())) { e.target.checked = false; return; }
    settings.tilt = on; input.tilt = on; saveSettings();
  });
  $('setFps').addEventListener('change', e => { settings.fps = e.target.checked; $('fps').hidden = !settings.fps; saveSettings(); });
  $('fps').hidden = !settings.fps;
  updateRaceOpts();

  // keyboard shortcut on menus
  window.addEventListener('keydown', e => {
    if (state === 'title' && (e.code === 'Enter' || e.code === 'Space')) { audio.init(); toGarage(); }
    else if (state === 'garage' && !$('scr-upgrades').hidden && e.code === 'Escape') $('btnCloseUpgrades').click();
    else if (state === 'garage' && $('scr-settings').hidden && $('scr-upgrades').hidden) {
      if (e.code === 'ArrowLeft') $('btnPrev').click();
      else if (e.code === 'ArrowRight') $('btnNext').click();
      else if (e.code === 'Enter') $('btnRace').click();
    } else if (state === 'results' && e.code === 'Enter') $('btnAgain').click();
  });
  document.addEventListener('gesturestart', e => e.preventDefault());
}

function syncSettingsUI() {
  $('setVolume').value = settings.volume;
  document.querySelectorAll('[name=quality]').forEach(r => { r.checked = r.value === settings.quality; });
  document.querySelectorAll('[name=camera]').forEach(r => { r.checked = +r.value === settings.camera; });
  $('setAutoGas').checked = settings.autoGas;
  $('setTilt').checked = settings.tilt;
  $('setFps').checked = settings.fps;
}

// ------------------------------------------------------------------ boot
async function boot() {
  setState('loading');
  setupComposer();
  const bar = $('loadBar');
  const loader = new GLTFLoader();
  const prog = { cars: 0, props: 0 };
  const upd = () => { bar.style.transform = `scaleX(${(prog.cars * 0.85 + prog.props * 0.15).toFixed(3)})`; };
  // models ship as base64 GLB inside JSON (the host serves JSON but not .glb)
  const load = async (url, k) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    let text;
    if (res.body && total) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        prog[k] = Math.min(0.98, got / total); upd();
      }
      const all = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      text = new TextDecoder().decode(all);
    } else text = await res.text();
    const b64 = JSON.parse(text).glb;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const gltf = await new Promise((ok, fail) => loader.parse(bytes.buffer, '', ok, fail));
    prog[k] = 1; upd();
    return gltf;
  };
  try {
    await Promise.race([Promise.all([document.fonts.load('700 40px Teko'), document.fonts.load('600 20px Rajdhani')]), new Promise(r => setTimeout(r, 2500))]);
  } catch (e) { /* fonts optional */ }
  let cars, props;
  try {
    audio.loadEngine('assets/engine.json');
    [cars, props] = await Promise.all([load('assets/cars.json', 'cars'), load('assets/props.json', 'props')]);
  } catch (e) {
    $('loadMsg').textContent = 'The 3D models could not load. Reload the page to try again.';
    return;
  }
  assets = { cars, props: props.scene };
  factory = new CarFactory(cars, settings.quality);
  buildGarage();
  bindUI();
  garageCar();
  setState('title');
  show('title');
  // test hooks (used by the automated playtest)
  window.__cam = () => camera.position.toArray();
  window.__driftline = {
    get race() { return race; }, startRace, settings, input, audio,
    autopilot(on = true) { race.player.autopilot = on ? new RacerAI(race.player, race.track, 1.0, { drifter: true, bias: 0 }) : null; },
    simulate(sec) {
      const n = Math.round(sec / STEP);
      for (let i = 0; i < n; i++) {
        physicsStep(STEP);
        if (race.phase === 'running' || race.phase === 'finished') race.time += STEP;
        if (i % 30 === 0) race.traffic.recycle(race.player, race.cars);
      }
    },
  };
  requestAnimationFrame(t => { last = t; loop(t); });
}
boot();
