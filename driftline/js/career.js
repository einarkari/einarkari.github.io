// Career: cash earned from races and per-car performance upgrades bought with it.

export const UPGRADES = [
  { key: 'engine', name: 'Engine', desc: 'Higher top speed', fx: lv => `+${Math.round(lv * 3)}% top speed` },
  { key: 'turbo', name: 'Turbo', desc: 'Faster acceleration', fx: lv => `+${Math.round(lv * 7)}% acceleration` },
  { key: 'tires', name: 'Tires', desc: 'More grip and sharper steering', fx: lv => `+${(lv * 3.5).toFixed(lv % 2 ? 1 : 0)}% grip` },
  { key: 'nitro', name: 'Nitro', desc: 'Stronger boost that lasts longer and fills faster', fx: lv => `+${Math.round(lv * 12)}% nitro fill` },
];
export const MAX_LEVEL = 5;
/** price of buying level n (index 0 = level 1) */
export const PRICES = [2000, 4000, 7000, 11000, 16000];
const START_CASH = 5000;

// prize money by finishing place, before the difficulty multiplier
const PLACE_PAY = [6000, 4500, 3500, 2800, 2200, 1700, 1300, 1000, 800];
const DIFF_MUL = { easy: 0.7, normal: 1, hard: 1.5 };
const KEY = 'driftline.career';

export class Career {
  constructor() {
    this.cash = START_CASH;
    this.up = {};
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s.cash === 'number') { this.cash = Math.max(0, Math.floor(s.cash)); this.up = s.up || {}; }
    } catch (e) { /* storage unavailable: start fresh */ }
  }

  data() { return { cash: this.cash, up: this.up }; }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data())); } catch (e) { /* ignore */ }
    if (this.onSave) this.onSave(this.data());
  }

  /** swap in another save (an account's cloud progress, or the guest save after logging out) */
  replace(d, persist = true) {
    this.cash = Math.max(0, Math.floor((d && d.cash) ?? START_CASH));
    this.up = (d && d.up) || {};
    if (persist) { try { localStorage.setItem(KEY, JSON.stringify(this.data())); } catch (e) { /* ignore */ } }
  }

  levels(carId) {
    const u = this.up[carId] || {};
    const out = {};
    for (const g of UPGRADES) out[g.key] = Math.max(0, Math.min(MAX_LEVEL, u[g.key] | 0));
    return out;
  }

  price(carId, key) {
    const lv = this.levels(carId)[key];
    return lv >= MAX_LEVEL ? null : PRICES[lv];
  }

  buy(carId, key) {
    const p = this.price(carId, key);
    if (p === null || p > this.cash) return false;
    this.cash -= p;
    const u = (this.up[carId] ||= {});
    u[key] = (u[key] | 0) + 1;
    this.save();
    return true;
  }

  /** race reward: place prize + style bonus, scaled by difficulty, minus police fines */
  payout({ place, style, busts, difficulty }) {
    const mul = DIFF_MUL[difficulty] ?? 1;
    const prize = Math.round((PLACE_PAY[place - 1] ?? 500) * mul / 10) * 10;
    const styleBonus = Math.round(style / 20 * mul / 10) * 10;
    const fines = busts * 500;
    const total = Math.max(0, prize + styleBonus - fines);
    return { prize, styleBonus, fines, total, mul };
  }

  earn(amount) { this.cash += amount; this.save(); }
}

/** a copy of a car spec with its upgrades applied (physics + garage stat bars) */
export function upgradedSpec(spec, lv) {
  const s = { ...spec, bars: { ...spec.bars } };
  s.top = spec.top * (1 + 0.03 * lv.engine);
  s.accel = spec.accel * (1 + 0.07 * lv.turbo);
  s.grip = spec.grip * (1 + 0.035 * lv.tires);
  s.turn = spec.turn * (1 + 0.025 * lv.tires);
  s.fill = spec.fill * (1 + 0.12 * lv.nitro);
  s.nitroDrain = 0.21 * (1 - 0.07 * lv.nitro);
  s.boost = 1.22 + 0.016 * lv.nitro;
  s.bars.speed = Math.min(1, spec.bars.speed + 0.032 * lv.engine);
  s.bars.accel = Math.min(1, spec.bars.accel + 0.03 * lv.turbo);
  s.bars.handling = Math.min(1, spec.bars.handling + 0.032 * lv.tires);
  s.bars.drift = Math.min(1, spec.bars.drift + 0.012 * lv.nitro);
  return s;
}

export const money = n => '$' + Math.round(n).toLocaleString('en-US');
