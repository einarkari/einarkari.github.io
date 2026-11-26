// Car specs, model instancing from the Blender export, and arcade drift physics.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp = THREE.MathUtils.clamp;

export const CAR_LIST = [
  {
    id: 'halcyon', brand: 'Lamborgata', model: 'Aventura SVX', name: 'Lamborgata Aventura SVX', klass: 'Mid-engine V12 · AWD',
    top: 88, accel: 15.6, turn: 1.0, grip: 1.05, drift: 1.0, fill: 1.0,
    bars: { speed: 0.84, accel: 0.86, handling: 0.82, drift: 0.74 },
  },
  {
    id: 'ronin', brand: 'Porsha', model: '912 GT3 RX', name: 'Porsha 912 GT3 RX', klass: 'Rear-engine flat-six · RWD',
    top: 85, accel: 16.2, turn: 1.08, grip: 1.15, drift: 0.92, fill: 0.95,
    bars: { speed: 0.76, accel: 0.9, handling: 0.95, drift: 0.68 },
  },
  {
    id: 'vortex', brand: 'Bugatata', model: 'Suron', name: 'Bugatata Suron', klass: 'Quad-turbo W16 hypercar · AWD',
    top: 95, accel: 15.0, turn: 0.95, grip: 0.98, drift: 1.0, fill: 1.0,
    bars: { speed: 0.98, accel: 0.8, handling: 0.72, drift: 0.76 },
  },
  {
    id: 'kodiak', brand: 'Fjord', model: 'Mustank GT500', name: 'Fjord Mustank GT500', klass: 'Supercharged V8 · RWD',
    top: 86, accel: 15.8, turn: 1.0, grip: 0.95, drift: 1.22, fill: 1.3,
    bars: { speed: 0.78, accel: 0.86, handling: 0.7, drift: 0.98 },
  },
];

export const TRAFFIC_SPEC = { id: 'sedan', top: 34, accel: 6, turn: 0.8, grip: 1.1, drift: 0.6, fill: 0 };
export const POLICE_SPEC = { id: 'police', top: 93, accel: 16.5, turn: 1.05, grip: 1.12, drift: 0.9, fill: 0 };

export const PAINTS = [
  { name: 'Obsidian', hex: '#0d0f13' },
  { name: 'Race Red', hex: '#c4121c' },
  { name: 'Volt Blue', hex: '#1652e0' },
  { name: 'Lagoon Teal', hex: '#0fa3a3' },
  { name: 'Solar Yellow', hex: '#f2b200' },
  { name: 'Acid Lime', hex: '#4fcf0c' },
  { name: 'Pearl', hex: '#e7e8ec' },
  { name: 'Sunset Orange', hex: '#ff5a1f' },
];

const TRAFFIC_PAINTS = ['#d9d9d6', '#9aa0a6', '#1c1f24', '#2b3a55', '#5a1d22', '#e2b02a', '#3d4a3a', '#b8b1a2'];

const PART_COLORS = {
  Glass: '#0a0d12', Chrome: '#dedede', Carbon: '#16171b', Trim: '#0b0b0d', Plate: '#f0c419',
  Caliper: '#c8191e', PaintAlt: '#e9e9ea', Tire: '#121214', Rim: '#a6abb3',
};
const CATEGORY = {
  Paint: 'paint', Glass: 'shiny', Chrome: 'shiny', Carbon: 'shiny', Trim: 'matte', Plate: 'matte', Caliper: 'matte',
  PaintAlt: 'matte', HeadLight: 'head', TailLight: 'tail', SirenRed: 'sirenR', SirenBlue: 'sirenB',
};

/** merge every mesh under `obj` into one geometry per category, baking part colors into vertex colors */
function mergeByCategory(obj, categorize, colorOverride = {}) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const groups = {};
  obj.traverse(o => {
    if (!o.isMesh) return;
    const name = o.material.name;
    const cat = categorize(name);
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const keep = new THREE.BufferGeometry();
    keep.setAttribute('position', g.attributes.position);
    keep.setAttribute('normal', g.attributes.normal);
    keep.setIndex(g.index);
    const c = new THREE.Color(colorOverride[name] || PART_COLORS[name] || '#ffffff');
    const n = g.attributes.position.count, ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
    keep.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    (groups[cat] ||= []).push(keep);
  });
  const out = {};
  for (const cat in groups) out[cat] = mergeGeometries(groups[cat], false);
  return out;
}

export class CarFactory {
  constructor(gltf, quality) {
    this.quality = quality;
    this.src = {};
    const ids = ['halcyon', 'ronin', 'vortex', 'kodiak', 'sedan', 'suv', 'police'];
    for (const id of ids) {
      const root = gltf.scene.getObjectByName('car_' + id);
      const get = n => { const o = root.getObjectByName(id + '_' + n); return o ? o.position.clone() : null; };
      const wheels = { FL: get('WFL'), FR: get('WFR'), RL: get('WRL'), RR: get('WRR') };
      const body = root.getObjectByName(id + '_body');
      const wheel = root.getObjectByName(id + '_wheel');
      this.src[id] = {
        body: mergeByCategory(body, n => CATEGORY[n] || 'matte'),
        wheel: mergeByCategory(wheel, () => 'wheel').wheel,
        wheelDark: mergeByCategory(wheel, () => 'wheel', { Rim: '#25272c' }).wheel,
        wheels,
        radius: wheels.FL.y,
        ex: [0, 1, 2, 3].map(i => get('EX' + i)).filter(Boolean),
        hl: [get('HL'), get('HR')].filter(Boolean),
        tl: [get('TL'), get('TR')].filter(Boolean),
      };
    }
    const S = THREE.MeshStandardMaterial;
    this.shared = {
      shiny: new S({ vertexColors: true, metalness: 0.9, roughness: 0.1, envMapIntensity: 1.3 }),
      matte: new S({ vertexColors: true, metalness: 0.15, roughness: 0.6 }),
      wheel: new S({ vertexColors: true, metalness: 0.75, roughness: 0.34 }),
      head: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 4.0, 3.7) }),
    };
    this.flameGeo = new THREE.ConeGeometry(0.11, 1.0, 10, 1, true);
    this.flameGeo.rotateX(-Math.PI / 2);
    this.flameGeo.translate(0, 0, -0.5);
    this.flameOuter = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 4.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flameInner = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  paintMaterial(hex, physical, stripes = false) {
    const col = new THREE.Color(hex);
    const m = physical
      ? new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 })
      : new THREE.MeshStandardMaterial({ color: col, metalness: 0.5, roughness: 0.28 });
    // twin racing stripes drawn in object space over the hood, roof and deck
    const lum = (col.r + col.g + col.b) / 3;
    m.userData.stripe = { value: stripes ? 1 : 0 };
    m.userData.stripeColor = { value: new THREE.Color(lum < 0.08 ? '#f2f2f0' : '#0d0f13') };
    m.onBeforeCompile = sh => {
      sh.uniforms.uStripe = m.userData.stripe;
      sh.uniforms.uStripeColor = m.userData.stripeColor;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;\nvarying vec3 vObjN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;\nvObjN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;\nvarying vec3 vObjN;\nuniform float uStripe;\nuniform vec3 uStripeColor;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (uStripe > 0.5) {
            float ax = abs(vObjP.x);
            float band = smoothstep(0.085, 0.1, ax) * (1.0 - smoothstep(0.3, 0.315, ax));
            float face = smoothstep(0.1, 0.35, vObjN.y + abs(vObjN.z) * 0.7);
            diffuseColor.rgb = mix(diffuseColor.rgb, uStripeColor, band * face);
          }`);
    };
    m.customProgramCacheKey = () => 'paint-stripes';
    return m;
  }

  setStripes(paint, on) {
    if (paint.userData.stripe) paint.userData.stripe.value = on ? 1 : 0;
    const c = paint.color, lum = (c.r + c.g + c.b) / 3;
    if (paint.userData.stripeColor) paint.userData.stripeColor.value.set(lum < 0.08 ? '#f2f2f0' : '#0d0f13');
  }

  create(id, paintHex, { physical = true, flames = true, shadows = false, stripes = false } = {}) {
    const S = this.src[id];
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);
    const paint = this.paintMaterial(paintHex, physical && this.quality !== 'low', stripes);
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.04, 0.05) });
    const siren = { red: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.02, 0.02) }), blue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.05, 0.3) }) };
    const mats = { paint, shiny: this.shared.shiny, matte: this.shared.matte, head: this.shared.head, tail, sirenR: siren.red, sirenB: siren.blue };
    for (const cat in S.body) {
      const m = new THREE.Mesh(S.body[cat], mats[cat]);
      m.castShadow = shadows && (cat === 'paint' || cat === 'shiny' || cat === 'matte');
      bodyPivot.add(m);
    }
    const lum = new THREE.Color(paintHex);
    const dark = (lum.r + lum.g + lum.b) / 3 < 0.2 || Math.random() < 0.4;
    const wheelGeo = dark ? S.wheelDark : S.wheel;
    const wheels = [];
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const pivot = new THREE.Group();
      pivot.position.copy(S.wheels[k]);
      const w = new THREE.Mesh(wheelGeo, this.shared.wheel);
      if (k[1] === 'R') w.scale.x = -1;
      w.castShadow = shadows;
      pivot.add(w);
      root.add(pivot);
      wheels.push({ pivot, mesh: w, front: k[0] === 'F' });
    }
    const flameMeshes = [];
    if (flames) {
      for (const p of S.ex) {
        const g = new THREE.Group();
        g.position.copy(p);
        const o = new THREE.Mesh(this.flameGeo, this.flameOuter);
        const i = new THREE.Mesh(this.flameGeo, this.flameInner);
        i.scale.set(0.45, 0.45, 0.6);
        g.add(o, i);
        g.visible = false;
        bodyPivot.add(g);
        flameMeshes.push(g);
      }
    }
    return { root, bodyPivot, wheels, paint, tail, siren, radius: S.radius, ex: S.ex, hl: S.hl, tl: S.tl, flames: flameMeshes };
  }

  randomTrafficPaint() { return TRAFFIC_PAINTS[Math.floor(Math.random() * TRAFFIC_PAINTS.length)]; }
}

const RATIOS = [0, 0.16, 0.3, 0.44, 0.58, 0.72, 0.86, 1.02];

export class Vehicle {
  constructor(spec, visual, opts = {}) {
    this.spec = spec;
    this.vis = visual;
    this.root = visual.root;
    this.name = opts.name || 'CPU';
    this.color = opts.color || '#ffffff';
    this.isPlayer = !!opts.isPlayer;
    this.kind = opts.kind || 'racer';
    this.mass = opts.mass || 1;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.heading = 0; this.prevHeading = 0;
    this.vx = 0; this.vz = 0; this.yawRate = 0; this.steer = 0;
    this.ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.nitro = 0.3; this.boosting = false; this.drifting = false; this.driftDir = 0; this.driftExit = 0;
    this.slip = 0; this.slipSigned = 0;
    this.si = -1; this.s = 0; this.d = 0; this.y = 0; this.prevY = 0; this.grade = 0;
    this.trackTx = 0; this.trackTz = 1; this.trackRx = -1; this.trackRz = 0;
    this.lapCount = -1; this.finished = false; this.finishTime = 0; this.progress = 0;
    this.lapStart = 0; this.bestLap = 0; this.lastLap = 0;
    this.frozen = false; this.ghost = 0; this.wallHit = 0; this.scrape = 0;
    this.fwd = 0; this.lat = 0; this.speed = 0;
    this.topMul = 1; this.accelMul = 1;
    this.wheelSpin = 0; this.roll = 0; this.pitch = 0; this.rollV = 0; this.pitchV = 0;
    this.longAcc = 0; this.latAcc = 0;
    this.gear = 1; this.rpm = 0.15; this.shiftCut = 0; this.shifted = false;
    this.hidden = false;
    this._n = {};
    this.marks = new Map();
  }

  place(track, s, d, speed = 0) {
    const p = track.at(s, d, {});
    this.pos.set(p.x, p.y, p.z);
    this.prev.copy(this.pos);
    this.heading = this.prevHeading = p.hdg;
    this.vx = Math.sin(p.hdg) * speed; this.vz = Math.cos(p.hdg) * speed;
    this.yawRate = 0; this.steer = 0; this.drifting = false;
    const n = track.nearest(p.x, p.z, -1, this._n);
    this.si = n.i; this.s = n.s; this.d = n.d; this.y = this.prevY = n.y; this.grade = n.grade;
    this.trackTx = n.tx; this.trackTz = n.tz; this.trackRx = n.rx; this.trackRz = n.rz;
    this.fwd = speed;
  }

  respawn(track, s, d) {
    const lap = this.lapCount;
    const sOld = this.s;
    this.place(track, s, d, 6);
    // keep lap bookkeeping consistent when respawning across the line
    if (sOld < track.L * 0.25 && this.s > track.L * 0.75) this.lapCount = lap - 1; else this.lapCount = lap;
    this.progress = this.lapCount * track.L + this.s;
    this.ghost = 2.0;
    this.nitro = Math.max(this.nitro, 0.1);
  }

  step(dt, track) {
    this.prev.copy(this.pos);
    this.prevHeading = this.heading;
    this.prevY = this.y;
    this.shifted = false;
    if (this.ghost > 0) this.ghost -= dt;
    const P = this.spec, c = this.ctrl;
    if (this.frozen) {
      this.vx *= Math.exp(-6 * dt); this.vz *= Math.exp(-6 * dt);
      this.yawRate = 0; this.boosting = false; this.drifting = false; this.slip = 0;
      this.pos.x += this.vx * dt; this.pos.z += this.vz * dt;
      this.fwd = this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
      this.speed = Math.hypot(this.vx, this.vz);
      this._track(track); this._walls(track);
      return;
    }
    // steering smoothing (faster return to center)
    const st = c.steer;
    const back = Math.abs(st) < Math.abs(this.steer) || Math.sign(st) !== Math.sign(this.steer);
    const rate = back ? 14 : (this.isPlayer ? 9 : 6);
    this.steer += clamp(st - this.steer, -rate * dt, rate * dt);

    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    let fwd = this.vx * sh + this.vz * ch;
    let lat = -this.vx * ch + this.vz * sh;

    const wantBoost = c.nitro && this.nitro > 0.002 && fwd > 4;
    this.boostStarted = wantBoost && !this.boosting;
    this.boosting = wantBoost;
    if (this.boosting) this.nitro = Math.max(0, this.nitro - dt * (P.nitroDrain ?? 0.21));
    const top = P.top * this.topMul * (this.boosting ? (P.boost ?? 1.22) : 1);

    let a = 0;
    const x = fwd / top;
    if (c.throttle > 0) {
      if (fwd < -0.5) a += 24 * c.throttle;
      else a += c.throttle * P.accel * this.accelMul * Math.max(0, 1 - Math.pow(Math.max(0, x), 2.6));
    }
    if (this.boosting) a += 13 * ((P.boost ?? 1.22) / 1.22) * Math.max(0, 1 - Math.max(0, x));
    if (c.brake > 0) {
      if (fwd > 0.5) a -= c.brake * 32;
      else if (fwd > -14) a -= c.brake * 10;
    }
    if (this.drifting) a -= Math.abs(lat) * 0.42 * (1.8 - 0.8 * P.drift);
    let drag = 0.25 + 0.00028 * fwd * fwd + (c.throttle > 0 ? 0 : 1.1);
    if (this.offroad) drag += 2.5 + 0.0028 * fwd * fwd;
    a -= Math.sign(fwd) * Math.min(Math.abs(fwd) / dt, drag);
    fwd += a * dt;
    if (c.throttle === 0 && c.brake === 0 && Math.abs(fwd) < 0.2) fwd = 0;

    const vAbs = Math.abs(fwd);
    const spdF = Math.min(1, vAbs / 5);
    const steerLim = 1 - 0.68 * Math.min(1, vAbs / 72);
    const dir = fwd >= 0 ? 1 : -1;
    const slipAngle = Math.atan2(lat, Math.max(2, Math.abs(fwd)));

    if (!this.drifting && fwd > 13) {
      const hb = c.handbrake && Math.abs(this.steer) > 0.22;
      const brakeFlick = c.brake > 0.5 && Math.abs(this.steer) > 0.7 && fwd > 24;
      if (hb || brakeFlick) {
        this.drifting = true;
        this.driftDir = Math.sign(this.steer);
        this.driftExit = 0;
        this.yawRate += -this.driftDir * 0.8 * P.drift;
      }
    }
    let targetYaw, traction, latGrip;
    if (this.drifting) {
      const assist = -this.driftDir * 0.45 * P.drift * Math.min(1, vAbs / 25);
      targetYaw = -this.steer * 1.25 * P.turn * spdF + assist * (c.handbrake ? 1 : 0.7);
      if (Math.abs(slipAngle) > 0.95 && Math.sign(targetYaw) === Math.sign(slipAngle)) targetYaw *= 0.3;
      traction = c.handbrake ? 0.22 : 0.36;
      latGrip = (c.handbrake ? 0.5 : 0.95) * (1.4 - P.drift * 0.4);
      if (!c.handbrake && Math.abs(slipAngle) < 0.13) this.driftExit += dt; else this.driftExit = 0;
      if (this.driftExit > 0.18 || vAbs < 7 || fwd < 0) this.drifting = false;
    } else {
      targetYaw = -this.steer * steerLim * P.turn * 1.85 * spdF * dir;
      if (c.handbrake && vAbs > 3) { traction = 0.6; latGrip = 3; } else { traction = 0.93; latGrip = 10 * P.grip; }
      if (this.offroad) { traction *= 0.85; latGrip *= 0.55; }
    }
    const yawK = this.drifting ? 5.5 : 13;
    this.yawRate += (targetYaw - this.yawRate) * (1 - Math.exp(-yawK * dt));

    const newLat = lat * Math.exp(-latGrip * dt);
    const lost = Math.abs(lat) - Math.abs(newLat);
    if (fwd > 0) fwd += lost * (this.drifting ? 0.55 : 0.2);
    lat = newLat;
    this.vx = fwd * sh - lat * ch;
    this.vz = fwd * ch + lat * sh;

    const dh = this.yawRate * dt;
    this.heading += dh;
    const rot = dh * traction;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const vx2 = this.vx * cr + this.vz * sr, vz2 = -this.vx * sr + this.vz * cr;
    this.vx = vx2; this.vz = vz2;

    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.fwd = fwd; this.lat = lat;
    this.speed = Math.hypot(this.vx, this.vz);
    this.slip = Math.abs(slipAngle); this.slipSigned = slipAngle;
    this.longAcc = a; this.latAcc = fwd * this.yawRate;
    this._track(track);
    this._walls(track);
  }

  _track(track) {
    const n = track.nearest(this.pos.x, this.pos.z, this.si, this._n);
    const prevS = this.s;
    this.si = n.i; this.s = n.s; this.d = n.d; this.y = n.y; this.grade = n.grade;
    this.trackTx = n.tx; this.trackTz = n.tz; this.trackRx = n.rx; this.trackRz = n.rz;
    this.pos.y = n.y;
    this.offroad = Math.abs(this.d) > track.halfWidth + 0.4;
    const L = track.L;
    this.crossedLine = 0;
    if (prevS > L * 0.75 && this.s < L * 0.25) { this.lapCount++; this.crossedLine = 1; }
    else if (prevS < L * 0.25 && this.s > L * 0.75) { this.lapCount--; this.crossedLine = -1; }
    this.progress = this.lapCount * L + this.s;
  }

  _walls(track) {
    const hw = track.wallHalf;
    const th = Math.atan2(this.trackTx, this.trackTz);
    const rel = Math.atan2(Math.sin(this.heading - th), Math.cos(this.heading - th));
    const ext = 0.95 + 1.3 * Math.abs(Math.sin(rel));
    const limit = hw - ext;
    this.wallHit = 0;
    if (Math.abs(this.d) > limit) {
      const sg = Math.sign(this.d), pen = Math.abs(this.d) - limit;
      const nx = this.trackRx * sg, nz = this.trackRz * sg;
      this.pos.x -= nx * pen; this.pos.z -= nz * pen; this.d = sg * limit;
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        this.vx -= nx * vn * 1.25; this.vz -= nz * vn * 1.25;
        const fr = Math.max(0.72, 1 - vn * 0.02);
        this.vx *= fr; this.vz *= fr;
        this.wallHit = vn;
        const tgt = th + (Math.cos(rel) < 0 ? Math.PI : 0);
        let dd = tgt - this.heading;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        this.heading += dd * Math.min(0.6, 0.05 + vn * 0.05);
        this.yawRate *= 0.4;
        if (vn > 6) this.drifting = false;
      }
      this.scrape = this.speed;
      this.wallSide = sg;
    } else this.scrape = 0;
  }

  updateGear(dt) {
    const top = this.spec.top;
    const v = Math.max(0, this.fwd);
    let g = this.gear;
    if (g < 7 && v > RATIOS[g] * top * 0.97) g++;
    else if (g > 1 && v < RATIOS[g - 1] * top * 0.8) g--;
    if (g !== this.gear) {
      if (g > this.gear) { this.shiftCut = 0.1; this.shifted = true; }
      this.gear = g;
    }
    const lo = g === 1 ? 0 : RATIOS[g - 1] * top * 0.8, hi = RATIOS[g] * top;
    let r = 0.3 + 0.7 * clamp((v - lo) / (hi - lo), 0, 1);
    if (v < 1.5) r = 0.14 + this.ctrl.throttle * 0.6;
    if (this.drifting && this.ctrl.throttle > 0) r = Math.min(1, r + this.slip * 0.25);
    this.rpm += (r - this.rpm) * (1 - Math.exp(-12 * dt));
    this.shiftCut = Math.max(0, this.shiftCut - dt);
  }

  render(alpha, dt) {
    const x = this.prev.x + (this.pos.x - this.prev.x) * alpha;
    const z = this.prev.z + (this.pos.z - this.prev.z) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    let dh = this.heading - this.prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const h = this.prevHeading + dh * alpha;
    this.rx = x; this.rz = z; this.ry = y; this.rh = h;
    this.root.position.set(x, y, z);
    const th = Math.atan2(this.trackTx, this.trackTz);
    const gAlong = this.grade * Math.cos(h - th);
    this.root.rotation.set(-Math.atan(gAlong), h, 0, 'YXZ');
    // body roll & pitch springs
    const rollT = clamp(this.latAcc * 0.0042, -0.075, 0.075) + (this.drifting ? -this.slipSigned * 0.03 : 0);
    const pitchT = clamp(-this.longAcc * 0.0032, -0.045, 0.045);
    const k = 70, d = 10, sdt = Math.min(dt, 0.05);
    this.rollV += ((rollT - this.roll) * k - this.rollV * d) * sdt; this.roll += this.rollV * sdt;
    this.pitchV += ((pitchT - this.pitch) * k - this.pitchV * d) * sdt; this.pitch += this.pitchV * sdt;
    this.vis.bodyPivot.rotation.set(this.pitch, 0, this.roll);
    // wheels
    let spinV = this.fwd / this.vis.radius;
    if (this.drifting && this.ctrl.throttle > 0) spinV *= 1.35;
    if (this.frozen) spinV = 0;
    this.wheelSpin = (this.wheelSpin + spinV * dt) % (Math.PI * 2);
    const steerVis = this.drifting ? -this.steer * 0.5 : -this.steer * 0.42 * (1 - Math.min(0.6, this.speed / 120));
    for (const w of this.vis.wheels) {
      w.mesh.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = steerVis;
    }
    // brake lights
    const braking = this.ctrl.brake > 0.1 && this.fwd > 0.5;
    this.vis.tail.color.setRGB(braking ? 5 : 1.6, braking ? 0.15 : 0.04, braking ? 0.15 : 0.05);
    // nitro flames
    for (const f of this.vis.flames) {
      f.visible = this.boosting;
      if (this.boosting) {
        const fl = 0.75 + Math.random() * 0.5;
        f.scale.set(1 + Math.random() * 0.2, 1 + Math.random() * 0.2, fl);
      }
    }
  }

  /** world-space position of a local point using the rendered transform */
  localToWorld(lx, ly, lz, out) {
    const s = Math.sin(this.rh), c = Math.cos(this.rh);
    // local x is left, z is forward
    out.x = this.rx + lx * c + lz * s;
    out.z = this.rz - lx * s + lz * c;
    out.y = this.ry + ly;
    return out;
  }
}
