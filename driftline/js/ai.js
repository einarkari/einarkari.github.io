// AI racers, civilian traffic and police pursuit.
import * as THREE from 'three';
import { Vehicle, TRAFFIC_SPEC, POLICE_SPEC } from './vehicle.js';

const clamp = THREE.MathUtils.clamp;

function pursuitSteer(car, tx, tz, v) {
  const dx = tx - car.pos.x, dz = tz - car.pos.z;
  const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
  const lf = dx * sh + dz * ch, lr = -dx * ch + dz * sh;
  const dist = Math.max(4, Math.hypot(dx, dz));
  const alpha = Math.atan2(lr, lf);
  const reqYaw = -2 * Math.sin(alpha) * Math.max(v, 6) / dist;
  const steerLim = 1 - 0.68 * Math.min(1, v / 72);
  const K = steerLim * car.spec.turn * 1.85 * Math.min(1, Math.max(v, 3) / 5);
  let steer = -reqYaw / Math.max(0.05, K);
  steer += (car.yawRate - reqYaw) * 0.12;
  return { steer: clamp(steer, -1, 1), alpha };
}

export class RacerAI {
  constructor(car, track, skill, personality = {}) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    this.bias = personality.bias ?? (Math.random() * 2 - 1) * 1.5;
    this.aggro = personality.aggro ?? Math.random();
    this.drifter = personality.drifter ?? Math.random() < 0.5;
    this.avoid = 0;
    this.stuck = 0;
    this.hb = 0;
    this.lastCorner = -1;
    this._p = {};
    car.nitro = 0.25;
  }

  update(dt, ctx) {
    const c = this.car, T = this.track;
    if (c.frozen) return;
    const v = Math.max(0, c.fwd);
    const look = 9 + v * 0.42;
    const s = c.s;
    const lineD = T.line[T.idx(s + look * 0.6)] + this.bias;
    const hw = T.halfWidth - 1.9;

    // avoidance of slower cars ahead
    let block = null, blockDs = 1e9;
    for (const o of ctx.cars) {
      if (o === c || o.hidden) continue;
      const ds = T.deltaS(s, o.s);
      if (ds <= 0 || ds > 34) continue;
      if (o.fwd > v + 3 && ds > 6) continue;
      const pathD = c.d + (lineD + this.avoid - c.d) * Math.min(1, ds / look);
      if (Math.abs(o.d - pathD) < 3.1 && ds < blockDs) { blockDs = ds; block = o; }
    }
    let avoidT = 0;
    this.brakeFor = null;
    if (block) {
      const r = block.d + 3.7, l = block.d - 3.7;
      const canR = r < hw, canL = l > -hw;
      let target;
      if (canR && canL) target = Math.abs(r - c.d) < Math.abs(l - c.d) ? r : l;
      else if (canR) target = r;
      else if (canL) target = l;
      else target = c.d;
      avoidT = target - lineD;
      if ((!canR && !canL) || (blockDs < 9 && Math.abs(block.d - c.d) < 2.3)) this.brakeFor = Math.max(0, block.fwd - 1);
    }
    this.avoid += (avoidT - this.avoid) * (1 - Math.exp(-3.2 * dt));
    const targetD = clamp(lineD + this.avoid, -hw, hw);
    const p = T.at(s + look, targetD, this._p);
    const { steer, alpha } = pursuitSteer(c, p.x, p.z, v);
    c.ctrl.steer = steer;

    // speed control from the precomputed profile
    const ahead = T.vmax[T.idx(s + 5)];
    let vt = ahead * this.skill * (ctx.rubber(c) || 1);
    vt = Math.min(vt, c.spec.top * (c.topMul || 1) * (c.boosting ? 1.22 : 1));
    if (this.brakeFor !== null) vt = Math.min(vt, this.brakeFor + 1.5);
    if (Math.abs(alpha) > 0.35) vt *= 0.92;
    if (!ctx.running) vt = 0;
    const err = vt - v;
    c.ctrl.throttle = ctx.running ? (err > 0 ? Math.min(1, err * 0.35 + 0.25) : 0) : 0;
    c.ctrl.brake = err < -2.5 ? Math.min(1, -err * 0.12) : 0;

    // style drift on tight corners
    c.ctrl.handbrake = false;
    if (this.hb > 0) { this.hb -= dt; c.ctrl.handbrake = true; }
    else if (this.drifter && ctx.running && v > 26 && v < 46) {
      const ci = T.idx(s + 18);
      const k = Math.abs(T.curvS[ci]);
      const cornerId = Math.floor((s + 18) / 60);
      if (k > 1 / 80 && cornerId !== this.lastCorner && Math.abs(c.d) < hw - 3) {
        this.lastCorner = cornerId;
        if (Math.random() < 0.6) this.hb = 0.18;
      }
    }

    // nitro: fill slowly, burn on long fast stretches
    c.nitro = Math.min(1, c.nitro + dt * 0.018 * (c.drifting ? 4 : 1));
    const straight = T.vmax[T.idx(s + 60)] > 75 && T.vmax[T.idx(s + 120)] > 70;
    c.ctrl.nitro = ctx.running && straight && c.nitro > 0.25 && v > 30 && Math.abs(alpha) < 0.15 && (c.boosting || c.nitro > 0.5);

    // recovery
    const tangDot = Math.sin(c.heading) * c.trackTx + Math.cos(c.heading) * c.trackTz;
    if (ctx.running && !c.finished) {
      if (v < 2.5 || tangDot < -0.2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
      if (this.stuck > 2.2) { this.stuck = 0; c.respawn(T, s - 3, clamp(c.d, -3, 3)); }
    }
  }
}

export class TrafficManager {
  constructor(track, factory, scene, count) {
    this.track = track;
    this.factory = factory;
    this.scene = scene;
    this.cars = [];
    const lanes = track.def.lanes;
    for (let i = 0; i < count; i++) {
      const model = Math.random() < 0.55 ? 'sedan' : 'suv';
      const vis = factory.create(model, factory.randomTrafficPaint(), { physical: false, flames: false });
      const car = new Vehicle({ ...TRAFFIC_SPEC, id: model }, vis, { kind: 'traffic', name: 'TRAFFIC', mass: model === 'suv' ? 1.35 : 1.15 });
      car.ai = { lane: lanes[i % lanes.length], cruise: 15 + Math.random() * 8, spin: 0, laneShift: 0 };
      car.nitro = 0;
      car.nm = { active: false, minLat: 99, prevDs: 0, lastHit: -10 };
      scene.add(car.root);
      this.cars.push(car);
    }
  }

  /** spread cars around the lap, away from the starting grid */
  initialPlace() {
    const T = this.track;
    const n = this.cars.length;
    this.cars.forEach((car, i) => {
      const s = 160 + (T.L - 260) * (i + Math.random() * 0.5) / n;
      car.place(T, s, car.ai.lane, car.ai.cruise);
      car.lapCount = 0;
    });
  }

  update(dt, ctx) {
    const T = this.track;
    for (const car of this.cars) {
      const a = car.ai;
      const v = Math.max(0, car.fwd);
      if (a.spin > 0) {
        a.spin -= dt;
        car.ctrl.throttle = 0; car.ctrl.brake = 0.3; car.ctrl.steer = 0; car.ctrl.handbrake = true; car.ctrl.nitro = false;
        continue;
      }
      car.ctrl.handbrake = false;
      // gap keeping to anything ahead in our lane
      let vt = a.cruise;
      for (const o of ctx.cars) {
        if (o === car || o.hidden) continue;
        const ds = T.deltaS(car.s, o.s);
        if (ds > 0 && ds < 26 && Math.abs(o.d - car.d) < 2.4) vt = Math.min(vt, Math.max(0, o.fwd - 1 + (ds - 10) * 0.4));
      }
      const target = T.at(car.s + 12 + v * 0.4, a.lane, car._p || (car._p = {}));
      car.ctrl.steer = pursuitSteer(car, target.x, target.z, v).steer;
      const err = vt - v;
      car.ctrl.throttle = err > 0 ? Math.min(1, err * 0.25 + 0.2) : 0;
      car.ctrl.brake = err < -1.5 ? Math.min(1, -err * 0.15) : 0;
    }
  }

  /** keep traffic around the player: recycle cars that fall far behind */
  recycle(player, others) {
    const T = this.track;
    for (const car of this.cars) {
      const rel = T.deltaS(player.s, car.s);
      const wrongWay = Math.sin(car.heading) * car.trackTx + Math.cos(car.heading) * car.trackTz < 0;
      const far = rel < -260 || rel > 900;
      if (!(far || (wrongWay && Math.abs(rel) > 120) || (car.ai.spin <= 0 && car.speed < 1 && Math.abs(rel) > 150))) continue;
      for (let tries = 0; tries < 8; tries++) {
        const s = player.s + 420 + Math.random() * 380;
        const lane = T.def.lanes[Math.floor(Math.random() * T.def.lanes.length)];
        const clear = [...this.cars, ...others].every(o => o === car || Math.abs(T.deltaS(s, o.s)) > 30 || Math.abs(o.d - lane) > 3);
        if (clear) {
          car.ai.lane = lane;
          car.ai.spin = 0;
          car.place(T, s, lane, car.ai.cruise);
          car.nm.active = false;
          break;
        }
      }
    }
  }

  dispose() { for (const c of this.cars) this.scene.remove(c.root); this.cars = []; }
}

export class PoliceManager {
  constructor(track, factory, scene, hooks) {
    this.track = track;
    this.factory = factory;
    this.scene = scene;
    this.hooks = hooks;
    this.heat = 0;
    this.cops = [];
    this.bust = 0;
    this.escape = 0;
    this.cooldown = 0;
    this.pool = [];
    for (let i = 0; i < 2; i++) {
      const vis = factory.create('police', '#0b0c10', { physical: false, flames: true });
      const car = new Vehicle({ ...POLICE_SPEC }, vis, { kind: 'police', name: 'POLICE', mass: 1.4 });
      car.hidden = true;
      car.root.visible = false;
      car.nitro = 1;
      this.pool.push(car);
    }
    this._p = {};
    this.flash = 0;
  }

  addHeat(v) { if (this.cooldown <= 0) this.heat = clamp(this.heat + v, 0, 100); }

  get level() { return this.cops.length; }

  spawn(player) {
    const car = this.pool.find(c => c.hidden);
    if (!car) return;
    const T = this.track;
    const back = 130 + this.cops.length * 40;
    car.place(T, player.s - back, clamp(player.d, -2, 2), Math.max(20, player.fwd * 0.95));
    car.lapCount = player.lapCount;
    car.hidden = false;
    car.root.visible = true;
    car.ghost = 0.5;
    car.nitro = 1;
    this.scene.add(car.root);
    this.cops.push(car);
    this.hooks.onSpawn && this.hooks.onSpawn(this.cops.length);
  }

  clear(silent = false) {
    for (const c of this.cops) { c.hidden = true; c.root.visible = false; this.scene.remove(c.root); }
    this.cops = [];
    this.bust = 0; this.escape = 0;
    if (!silent) this.cooldown = 8;
  }

  update(dt, player, ctx) {
    const T = this.track;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash += dt;
    if (!ctx.running || player.finished) {
      if (this.cops.length) this.clear(true);
      this.heat = Math.max(0, this.heat - dt * 10);
      return;
    }
    // heat decay when not pursued
    if (!this.cops.length) this.heat = Math.max(0, this.heat - dt * 2.2);
    else this.heat = Math.max(55, this.heat - dt * 0.6);
    if (player.speed > 72) this.addHeat(dt * 1.2);
    if (ctx.raceTime > 12 && this.cooldown <= 0) {
      if (this.heat >= 55 && this.cops.length < 1) this.spawn(player);
      else if (this.heat >= 90 && this.cops.length < 2) this.spawn(player);
    }
    let nearest = 1e9, nearestPan = 0;
    let allFar = true;
    this.cops.forEach((cop, ci) => {
      const v = Math.max(0, cop.fwd);
      const rel = T.deltaS(cop.s, player.s);
      const dx = player.pos.x - cop.pos.x, dz = player.pos.z - cop.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < nearest) {
        nearest = dist;
        const sh = Math.sin(player.heading), ch = Math.cos(player.heading);
        nearestPan = clamp(((-dx) * (-ch) + (-dz) * sh) / Math.max(10, dist), -1, 1);
      }
      if (rel < 200 && dist < 230) allFar = false;
      // stun after a heavy crash
      if (cop.wallHit > 10 || cop.bigHit) { cop.stun = 1.6; cop.bigHit = false; }
      if (cop.stun > 0) {
        cop.stun -= dt;
        cop.ctrl.throttle = 0; cop.ctrl.brake = 0.4; cop.ctrl.nitro = false; cop.ctrl.handbrake = false;
        return;
      }
      cop.ramT = (cop.ramT || 0) - dt;
      let tx, tz, vt;
      const pv = player.speed;
      if (dist < 40 && Math.abs(rel) < 45) {
        const sh = Math.sin(player.heading), ch = Math.cos(player.heading);
        const side = ci % 2 ? 1 : -1;
        if (pv < 9) {
          // box the player in and stop
          tx = player.pos.x - ch * side * 2.6 - sh * 3; tz = player.pos.z + sh * side * 2.6 - ch * 3;
          vt = dist < 9 ? 0 : 6;
        } else if (cop.ramT < -3 && rel > 2 && rel < 14) {
          cop.ramT = 0.9;
          tx = player.pos.x; tz = player.pos.z; vt = pv + 9;
        } else if (cop.ramT > 0) {
          tx = player.pos.x + player.vx * 0.3; tz = player.pos.z + player.vz * 0.3; vt = pv + 9;
        } else {
          // pace alongside the player
          tx = player.pos.x - ch * side * 3.2 + sh * 2; tz = player.pos.z + sh * side * 3.2 + ch * 2;
          vt = pv + clamp(rel * 0.35, -6, 6);
        }
      } else {
        const p = T.at(cop.s + 14 + v * 0.45, clamp(player.d, -T.halfWidth + 3, T.halfWidth - 3), this._p);
        tx = p.x; tz = p.z;
        vt = T.vmax[T.idx(cop.s + 6)] * 1.06;
      }
      cop.topMul = rel > 160 ? 1.1 : 0.99;
      const { steer } = pursuitSteer(cop, tx, tz, v);
      cop.ctrl.steer = steer;
      const err = vt - v;
      cop.ctrl.throttle = err > 0 ? Math.min(1, err * 0.3 + 0.3) : 0;
      cop.ctrl.brake = err < -3 ? Math.min(1, -err * 0.12) : 0;
      cop.ctrl.handbrake = false;
      cop.ctrl.nitro = rel > 160 && cop.nitro > 0.05;
      cop.nitro = Math.min(1, cop.nitro + dt * 0.04);
      if (v < 2 && dist > 30) { cop.stuck = (cop.stuck || 0) + dt; if (cop.stuck > 2) { cop.stuck = 0; cop.respawn(T, player.s - 120, 0); } }
      const on = Math.floor(this.flash * 6) % 2 === 0;
      cop.vis.siren.red.color.setRGB(on ? 3.5 : 0.25, on ? 0.12 : 0.02, on ? 0.1 : 0.02);
      cop.vis.siren.blue.color.setRGB(on ? 0.02 : 0.12, on ? 0.05 : 0.45, on ? 0.25 : 3.2);
    });
    this.sirenLevel = this.cops.length ? clamp(1 - nearest / 220, 0.08, 1) : 0;
    this.sirenPan = nearestPan;

    // bust & escape
    if (this.cops.length) {
      const close = nearest < 10.5 && player.speed < 9;
      this.bust = clamp(this.bust + (close ? dt / 1.8 : -dt * 0.7), 0, 1);
      if (this.bust >= 1) { this.clear(); this.heat = 0; this.hooks.onBusted && this.hooks.onBusted(); return; }
      this.escape = allFar ? this.escape + dt : Math.max(0, this.escape - dt * 2);
      if (this.escape > 4) { this.clear(); this.heat = 25; this.hooks.onEscaped && this.hooks.onEscaped(); }
    }
  }

  dispose() { this.clear(true); }
}
