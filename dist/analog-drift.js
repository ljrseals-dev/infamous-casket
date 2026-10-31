/**
 * Main-thread helper for analog-drift. ES module, no dependencies.
 *
 *   import { loadAnalogDrift, createDrift, createOsc, PRESETS } from "./analog-drift.js";
 *   await loadAnalogDrift(ctx);                              // once per AudioContext
 *   const osc = new OscillatorNode(ctx, { type: "sawtooth", frequency: 220 });
 *   const drift = createDrift(ctx, { ...PRESETS.vintage, seed: 3 });
 *   drift.connect(osc.detune);                               // cents of drift into any native oscillator
 */
export const PRESETS = {
  clean:   { slow: 0, wander: 0, jitter: 0, warmup: 0, spread: 0 },
  stable:  { slow: 0.8, wander: 0.5, jitter: 0.1, warmup: 1, spread: 1 },
  vintage: { slow: 2.5, wander: 1.5, jitter: 0.25, warmup: 4, spread: 2 },
  oldmono: { slow: 4, wander: 3, jitter: 0.4, warmup: 8, spread: 3 },
  unstable:{ slow: 12, wander: 10, jitter: 1.2, warmup: 20, spread: 6 }
};

/** Registers the processors. `url` defaults to analog-drift.worklet.js next to this file. */
export function loadAnalogDrift(ctx, url) {
  return ctx.audioWorklet.addModule(url || new URL("./analog-drift.worklet.js", import.meta.url).href);
}

/** A node whose single output is pitch drift in cents. Connect it to an AudioParam such as OscillatorNode.detune. */
export function createDrift(ctx, options = {}) {
  return new AudioWorkletNode(ctx, "analog-drift", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: options });
}

/** A band-limited oscillator with built-in drift. type: "saw" | "square" | "triangle" | "sine". */
export function createOsc(ctx, { type = "saw", drift = PRESETS.vintage, ampJitter = 0 } = {}) {
  return new AudioWorkletNode(ctx, "analog-osc", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { type, drift, ampJitter } });
}

/** Change settings on a running node. Pass reset: true to restart the model (new seed, warm-up from the start). */
export function configure(node, settings, reset = false) { node.port.postMessage({ configure: settings, reset }); }
