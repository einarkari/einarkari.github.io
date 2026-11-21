// Builds the environment for each track: road, roadside, buildings/terrain, sky, lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { radialTexture, GlowPoints, makeRain } from './fx.js';

// ------------------------------------------------------------------ helpers
let SEED = 1;
const rnd = () => { SEED = (SEED * 16807) % 2147483647; return (SEED - 1) / 2147483646; };
const rr = (a, b) => a + (b - a) * rnd();

function cvs(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
function noise2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = noise2(xi, yi), b = noise2(xi + 1, yi), c = noise2(xi, yi + 1), d = noise2(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x, y, o = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < o; i++) { s += vnoise(x * f, y * f) * a; f *= 2.03; a *= 0.5; }
  return s;
}

function minTrackDist(track, x, z, step = 3) {
  let best = 1e18, bi = 0;
  for (let i = 0; i < track.N; i += step) {
    const dx = track.px[i] - x, dz = track.pz[i] - z, d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = i; }
  }
  return { d: Math.sqrt(best), i: bi };
}

function instanceTemplate(template, matrices, { cast = false, receive = false, matMap = null } = {}) {
  const group = new THREE.Group();
  if (!matrices.length) return group;
  template.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
  template.traverse(o => {
    if (!o.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const mat = matMap ? (matMap[o.material.name] || o.material) : o.material;
    const im = new THREE.InstancedMesh(o.geometry, mat, matrices.length);
    const m = new THREE.Matrix4();
    matrices.forEach((M, i) => { m.multiplyMatrices(M, local); im.setMatrixAt(i, m); });
    im.castShadow = cast; im.receiveShadow = receive;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

function tm(x, y, z, yaw = 0, s = 1) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
}

/** ribbon swept along the track with a 2D (outward, up) profile */
function sweep(track, profile, side, offset, vScale = 0.25) {
  const N = track.N, P = profile.length;
  const pos = new Float32Array((N + 1) * P * 3), uv = new Float32Array((N + 1) * P * 2);
  let o = 0, u = 0;
  for (let i = 0; i <= N; i++) {
    const k = i % N;
    for (let j = 0; j < P; j++) {
      const lat = side * (offset + profile[j][0]);
      pos[o++] = track.px[k] + track.rx[k] * lat;
      pos[o++] = track.py[k] + profile[j][1];
      pos[o++] = track.pz[k] + track.rz[k] * lat;
      uv[u++] = j / (P - 1);
      uv[u++] = i * track.ds * vScale;
    }
  }
  const idx = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j, b = a + 1, c = a + P, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function quadGeo(list) {
  // list of {c:[x,y,z], ax:[x,y,z] (half extent u), ay:[...] (half extent v), uv:[u0,v0,u1,v1]}
  const pos = [], uv = [], idx = [];
  list.forEach((q, n) => {
    const [cx, cy, cz] = q.c, [ax, ay, az] = q.ax, [bx, by, bz] = q.ay;
    pos.push(cx - ax - bx, cy - ay - by, cz - az - bz, cx + ax - bx, cy + ay - by, cz + az - bz,
      cx + ax + bx, cy + ay + by, cz + az + bz, cx - ax + bx, cy - ay + by, cz - az + bz);
    const [u0, v0, u1, v1] = q.uv || [0, 0, 1, 1];
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const b = n * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ road
function roadTexture(track, theme) {
  const W = 512, H = 1024;
  const [c, g] = cvs(W, H);
  const width = track.def.width, hw = width / 2;
  g.fillStyle = theme === 'city' ? '#3c3e44' : theme === 'coast' ? '#36383c' : '#55504a';
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * (theme === 'city' ? 22 : 30);
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const px = m => (m / width + 0.5) * W;
  // tire-polished lanes
  for (const lane of track.def.lanes) {
    for (const off of [-0.8, 0.8]) {
      const grd = g.createLinearGradient(px(lane + off - 0.6), 0, px(lane + off + 0.6), 0);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.16)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(px(lane + off - 0.6), 0, px(lane + off + 0.6) - px(lane + off - 0.6), H);
    }
  }
  // patches
  for (let k = 0; k < 6; k++) {
    g.fillStyle = `rgba(${theme === 'city' ? '20,21,25' : '60,56,52'},${0.25 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * W, Math.random() * H, 20 + Math.random() * 90, 30 + Math.random() * 140);
  }
  const line = (m, wM, col, dashed) => {
    g.fillStyle = col;
    const w = wM / width * W;
    const x = px(m) - w / 2;
    if (dashed) { g.fillRect(x, 0, w, H * 0.34); } else g.fillRect(x, 0, w, H);
  };
  const white = theme === 'city' ? '#d8dbe0' : '#ece6da';
  const yellow = '#e8b220';
  if (theme === 'coast') {
    line(-hw + 0.35, 0.3, '#f2f2ef', false); line(hw - 0.35, 0.3, '#f2f2ef', false);
    line(0, 0.2, '#f2f2ef', true);
    g.globalAlpha = 0.18;
    for (let k = 0; k < 3000; k++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#777'; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    g.globalAlpha = 1;
    return toTex(c, { aniso: 16 });
  }
  if (theme === 'city') {
    line(-hw + 0.55, 0.26, white, false); line(hw - 0.55, 0.26, white, false);
    line(-5, 0.22, white, true); line(5, 0.22, white, true);
  } else {
    line(-hw + 1.3, 0.24, white, false); line(hw - 1.3, 0.24, white, false);
  }
  line(-0.2, 0.16, yellow, false); line(0.2, 0.16, yellow, false);
  // grime over markings
  g.globalAlpha = 0.18;
  for (let k = 0; k < 3000; k++) {
    g.fillStyle = Math.random() < 0.5 ? '#000' : '#777';
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.globalAlpha = 1;
  return toTex(c, { aniso: 16 });
}

function wetRoughness() {
  const [c, g] = cvs(256, 512);
  g.fillStyle = 'rgb(90,90,90)';
  g.fillRect(0, 0, 256, 512);
  for (let k = 0; k < 40; k++) {
    const x = Math.random() * 256, y = Math.random() * 512, r = 10 + Math.random() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(15,15,15,0.95)'); grd.addColorStop(1, 'rgba(15,15,15,0)');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(x, y, r, r * 1.8, 0, 0, Math.PI * 2); g.fill();
  }
  return toTex(c, { srgb: false });
}

function buildRoad(track, material, repeatLen = 12) {
  const N = track.N, hw = track.halfWidth;
  const reps = Math.round(track.L / repeatLen), vScale = reps / track.L;
  const pos = new Float32Array((N + 1) * 2 * 3), uv = new Float32Array((N + 1) * 2 * 2);
  for (let i = 0; i <= N; i++) {
    const k = i % N;
    for (let s = 0; s < 2; s++) {
      const side = s ? 1 : -1, o = (i * 2 + s);
      pos[o * 3] = track.px[k] + track.rx[k] * hw * side;
      pos[o * 3 + 1] = track.py[k];
      pos[o * 3 + 2] = track.pz[k] + track.rz[k] * hw * side;
      uv[o * 2] = s; uv[o * 2 + 1] = i * track.ds * vScale;
    }
  }
  const idx = [];
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

function startLine(track) {
  const [c, g] = cvs(256, 32);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#eee';
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = toTex(c, { repeat: false });
  const p = track.at(0, 0, {});
  const hw = track.halfWidth;
  const geo = quadGeo([{ c: [p.x, p.y + 0.03, p.z], ax: [p.rx * hw, 0, p.rz * hw], ay: [p.tx * 1.1, 0, p.tz * 1.1] }]);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1 }));
}

function textBanner(lines, colors, w = 1024, h = 160) {
  const [c, g] = cvs(w, h);
  g.fillStyle = '#07090f'; g.fillRect(0, 0, w, h);
  g.strokeStyle = colors[1]; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `italic 700 ${h * 0.5}px "Teko", "Arial Narrow", sans-serif`;
  g.shadowColor = colors[0]; g.shadowBlur = 24; g.fillStyle = '#fff';
  g.fillText(lines[0], w / 2, h * 0.42);
  g.font = `600 ${h * 0.16}px "Rajdhani", Arial, sans-serif`;
  g.shadowBlur = 0; g.fillStyle = colors[1];
  g.fillText(lines[1], w / 2, h * 0.8);
  return toTex(c, { repeat: false });
}

function chevronTexture(night) {
  const [c, g] = cvs(256, 128);
  g.fillStyle = night ? '#120406' : '#d01919';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = night ? '#ff3346' : '#ffffff';
  for (let k = 0; k < 3; k++) {
    const x = 40 + k * 70;
    g.beginPath();
    g.moveTo(x, 16); g.lineTo(x + 40, 64); g.lineTo(x, 112); g.lineTo(x - 22, 112); g.lineTo(x + 18, 64); g.lineTo(x - 22, 16);
    g.closePath(); g.fill();
  }
  return toTex(c, { repeat: false });
}

function chevrons(track, night) {
  const quads = [];
  const hw = track.wallHalf;
  let lastS = -100;
  for (let i = 0; i < track.N; i++) {
    const k = track.curvS[i];
    const s = i * track.ds;
    if (Math.abs(k) < 1 / 105 || s - lastS < 11) continue;
    lastS = s;
    const side = k > 0 ? 1 : -1;
    const lat = side * (hw + 1.0);
    const x = track.px[i] + track.rx[i] * lat, z = track.pz[i] + track.rz[i] * lat, y = track.py[i] + 1.5;
    // face incoming traffic, angled slightly toward the road
    const fx = -track.tx[i] - track.rx[i] * side * 0.25, fz = -track.tz[i] - track.rz[i] * side * 0.25;
    const fl = Math.hypot(fx, fz);
    const nx = fx / fl, nz = fz / fl;
    const ux = nz, uz = -nx; // horizontal axis along the board
    const flip = side > 0; // left turn -> arrows point left
    quads.push({ c: [x, y, z], ax: [ux * 1.2, 0, uz * 1.2], ay: [0, 0.6, 0], uv: flip ? [1, 0, 0, 1] : [0, 0, 1, 1] });
    // post
  }
  const geo = quadGeo(quads);
  const mat = new THREE.MeshBasicMaterial({ map: chevronTexture(night), side: THREE.DoubleSide, color: night ? new THREE.Color(1.8, 1.8, 1.8) : new THREE.Color(1, 1, 1) });
  return new THREE.Mesh(geo, mat);
}

function skyDome(top, horizon, glow, sunDir = null, sunCol = null, clouds = 0.5) {
  const geo = new THREE.SphereGeometry(4000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, glow: { value: new THREE.Color(glow) },
      sunDir: { value: sunDir || new THREE.Vector3(0, -1, 0) }, sunCol: { value: new THREE.Color(sunCol || 0x000000) },
      clouds: { value: clouds }, time: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; uniform vec3 sunCol; uniform float clouds; uniform float time;
      varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=n(p)*a; p*=2.07; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 col = mix(horizon, top, pow(y, 0.5));
        col += glow * exp(-y * 7.0) * 0.9;
        if (d.y < 0.0) col = mix(horizon, horizon * 0.6, clamp(-d.y * 4.0, 0.0, 1.0));
        float sd = max(dot(d, sunDir), 0.0);
        col += sunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 60.0) * 0.8) + sunCol * smoothstep(0.9993, 0.9997, sd) * 6.0;
        vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(time * 0.004, 0.0);
        float c = smoothstep(0.42, 0.85, fbm(cp));
        vec3 cloudCol = mix(horizon * 1.08, vec3(1.0) + sunCol * pow(sd, 3.0) * 0.4, 0.55);
        col = mix(col, cloudCol, c * clouds * smoothstep(0.0, 0.25, d.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

/** merged mesh of glowing additive ground decals */
function decals(list, texture, color, opacity = 1) {
  const geo = quadGeo(list);
  const mat = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color,
    opacity, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 3;
  return m;
}

function streakTexture() {
  const [c, g] = cvs(64, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.5, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h; g.fillRect(0, 0, 64, 256);
  return toTex(c, { repeat: false });
}

// ------------------------------------------------------------------ shared daytime setup
const SHADOW = { low: 0, medium: 1024, high: 2048, ultra: 4096 };
const SHADOW_EXT = { low: 0, medium: 45, high: 60, ultra: 80 };

function daySetup(scene, ctx, o) {
  const { renderer, quality } = ctx;
  const sunDir = o.sunDir.clone().normalize();
  const fogCol = new THREE.Color(o.fog);
  scene.fog = new THREE.FogExp2(fogCol, o.fogDensity);
  scene.background = fogCol;
  const sky = skyDome(o.top, o.horizon, o.glow, sunDir, o.sunCol, o.clouds ?? 0.5);
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(o.hemiSky, o.hemiGround, o.hemi ?? 1.1));
  const sun = new THREE.DirectionalLight(o.sunLight ?? 0xfff1dc, o.sunI ?? 3.0);
  sun.position.copy(sunDir).multiplyScalar(300);
  const sz = SHADOW[quality] || 0;
  if (sz) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(sz, sz);
    const e = SHADOW_EXT[quality], cam = sun.shadow.camera;
    cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e; cam.near = 10; cam.far = 800;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.035;
  }
  scene.add(sun, sun.target);
  // reflections: render the sky and a ground plane into a PMREM environment map
  const envScene = new THREE.Scene();
  envScene.add(skyDome(o.top, o.horizon, o.glow, sunDir, o.sunCol, 0.25));
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: o.envGround ?? 0x8a8a80 }));
  gnd.rotation.x = -Math.PI / 2; gnd.position.y = -8; envScene.add(gnd);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  pm.dispose();
  return {
    sun, sky, sunDir, shadows: sz > 0,
    follow(player) {
      sky.material.uniforms.time.value = performance.now() / 1000;
      if (!sz) return;
      sun.target.position.set(player.rx ?? player.pos.x, player.pos.y, player.rz ?? player.pos.z);
      sun.position.copy(sun.target.position).addScaledVector(sunDir, 320);
      sun.target.updateMatrixWorld();
    },
  };
}

function trackBounds(track) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < track.N; i++) { minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]); minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]); }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/** start/finish gantry: lattice towers, truss, banner and a row of start lights */
function bannerTexture(title, sub, accent) {
  const w = 1024, h = 160;
  const [c, g] = cvs(w, h);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = accent;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(150, 0); g.lineTo(100, h); g.lineTo(0, h); g.fill();
  g.beginPath(); g.moveTo(w, 0); g.lineTo(w - 150, 0); g.lineTo(w - 100, h); g.lineTo(w, h); g.fill();
  g.fillStyle = '#11161f';
  g.beginPath(); g.moveTo(165, 0); g.lineTo(185, 0); g.lineTo(135, h); g.lineTo(115, h); g.fill();
  g.beginPath(); g.moveTo(w - 165, 0); g.lineTo(w - 185, 0); g.lineTo(w - 135, h); g.lineTo(w - 115, h); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `italic 700 ${h * 0.62}px "Teko", "Arial Narrow", sans-serif`;
  g.fillStyle = '#11161f';
  g.fillText(title, w / 2, h * 0.44);
  g.font = `700 ${h * 0.15}px "Rajdhani", Arial, sans-serif`;
  g.fillStyle = accent;
  g.fillText(sub, w / 2, h * 0.84);
  return toTex(c, { repeat: false });
}

function gantry(track, name, accent = '#ff6b1a') {
  const grp = new THREE.Group();
  const p = track.at(-4, 0, {});
  const hw = track.halfWidth + 1.8;
  const steel = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 0.55, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2128, metalness: 0.5, roughness: 0.45 });
  const yaw = p.hdg;
  const box = (sx, sy, sz, lat, y, fwd, mat, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(p.x + p.rx * lat + p.tx * fwd, p.y + y, p.z + p.rz * lat + p.tz * fwd);
    m.rotation.set(0, yaw, rz);
    m.castShadow = true;
    grp.add(m);
    return m;
  };
  const H = 10;
  for (const s of [-1, 1]) {
    const c = s * hw;
    for (const a of [-0.55, 0.55]) for (const f of [-0.55, 0.55]) box(0.16, H, 0.16, c + a, H / 2, f, steel);
    for (let y = 1; y < H; y += 1.6) {
      for (const f of [-0.55, 0.55]) box(1.1, 0.08, 0.08, c, y, f, steel);
      for (const f of [-0.55, 0.55]) box(1.5, 0.07, 0.07, c, y + 0.8, f, steel, (f > 0 ? 1 : -1) * 0.95);
    }
    box(1.6, 0.5, 1.6, c, 0.25, 0, dark);
  }
  const span = hw * 2 + 1.2;
  for (const y of [H - 2.4, H]) for (const f of [-0.55, 0.55]) box(span, 0.18, 0.18, 0, y, f, steel);
  for (let x = -span / 2 + 1.2; x < span / 2 - 0.8; x += 1.6) {
    for (const f of [-0.55, 0.55]) box(2.6, 0.07, 0.07, x + 0.8, H - 1.2, f, steel, ((Math.round(x / 1.6) % 2) ? 1 : -1) * 0.98);
  }
  const tex = bannerTexture(name.toUpperCase(), 'START  ·  FINISH  ·  DRIFTLINE SERIES', accent);
  const bannerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
  for (const f of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(span - 4, 17), 2.1), bannerMat);
    b.position.set(p.x + p.tx * f * 0.62, p.y + H - 1.2, p.z + p.tz * f * 0.62);
    b.rotation.y = yaw + (f < 0 ? Math.PI : 0);
    grp.add(b);
  }
  // start lights facing the grid
  box(4.4, 0.9, 0.3, 0, H - 3.2, -0.4, dark);
  const lights = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.02, 0.02) });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 10), mat);
    const lat = (i - 2) * 0.85;
    m.position.set(p.x + p.rx * lat - p.tx * 0.6, p.y + H - 3.2, p.z + p.rz * lat - p.tz * 0.6);
    grp.add(m);
    lights.push(mat);
  }
  // red count (0-5) or green
  const setLights = (n, green = false) => {
    lights.forEach((m, i) => {
      if (green) m.color.setRGB(0.2, 4, 0.6);
      else if (i < n) m.color.setRGB(5, 0.15, 0.1);
      else m.color.setRGB(0.12, 0.02, 0.02);
    });
  };
  return { group: grp, setLights };
}

/** billboards with bold graphic designs */
function billboardAtlas() {
  const W = 1024, H = 384, [c, g] = cvs(W * 2, H * 2);
  const cell = (i, fn) => { g.save(); g.translate((i % 2) * W, Math.floor(i / 2) * H); g.beginPath(); g.rect(0, 0, W, H); g.clip(); fn(); g.restore(); };
  const txt = (t, x, y, size, col, italic = true) => { g.font = `${italic ? 'italic ' : ''}700 ${size}px "Teko", "Arial Narrow", sans-serif`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  cell(0, () => {
    g.fillStyle = '#ffd21f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1559c9';
    for (let k = -2; k < 8; k++) { g.beginPath(); g.moveTo(k * 180, H); g.lineTo(k * 180 + 90, H); g.lineTo(k * 180 + 290, 0); g.lineTo(k * 180 + 200, 0); g.fill(); }
    g.fillStyle = '#ffffff'; g.fillRect(0, H * 0.32, W, H * 0.36);
    txt('NITRO FUEL', W / 2, H * 0.52, 150, '#1559c9');
  });
  cell(1, () => {
    g.fillStyle = '#ff6b1a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#11161f'; g.fillRect(0, H * 0.72, W, H * 0.12);
    txt('DRIFTLINE', W / 2, H * 0.42, 200, '#ffffff');
  });
  cell(2, () => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#00a7c7'; g.lineWidth = 16;
    for (let k = 0; k < 3; k++) { g.beginPath(); for (let x = 0; x <= W; x += 16) g.lineTo(x, H * 0.78 + k * 26 + Math.sin(x * 0.02 + k) * 10); g.stroke(); }
    txt('SOLARIS BAY GP', W / 2, H * 0.36, 150, '#0b5f8a');
  });
  cell(3, () => {
    g.fillStyle = '#11161f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd21f'; g.fillRect(40, 40, 18, H - 80); g.fillRect(W - 58, 40, 18, H - 80);
    txt('FULL THROTTLE', W / 2, H * 0.5, 160, '#ffd21f');
  });
  return toTex(c, { repeat: false });
}

function billboards(track, count, height = 4) {
  const quads = [], frames = [];
  const hw = track.wallHalf;
  const L = track.L;
  for (let k = 0; k < count; k++) {
    const s = (k + 0.35) * L / count;
    const i = track.idx(s);
    const side = track.curvS[track.idx(s + 60)] > 0 ? 1 : -1;
    const p = track.at(s, side * (hw + 4.5), {});
    if (minTrackDist(track, p.x, p.z, 3).d < hw + 3.5) continue;
    // face oncoming cars, angled toward the road
    let nx = -p.tx - p.rx * side * 0.6, nz = -p.tz - p.rz * side * 0.6;
    const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
    const ux = nz, uz = -nx;
    const d = k % 4, u0 = (d % 2) * 0.5, v1 = 1 - Math.floor(d / 2) * 0.5;
    const cy = p.y + height + 3;
    quads.push({ c: [p.x, cy, p.z], ax: [ux * 8, 0, uz * 8], ay: [0, 3, 0], uv: [u0, v1 - 0.5, u0 + 0.5, v1] });
    frames.push(tm(p.x - nx * 0.25, 0, p.z - nz * 0.25, Math.atan2(nx, nz)));
    frames[frames.length - 1].userData = { y: p.y, cy };
  }
  const grp = new THREE.Group();
  const faces = new THREE.Mesh(quadGeo(quads), new THREE.MeshStandardMaterial({ map: billboardAtlas(), roughness: 0.5, side: THREE.FrontSide }));
  faces.castShadow = true;
  grp.add(faces);
  // backing panel + two legs per board
  const back = new THREE.BoxGeometry(16.4, 6.4, 0.4);
  const leg = new THREE.BoxGeometry(0.35, 1, 0.35);
  const gray = new THREE.MeshStandardMaterial({ color: 0x8e959e, metalness: 0.6, roughness: 0.4 });
  const backs = new THREE.InstancedMesh(back, gray, frames.length);
  const legs = new THREE.InstancedMesh(leg, gray, frames.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  frames.forEach((F, i) => {
    F.decompose(v, q, sc);
    const { y, cy } = F.userData;
    backs.setMatrixAt(i, m.compose(new THREE.Vector3(v.x, cy, v.z), q, new THREE.Vector3(1, 1, 1)));
    for (const [j, off] of [[0, -5.5], [1, 5.5]]) {
      const ox = Math.cos(Math.atan2(v.x, v.z)) * 0;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const legH = cy - 3 - y;
      legs.setMatrixAt(i * 2 + j, m.compose(new THREE.Vector3(v.x + right.x * off + ox, y + legH / 2, v.z + right.z * off), q, new THREE.Vector3(1, legH, 1)));
    }
  });
  backs.castShadow = legs.castShadow = true;
  backs.computeBoundingSphere(); legs.computeBoundingSphere();
  grp.add(backs, legs);
  return grp;
}

function kerbTexture() {
  const [c, g] = cvs(64, 128);
  g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#e0261b'; g.fillRect(0, 0, 64, 64);
  return toTex(c);
}

/** red/white kerbs along both edges of every corner */
function kerbs(track) {
  const N = track.N, hw = track.halfWidth;
  const on = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (Math.abs(track.curvS[i]) > 1 / 160) for (let k = -12; k <= 12; k++) on[(i + k + N) % N] = 1;
  const pos = [], uv = [], idx = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      if (!on[i] || !on[(i + 1) % N]) continue;
      for (const k of [i, (i + 1) % N]) {
        const s = (k === i ? i : i + 1) * track.ds;
        for (const lat of [hw - 0.9, hw + 0.7]) {
          pos.push(track.px[k] + track.rx[k] * lat * side, track.py[k] + 0.035, track.pz[k] + track.rz[k] * lat * side);
          uv.push(lat > hw ? 1 : 0, s / 3);
        }
      }
      const b = pos.length / 3 - 4;
      if (side > 0) idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); else idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

/** guardrail at the wall line with yellow posts */
function guardrails(track, shadows) {
  const grp = new THREE.Group();
  const hw = track.wallHalf;
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd3d7dc, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
  const postMats = [];
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(sweep(track, [[0.4, 0.42], [0.36, 0.56], [0.4, 0.66], [0.36, 0.8]], s, hw, 0.25), railMat);
    m.castShadow = shadows; m.receiveShadow = shadows;
    grp.add(m);
    for (let i = 0; i < track.N; i += 2) {
      const lat = s * (hw + 0.62);
      postMats.push(tm(track.px[i] + track.rx[i] * lat, track.py[i] + 0.45, track.pz[i] + track.rz[i] * lat, track.hdg[i]));
    }
  }
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 }), postMats.length);
  postMats.forEach((m, i) => posts.setMatrixAt(i, m));
  posts.computeBoundingSphere();
  grp.add(posts);
  return grp;
}

/** generic terrain grid around the track; heightFn(x,z,d,y,i,dSigned) colorFn(...) */
function terrainGrid(track, quality, pad, heightFn, colorFn, extraFlat = 1.5) {
  const B = trackBounds(track);
  const x0 = B.minX - pad, x1 = B.maxX + pad, z0 = B.minZ - pad, z1 = B.maxZ + pad;
  const seg = quality === 'low' ? 180 : quality === 'medium' ? 260 : quality === 'high' ? 320 : 380;
  const sx = (x1 - x0) / seg, sz = (z1 - z0) / seg;
  const flat = track.wallHalf + extraFlat + Math.max(sx, sz) * 1.6;
  const nv = (seg + 1) * (seg + 1);
  const H = new Float32Array(nv);
  const N = track.N;
  const pos = new Float32Array(nv * 3), meta = [];
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const k = j * (seg + 1) + i;
      const x = x0 + i * sx, z = z0 + j * sz;
      let best = 1e18, bi = 0;
      for (let q = 0; q < N; q += 8) { const dx = track.px[q] - x, dz = track.pz[q] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = q; } }
      for (let r = -10; r <= 10; r++) { const q = (bi + r + N) % N; const dx = track.px[q] - x, dz = track.pz[q] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = q; } }
      const d = Math.sqrt(best);
      const dS = (x - track.px[bi]) * track.rx[bi] + (z - track.pz[bi]) * track.rz[bi];
      H[k] = d < flat ? track.py[bi] - 0.12 : heightFn(x, z, d - flat, track.py[bi] - 0.12, bi);
      pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
      meta.push([d, dS, bi]);
    }
  }
  const idx = new Uint32Array(seg * seg * 6);
  let o = 0;
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  const col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), tmpC = new THREE.Color();
  for (let k = 0; k < nv; k++) {
    const [d, dS, bi] = meta[k];
    colorFn(tmpC, pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], 1 - nrm[k * 3 + 1], d, dS, bi, flat);
    col[k * 3] = tmpC.r; col[k * 3 + 1] = tmpC.g; col[k * 3 + 2] = tmpC.b;
  }
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) { const k = j * (seg + 1) + i; uv[k * 2] = i / seg; uv[k * 2 + 1] = j / seg; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const [dc, dg] = cvs(256, 256);
  const di = dg.createImageData(256, 256);
  for (let i = 0; i < di.data.length; i += 4) { const v = 205 + Math.random() * 50; di.data[i] = di.data[i + 1] = di.data[i + 2] = v; di.data[i + 3] = 255; }
  dg.putImageData(di, 0, 0);
  const detail = toTex(dc);
  detail.repeat.set(seg * 1.5, seg * 1.5);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: detail }));
  mesh.receiveShadow = quality !== 'low';
  const heightAt = (x, z) => {
    const fi = (x - x0) / sx, fj = (z - z0) / sz;
    const i = Math.max(0, Math.min(seg - 1, Math.floor(fi))), j = Math.max(0, Math.min(seg - 1, Math.floor(fj)));
    const u = fi - i, v = fj - j, k = j * (seg + 1) + i;
    return H[k] * (1 - u) * (1 - v) + H[k + 1] * u * (1 - v) + H[k + seg + 1] * (1 - u) * v + H[k + seg + 2] * u * v;
  };
  return { mesh, heightAt, flat };
}

function hillsRing(cx, cz, layers, keep = () => true) {
  const mPos = [], mCol = [], mIdx = [];
  const segs = 180;
  layers.forEach(([R, hMin, hMax, cBase, cTop], li) => {
    const cb = new THREE.Color(cBase), ct = new THREE.Color(cTop);
    let prev = -1;
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2;
      if (!keep(a)) { prev = -1; continue; }
      const h = hMin + (hMax - hMin) * (0.5 + 0.5 * fbm(Math.cos(a) * 3 + li * 10, Math.sin(a) * 3, 5));
      const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
      const base = mPos.length / 3;
      mPos.push(x, -40, z, x + Math.cos(a) * 60, h, z + Math.sin(a) * 60);
      mCol.push(cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
      if (prev >= 0) mIdx.push(prev, base, prev + 1, prev + 1, base, base + 1);
      prev = base;
    }
  });
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
  mg.setAttribute('color', new THREE.Float32BufferAttribute(mCol, 3));
  mg.setIndex(mIdx);
  const m = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.renderOrder = -6;
  return m;
}

// ------------------------------------------------------------------ city (daytime)
function facadeTextures() {
  // black glass towers: dark frames, smoked windows with sky reflections
  const W = 512, H = 1024, cols = 16, rows = 32, cw = W / cols, ch = H / rows;
  const [c, g] = cvs(W, H);
  g.fillStyle = '#121418'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < rows; y++) {
    const band = Math.random() < 0.12;
    for (let x = 0; x < cols; x++) {
      const px = x * cw, py = y * ch;
      g.fillStyle = band ? '#1d2026' : '#16181d'; g.fillRect(px, py, cw, ch);
      const grd = g.createLinearGradient(px, py, px + cw * 0.6, py + ch);
      const r = Math.random();
      const glass = r < 0.2 ? ['#07090c', '#12161c'] : r < 0.7 ? ['#0e1319', '#26303b'] : ['#18202a', '#3a4756'];
      grd.addColorStop(0, glass[0]); grd.addColorStop(1, glass[1]);
      g.fillStyle = grd; g.fillRect(px + 3, py + 4, cw - 6, ch - 9);
      if (Math.random() < 0.22) { g.fillStyle = 'rgba(170,200,230,0.16)'; g.fillRect(px + 3, py + 4, cw - 6, (ch - 9) * Math.random() * 0.5); }
      if (Math.random() < 0.04) { g.fillStyle = 'rgba(255,214,150,0.55)'; g.fillRect(px + 5, py + 6, cw - 10, ch - 13); }
    }
  }
  g.fillStyle = '#1b1e23'; g.fillRect(0, 0, 12, 12);
  return toTex(c);
}

const SIGNS = [
  ['NOODLE', '#e53935'], ['HOTEL', '#0d8bd9'], ['24/7', '#f2a900'], ['ARCADE', '#1e88e5'], ['KARAOKE', '#f4511e'],
  ['SUSHI', '#16a34a'], ['CLUB', '#d32f2f'], ['MOTEL', '#ff7a1a'], ['RAMEN', '#c62828'], ['TATTOO', '#0097a7'],
  ['GARAGE', '#f2b600'], ['OPEN', '#e53935'], ['CAFE', '#8d6e63'], ['LIVE', '#00a896'], ['BAR', '#e64a19'], ['DINER', '#00897b'],
];
function signAtlas() {
  const S = 256, [c, g] = cvs(S * 4, S * 4);
  g.clearRect(0, 0, S * 4, S * 4);
  SIGNS.forEach(([txt, col], i) => {
    const x = (i % 4) * S, y = Math.floor(i / 4) * S;
    g.save();
    g.translate(x + S / 2, y + S / 2);
    g.fillStyle = col; g.fillRect(-S / 2 + 6, -S / 4 - 4, S - 12, S / 2 + 8);
    g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(-S / 2 + 16, -S / 4 + 6, S - 32, S / 2 - 12);
    g.font = `700 ${txt.length > 5 ? 54 : 70}px "Teko", "Arial Narrow", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.fillText(txt, 0, 4);
    g.restore();
  });
  return toTex(c, { repeat: false });
}

function skylineTexture() {
  const W = 2048, H = 256, [c, g] = cvs(W, H);
  g.clearRect(0, 0, W, H);
  let x = 0;
  while (x < W) {
    const w = 18 + Math.random() * 60, h = 40 + Math.pow(Math.random(), 1.6) * 200;
    const v = 46 + Math.random() * 22;
    g.fillStyle = `rgb(${v - 4},${v},${v + 8})`;
    g.fillRect(x, H - h, w, h);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x, H - h, w * 0.3, h);
    x += w + Math.random() * 6;
  }
  const t = toTex(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function buildCity(track, assets, ctx) {
  SEED = 4242;
  const { quality } = ctx;
  const scene = new THREE.Scene();
  const hw = track.halfWidth;
  const day = daySetup(scene, ctx, {
    sunDir: new THREE.Vector3(0.42, 0.68, 0.6), fog: 0xd6e0e8, fogDensity: 0.0013,
    top: 0x4086d8, horizon: 0xd3e0ea, glow: 0x46413a, sunCol: 0xfff2da, clouds: 0.5,
    hemiSky: 0xd7e7ff, hemiGround: 0x8f8a80, hemi: 1.05, sunI: 3.1, envGround: 0x9c9fa3,
  });
  // ground sits well below the road and is pushed back in depth, so it never shows through the asphalt
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 40, 40), new THREE.MeshStandardMaterial({ color: 0x9da2a8, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.3;
  ground.receiveShadow = day.shadows;
  scene.add(ground);

  // matte asphalt: a glossy road flared to white when driving toward the low sun
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTexture(track, 'city') });
  scene.add(buildRoad(track, roadMat));
  scene.add(startLine(track));

  const [bc, bg] = cvs(64, 256);
  bg.fillStyle = '#c9ccd0'; bg.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 400; i++) { bg.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; bg.fillRect(Math.random() * 64, Math.random() * 256, 3, 3); }
  bg.fillStyle = '#e0261b'; bg.fillRect(0, 0, 64, 18);
  const barrierMat = new THREE.MeshStandardMaterial({ map: toTex(bc), roughness: 0.85, side: THREE.DoubleSide });
  const barrierProf = [[0, 0], [0, 0.12], [0.12, 0.3], [0.17, 0.82], [0.43, 0.82], [0.48, 0.3], [0.6, 0.12], [0.6, 0]];
  const sideMat = (() => {
    const [c, g] = cvs(128, 128);
    g.fillStyle = '#c3c6ca'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#a9adb2'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke(); g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.stroke(); }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.8 });
  })();
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(sweep(track, barrierProf, s, hw, 0.25), barrierMat);
    b.castShadow = day.shadows; b.receiveShadow = day.shadows;
    scene.add(b);
    const sw = new THREE.Mesh(sweep(track, [[0.6, 0.16], [7.5, 0.16], [7.5, -0.05]], s, hw, 0.25), sideMat);
    sw.receiveShadow = day.shadows;
    scene.add(sw);
  }

  // buildings
  const occ = new Set();
  const cell = 4;
  const key = (x, z) => (Math.floor(x / cell) + 4000) * 8000 + (Math.floor(z / cell) + 4000);
  const fpPoints = (cx, cz, ux, uz, w, d) => {
    const pts = [];
    for (let a = -w / 2; a <= w / 2 + 0.01; a += Math.min(3, w / 2)) for (let b = -d / 2; b <= d / 2 + 0.01; b += Math.min(3, d / 2)) {
      pts.push([cx + ux * a - uz * b, cz + uz * a + ux * b]);
    }
    return pts;
  };
  const free = (pts) => pts.every(([x, z]) => !occ.has(key(x, z)));
  const mark = (pts) => pts.forEach(([x, z]) => occ.add(key(x, z)));
  const blds = [];
  const tryAdd = (cx, cz, ux, uz, w, d, h, minD, front) => {
    const pts = fpPoints(cx, cz, ux, uz, w, d);
    if (!free(pts)) return false;
    for (const [x, z] of pts) if (minTrackDist(track, x, z, 4).d < minD) return false;
    mark(pts);
    blds.push({ cx, cz, ux, uz, w, d, h, front });
    return true;
  };
  for (const side of [-1, 1]) {
    let s = rr(0, 10);
    while (s < track.L) {
      const w = rr(16, 34), d = rr(14, 28);
      const p = track.at(s + w / 2, 0, {});
      const off = hw + 8 + d / 2 + rr(0, 2.5);
      const cx = p.x + p.rx * off * side, cz = p.z + p.rz * off * side;
      const h = 10 + Math.pow(rnd(), 2.2) * 60 + (rnd() < 0.14 ? rr(40, 90) : 0);
      const face = off - d / 2;
      tryAdd(cx, cz, p.tx, p.tz, w, d, h, hw + 7.6, { nx: -p.rx * side, nz: -p.rz * side, px: p.x + p.rx * face * side, pz: p.z + p.rz * face * side, tx: p.tx, tz: p.tz });
      s += w + rr(1.5, 7);
    }
  }
  const B = trackBounds(track);
  const pad = quality === 'low' ? 260 : 380;
  let fill = 0;
  const maxFill = quality === 'low' ? 450 : quality === 'ultra' ? 1200 : 900;
  for (let x = B.minX - pad; x < B.maxX + pad && fill < maxFill; x += 36) {
    for (let z = B.minZ - pad; z < B.maxZ + pad && fill < maxFill; z += 36) {
      const cx = x + rr(-5, 5), cz = z + rr(-5, 5);
      const w = rr(16, 30), d = rr(16, 30);
      const dist = minTrackDist(track, cx, cz, 6).d;
      if (dist < hw + 26) continue;
      const h = 14 + Math.pow(rnd(), 2) * 70 + (dist > 120 ? Math.pow(rnd(), 1.5) * 110 : 0);
      if (tryAdd(cx, cz, 1, 0, w, d, h, hw + 20, null)) fill++;
    }
  }
  const facade = facadeTextures();
  const bPos = [], bUv = [], bCol = [], bIdx = [];
  const tints = [[1, 1, 1], [0.9, 0.9, 0.92], [0.85, 0.9, 1], [1, 0.97, 0.92], [0.8, 0.82, 0.86], [0.95, 0.95, 1]];
  for (const b of blds) {
    const { cx, cz, ux, uz, w, d, h } = b;
    const vx = -uz, vz = ux;
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, c]) => [cx + ux * a + vx * c, cz + uz * a + vz * c]);
    const tint = tints[Math.floor(rnd() * tints.length)];
    const u0 = Math.floor(rnd() * 16) / 16, v0 = Math.floor(rnd() * 32) / 32;
    let uAcc = 0;
    for (let k = 0; k < 4; k++) {
      const a = corners[k], c = corners[(k + 1) % 4];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const base = bPos.length / 3;
      bPos.push(a[0], 0, a[1], c[0], 0, c[1], c[0], h, c[1], a[0], h, a[1]);
      const uA = u0 + uAcc / 40, uB = u0 + (uAcc + len) / 40;
      bUv.push(uA, v0, uB, v0, uB, v0 + h / 102.4, uA, v0 + h / 102.4);
      uAcc += len;
      for (let q = 0; q < 4; q++) bCol.push(...tint);
      bIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const base = bPos.length / 3;
    for (const [x, z] of corners) { bPos.push(x, h, z); bUv.push(0.005, 0.995); bCol.push(1, 1, 1); }
    bIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
  bGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bUv, 2));
  bGeo.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
  bGeo.setIndex(bIdx);
  bGeo.computeVertexNormals();
  const bMesh = new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.22, metalness: 0.6, envMapIntensity: 1.4 }));
  bMesh.castShadow = day.shadows && quality !== 'medium';
  bMesh.receiveShadow = day.shadows;
  scene.add(bMesh);

  // shop signs on roadside facades
  const signQuads = [];
  for (const b of blds) {
    if (!b.front || rnd() < 0.35) continue;
    const f = b.front;
    const along = rr(-b.w / 2 + 4, b.w / 2 - 4);
    const idx = Math.floor(rnd() * SIGNS.length);
    const u0 = (idx % 4) / 4, v1 = 1 - Math.floor(idx / 4) / 4;
    const uv = [u0, v1 - 0.25, u0 + 0.25, v1];
    const x = f.px + f.tx * along, z = f.pz + f.tz * along;
    const y = rr(4.5, Math.min(14, b.h - 3));
    if (rnd() < 0.5) {
      const sz = rr(2.4, 4.2);
      signQuads.push({ c: [x + f.nx * 0.3, y, z + f.nz * 0.3], ax: [f.nz * sz, 0, -f.nx * sz], ay: [0, sz * 0.5, 0], uv });
    } else {
      const sz = rr(1.8, 2.8);
      signQuads.push({ c: [x + f.nx * (sz + 0.4), y + 2, z + f.nz * (sz + 0.4)], ax: [f.nx * sz, 0, f.nz * sz], ay: [0, sz * 0.5, 0], uv });
    }
  }
  const signMesh = new THREE.Mesh(quadGeo(signQuads), new THREE.MeshStandardMaterial({ map: signAtlas(), transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 0.55 }));
  scene.add(signMesh);

  // lamps and palms along the sidewalks
  const lampMats = [], palmMats = [];
  const lampTpl = assets.props.getObjectByName('prop_lamp');
  const palmTpl = assets.props.getObjectByName('prop_palm');
  for (const side of [-1, 1]) {
    for (let s = side > 0 ? 8 : 27; s < track.L; s += 38) {
      if (s < 18 || s > track.L - 18) continue;
      const p = track.at(s, side * (hw + 1.3), {});
      if (minTrackDist(track, p.x, p.z, 2).d < hw + 0.9) continue;
      const dx = -p.rx * side, dz = -p.rz * side;
      lampMats.push(tm(p.x, p.y, p.z, Math.atan2(dx, dz), 1));
      const pp = track.at(s + 19, side * (hw + 4.2), {});
      if (minTrackDist(track, pp.x, pp.z, 2).d > hw + 3) palmMats.push(tm(pp.x, pp.y + 0.15, pp.z, rnd() * 6.28, rr(0.85, 1.2)));
    }
  }
  const propMat = {
    LampMetal: new THREE.MeshStandardMaterial({ color: 0x5c626b, metalness: 0.8, roughness: 0.35 }),
    LampGlow: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.3 }),
    PalmTrunk: new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 }),
    PalmLeaf: new THREE.MeshStandardMaterial({ color: 0x5f9a35, roughness: 0.75, side: THREE.DoubleSide }),
  };
  scene.add(instanceTemplate(lampTpl, lampMats, { matMap: propMat, cast: day.shadows }));
  scene.add(instanceTemplate(palmTpl, palmMats, { matMap: propMat, cast: day.shadows }));

  const gt = gantry(track, track.def.name, '#ff6b1a');
  scene.add(gt.group);
  scene.add(chevrons(track, false));

  const skyTex = skylineTexture();
  skyTex.repeat.set(4, 1);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1900, 1900, 420, 64, 1, true),
    new THREE.MeshBasicMaterial({ map: skyTex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false, color: 0xe6edf3 }));
  ring.position.set(B.cx, 200, B.cz);
  ring.renderOrder = -5;
  scene.add(ring);

  return {
    scene, theme: 'city', night: false,
    bloom: { strength: 0.22, radius: 0.45, threshold: 0.96 },
    exposure: 1.0,
    glowPoints: [],
    sunDir: day.sunDir,
    setLights: gt.setLights,
    update(dt, time, camera, player) { day.follow(player); },
  };
}

// ------------------------------------------------------------------ coast (seaside circuit)
const SHORE = x => -395 + 14 * Math.sin(x * 0.009) + 8 * Math.sin(x * 0.023 + 1.3);

function waterMesh(sunDir, fogCol, fogDensity) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }, sunDir: { value: sunDir }, deep: { value: new THREE.Color(0x0d5d8f) }, shallow: { value: new THREE.Color(0x35c3c9) },
      skyTop: { value: new THREE.Color(0x3d84d6) }, skyHor: { value: new THREE.Color(0xcfdeea) },
      fogColor: { value: new THREE.Color(fogCol) }, fogDensity: { value: fogDensity },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float time; uniform vec3 sunDir; uniform vec3 deep; uniform vec3 shallow; uniform vec3 skyTop; uniform vec3 skyHor;
      uniform vec3 fogColor; uniform float fogDensity;
      varying vec3 vW;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hh(i),hh(i+vec2(1,0)),f.x), mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x), f.y); }
      float wave(vec2 p){
        float t = time;
        return sin(p.x*0.06 + t*0.9)*0.5 + sin(p.y*0.09 - t*1.1 + p.x*0.03)*0.35 + nz(p*0.12 + vec2(t*0.25, t*0.18))*0.8 + nz(p*0.45 - vec2(t*0.4, -t*0.3))*0.25;
      }
      float shore(float x){ return -395.0 + 14.0*sin(x*0.009) + 8.0*sin(x*0.023 + 1.3); }
      void main(){
        vec2 p = vW.xz;
        float e = 0.6;
        float h0 = wave(p);
        vec3 n = normalize(vec3(-(wave(p + vec2(e,0.0)) - h0) / e * 0.5, 1.0, -(wave(p + vec2(0.0,e)) - h0) / e * 0.5));
        vec3 v = normalize(cameraPosition - vW);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        vec3 sky = mix(skyHor, skyTop, clamp(r.y * 1.8, 0.0, 1.0));
        float toShore = vW.z - shore(vW.x);
        float sh = smoothstep(-90.0, 0.0, toShore);
        vec3 base = mix(deep, shallow, sh);
        vec3 col = mix(base, sky, fres * 0.85);
        float spec = pow(max(dot(r, sunDir), 0.0), 280.0);
        col += vec3(1.0, 0.95, 0.85) * spec * 7.0;
        float foamBand = smoothstep(-14.0, -2.0, toShore) * (0.55 + 0.45 * sin(vW.x * 0.07 + time * 1.4 + nz(p * 0.2) * 4.0));
        float foamN = smoothstep(0.55, 0.9, nz(p * 0.6 + time * 0.3));
        col = mix(col, vec3(0.97), clamp(foamBand * (0.4 + foamN), 0.0, 0.85));
        float dist = length(cameraPosition - vW);
        float f = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
        col = mix(col, fogColor, clamp(f, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = -1.15;
  return m;
}

function crowdTexture() {
  const [c, g] = cvs(256, 64);
  g.fillStyle = '#2f6fc0'; g.fillRect(0, 0, 256, 64);
  const shirts = ['#ff6b1a', '#ffffff', '#e53935', '#ffd21f', '#1e88e5', '#16a34a', '#11161f', '#00a7c7', '#f4f4f2'];
  const skins = ['#f1c7a5', '#d9a37f', '#a8714f', '#7a4a32', '#f5d6bd'];
  for (let k = 0; k < 220; k++) {
    if (Math.random() < 0.12) continue;
    const x = Math.random() * 256, y = 16 + Math.random() * 40;
    g.fillStyle = shirts[Math.floor(Math.random() * shirts.length)];
    g.fillRect(x - 3, y, 6, 12);
    g.fillStyle = skins[Math.floor(Math.random() * skins.length)];
    g.beginPath(); g.arc(x, y - 3, 3, 0, Math.PI * 2); g.fill();
  }
  return toTex(c);
}

/** stepped grandstand with crowd and roof, built along the track between s0 and s1 */
function grandstand(track, s0, s1, side, lat0, shadows) {
  const grp = new THREE.Group();
  const mid = track.at((s0 + s1) / 2, 0, {});
  const len = s1 - s0;
  const rows = 12, rowD = 0.95, rowH = 0.55;
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.6 });
  const crowdTex = crowdTexture();
  crowdTex.repeat.set(len / 7, 1);
  const crowd = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 });
  const tread = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.85 });
  const tx = mid.tx, tz = mid.tz, rx = mid.rx * side, rz = mid.rz * side;
  const P = (along, lat, y) => [mid.x + tx * along + rx * lat, mid.y + y, mid.z + tz * along + rz * lat];
  const risers = [], treads = [];
  for (let r = 0; r < rows; r++) {
    const lat = lat0 + r * rowD, y = 1.4 + r * rowH;
    const c = P(0, lat, y + rowH / 2);
    risers.push({ c, ax: [tx * len / 2, 0, tz * len / 2], ay: [0, rowH / 2, 0], uv: [0, 0, 1, 1] });
    const ct = P(0, lat + rowD / 2, y + rowH);
    treads.push({ c: ct, ax: [tx * len / 2, 0, tz * len / 2], ay: [rx * rowD / 2, 0, rz * rowD / 2] });
  }
  const rm = new THREE.Mesh(quadGeo(risers), crowd);
  rm.material.side = THREE.DoubleSide;
  const tdm = new THREE.Mesh(quadGeo(treads), tread);
  tdm.material.side = THREE.DoubleSide;
  rm.receiveShadow = tdm.receiveShadow = shadows;
  grp.add(rm, tdm);
  const yaw = Math.atan2(tx, tz);
  const box = (along, lat, y, sx, sy, sz, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    const [x, yy, z] = P(along, lat, y);
    m.position.set(x, yy, z);
    m.rotation.y = yaw;
    m.castShadow = shadows; m.receiveShadow = shadows;
    grp.add(m);
    return m;
  };
  const backLat = lat0 + rows * rowD + 0.4;
  box(0, lat0 - 0.3, 0.7, 0.6, 1.4, len, white);
  box(0, backLat, (1.4 + rows * rowH + 3) / 2, 0.8, 1.4 + rows * rowH + 3, len, white);
  box(-len / 2, lat0 + rows * rowD / 2, (1.4 + rows * rowH) / 2, rows * rowD + 1, 1.4 + rows * rowH, 0.6, white);
  box(len / 2, lat0 + rows * rowD / 2, (1.4 + rows * rowH) / 2, rows * rowD + 1, 1.4 + rows * rowH, 0.6, white);
  // cantilever roof
  const roofY = 1.4 + rows * rowH + 3.2;
  const roof = box(0, lat0 + rows * rowD / 2 - 0.5, roofY, rows * rowD + 3, 0.35, len + 2, white);
  roof.rotation.set(0, yaw, 0);
  for (let a = -len / 2 + 4; a <= len / 2 - 4; a += 12) box(a, backLat, roofY / 2, 0.5, roofY, 0.5, white);
  // sponsor strip on the front wall
  const stripTex = billboardAtlas();
  stripTex.repeat.set(len / 32, 1);
  stripTex.wrapS = THREE.RepeatWrapping;
  return grp;
}

function pitBuilding(track, s0, s1, side, lat0, shadows) {
  const grp = new THREE.Group();
  const mid = track.at((s0 + s1) / 2, 0, {});
  const len = s1 - s0, depth = 16;
  const yaw = Math.atan2(mid.tx, mid.tz);
  const rx = mid.rx * side, rz = mid.rz * side;
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f4f5, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x23384d, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.4 });
  const box = (along, lat, y, sx, sy, sz, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(mid.x + mid.tx * along + rx * lat, mid.y + y, mid.z + mid.tz * along + rz * lat);
    m.rotation.y = yaw;
    m.castShadow = shadows; m.receiveShadow = shadows;
    grp.add(m);
    return m;
  };
  const c = lat0 + depth / 2;
  box(0, c, 2.2, depth, 4.4, len, white);
  box(0, c - 0.3, 5.6, depth - 1, 2.4, len - 2, glass);
  box(0, c, 7.1, depth + 2.5, 0.5, len + 2, white);
  for (let a = -len / 2 + 6; a < len / 2 - 4; a += 10) box(a, lat0 - 0.05, 2.1, 0.2, 3.6, 7, glass);
  // control tower
  const ta = -len / 2 + 14;
  box(ta, c, 9, 10, 18, 10, white);
  box(ta, c, 16.6, 11, 3, 11, glass);
  box(ta, c, 18.4, 12, 0.5, 12, white);
  return grp;
}

function yachts(count) {
  const hull = new THREE.CylinderGeometry(1.4, 0.6, 12, 6, 1);
  hull.rotateX(Math.PI / 2); hull.scale(1, 0.55, 1);
  const cabin = new THREE.BoxGeometry(2.2, 1.6, 5); cabin.translate(0, 1.4, -0.5);
  const mast = new THREE.CylinderGeometry(0.08, 0.1, 13, 6); mast.translate(0, 7, 0.5);
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.35 });
  const grp = new THREE.Group();
  const parts = [hull, cabin, mast].map(g => new THREE.InstancedMesh(g, white, count));
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const x = rr(-900, 900), z = rr(-520, -1100);
    m.compose(new THREE.Vector3(x, -0.7, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(1, 1, 1).multiplyScalar(rr(0.8, 1.5)));
    parts.forEach(p => p.setMatrixAt(i, m));
  }
  parts.forEach(p => { p.computeBoundingSphere(); grp.add(p); });
  return grp;
}

function buildCoast(track, assets, ctx) {
  SEED = 9090;
  const { quality } = ctx;
  const scene = new THREE.Scene();
  const hw = track.halfWidth, wh = track.wallHalf;
  const fogCol = 0xd9e5ee, fogDensity = 0.00052;
  const day = daySetup(scene, ctx, {
    sunDir: new THREE.Vector3(0.38, 0.55, -0.74), fog: fogCol, fogDensity,
    top: 0x3d84d6, horizon: 0xcfdeea, glow: 0x4a4436, sunCol: 0xfff2d8, clouds: 0.6,
    hemiSky: 0xd9ebff, hemiGround: 0xb59f78, hemi: 1.15, sunI: 3.2, envGround: 0x9aa680,
  });

  // terrain: mown grass near the circuit, sand traps outside corners, hills inland, beach to the sea
  const grassA = new THREE.Color(0x5e9a3a), grassB = new THREE.Color(0x6dab45), dry = new THREE.Color(0xa7a868),
    gravel = new THREE.Color(0xddcfa9), sand = new THREE.Color(0xefe0b9), wet = new THREE.Color(0xc9b68c), rock = new THREE.Color(0x9a8f7c);
  const terr = terrainGrid(track, quality, 1100, (x, z, t, y) => {
    const n = fbm(x * 0.002 + 4, z * 0.002 - 2);
    const amp = 6 + 46 * (n * 0.5 + 0.5);
    let h = y + (t * t) / (t * t + 95 * 95) * amp + fbm(x * 0.02, z * 0.02, 3) * 1.4 * Math.min(1, t / 30) + Math.max(0, t - 380) * 0.08;
    const toShore = z - SHORE(x);
    if (toShore < 140) {
      const beachH = -1.15 + toShore * 0.032 - (toShore < 0 ? -toShore * 0.05 : 0);
      h = Math.min(h, beachH + Math.max(0, toShore - 110) * 0.5);
    }
    return h;
  }, (c, x, y, z, slope, d, dS, bi, flat) => {
    const stripe = Math.sin((x * 0.7 + z * 0.7) * 0.22) > 0;
    c.copy(stripe ? grassA : grassB);
    if (d > flat) {
      const n = fbm(x * 0.008, z * 0.008, 3);
      c.lerp(dry, THREE.MathUtils.clamp((d - flat) / 160 + n * 0.4, 0, 0.85));
      c.lerp(rock, THREE.MathUtils.smoothstep(slope, 0.18, 0.4));
    }
    const k = track.curvS[bi];
    if (Math.abs(k) > 1 / 110 && Math.sign(dS) === Math.sign(k) && d > hw + 1 && d < wh + 9) c.copy(gravel);
    const toShore = z - SHORE(x);
    if (toShore < 70 && d > wh + 2) c.copy(sand).lerp(wet, THREE.MathUtils.smoothstep(12 - toShore, 0, 14));
    const v = 0.93 + noise2(x, z) * 0.12;
    c.multiplyScalar(v);
  }, 0.5);
  scene.add(terr.mesh);
  scene.add(waterMesh(day.sunDir, fogCol, fogDensity));

  // road, kerbs, rails
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(track, 'coast'), roughness: 0.78, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  scene.add(buildRoad(track, roadMat));
  scene.add(startLine(track));
  scene.add(kerbs(track));
  scene.add(guardrails(track, day.shadows));

  // main straight furniture: grandstands inland, pit building toward the sea
  const shadows = day.shadows;
  scene.add(grandstand(track, -110, 20, 1, wh + 5, shadows));
  scene.add(grandstand(track, 40, 170, 1, wh + 5, shadows));
  scene.add(grandstand(track, 190, 300, 1, wh + 5, shadows));
  scene.add(pitBuilding(track, -60, 200, -1, wh + 5, shadows));
  scene.add(billboards(track, quality === 'low' ? 6 : 12));
  const gt = gantry(track, track.def.name, '#ff6b1a');
  scene.add(gt.group);
  scene.add(chevrons(track, false));

  // palms: a long row on the beach plus clusters around the circuit
  const palmMats = [], rockMats = [], treeMats = [];
  for (let x = -900; x < 900; x += rr(9, 16)) {
    const z = SHORE(x) + rr(22, 48);
    if (minTrackDist(track, x, z, 4).d < wh + 4) continue;
    palmMats.push(tm(x, terr.heightAt(x, z), z, rnd() * 6.28, rr(0.9, 1.45)));
  }
  const nPalms = quality === 'low' ? 160 : quality === 'ultra' ? 520 : 340;
  for (let k = 0; k < nPalms; k++) {
    const s = rnd() * track.L, side = rnd() < 0.5 ? -1 : 1;
    const dist = wh + 4 + Math.pow(rnd(), 1.4) * 70;
    const p = track.at(s, side * dist, {});
    if (minTrackDist(track, p.x, p.z, 4).d < wh + 3) continue;
    if (p.z - SHORE(p.x) < 6) continue;
    const r = rnd();
    const y = terr.heightAt(p.x, p.z);
    if (r < 0.72) palmMats.push(tm(p.x, y, p.z, rnd() * 6.28, rr(0.85, 1.35)));
    else if (r < 0.86) treeMats.push(tm(p.x, y, p.z, rnd() * 6.28, rr(0.8, 1.2)));
    else rockMats.push(tm(p.x, y - 0.4, p.z, rnd() * 6.28, rr(0.6, 1.6)));
  }
  const propMat = {
    PalmTrunk: new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.9 }),
    PalmLeaf: new THREE.MeshStandardMaterial({ color: 0x74b53e, roughness: 0.7, side: THREE.DoubleSide }),
    TreeBark: new THREE.MeshStandardMaterial({ color: 0x6b4f37, roughness: 0.9 }),
    Foliage: new THREE.MeshStandardMaterial({ color: 0x5f8f3a, roughness: 0.85, flatShading: true }),
    Rock: new THREE.MeshStandardMaterial({ color: 0xb4a68c, roughness: 0.95, flatShading: true }),
  };
  const castProps = shadows && quality !== 'medium';
  scene.add(instanceTemplate(assets.props.getObjectByName('prop_palm'), palmMats, { matMap: propMat, cast: castProps }));
  scene.add(instanceTemplate(assets.props.getObjectByName('prop_tree'), treeMats, { matMap: propMat, cast: castProps }));
  scene.add(instanceTemplate(assets.props.getObjectByName('prop_rock0'), rockMats, { matMap: propMat, cast: castProps }));
  if (quality !== 'low') scene.add(yachts(quality === 'ultra' ? 18 : 10));

  const B = trackBounds(track);
  scene.add(hillsRing(B.cx, B.cz, [[2200, 90, 240, 0x9fb4b8, 0xc8d6d8], [2900, 160, 420, 0xaebfc9, 0xd7e1e7]], a => Math.sin(a) > -0.05));

  const water = scene.children.find(o => o.material && o.material.uniforms && o.material.uniforms.shallow);
  return {
    scene, theme: 'coast', night: false,
    bloom: { strength: 0.28, radius: 0.5, threshold: 0.95 },
    exposure: 1.0,
    glowPoints: [],
    sunDir: day.sunDir,
    setLights: gt.setLights,
    update(dt, time, camera, player) {
      day.follow(player);
      water.material.uniforms.time.value = time;
    },
  };
}

// ------------------------------------------------------------------ canyon
function buildCanyon(track, assets, ctx) {
  SEED = 777;
  const { quality } = ctx;
  const scene = new THREE.Scene();
  const hw = track.halfWidth;
  const day = daySetup(scene, ctx, {
    sunDir: new THREE.Vector3(-0.55, 0.45, -0.7), fog: 0xe4d4bd, fogDensity: 0.0009,
    top: 0x4a88d4, horizon: 0xe9dcc8, glow: 0x5a4a36, sunCol: 0xfff1d6, clouds: 0.4,
    hemiSky: 0xe0ecff, hemiGround: 0x8f6c4a, hemi: 1.1, sunLight: 0xfff0dc, sunI: 3.1, envGround: 0x9a7a5c,
  });
  const sunDir = day.sunDir, sky = day.sky, sun = day.sun;
  const shadows = day.shadows;

  // terrain
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < track.N; i++) { minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]); minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]); }
  const pad = 900;
  const x0 = minX - pad, x1 = maxX + pad, z0 = minZ - pad, z1 = maxZ + pad;
  const seg = quality === 'low' ? 180 : quality === 'medium' ? 260 : quality === 'high' ? 320 : 380;
  const sx = (x1 - x0) / seg, sz = (z1 - z0) / seg;
  const nv = (seg + 1) * (seg + 1);
  const H = new Float32Array(nv), D = new Float32Array(nv);
  const N = track.N;
  const nearest = (x, z) => {
    let best = 1e18, bi = 0;
    for (let i = 0; i < N; i += 8) { const dx = track.px[i] - x, dz = track.pz[i] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    for (let k = -10; k <= 10; k++) { const i = (bi + k + N) % N; const dx = track.px[i] - x, dz = track.pz[i] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    return [Math.sqrt(best), track.py[bi]];
  };
  // any terrain triangle touching the road must lie fully inside the flat zone
  const flat = hw + 1.5 + Math.max(sx, sz) * 1.6;
  const heightAt = (x, z, d, y) => {
    if (d < flat) return y - 0.14;
    const t = d - flat;
    const n1 = fbm(x * 0.0022 + 3.1, z * 0.0022 - 1.7);
    const amp = 30 + 100 * (n1 * 0.5 + 0.5);
    const dir = fbm(x * 0.0013 - 7, z * 0.0013 + 2) > -0.18 ? 1 : -0.45;
    const rise = (t * t) / (t * t + 55 * 55);
    return y - 0.14 + rise * amp * dir + fbm(x * 0.018, z * 0.018, 3) * 3.5 * Math.min(1, t / 25)
      + Math.max(0, t - 300) * 0.25;
  };
  const pos = new Float32Array(nv * 3);
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const k = j * (seg + 1) + i;
      const x = x0 + i * sx, z = z0 + j * sz;
      const [d, y] = nearest(x, z);
      D[k] = d;
      H[k] = heightAt(x, z, d, y);
      pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
    }
  }
  const idx = new Uint32Array(seg * seg * 6);
  let o = 0;
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tGeo.computeVertexNormals();
  const nrm = tGeo.attributes.normal.array;
  const col = new Float32Array(nv * 3);
  const cGravel = new THREE.Color(0xb3a087), cRock = new THREE.Color(0xb06a40), cRock2 = new THREE.Color(0x8c5638),
    cGrass = new THREE.Color(0xa99a58), cSand = new THREE.Color(0xd9b98a), tmp = new THREE.Color();
  for (let k = 0; k < nv; k++) {
    const slope = 1 - nrm[k * 3 + 1];
    const x = pos[k * 3], z = pos[k * 3 + 2];
    const n = fbm(x * 0.01, z * 0.01, 3);
    tmp.copy(cSand).lerp(cGrass, THREE.MathUtils.clamp(0.5 + n, 0, 1));
    tmp.lerp(n > 0.1 ? cRock : cRock2, THREE.MathUtils.smoothstep(slope, 0.12, 0.35));
    if (D[k] < flat + 2) tmp.lerp(cGravel, THREE.MathUtils.smoothstep(flat + 2 - D[k], 0, 6));
    const v = 0.9 + noise2(x, z) * 0.18;
    col[k * 3] = tmp.r * v; col[k * 3 + 1] = tmp.g * v; col[k * 3 + 2] = tmp.b * v;
  }
  tGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const [dc, dg] = cvs(256, 256);
  const di = dg.createImageData(256, 256);
  for (let i = 0; i < di.data.length; i += 4) { const v = 200 + Math.random() * 55; di.data[i] = di.data[i + 1] = di.data[i + 2] = v; di.data[i + 3] = 255; }
  dg.putImageData(di, 0, 0);
  const detail = toTex(dc);
  detail.repeat.set(seg * 1.5, seg * 1.5);
  const terrUv = new Float32Array(nv * 2);
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) { const k = j * (seg + 1) + i; terrUv[k * 2] = i / seg; terrUv[k * 2 + 1] = j / seg; }
  tGeo.setAttribute('uv', new THREE.BufferAttribute(terrUv, 2));
  const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, map: detail }));
  terrain.receiveShadow = shadows;
  scene.add(terrain);
  const terrainH = (x, z) => {
    const fi = (x - x0) / sx, fj = (z - z0) / sz;
    const i = Math.max(0, Math.min(seg - 1, Math.floor(fi))), j = Math.max(0, Math.min(seg - 1, Math.floor(fj)));
    const u = fi - i, v = fj - j;
    const k = j * (seg + 1) + i;
    return H[k] * (1 - u) * (1 - v) + H[k + 1] * u * (1 - v) + H[k + seg + 1] * (1 - u) * v + H[k + seg + 2] * u * v;
  };

  // road
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(track, 'canyon'), roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  scene.add(buildRoad(track, roadMat));
  scene.add(startLine(track));

  // guardrails + posts
  const railMat = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide });
  const postMats = [];
  for (const s of [-1, 1]) {
    const g = sweep(track, [[0.4, 0.42], [0.36, 0.56], [0.4, 0.66], [0.36, 0.78]], s, hw, 0.25);
    const m = new THREE.Mesh(g, railMat);
    m.castShadow = shadows;
    scene.add(m);
    for (let i = 0; i < track.N; i += 2) {
      const lat = s * (hw + 0.6);
      postMats.push(tm(track.px[i] + track.rx[i] * lat, track.py[i] + 0.4, track.pz[i] + track.rz[i] * lat, track.hdg[i]));
    }
  }
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.85, 0.12), new THREE.MeshStandardMaterial({ color: 0x6d6f73, metalness: 0.6, roughness: 0.5 }), postMats.length);
  postMats.forEach((m, i) => posts.setMatrixAt(i, m));
  posts.computeBoundingSphere();
  scene.add(posts);

  // props
  const propMat = {
    PalmTrunk: new THREE.MeshStandardMaterial({ color: 0x6a4e36, roughness: 0.9 }),
    PalmLeaf: new THREE.MeshStandardMaterial({ color: 0x4f6b2a, roughness: 0.8, side: THREE.DoubleSide }),
    TreeBark: new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }),
    Foliage: new THREE.MeshStandardMaterial({ color: 0x6f7a3c, roughness: 0.85, flatShading: true }),
    Cactus: new THREE.MeshStandardMaterial({ color: 0x4f7a3e, roughness: 0.8 }),
    Rock: new THREE.MeshStandardMaterial({ color: 0x9a6243, roughness: 0.95, flatShading: true }),
    Wood: new THREE.MeshStandardMaterial({ color: 0x4b3628, roughness: 0.9 }),
    Trim: new THREE.MeshStandardMaterial({ color: 0x222222 }),
    LampMetal: new THREE.MeshStandardMaterial({ color: 0x5b5f66, metalness: 0.8, roughness: 0.35 }),
    LampGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.9) }),
  };
  const lists = { palm: [], tree: [], cactus: [], rock0: [], rock1: [], rock2: [], pole: [], lamp: [] };
  const count = quality === 'low' ? 380 : 700;
  for (let k = 0; k < count; k++) {
    const s = rnd() * track.L;
    const side = rnd() < 0.5 ? -1 : 1;
    const dist = hw + 7 + Math.pow(rnd(), 1.6) * 160;
    const p = track.at(s, side * dist, {});
    if (minTrackDist(track, p.x, p.z, 4).d < hw + 5) continue;
    const y = terrainH(p.x, p.z);
    const r = rnd();
    let type;
    if (dist < hw + 40 && r < 0.2) type = 'palm';
    else if (r < 0.5) type = 'rock' + Math.floor(rnd() * 3);
    else if (r < 0.75) type = 'tree';
    else type = 'cactus';
    const sc = type.startsWith('rock') ? rr(0.8, 3.2) : rr(0.75, 1.3);
    lists[type].push(tm(p.x, y - (type.startsWith('rock') ? 0.3 * sc : 0), p.z, rnd() * 6.28, sc));
  }
  for (let s = 20; s < track.L; s += 52) {
    const p = track.at(s, hw + 8, {});
    if (minTrackDist(track, p.x, p.z, 4).d < hw + 6) continue;
    lists.pole.push(tm(p.x, terrainH(p.x, p.z), p.z, p.hdg));
  }
  for (let s = 60; s < track.L; s += 140) {
    const p = track.at(s, -(hw + 1.6), {});
    lists.lamp.push(tm(p.x, p.y, p.z, Math.atan2(p.rx, p.rz)));
  }
  for (const [name, mats] of Object.entries(lists)) {
    const tpl = assets.props.getObjectByName('prop_' + name);
    if (tpl) scene.add(instanceTemplate(tpl, mats, { matMap: propMat, cast: shadows && name !== 'pole', receive: false }));
  }
  // power lines between poles
  const wire = [];
  for (let i = 0; i < lists.pole.length - 1; i++) {
    const a = new THREE.Vector3().setFromMatrixPosition(lists.pole[i]);
    const b = new THREE.Vector3().setFromMatrixPosition(lists.pole[i + 1]);
    const xa = new THREE.Vector3().setFromMatrixColumn(lists.pole[i], 0);
    const xb = new THREE.Vector3().setFromMatrixColumn(lists.pole[i + 1], 0);
    if (a.distanceTo(b) > 80) continue;
    for (const off of [-0.9, 0, 0.9]) {
      const ya = a.y + 10.35, yb = b.y + 10.35;
      let prev = null;
      for (let t = 0; t <= 1.0001; t += 0.125) {
        const ox = xa.x + (xb.x - xa.x) * t, oz = xa.z + (xb.z - xa.z) * t;
        const x = a.x + (b.x - a.x) * t + ox * off, z = a.z + (b.z - a.z) * t + oz * off;
        const yy = ya + (yb - ya) * t - Math.sin(t * Math.PI) * 1.4;
        const q = [x, yy, z];
        if (prev) wire.push(...prev, ...q);
        prev = q;
      }
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2220, transparent: true, opacity: 0.8 })));

  // distant mountains
  const mPos = [], mCol = [], mIdx = [];
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const layers = [[2300, 160, 340, 0xb08a66, 0xe9cba3], [3000, 260, 520, 0x9fb0c0, 0xdccbb0]];
  const segs = 180;
  layers.forEach(([R, hMin, hMax, cBase, cTop], li) => {
    const base = mPos.length / 3;
    const cb = new THREE.Color(cBase), ct = new THREE.Color(cTop);
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2;
      const h = hMin + (hMax - hMin) * (0.5 + 0.5 * fbm(Math.cos(a) * 3 + li * 10, Math.sin(a) * 3, 5));
      const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
      mPos.push(x, -60, z, x + Math.cos(a) * 60, h, z + Math.sin(a) * 60);
      const lit = 0.5 + 0.5 * Math.max(0, Math.cos(a) * sunDir.x + Math.sin(a) * sunDir.z);
      const top = cb.clone().lerp(ct, lit * 0.8);
      mCol.push(cb.r, cb.g, cb.b, top.r, top.g, top.b);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      mIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
  mg.setAttribute('color', new THREE.Float32BufferAttribute(mCol, 3));
  mg.setIndex(mIdx);
  const mountains = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  mountains.renderOrder = -6;
  scene.add(mountains);

  const gt = gantry(track, track.def.name, '#ff6b1a');
  scene.add(gt.group);
  scene.add(chevrons(track, false));
  scene.add(billboards(track, quality === 'low' ? 4 : 8));

  return {
    scene, theme: 'canyon', night: false,
    bloom: { strength: 0.25, radius: 0.5, threshold: 0.95 },
    exposure: 1.0,
    glowPoints: [],
    sunDir,
    setLights: gt.setLights,
    update(dt, time, camera, player) { day.follow(player); },
  };
}

export function buildWorld(track, assets, ctx) {
  const t = track.def.theme;
  return t === 'city' ? buildCity(track, assets, ctx) : t === 'coast' ? buildCoast(track, assets, ctx) : buildCanyon(track, assets, ctx);
}
