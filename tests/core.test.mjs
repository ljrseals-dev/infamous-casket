import assert from "node:assert/strict";
import "../src/core.js";
const { DriftModel, PRESETS, CONTROL_RATE: CR } = globalThis.AnalogDriftCore;

function fft(re, im) { // in-place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const a = i + k, b = i + k + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
}
function welch(x, seg, rate) { // returns {f, p}
  const hop = seg / 2, win = new Float64Array(seg).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / seg));
  const p = new Float64Array(seg / 2); let cnt = 0;
  for (let s = 0; s + seg <= x.length; s += hop) {
    const re = new Float64Array(seg), im = new Float64Array(seg); let m = 0;
    for (let i = 0; i < seg; i++) m += x[s + i]; m /= seg;
    for (let i = 0; i < seg; i++) re[i] = (x[s + i] - m) * win[i];
    fft(re, im); for (let k = 0; k < seg / 2; k++) p[k] += re[k] * re[k] + im[k] * im[k]; cnt++;
  }
  return { f: Array.from(p, (_, k) => (k * rate) / seg), p: Array.from(p, (v) => v / cnt) };
}
function slope(ps, lo, hi) { // least-squares slope of log10 P vs log10 f
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 1; k < ps.f.length; k++) { const f = ps.f[k]; if (f < lo || f > hi) continue; const x = Math.log10(f), y = Math.log10(ps.p[k]); n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
function gen(opts, nControl) { // control-rate samples of the model
  const m = new DriftModel({ spread: 0, warmup: 0, slow: 0, wander: 0, jitter: 0, ...opts });
  const x = new Float64Array(nControl); for (let i = 0; i < nControl; i++) x[i] = m.tick(); return x;
}
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const N = 1 << 19;

// 1. spectral shape of each component: frequency-noise PSD slopes
const pink = gen({ slow: 3, seed: 11 }, N), pinkS = slope(welch(pink, 1 << 15, CR), 0.2, 1.5);
const rw = gen({ wander: 3, wanderTime: 1000, seed: 12 }, N), rwS = slope(welch(rw, 1 << 15, CR), 0.2, 20);
const jit = gen({ jitter: 1, seed: 13 }, N), jitS = slope(welch(jit, 1 << 13, CR), 5, 100);
console.log("PSD slopes  slow(1/f):", pinkS.toFixed(2), " wander(1/f^2):", rwS.toFixed(2), " jitter(flat):", jitS.toFixed(2));
assert.ok(Math.abs(pinkS + 1) < 0.25, "slow drift should be about 1/f");
assert.ok(Math.abs(rwS + 2) < 0.25, "wander should be about 1/f^2");
assert.ok(Math.abs(jitS) < 0.3, "jitter should be about flat below its corner");

// 2. amplitude calibration: parameters are rms cents
for (const [name, x, target, tol] of [["slow", pink, 3, 0.4], ["wander(tau 20)", gen({ wander: 2, wanderTime: 20, seed: 14 }, N), 2, 0.4], ["jitter", jit, 1, 0.1]]) {
  const r = rms(x); console.log(`rms ${name}: ${r.toFixed(2)} cents (target ${target})`);
  assert.ok(Math.abs(r / target - 1) < tol, `${name} rms off target`);
}

// 3. determinism, independence, bounds, warm-up
const a1 = gen({ slow: 3, seed: 5 }, 5000), a2 = gen({ slow: 3, seed: 5 }, 5000);
assert.deepEqual(Array.from(a1), Array.from(a2), "same seed must reproduce exactly");
let worst = 0; // correlation of 60 s traces from different seeds, over several pairs
for (let s = 20; s < 28; s += 2) {
  const x = gen({ slow: 3, wander: 2, seed: s }, CR * 60), y = gen({ slow: 3, wander: 2, seed: s + 1 }, CR * 60);
  let cab = 0, ca = 0, cb = 0; for (let i = 0; i < x.length; i++) { cab += x[i] * y[i]; ca += x[i] ** 2; cb += y[i] ** 2; }
  worst = Math.max(worst, Math.abs(cab / Math.sqrt(ca * cb)));
}
console.log("worst |correlation| between seeds (4 pairs, 60 s):", worst.toFixed(3));
assert.ok(worst < 0.6, "different seeds should not track each other");
const wm = new DriftModel({ ...PRESETS.clean, warmup: 8, warmupTime: 10, seed: 3 }); let first = 0, last = 0;
for (let i = 0; i < CR * 60; i++) { const v = wm.tick(); if (i === 0) first = v; last = v; }
console.log("warm-up: first", first.toFixed(2), "cents, after 60 s", last.toFixed(3));
assert.ok(Math.abs(first - 8) < 0.1 && Math.abs(last) < 0.05, "warm-up should start at its offset and settle to zero");
for (const [name, preset] of Object.entries(PRESETS)) {
  const m = new DriftModel({ ...preset, seed: 9 }); let mx = 0, fin = true;
  for (let i = 0; i < CR * 120; i++) { const v = m.tick(); if (!Number.isFinite(v)) fin = false; mx = Math.max(mx, Math.abs(v)); }
  console.log(`preset ${name.padEnd(8)} max |deviation| over 120 s: ${mx.toFixed(1)} cents`);
  assert.ok(fin); assert.ok(mx < 8 * Math.max(1, preset.slow + preset.wander + preset.jitter + preset.warmup + preset.spread * 3), `${name} unbounded`);
}
// 4. per-sample interpolation: no jumps larger than the control step would allow
const m2 = new DriftModel({ ...PRESETS.unstable, seed: 2 }), out = new Float32Array(48000); m2.process(out, 48000, 48000);
let maxStep = 0; for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
console.log("max per-sample step (unstable preset):", maxStep.toFixed(4), "cents");
assert.ok(maxStep < 0.5, "interpolated output should be smooth");
console.log("\ncore: all assertions passed");
