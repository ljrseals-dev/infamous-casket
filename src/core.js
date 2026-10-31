/*
 * analog-drift core: a small model of the slow and fast pitch instability of analog oscillators.
 * Plain script (no imports) so it runs in Node, the main thread and an AudioWorkletGlobalScope.
 * All outputs are in cents of pitch deviation.
 *
 * Components (each is a frequency-noise source; the phase noise is its integral):
 *   slow    1/f ("flicker") FM, built from octave-spaced one-pole filters between 0.02 and 3 Hz
 *   wander  leaky random-walk FM (thermal wander), bounded by a time constant
 *   jitter  white FM, low-passed at 200 Hz
 *   warmup  exponential settling of the pitch after power-on
 *   spread  fixed per-instance offset (component tolerance), drawn once from the seed
 */
(function () {
  var G = typeof globalThis !== "undefined" ? globalThis : self;
  var CR = 1500; // control rate in Hz: the model advances at this rate and is linearly interpolated per sample

  function Rng(seed) { this.s = (seed >>> 0) || 1; this.spare = null; }
  Rng.prototype.uniform = function () { // mulberry32
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    var t = this.s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.gauss = function () {
    if (this.spare !== null) { var s = this.spare; this.spare = null; return s; }
    var u, v, q;
    do { u = this.uniform() * 2 - 1; v = this.uniform() * 2 - 1; q = u * u + v * v; } while (q >= 1 || q === 0);
    var m = Math.sqrt(-2 * Math.log(q) / q); this.spare = v * m; return u * m;
  };

  var DEFAULTS = { slow: 2.5, wander: 1.5, wanderTime: 20, jitter: 0.25, warmup: 4, warmupTime: 25, spread: 2, depth: 1, seed: 1 };
  var PRESETS = {
    clean:   { slow: 0, wander: 0, jitter: 0, warmup: 0, spread: 0 },
    stable:  { slow: 0.8, wander: 0.5, jitter: 0.1, warmup: 1, spread: 1 },
    vintage: { slow: 2.5, wander: 1.5, jitter: 0.25, warmup: 4, spread: 2 },
    oldmono: { slow: 4, wander: 3, jitter: 0.4, warmup: 8, spread: 3 },
    unstable:{ slow: 12, wander: 10, jitter: 1.2, warmup: 20, spread: 6 }
  };

  var PINK_FMIN = 0.02, PINK_FMAX = 3;
  function pinkCoefs() {
    var a = [], f = PINK_FMIN;
    while (f <= PINK_FMAX * 1.0001) { var c = Math.min(0.5, (2 * Math.PI * f) / CR); a.push(c); f *= 2; }
    return a;
  }
  var PA = pinkCoefs();
  var PNORM = PA.map(function (a) { return 1 / Math.sqrt(a / (2 - a)); }); // unit variance per filter => equal power per octave => 1/f

  function DriftModel(opts) { this.configure(opts, true); }
  DriftModel.prototype.configure = function (o, reset) {
    o = o || {};
    if (!this.p) this.p = {};
    var k; for (k in DEFAULTS) { if (o[k] !== undefined) this.p[k] = o[k]; else if (this.p[k] === undefined) this.p[k] = DEFAULTS[k]; }
    if (reset || o.seed !== undefined) {
      this.rng = new Rng(this.p.seed);
      this.pink = new Float64Array(PA.length); this.rw = 0; this.jl = 0; this.t = 0;
      this.spreadCents = this.rng.gauss() * this.p.spread;
      this.frac = 0; this.cur = this.tick(); this.prev = this.cur; // start at the model's initial value, no ramp-in
    }
  };
  DriftModel.prototype.tick = function () {
    var p = this.p, r = this.rng, dt = 1 / CR, i, pk = 0;
    for (i = 0; i < PA.length; i++) { this.pink[i] += PA[i] * (r.gauss() - this.pink[i]); pk += this.pink[i] * PNORM[i]; }
    pk = (pk / Math.sqrt(PA.length)) * p.slow;
    var tau = Math.max(0.5, p.wanderTime), sigma = p.wander * Math.sqrt(2 / tau);
    this.rw += -this.rw * dt / tau + sigma * Math.sqrt(dt) * r.gauss();
    var aj = Math.min(0.5, (2 * Math.PI * 200) / CR);
    this.jl += aj * (r.gauss() - this.jl);
    var jt = (this.jl / Math.sqrt(aj / (2 - aj))) * p.jitter;
    var warm = p.warmup * Math.exp(-this.t / Math.max(0.1, p.warmupTime));
    this.t += dt;
    return (this.spreadCents + warm + pk + this.rw + jt) * p.depth;
  };
  /** Fill `out` with n samples of cents deviation at sample rate sr. */
  DriftModel.prototype.process = function (out, n, sr) {
    var step = CR / sr;
    for (var i = 0; i < n; i++) {
      this.frac += step;
      while (this.frac >= 1) { this.prev = this.cur; this.cur = this.tick(); this.frac -= 1; }
      out[i] = this.prev + (this.cur - this.prev) * this.frac;
    }
  };

  G.AnalogDriftCore = { DriftModel: DriftModel, Rng: Rng, PRESETS: PRESETS, DEFAULTS: DEFAULTS, CONTROL_RATE: CR };
})();
