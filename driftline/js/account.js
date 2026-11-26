// Player accounts (Firebase Auth) and cloud saves (Firestore: players/{uid}).
// Everything here is optional: without a config in firebase-config.js the game is guest-only.
import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';

const ERRORS = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-email': 'Enter your email address.',
  'auth/email-already-in-use': 'There’s already an account with that email. Try logging in.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/missing-password': 'Enter your password.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'No account with that email. Try signing up.',
  'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
  'auth/cancelled-popup-request': 'Google sign-in was closed before it finished.',
  'auth/unauthorized-domain': 'Sign-in isn’t enabled for this website yet.',
  'auth/operation-not-allowed': 'This sign-in method isn’t turned on yet.',
};

export class Account {
  constructor() {
    this.configured = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);
    this.user = null;
    this.fb = null;
    this.listeners = [];
    this._saveTimer = 0;
    this._pending = null;
  }

  /** load the SDK and wait for the first auth state (a returning player is signed in automatically) */
  async init() {
    if (!this.configured) return;
    try {
      const [app, auth, fs] = await Promise.all([
        import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
      ]);
      const a = app.initializeApp(FIREBASE_CONFIG);
      this.fb = { auth, fs, A: auth.getAuth(a), db: fs.getFirestore(a) };
      await new Promise(resolve => {
        let first = true;
        auth.onAuthStateChanged(this.fb.A, u => {
          this.user = u;
          if (first) { first = false; resolve(); }
          this._emit();
        });
      });
    } catch (e) {
      console.warn('Driftline accounts unavailable:', e);
      this.configured = false;
      this.fb = null;
    }
  }

  get available() { return !!this.fb; }
  onChange(fn) { this.listeners.push(fn); }
  _emit() { for (const fn of this.listeners) fn(this.user); }

  displayName() {
    const u = this.user;
    if (!u) return 'Guest';
    return u.displayName || (u.email ? u.email.split('@')[0] : 'Player');
  }

  errorText(e) {
    return ERRORS[e && e.code] || 'Something went wrong. Please try again.';
  }

  async signUp(name, email, password) {
    const { auth, A } = this.fb;
    const cred = await auth.createUserWithEmailAndPassword(A, email.trim(), password);
    if (name) await auth.updateProfile(cred.user, { displayName: name.trim().slice(0, 20) });
    this.user = cred.user;
    this._emit();
    return cred.user;
  }

  async logIn(email, password) {
    const { auth, A } = this.fb;
    const cred = await auth.signInWithEmailAndPassword(A, email.trim(), password);
    this.user = cred.user;
    return cred.user;
  }

  async logInGoogle() {
    const { auth, A } = this.fb;
    const provider = new auth.GoogleAuthProvider();
    try {
      const cred = await auth.signInWithPopup(A, provider);
      this.user = cred.user;
      return cred.user;
    } catch (e) {
      // phones that block pop-ups: fall back to a full-page redirect (the page reloads signed in)
      if (e && e.code === 'auth/popup-blocked') { await auth.signInWithRedirect(A, provider); return null; }
      throw e;
    }
  }

  async resetPassword(email) {
    await this.fb.auth.sendPasswordResetEmail(this.fb.A, email.trim());
  }

  async logOut() {
    await this.flush();
    await this.fb.auth.signOut(this.fb.A);
    this.user = null;
  }

  /** the signed-in player's saved progress, or null when there is none yet */
  async load() {
    if (!this.user || !this.fb) return null;
    const { fs, db } = this.fb;
    const snap = await fs.getDoc(fs.doc(db, 'players', this.user.uid));
    return snap.exists() ? snap.data() : null;
  }

  /** save progress to the cloud (batched: at most one write every couple of seconds) */
  save(data) {
    if (!this.user || !this.fb) return;
    this._pending = { ...(this._pending || {}), ...data };
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 1500);
  }

  async flush() {
    clearTimeout(this._saveTimer);
    if (!this._pending || !this.user || !this.fb) return;
    const { fs, db } = this.fb;
    const data = { ...this._pending, name: this.displayName(), updatedAt: fs.serverTimestamp() };
    this._pending = null;
    try {
      await fs.setDoc(fs.doc(db, 'players', this.user.uid), data, { merge: true });
    } catch (e) {
      console.warn('Driftline cloud save failed:', e);
    }
  }
}
