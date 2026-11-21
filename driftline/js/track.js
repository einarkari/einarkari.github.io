// Track definitions + sampled centerline with fast nearest-point queries.
import * as THREE from 'three';

export const TRACKS = [
  {
    id: 'coast',
    name: 'Solaris Bay',
    blurb: 'Seaside grand prix circuit lined with palms',
    time: 'Midday · Sunny',
    theme: 'coast',
    width: 18,
    runoff: 7,
    laps: 3,
    spline: [[-360, -304, 0], [280, -304, 0], [416, -264, 0], [448, -160, 0], [400, -64, 0], [264, -32, 1], [160, -80, 1],
      [48, -32, 1], [-32, 48, 2], [48, 160, 4], [200, 208, 6], [264, 304, 6], [144, 376, 5], [-96, 336, 4], [-264, 264, 3],
      [-376, 144, 2], [-448, 0, 1], [-456, -176, 0], [-424, -272, 0]],
    startS: 120,
    lanes: [-4.5, 4.5],
  },
  {
    id: 'city',
    name: 'Downtown Loop',
    blurb: 'Sunny street circuit between glass towers',
    time: 'Afternoon · Clear',
    theme: 'city',
    width: 20,
    laps: 3,
    // closed polygon (x, z) with fillet radius per corner
    poly: [[0, -450], [0, 350], [380, 350], [380, 120], [560, 120], [560, -300], [420, -450]],
    radii: [62, 62, 48, 48, 72, 64, 60],
    startS: 230,
    lanes: [-7.5, -2.5, 2.5, 7.5],
  },
  {
    id: 'canyon',
    name: 'Red Rock Canyon',
    blurb: 'Winding desert highway through the hills',
    time: 'Afternoon · Clear',
    theme: 'canyon',
    width: 16,
    laps: 3,
    spline: [[0, -480, 0], [300, -470, 4], [520, -380, 12], [600, -200, 22], [520, -40, 30], [600, 120, 34],
      [560, 300, 30], [380, 420, 22], [180, 380, 18], [60, 460, 14], [-160, 500, 10], [-380, 420, 8],
      [-480, 240, 12], [-400, 80, 18], [-520, -80, 20], [-480, -300, 12], [-300, -440, 4]],
    startS: 70,
    lanes: [-4, 4],
  },
];

function filletPath(poly, radii) {
  const n = poly.length;
  const V = poly.map(p => new THREE.Vector2(p[0], p[1]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = V[(i - 1 + n) % n], p = V[i], c = V[(i + 1) % n];
    const u1 = p.clone().sub(a).normalize();
    const u2 = c.clone().sub(p).normalize();
    const cross = u1.x * u2.y - u1.y * u2.x;
    const theta = Math.acos(THREE.MathUtils.clamp(u1.dot(u2), -1, 1));
    const R = radii[i];
    const T = R * Math.tan(theta / 2);
    const P1 = p.clone().addScaledVector(u1, -T);
    const sign = Math.sign(cross) || 1;
    const perp = new THREE.Vector2(-u1.y, u1.x).multiplyScalar(sign);
    const C = P1.clone().addScaledVector(perp, R);
    const a0 = Math.atan2(P1.y - C.y, P1.x - C.x);
    const steps = Math.max(4, Math.ceil(theta * R / 1.0));
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + sign * theta * (k / steps);
      out.push(new THREE.Vector3(C.x + Math.cos(ang) * R, 0, C.y + Math.sin(ang) * R));
    }
  }
  return out;
}

function resampleClosed(pts, step) {
  const n = pts.length;
  const segs = [];
  let L = 0;
  for (let i = 0; i < n; i++) {
    const d = pts[i].distanceTo(pts[(i + 1) % n]);
    segs.push(d);
    L += d;
  }
  const N = Math.round(L / step);
  const ds = L / N;
  const out = [];
  let si = 0, acc = 0;
  for (let k = 0; k < N; k++) {
    const target = k * ds;
    while (acc + segs[si] < target && si < n - 1) { acc += segs[si]; si++; }
    const t = segs[si] > 0 ? (target - acc) / segs[si] : 0;
    out.push(pts[si].clone().lerp(pts[(si + 1) % n], t));
  }
  return out;
}

export class Track {
  constructor(def, opts = {}) {
    this.def = def;
    this.halfWidth = def.width / 2;
    this.runoff = def.runoff || 0;
    this.wallHalf = this.halfWidth + this.runoff;
    let pts;
    if (def.poly) {
      pts = resampleClosed(filletPath(def.poly, def.radii), 2.0);
    } else {
      const curve = new THREE.CatmullRomCurve3(def.spline.map(p => new THREE.Vector3(p[0], p[2], p[1])), true, 'centripetal');
      const len = curve.getLength();
      pts = curve.getSpacedPoints(Math.round(len / 2));
      pts.pop();
      pts = resampleClosed(pts, 2.0);
    }
    // rotate so index 0 is the start/finish line
    let L0 = 0;
    for (let i = 0; i < pts.length; i++) L0 += pts[i].distanceTo(pts[(i + 1) % pts.length]);
    const startIdx = Math.round((def.startS / L0) * pts.length) % pts.length;
    pts = pts.slice(startIdx).concat(pts.slice(0, startIdx));

    const N = this.N = pts.length;
    let L = 0;
    for (let i = 0; i < N; i++) L += pts[i].distanceTo(pts[(i + 1) % N]);
    this.L = L;
    this.ds = L / N;
    const F = n => new Float32Array(n);
    this.px = F(N); this.py = F(N); this.pz = F(N);
    this.tx = F(N); this.tz = F(N); this.rx = F(N); this.rz = F(N);
    this.hdg = F(N); this.curv = F(N); this.curvS = F(N); this.grade = F(N);
    this.line = F(N); this.vmax = F(N);
    for (let i = 0; i < N; i++) {
      this.px[i] = pts[i].x; this.py[i] = pts[i].y; this.pz[i] = pts[i].z;
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      let dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
      this.rx[i] = -dz; this.rz[i] = dx;
      this.hdg[i] = Math.atan2(dx, dz);
      this.grade[i] = (this.py[b] - this.py[a]) / (4 * this.ds);
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      let dh = this.hdg[b] - this.hdg[a];
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.curv[i] = dh / (4 * this.ds);
    }
    // smoothed curvature
    const W = 8;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -W; k <= W; k++) s += this.curv[(i + k + N) % N];
      this.curvS[i] = s / (2 * W + 1);
    }
    // racing line: hug the inside of corners, smoothed heavily
    const raw = new Float32Array(N);
    const lim = this.halfWidth - 2.8;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -10; k <= 25; k++) s += this.curv[(i + k + N) % N];
      s /= 36;
      raw[i] = -THREE.MathUtils.clamp(s * 140, -1, 1) * lim;
    }
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -30; k <= 30; k++) s += raw[(i + k + N) % N];
      this.line[i] = s / 61;
    }
    // speed profile for AI (lateral accel limit + braking pass)
    const aLat = opts.aLat || 28, aBrake = opts.aBrake || 17;
    for (let i = 0; i < N; i++) {
      const k = Math.max(Math.abs(this.curvS[i]), 1e-4);
      this.vmax[i] = Math.min(110, Math.sqrt(aLat / k));
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const nx = this.vmax[(i + 1) % N];
        const lim2 = Math.sqrt(nx * nx + 2 * aBrake * this.ds);
        if (this.vmax[i] > lim2) this.vmax[i] = lim2;
      }
    }
    this._tmp = { i: 0, t: 0, s: 0, d: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, rx: -1, rz: 0, grade: 0 };
  }

  wrapS(s) { const L = this.L; return ((s % L) + L) % L; }

  /** signed along-track distance from a to b in (-L/2, L/2] */
  deltaS(a, b) {
    let d = b - a;
    const L = this.L;
    d = ((d % L) + L) % L;
    if (d > L / 2) d -= L;
    return d;
  }

  nearest(x, z, hint = -1, out = {}) {
    const N = this.N, px = this.px, pz = this.pz;
    let bi = 0, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i += 2) {
        const dx = px[i] - x, dz = pz[i] - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bi = i; }
      }
      hint = bi;
    }
    bd = Infinity;
    for (let k = -32; k <= 32; k++) {
      const i = (hint + k + N) % N;
      const dx = px[i] - x, dz = pz[i] - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    // refine on adjacent segments
    let best = null;
    for (const a of [(bi - 1 + N) % N, bi]) {
      const b = (a + 1) % N;
      const vx = px[b] - px[a], vz = pz[b] - pz[a];
      const ll = vx * vx + vz * vz || 1;
      let t = ((x - px[a]) * vx + (z - pz[a]) * vz) / ll;
      t = Math.max(0, Math.min(1, t));
      const qx = px[a] + vx * t, qz = pz[a] + vz * t;
      const dd = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (!best || dd < best.dd) best = { a, b, t, qx, qz, dd };
    }
    const { a, b, t } = best;
    out.i = a;
    out.t = t;
    out.s = (a + t) * this.ds;
    out.tx = this.tx[a] + (this.tx[b] - this.tx[a]) * t;
    out.tz = this.tz[a] + (this.tz[b] - this.tz[a]) * t;
    const tl = Math.hypot(out.tx, out.tz) || 1;
    out.tx /= tl; out.tz /= tl;
    out.rx = -out.tz; out.rz = out.tx;
    out.x = best.qx; out.z = best.qz;
    out.y = this.py[a] + (this.py[b] - this.py[a]) * t;
    out.d = (x - best.qx) * out.rx + (z - best.qz) * out.rz;
    out.grade = this.grade[a] + (this.grade[b] - this.grade[a]) * t;
    return out;
  }

  /** point/frame at along-track distance s with lateral offset d */
  at(s, d = 0, out = {}) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const a = Math.floor(f) % this.N, b = (a + 1) % this.N, t = f - Math.floor(f);
    let tx = this.tx[a] + (this.tx[b] - this.tx[a]) * t;
    let tz = this.tz[a] + (this.tz[b] - this.tz[a]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    out.tx = tx; out.tz = tz; out.rx = -tz; out.rz = tx;
    out.x = this.px[a] + (this.px[b] - this.px[a]) * t + out.rx * d;
    out.z = this.pz[a] + (this.pz[b] - this.pz[a]) * t + out.rz * d;
    out.y = this.py[a] + (this.py[b] - this.py[a]) * t;
    out.hdg = Math.atan2(tx, tz);
    out.i = a;
    return out;
  }

  idx(s) { return Math.floor(this.wrapS(s) / this.ds) % this.N; }
}
