# Analog Drift

A small Web Audio library that makes digital oscillators wander in pitch the way analog ones do. Synthetic oscillators are mathematically exact, and that exactness is a large part of why they sound lifeless. This adds the instability back, with a model whose behaviour you can inspect, plot and tune.

Open `index.html` for the demo: a held five-note chord with an instant Clean/Drift switch, live pitch traces for each voice, and a plot of the drift's frequency-noise spectrum.

**Status: first working version. Mechanically tested; the sound has not been judged by ear, and the presets are invented, not measured from any real instrument.**

## What the model contains

All outputs are pitch deviation in cents. Each part is a frequency-noise source.

| Part | Behaviour | Spectrum of the frequency noise |
|---|---|---|
| `slow` | Slow 1/f ("flicker") wander, built from octave-spaced one-pole filters between 0.02 and 3 Hz | falls as 1/f |
| `wander` | Thermal-style random walk, kept bounded by a time constant (`wanderTime`, default 20 s) | falls as 1/f² |
| `jitter` | Fast white FM jitter, low-passed at 200 Hz | flat |
| `warmup` | Exponential settling after power-on (`warmupTime`, default 25 s) | none (a transient) |
| `spread` | A fixed per-instance pitch offset from the seed, like component tolerance | none |

`slow`, `wander` and `jitter` are rms values in cents. Phase noise is the integral of frequency noise, so these show up in a phase-noise plot as f⁻³, f⁻⁴ and f⁻². The model runs at a 1.5 kHz control rate and is linearly interpolated per sample, so it costs very little. Each instance has its own seed, so voices drift independently and the same seed reproduces the same drift exactly.

## Use it

Build the library (`npm run build`) and copy `dist/` into your project. It contains `analog-drift.js` (the helper module) and `analog-drift.worklet.js` (the processors).

**1. Drive any native oscillator.** The drift node outputs cents, which is exactly what `detune` expects.

```js
import { loadAnalogDrift, createDrift, PRESETS } from "./dist/analog-drift.js";

await loadAnalogDrift(ctx);                        // once per AudioContext
const osc = new OscillatorNode(ctx, { type: "sawtooth", frequency: 220 });
const drift = createDrift(ctx, { ...PRESETS.vintage, seed: 3 });
drift.connect(osc.detune);
osc.connect(ctx.destination); osc.start();

drift.parameters.get("depth").value = 0.5;         // scale the whole effect live
configure(drift, { slow: 5 });                     // change settings without restarting
```

**2. Use the built-in oscillator.** `createOsc` is a band-limited (PolyBLEP) saw, square, triangle or sine with the same drift model inside. `frequency` and `detune` (cents) are a-rate parameters, so you can still automate or modulate them.

```js
import { createOsc, PRESETS } from "./dist/analog-drift.js";
const osc = createOsc(ctx, { type: "saw", drift: { ...PRESETS.oldmono, seed: 7 }, ampJitter: 0.1 });
osc.parameters.get("frequency").value = 110;
osc.connect(ctx.destination);
```

Give every voice a different `seed`. If two voices share one, they drift together and the effect disappears.

Presets: `clean`, `stable`, `vintage`, `oldmono`, `unstable`. They are starting points for taste.

## Develop

```
npm run build          # writes dist/ and the demo index.html
npm test               # core model and worklet tests, in Node
npm install && npx playwright install chromium
npm run test:browser   # demo and the built library in headless Chromium
```

## Verification

Checked automatically:
- **Spectral shape.** The measured frequency-noise slopes are −1.15 for `slow`, −1.98 for `wander` and −0.12 for `jitter` (flat), against targets of −1, −2 and 0.
- **Calibration.** Measured rms cents land within about 11% of the requested value for each component (the tests allow 40%, because 1/f noise varies between runs).
- **Statistics.** The same seed reproduces exactly. Different seeds are weakly correlated (worst case 0.26 over four 60 s pairs). Warm-up starts at its offset and settles to zero. Every preset stays bounded and finite, and the per-sample output is smooth.
- **Oscillator.** Saw, square, triangle and sine measure 440 Hz at the right amplitude. `detune` of +1200 cents doubles the pitch. PolyBLEP lowers inharmonic (aliased) energy by about 15 dB against a naive saw at 3.1 kHz.
- **Audible effect, measured.** In headless Chromium, the shipped `dist/` module drives a native oscillator's `detune`. With the `unstable` preset, a 1 kHz sine's energy near the carrier falls from 1.000 to 0.001, for both the drift node and the built-in oscillator.

**Not checked:**
- Nobody has listened to it. Whether `vintage` sounds pleasantly alive or just detuned is unjudged.
- The presets are not measurements of real hardware. The 1/f, 1/f² and white shapes are standard noise models, but how much of each a real oscillator has varies a lot.
- The model has no temperature or voltage input, no pitch-dependent drift, and no coupling between voices (real polysynths share a supply, so their voices can drift together).
- Safari and Firefox are untested.

## Limitations

- Drift is added to the pitch only. Real instability also affects filter cutoff and amplitude. The oscillator's `ampJitter` is a crude stand-in.
- The triangle is a leaky integral of a band-limited square, so it has a small high-pass effect below about 10 Hz.
- Loading the worklet from a `file://` page does not work in Chrome because of its opaque origin. Serve the files over HTTP, or use the self-contained `index.html`, which falls back to a data URL.

## License

No license has been chosen. Add one (for example MIT) before publishing if you want others to reuse the code.
