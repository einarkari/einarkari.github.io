// DOM HUD: position + standings, lap/timer, speedometer, nitro, minimap, drift popups, messages, name tags.
import * as THREE from 'three';
const $ = id => document.getElementById(id);
const SPEED_MAX = 340;

export function fmtTime(t, short = false) {
  if (!isFinite(t) || t <= 0) return short ? '--' : '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  const ss = s.toFixed(2).padStart(5, '0');
  return short && m === 0 ? ss : `${String(m).padStart(2, '0')}:${ss}`;
}
export function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export class HUD {
  constructor() {
    this.el = $('hud');
    this.pos = $('hPos'); this.posOf = $('hPosOf');
    this.stand = $('hStand');
    this.lap = $('hLap'); this.laps = $('hLaps');
    this.time = $('hTime'); this.lapTime = $('hLapTime'); this.best = $('hBest');
    this.spd = $('hSpd'); this.gear = $('hGear');
    this.rpmArc = $('hRpm'); this.nitroArc = $('hNitroArc'); this.nitroPct = $('hNitroPct');
    this.drift = $('hDrift'); this.driftPts = $('hDriftPts'); this.driftMul = $('hDriftMul');
    this.chips = $('hChips');
    this.heat = $('hHeat'); this.heatBar = $('hHeatBar'); this.bustBar = $('hBustBar'); this.heatLbl = $('hHeatLbl');
    this.msg = $('hMsg'); this.count = $('hCount');
    this.mm = $('minimap'); this.mmg = this.mm.getContext('2d');
    this.trackName = $('hTrack');
    this.cache = {};
    this.rows = [];
    this.standT = 0;
    this.msgTimer = 0;
    this.arcLen = 2 * Math.PI * 78 * 0.75;
    this.nitroLen = 2 * Math.PI * 64 * 0.75;
    this.tagsEl = $('tags');
    this.slipEl = $('hSlip');
    this.tags = [];
    this._v = new THREE.Vector3();
    this.buildGaugeTicks();
  }

  /** numbered speed ticks around the gauge (0-320 km/h) */
  buildGaugeTicks() {
    const g = $('gTicks');
    if (!g) return;
    const NS = 'http://www.w3.org/2000/svg';
    for (let v = 0; v <= 320; v += 20) {
      const f = v / SPEED_MAX, a = (135 + f * 270) * Math.PI / 180;
      const major = v % 80 === 0;
      const r0 = major ? 86 : 89, r1 = 94;
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', 100 + Math.cos(a) * r0); l.setAttribute('y1', 100 + Math.sin(a) * r0);
      l.setAttribute('x2', 100 + Math.cos(a) * r1); l.setAttribute('y2', 100 + Math.sin(a) * r1);
      l.setAttribute('class', major ? 'tk major' : 'tk');
      g.appendChild(l);
      if (major) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', 100 + Math.cos(a) * 70); t.setAttribute('y', 100 + Math.sin(a) * 70 + 4);
        t.setAttribute('class', 'tn');
        t.textContent = v;
        g.appendChild(t);
      }
    }
  }

  setupTags(race) {
    this.tagsEl.innerHTML = '';
    this.tags = race.cars.filter(c => !c.isPlayer).map(c => {
      const d = document.createElement('div');
      d.className = 'tag';
      d.innerHTML = '<b></b><span></span>';
      d.children[1].textContent = c.name;
      d.style.setProperty('--dot', c.mapColor);
      this.tagsEl.appendChild(d);
      return { c, d, vis: false, key: '' };
    });
  }

  updateTags(race, camera) {
    const W = window.innerWidth, H = window.innerHeight, v = this._v;
    for (const t of this.tags) {
      const c = t.c;
      t.dist = Math.hypot(c.rx - camera.position.x, c.rz - camera.position.z);
    }
    const order = this.tags.slice().sort((a, b) => a.dist - b.dist);
    const placed = [];
    for (const t of order) {
      const c = t.c;
      v.set(c.rx, c.ry + 1.85, c.rz).project(camera);
      let show = t.dist < 130 && t.dist > 4 && v.z < 1 && Math.abs(v.x) < 1.05 && v.y < 1 && v.y > -1;
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      // keep tags readable: skip any that would overlap a closer car's tag
      if (show) for (const q of placed) if (Math.abs(q[0] - x) < 96 && Math.abs(q[1] - y) < 26) { show = false; break; }
      if (show !== t.vis) { t.vis = show; t.d.style.display = show ? 'flex' : 'none'; }
      if (!show) continue;
      placed.push([x, y]);
      const sc = Math.max(0.62, Math.min(1, 26 / t.dist + 0.45));
      t.d.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      const pos = race.standings.indexOf(c) + 1;
      if (t.key !== pos) { t.key = pos; t.d.children[0].textContent = pos; }
    }
  }

  slipstream(on) {
    if (this.slipOn !== on) { this.slipOn = on; this.slipEl.classList.toggle('on', on); }
  }

  set(key, el, val) {
    if (this.cache[key] !== val) { this.cache[key] = val; el.textContent = val; }
  }

  show(on) { this.el.hidden = !on; if (this.tagsEl) this.tagsEl.hidden = !on; }

  setupRace(race) {
    this.cache = {};
    this.laps.textContent = race.laps;
    this.posOf.textContent = race.cars.length;
    this.trackName.textContent = race.track.def.name.toUpperCase();
    this.stand.innerHTML = '';
    this.rows = race.cars.map(() => {
      const li = document.createElement('li');
      li.innerHTML = '<b></b><span class="nm"></span><span class="gp"></span>';
      this.stand.appendChild(li);
      return li;
    });
    this.buildMinimap(race.track);
    this.setupTags(race);
    this.slipstream(false);
    this.drift.classList.remove('on');
    this.heat.classList.remove('on');
    this.chips.innerHTML = '';
    this.msg.className = 'msg';
    this.count.className = 'count';
  }

  buildMinimap(track) {
    const c = document.createElement('canvas');
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < track.N; i++) {
      minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
    }
    this.mmScale = 0.36;
    const pad = 40;
    this.mmOff = { x: -maxX * this.mmScale - pad, y: -maxZ * this.mmScale - pad };
    c.width = Math.ceil((maxX - minX) * this.mmScale + pad * 2);
    c.height = Math.ceil((maxZ - minZ) * this.mmScale + pad * 2);
    const g = c.getContext('2d');
    const P = i => [-track.px[i] * this.mmScale - this.mmOff.x, -track.pz[i] * this.mmScale - this.mmOff.y];
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); for (let i = 0; i <= track.N; i += 2) { const [x, y] = P(i % track.N); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    path(); g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 15; g.stroke();
    path(); g.strokeStyle = '#2b3240'; g.lineWidth = 8; g.stroke();
    // start line
    const [sx, sy] = P(0);
    g.fillStyle = '#ff6b1a'; g.fillRect(sx - 7, sy - 2.5, 14, 5);
    this.mmImg = c;
  }

  /** world (x,z) -> minimap image coords */
  mmXY(x, z) { return [-x * this.mmScale - this.mmOff.x, -z * this.mmScale - this.mmOff.y]; }

  drawMinimap(race, time) {
    const cv = this.mm, g = this.mmg;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = cv.clientWidth;
    if (!size) return;
    if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
    const W = cv.width, R = W / 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(244,247,250,0.82)';
    g.fillRect(0, 0, W, W);
    const p = race.player;
    const zoom = (W / 200) * 1.25;
    g.translate(R, R * 1.18);
    g.scale(zoom, zoom);
    g.rotate(p.rh);
    const [px, py] = this.mmXY(p.rx, p.rz);
    g.translate(-px, -py);
    g.drawImage(this.mmImg, 0, 0);
    // traffic
    g.fillStyle = 'rgba(120,128,140,0.8)';
    for (const t of race.traffic.cars) {
      const [x, y] = this.mmXY(t.rx ?? t.pos.x, t.rz ?? t.pos.z);
      g.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
    }
    // racers
    for (const c of race.cars) {
      if (c === p) continue;
      const [x, y] = this.mmXY(c.rx ?? c.pos.x, c.rz ?? c.pos.z);
      g.beginPath(); g.arc(x, y, 4.2, 0, Math.PI * 2);
      g.fillStyle = c.mapColor; g.fill();
      g.lineWidth = 1.4; g.strokeStyle = '#ffffff'; g.stroke();
    }
    // police
    const on = Math.floor(time * 6) % 2 === 0;
    for (const c of race.police.cops) {
      const [x, y] = this.mmXY(c.rx ?? c.pos.x, c.rz ?? c.pos.z);
      g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2);
      g.fillStyle = on ? '#ff2a3a' : '#2a6bff'; g.fill();
    }
    g.restore();
    // player arrow (fixed, pointing up)
    g.save();
    g.translate(R, R * 1.18);
    g.beginPath(); g.moveTo(0, -11 * dpr); g.lineTo(7.5 * dpr, 8 * dpr); g.lineTo(0, 4 * dpr); g.lineTo(-7.5 * dpr, 8 * dpr); g.closePath();
    g.fillStyle = '#ff6b1a'; g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6; g.fill();
    g.lineWidth = 1.5 * dpr; g.strokeStyle = '#fff'; g.stroke();
    g.restore();
    // ring
    g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.lineWidth = 2 * dpr; g.strokeStyle = 'rgba(17,22,31,0.16)'; g.stroke();
  }

  update(race, dt, time) {
    const p = race.player;
    const pos = race.standings.indexOf(p) + 1;
    this.set('pos', this.pos, String(pos));
    this.set('lap', this.lap, String(Math.min(race.laps, Math.max(1, p.lapCount + 1))));
    this.set('time', this.time, fmtTime(race.time));
    const curLap = p.lapCount >= 0 && !p.finished ? race.time - p.lapStart : 0;
    this.set('lapt', this.lapTime, curLap > 0 ? fmtTime(curLap, true) : '--');
    this.set('best', this.best, p.bestLap ? fmtTime(p.bestLap, true) : '--');
    const kmh = Math.round(Math.abs(p.fwd) * 3.6);
    this.set('spd', this.spd, String(kmh));
    this.set('gear', this.gear, 'GEAR ' + (p.fwd < -0.5 ? 'R' : p.speed < 0.5 && p.ctrl.throttle === 0 ? 'N' : String(p.gear)));
    const rpmFrac = Math.max(0.006, Math.min(1, kmh / SPEED_MAX));
    const dash = (rpmFrac * this.arcLen).toFixed(1);
    if (this.cache.rpm !== dash) { this.cache.rpm = dash; this.rpmArc.style.strokeDasharray = `${dash} 999`; }
    const nd = (Math.max(0.001, p.nitro) * this.nitroLen).toFixed(1);
    if (this.cache.nitro !== nd) { this.cache.nitro = nd; this.nitroArc.style.strokeDasharray = `${nd} 999`; }
    this.set('npct', this.nitroPct, Math.round(p.nitro * 100) + '%');
    this.el.classList.toggle('boosting', p.boosting);
    this.el.classList.toggle('redline', p.rpm > 0.92);

    // standings (refresh 5x per second)
    this.standT -= dt;
    if (this.standT <= 0) {
      this.standT = 0.2;
      race.standings.forEach((c, i) => {
        const li = this.rows[i];
        const key = `${c.name}|${i}`;
        if (li.dataset.k !== key) {
          li.dataset.k = key;
          li.children[0].textContent = i + 1;
          li.children[1].textContent = c.name;
          li.className = c === p ? 'me' : '';
          li.style.setProperty('--dot', c.mapColor);
        }
        let gp = '';
        if (c === p) gp = '';
        else if (c.finished && !p.finished) gp = 'FIN';
        else {
          const g = race.gap(c);
          if (g !== null) gp = Math.abs(g) < 0.005 ? '0.00' : (g > 0 ? '+' : '−') + Math.abs(g).toFixed(2);
        }
        if (li.children[2].textContent !== gp) li.children[2].textContent = gp;
      });
    }

    // police heat
    const pol = race.police;
    const heatOn = pol.heat > 12 || pol.cops.length > 0;
    this.heat.classList.toggle('on', heatOn);
    if (heatOn) {
      this.heatBar.style.transform = `scaleX(${(pol.heat / 100).toFixed(3)})`;
      this.bustBar.style.transform = `scaleX(${pol.bust.toFixed(3)})`;
      this.heat.classList.toggle('pursuit', pol.cops.length > 0);
      this.set('heatLbl', this.heatLbl, pol.cops.length ? (pol.bust > 0.05 ? 'GETTING BUSTED' : `PURSUIT · ${pol.cops.length} UNIT${pol.cops.length > 1 ? 'S' : ''}`) : 'HEAT');
    }
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.msg.className = 'msg'; }
    this.drawMinimap(race, time);
  }

  driftScore(active, pts, mul) {
    this.drift.classList.toggle('on', active);
    if (active) {
      this.set('dpts', this.driftPts, Math.round(pts).toLocaleString('en-US'));
      this.set('dmul', this.driftMul, '×' + mul.toFixed(1));
    }
  }

  chip(label, value, kind = '') {
    const d = document.createElement('div');
    d.className = 'chip ' + kind;
    d.innerHTML = `<span class="l"></span><span class="v"></span>`;
    d.children[0].textContent = label;
    d.children[1].textContent = value;
    this.chips.prepend(d);
    while (this.chips.children.length > 3) this.chips.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 1700);
    setTimeout(() => d.remove(), 2200);
  }

  message(text, kind = '', dur = 1.8) {
    this.msg.textContent = text;
    this.msg.className = 'msg';
    void this.msg.offsetWidth;
    this.msg.className = 'msg on ' + kind;
    this.msgTimer = dur;
  }

  countdown(text) {
    this.count.textContent = text;
    this.count.className = 'count';
    void this.count.offsetWidth;
    this.count.className = 'count on' + (text === 'GO' ? ' go' : '');
  }
}
