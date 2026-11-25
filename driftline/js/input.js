// Keyboard + multi-touch + gamepad input, merged into one control state.
export class Input {
  constructor(touchRoot) {
    this.keys = new Set();
    this.actions = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false, drift: false };
    this.pointers = new Map();
    this.autoGas = false;
    this.usingTouch = false;
    this.padPrev = [];
    this.lastSource = 'keyboard';
    this.tilt = false;
    this.tiltSteer = null;
    this._tiltBound = false;

    const keyMap = {
      Escape: 'pause', KeyP: 'pause', KeyC: 'camera', KeyR: 'reset', KeyM: 'mute',
    };
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat && keyMap[e.code]) this.actions.add(keyMap[e.code]);
      this.keys.add(e.code);
      this.lastSource = 'keyboard';
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); this._recalcTouch(); });

    if (touchRoot) {
      const handle = (e) => {
        e.preventDefault();
        this.usingTouch = true;
        this.lastSource = 'touch';
        if (e.type === 'pointerup' || e.type === 'pointercancel') {
          this.pointers.delete(e.pointerId);
        } else {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const btn = el && el.closest('[data-ctl]');
          if (btn && touchRoot.contains(btn)) this.pointers.set(e.pointerId, btn.dataset.ctl);
          else if (e.type === 'pointerdown') this.pointers.delete(e.pointerId);
          else if (this.pointers.has(e.pointerId)) {
            // finger slid off a control: keep steering buttons sliding, release others
            this.pointers.delete(e.pointerId);
          }
        }
        this._recalcTouch();
      };
      for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        touchRoot.addEventListener(t, handle, { passive: false });
      }
      touchRoot.addEventListener('contextmenu', e => e.preventDefault());
    }
    window.addEventListener('gamepadconnected', () => { this.lastSource = 'gamepad'; });
  }

  /** start listening to the phone's motion sensor; on iPhone this must run from a tap */
  async enableTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try { if (await DOE.requestPermission() !== 'granted') return false; } catch (e) { return false; }
    }
    if (!this._tiltBound) {
      this._tiltBound = true;
      window.addEventListener('deviceorientation', e => {
        if (e.beta === null) return;
        // landscape: tipping the phone like a steering wheel changes beta; the sign flips with the side it is turned to
        const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90;
        const side = ang === 270 || ang === -90 ? -1 : 1;
        const deg = e.beta * side;
        const dead = 2.5, full = 24;
        const a = Math.abs(deg);
        this.tiltSteer = a < dead ? 0 : Math.sign(deg) * Math.min(1, (a - dead) / (full - dead));
      });
    }
    return true;
  }

  _recalcTouch() {
    for (const k in this.touch) this.touch[k] = false;
    for (const ctl of this.pointers.values()) this.touch[ctl] = true;
    document.querySelectorAll('[data-ctl]').forEach(b => b.classList.toggle('on', !!this.touch[b.dataset.ctl]));
  }

  consume(action) {
    if (this.actions.has(action)) { this.actions.delete(action); return true; }
    return false;
  }

  read() {
    const k = this.keys;
    let steer = 0, throttle = 0, brake = 0, handbrake = false, nitro = false;
    if (k.has('ArrowLeft') || k.has('KeyA')) steer -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) throttle = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) brake = 1;
    if (k.has('Space')) handbrake = true;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN')) nitro = true;

    const t = this.touch;
    if (t.left) steer -= 1;
    if (t.right) steer += 1;
    if (this.tilt && this.tiltSteer !== null && !t.left && !t.right) steer += this.tiltSteer;
    if (t.gas) throttle = 1;
    if (t.brake) brake = 1;
    if (t.drift) handbrake = true;
    if (t.nitro) nitro = true;
    if (this.autoGas && this.usingTouch && !t.brake) throttle = Math.max(throttle, 1);

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) { steer += (ax - Math.sign(ax) * 0.12) / 0.88; this.lastSource = 'gamepad'; }
      const b = i => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      throttle = Math.max(throttle, b(7));
      brake = Math.max(brake, b(6));
      if (b(0) > 0.5 || b(4) > 0.5) handbrake = true;
      if (b(1) > 0.5 || b(5) > 0.5) nitro = true;
      if (p.buttons[14] && p.buttons[14].pressed) steer -= 1;
      if (p.buttons[15] && p.buttons[15].pressed) steer += 1;
      const prev = this.padPrev[p.index] || [];
      const edge = (i, act) => { const now = p.buttons[i] && p.buttons[i].pressed; if (now && !prev[i]) this.actions.add(act); };
      edge(9, 'pause'); edge(3, 'camera'); edge(8, 'reset');
      this.padPrev[p.index] = p.buttons.map(x => x.pressed);
      if (throttle > 0.05 || brake > 0.05) this.lastSource = 'gamepad';
    }
    steer = Math.max(-1, Math.min(1, steer));
    return { steer, throttle, brake, handbrake, nitro };
  }
}
