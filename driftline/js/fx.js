// Visual effects: particles (smoke/sparks), skid marks, light glows, blob shadows, rain, speed lines.
import * as THREE from 'three';

export function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const pointVS = `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  uniform float scale;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(size * scale / max(-mv.z, 0.1), 900.0);
    gl_Position = projectionMatrix * mv;
  }`;
const pointFS = `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vTint * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.003) discard;
  }`;

/** CPU particle pool drawn as one Points object */
export class Particles {
  constructor(max, texture, blending = THREE.NormalBlending) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aTint = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('size', this.aSize);
    geo.setAttribute('alpha', this.aAlpha);
    geo.setAttribute('tint', this.aTint);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: pointVS, fragmentShader: pointFS,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.cursor = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b, drag = 1, grav = 0) {
    let i;
    if (this.n < this.max) i = this.n++;
    else { i = this.cursor; this.cursor = (this.cursor + 1) % this.max; }
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt) {
    const P = this.aPos.array, S = this.aSize.array, A = this.aAlpha.array, T = this.aTint.array;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      // compact live particles to the front
      if (w !== i) this._move(i, w);
      const t = this.age[w] / this.life[w];
      const w3 = w * 3;
      P[w3] = this.pos[w3]; P[w3 + 1] = this.pos[w3 + 1]; P[w3 + 2] = this.pos[w3 + 2];
      S[w] = this.s0[w] + (this.s1[w] - this.s0[w]) * t;
      A[w] = this.a0[w] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      T[w3] = this.col[w3]; T[w3 + 1] = this.col[w3 + 1]; T[w3 + 2] = this.col[w3 + 2];
      w++;
    }
    this.n = w;
    if (this.cursor >= this.n) this.cursor = 0;
    this.points.geometry.setDrawRange(0, w);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aTint.needsUpdate = true;
  }

  _move(i, w) {
    const i3 = i * 3, w3 = w * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[w3 + k] = this.pos[i3 + k]; this.vel[w3 + k] = this.vel[i3 + k]; this.col[w3 + k] = this.col[i3 + k];
    }
    this.life[w] = this.life[i]; this.age[w] = this.age[i]; this.s0[w] = this.s0[i]; this.s1[w] = this.s1[i];
    this.a0[w] = this.a0[i]; this.drag[w] = this.drag[i]; this.grav[w] = this.grav[i];
  }

  clear() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
}

/** Glow points: rewritten every frame (car lights, sirens) */
export class GlowPoints {
  constructor(max, texture) {
    this.max = max;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aTint = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('size', this.aSize);
    geo.setAttribute('alpha', this.aAlpha); geo.setAttribute('tint', this.aTint);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: pointVS, fragmentShader: pointFS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, size, r, g, b, a = 1) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    const P = this.aPos.array, T = this.aTint.array;
    P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
    this.aSize.array[i] = size; this.aAlpha.array[i] = a;
    T[i3] = r; T[i3 + 1] = g; T[i3 + 2] = b;
  }
  end() {
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aTint.needsUpdate = true;
  }
}

/** Ring-buffer of skid mark quads */
export class SkidMarks {
  constructor(maxQuads = 1600, color = 0x0a0a0a, opacity = 0.55) {
    this.max = maxQuads;
    this.pos = new Float32Array(maxQuads * 4 * 3);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      const v = q * 4, i = q * 6;
      idx[i] = v; idx[i + 1] = v + 2; idx[i + 2] = v + 1; idx[i + 3] = v + 1; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.cursor = 0;
    this.count = 0;
    this.last = new Map();
  }
  /** key identifies a wheel track; (x,y,z) wheel contact; (rx,rz) right vector */
  add(key, x, y, z, rx, rz, width = 0.26) {
    const prev = this.last.get(key);
    const lx = x - rx * width / 2, lz = z - rz * width / 2;
    const r2x = x + rx * width / 2, r2z = z + rz * width / 2;
    const yy = y + 0.025;
    if (prev && (x - prev.x) ** 2 + (z - prev.z) ** 2 < 25) {
      const q = this.cursor, o = q * 12, p = this.pos;
      p[o] = prev.lx; p[o + 1] = prev.y; p[o + 2] = prev.lz;
      p[o + 3] = prev.rx; p[o + 4] = prev.y; p[o + 5] = prev.rz;
      p[o + 6] = lx; p[o + 7] = yy; p[o + 8] = lz;
      p[o + 9] = r2x; p[o + 10] = yy; p[o + 11] = r2z;
      this.cursor = (this.cursor + 1) % this.max;
      this.count = Math.min(this.max, this.count + 1);
      this.attr.needsUpdate = true;
    }
    this.last.set(key, { x, z, y: yy, lx, lz, rx: r2x, rz: r2z });
  }
  lift(key) { this.last.delete(key); }
  clear() { this.pos.fill(0); this.attr.needsUpdate = true; this.last.clear(); this.cursor = 0; }
}

/** instanced flat quads lying on the ground (blob shadows, underglow) */
export class GroundQuads {
  constructor(max, texture, { additive = false, opacity = 1, colorful = false } = {}) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, opacity,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      toneMapped: !additive,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colorful) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.max = max;
    this.n = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
  }
  begin() { this.n = 0; }
  add(x, y, z, yaw, sx, sz, color) {
    if (this.n >= this.max) return;
    this._e.set(0, yaw, 0);
    this._q.setFromEuler(this._e);
    this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, 1, sz));
    this.mesh.setMatrixAt(this.n, this._m);
    if (color !== undefined && this.mesh.instanceColor) this.mesh.setColorAt(this.n, this._c.set(color));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** falling rain streaks that follow the camera */
export function makeRain(count = 2200) {
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * 80 - 40, y = Math.random() * 40, z = Math.random() * 80 - 40;
    pos.set([x, y, z, x, y, z], i * 6);
    seed[i * 2] = 0; seed[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('tip', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, vel: { value: new THREE.Vector3() } },
    vertexShader: `
      attribute float tip;
      uniform float time; uniform vec3 center; uniform vec3 vel;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - time * 28.0, 40.0);
        p.x = mod(p.x - center.x + 40.0, 80.0) - 40.0 + center.x;
        p.z = mod(p.z - center.z + 40.0, 80.0) - 40.0 + center.z;
        p.y += center.y - 12.0;
        vec3 streak = vec3(0.0, 0.9, 0.0) + vel * 0.025;
        p += streak * tip;
        vA = mix(0.0, 0.32, tip);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.7,0.8,1.0, vA); }`,
    transparent: true, depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}

/** 2D overlay with radial speed streaks */
export class SpeedLines {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.lines = [];
    for (let i = 0; i < 46; i++) this.lines.push(this._new(true));
    this.intensity = 0;
  }
  _new(rand) {
    return { a: Math.random() * Math.PI * 2, r: rand ? Math.random() : 0.2 + Math.random() * 0.2, v: 0.6 + Math.random() * 0.9, w: 0.5 + Math.random() * 1.6 };
  }
  resize(w, h, dpr) {
    this.c.width = Math.round(w * dpr * 0.5); this.c.height = Math.round(h * dpr * 0.5);
  }
  draw(dt, target, boost) {
    this.intensity += (target - this.intensity) * (1 - Math.exp(-4 * dt));
    const g = this.g, W = this.c.width, H = this.c.height;
    g.clearRect(0, 0, W, H);
    if (this.intensity < 0.02) return;
    const cx = W / 2, cy = H * 0.46, R = Math.hypot(W, H) * 0.6;
    g.lineCap = 'round';
    for (const L of this.lines) {
      L.r += L.v * dt * (1.2 + this.intensity * 2.5);
      if (L.r > 1.1) Object.assign(L, this._new(false));
      const r0 = (0.35 + L.r * 0.65) * R, r1 = r0 + (0.05 + L.r * 0.18) * R * this.intensity;
      const ca = Math.cos(L.a), sa = Math.sin(L.a);
      const al = Math.min(1, (L.r - 0.15) * 2) * this.intensity * 0.55;
      if (al <= 0) continue;
      g.strokeStyle = boost ? `rgba(150,215,255,${al})` : `rgba(255,255,255,${al * 0.7})`;
      g.lineWidth = L.w * (W / 900);
      g.beginPath();
      g.moveTo(cx + ca * r0, cy + sa * r0 * 0.75);
      g.lineTo(cx + ca * r1, cy + sa * r1 * 0.75);
      g.stroke();
    }
  }
}

/** full-screen grade: radial speed blur, edge chromatic aberration, vignette, saturation and sun glare */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBlur: { value: 0 }, uCA: { value: 0.004 }, uVig: { value: 0.35 }, uSat: { value: 1.08 },
    uSun: { value: new THREE.Vector2(-9, -9) }, uSunOn: { value: 0 }, uAspect: { value: 1.6 }, uTaps: { value: 8 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uBlur; uniform float uCA; uniform float uVig; uniform float uSat;
    uniform vec2 uSun; uniform float uSunOn; uniform float uAspect; uniform float uTaps;
    varying vec2 vUv;
    void main() {
      vec2 c = vec2(0.5, 0.56);
      vec2 d = vUv - c;
      float r = length(d * vec2(uAspect, 1.0)) / uAspect * 1.6;
      vec3 col;
      if (uBlur > 0.002) {
        vec3 acc = vec3(0.0); float ws = 0.0;
        for (int i = 0; i < 10; i++) {
          if (float(i) >= uTaps) break;
          float t = float(i) / max(1.0, uTaps - 1.0);
          float w = 1.0 - t * 0.6;
          acc += texture2D(tDiffuse, c + d * (1.0 - uBlur * t * smoothstep(0.1, 0.9, r) * 0.09)).rgb * w;
          ws += w;
        }
        col = acc / ws;
      } else col = texture2D(tDiffuse, vUv).rgb;
      if (uCA > 0.0) {
        vec2 off = d * uCA * r;
        col.r = texture2D(tDiffuse, vUv + off).r * 0.85 + col.r * 0.15;
        col.b = texture2D(tDiffuse, vUv - off).b * 0.85 + col.b * 0.15;
      }
      if (uSunOn > 0.0) {
        vec3 s = texture2D(tDiffuse, clamp(uSun, 0.001, 0.999)).rgb;
        float vis = smoothstep(1.4, 3.5, dot(s, vec3(0.333))) * uSunOn;
        vec2 sd = (vUv - uSun) * vec2(uAspect, 1.0);
        col += vec3(1.0, 0.92, 0.78) * exp(-length(sd) * 5.0) * 0.55 * vis;
        vec2 axis = c - uSun;
        for (int k = 1; k <= 3; k++) {
          vec2 gp = uSun + axis * (0.7 + float(k) * 0.45);
          float g = smoothstep(0.07 + float(k) * 0.02, 0.0, length((vUv - gp) * vec2(uAspect, 1.0)));
          col += vec3(0.55, 0.75, 1.0) * g * 0.06 * vis;
        }
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col *= mix(1.0, smoothstep(1.25, 0.35, r), uVig);
      gl_FragColor = vec4(col, 1.0);
    }`,
};
