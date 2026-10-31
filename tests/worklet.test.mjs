import assert from "node:assert/strict";
import fs from "node:fs";
const sr = 48000, procs = {};
globalThis.sampleRate = sr;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
globalThis.registerProcessor = (n, c) => { procs[n] = c; };
new Function(fs.readFileSync(new URL("../dist/analog-drift.worklet.js", import.meta.url), "utf8"))();

function render(name, secs, options, params = {}) {
  const p = new procs[name]({ processorOptions: options }), N = Math.ceil((sr * secs) / 128) * 128, out = new Float32Array(N);
  for (let off = 0; off < N; off += 128) {
    const o = new Float32Array(128);
    const prm = { frequency: new Float32Array([params.frequency ?? 440]), detune: new Float32Array([params.detune ?? 0]), depth: new Float32Array([params.depth ?? 1]) };
    p.process([[]], [[o]], prm); out.set(o, off);
  }
  return out;
}
function zeroCrossFreq(x) { let c = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c / (x.length / sr); }
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = i + k + len / 2, tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } } }
function spectrum(x) { const n = 1 << 17, re = new Float64Array(n), im = new Float64Array(n); for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); fft(re, im); return Array.from({ length: n / 2 }, (_, k) => re[k] ** 2 + im[k] ** 2); }

const clean = { slow: 0, wander: 0, jitter: 0, warmup: 0, spread: 0 };
// pitch accuracy with no drift
for (const type of ["saw", "square", "triangle", "sine"]) {
  const x = render("analog-osc", 2, { type, drift: clean }, { frequency: 440 });
  assert.ok(x.every(Number.isFinite), type + " finite");
  const f = zeroCrossFreq(x), pk = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  console.log(`${type.padEnd(8)} measured ${f.toFixed(1)} Hz  peak ${pk.toFixed(2)}`);
  assert.ok(Math.abs(f - 440) < 1.5, type + " frequency off");
  assert.ok(pk < 1.5 && pk > 0.3, type + " amplitude out of range");
}
// detune parameter is in cents: +1200 doubles the pitch
const up = render("analog-osc", 1, { type: "sine", drift: clean }, { frequency: 220, detune: 1200 });
assert.ok(Math.abs(zeroCrossFreq(up) - 440) < 1.5, "+1200 cents should double the frequency");
// PolyBLEP aliasing: a 3.1 kHz saw has many harmonics above Nyquist; compare energy at non-harmonic bins with a naive saw
{
  const f0 = 3100, n = 1 << 17, naive = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { naive[i] = 2 * ph - 1; ph += f0 / sr; if (ph >= 1) ph -= 1; }
  const blep = render("analog-osc", n / sr + 0.01, { type: "saw", drift: clean }, { frequency: f0 }).subarray(0, n);
  const alias = (x) => { const s = spectrum(x), bin = sr / n; let a = 0, h = 0; for (let k = 2; k < s.length; k++) { const f = k * bin, near = Math.abs(f / f0 - Math.round(f / f0)) * f0; if (near < 25) h += s[k]; else a += s[k]; } return 10 * Math.log10(a / h); };
  const an = alias(naive), ab = alias(blep);
  console.log(`inharmonic energy vs harmonic energy: naive ${an.toFixed(1)} dB, PolyBLEP ${ab.toFixed(1)} dB`);
  assert.ok(ab < an - 10, "PolyBLEP should cut aliasing by at least 10 dB");
}
// drift broadens the spectral line of a held note and the drift source output is in cents
{
  const secs = 12, steady = render("analog-osc", secs, { type: "sine", drift: clean }, { frequency: 1000 });
  const drifting = render("analog-osc", secs, { type: "sine", drift: { slow: 4, wander: 3, jitter: 0.5, warmup: 0, spread: 0, seed: 4 } }, { frequency: 1000 });
  const frac = (x) => { const s = spectrum(x.subarray(0, 1 << 17)), bin = sr / (1 << 17), c = Math.round(1000 / bin); let tot = 0, near = 0; for (let k = 1; k < s.length; k++) { tot += s[k]; if (Math.abs(k - c) <= 2) near += s[k]; } return near / tot; };
  const fs_ = frac(steady), fd = frac(drifting);
  console.log(`energy within ±2 bins of carrier: steady ${fs_.toFixed(3)}, drifting ${fd.toFixed(3)}`);
  assert.ok(fs_ > 0.9, "steady sine should be a narrow line");
  assert.ok(fd < fs_, "drifting sine should spread energy away from the line");
  const cents = render("analog-drift", 20, { slow: 3, wander: 2, jitter: 0, warmup: 0, spread: 0, seed: 8 });
  let s2 = 0; for (const v of cents) s2 += v * v;
  const r = Math.sqrt(s2 / cents.length); console.log("analog-drift output rms:", r.toFixed(2), "cents"); assert.ok(r > 0.5 && r < 8);
  const half = render("analog-drift", 5, { slow: 3, wander: 2, seed: 8 }, { depth: 0.5 }), full = render("analog-drift", 5, { slow: 3, wander: 2, seed: 8 }, { depth: 1 });
  assert.ok(Math.abs(half[40000] * 2 - full[40000]) < 1e-3, "depth should scale the output");
}
console.log("\nworklet: all assertions passed");
