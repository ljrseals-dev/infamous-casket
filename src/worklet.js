/* Worklet processors. Bundled after core.js, so AnalogDriftCore is already defined. */
(function () {
  var Core = globalThis.AnalogDriftCore;

  /** Outputs the drift as a signal in cents. Connect it to OscillatorNode.detune (or any detune-style AudioParam). */
  class DriftSource extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [{ name: "depth", defaultValue: 1, minValue: 0, maxValue: 4, automationRate: "k-rate" }]; }
    constructor(options) {
      super(options);
      this.model = new Core.DriftModel(options && options.processorOptions);
      this.port.onmessage = (e) => { if (e.data && e.data.configure) this.model.configure(e.data.configure, !!e.data.reset); };
    }
    process(inputs, outputs, parameters) {
      var out = outputs[0][0]; if (!out) return true;
      this.model.process(out, out.length, sampleRate);
      var d = parameters.depth[0]; if (d !== 1) for (var i = 0; i < out.length; i++) out[i] *= d;
      return true;
    }
  }

  function polyBlep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }

  /** Band-limited (PolyBLEP) oscillator with its own drift model. `frequency` and `detune` are a-rate; detune is in cents. */
  class AnalogOsc extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: "frequency", defaultValue: 440, minValue: 0, maxValue: 20000, automationRate: "a-rate" },
        { name: "detune", defaultValue: 0, minValue: -48000, maxValue: 48000, automationRate: "a-rate" },
        { name: "depth", defaultValue: 1, minValue: 0, maxValue: 4, automationRate: "k-rate" }
      ];
    }
    constructor(options) {
      super(options);
      var o = (options && options.processorOptions) || {};
      this.type = o.type || "saw";
      this.model = new Core.DriftModel(o.drift);
      this.rng = new Core.Rng(((o.drift && o.drift.seed) || 1) * 7919 + 13);
      this.ampJitter = o.ampJitter === undefined ? 0 : o.ampJitter;
      this.phase = this.rng.uniform(); this.tri = this.phase < 0.5 ? 4 * this.phase - 1 : 3 - 4 * this.phase; // start on the exact triangle value, no DC ramp-in
      this.amp = 0; this.cents = new Float32Array(128);
      this.port.onmessage = (e) => {
        var m = e.data || {};
        if (m.type) this.type = m.type;
        if (m.ampJitter !== undefined) this.ampJitter = m.ampJitter;
        if (m.configure) this.model.configure(m.configure, !!m.reset);
      };
    }
    process(inputs, outputs, parameters) {
      var out = outputs[0][0]; if (!out) return true;
      var n = out.length, f = parameters.frequency, dtn = parameters.detune, depth = parameters.depth[0];
      if (this.cents.length < n) this.cents = new Float32Array(n);
      this.model.process(this.cents, n, sampleRate);
      var ph = this.phase, type = this.type, tri = this.tri, amp = this.amp;
      for (var i = 0; i < n; i++) {
        var fr = f.length > 1 ? f[i] : f[0], dc = dtn.length > 1 ? dtn[i] : dtn[0];
        var hz = fr * Math.pow(2, (dc + this.cents[i] * depth) / 1200);
        var dt = Math.min(0.45, Math.max(0, hz / sampleRate)), v;
        if (type === "sine") v = Math.sin(2 * Math.PI * ph);
        else if (type === "saw") v = 2 * ph - 1 - polyBlep(ph, dt);
        else {
          var sq = (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 0.5) % 1, dt);
          if (type === "square") v = sq;
          else { tri = tri * 0.9995 + 4 * dt * sq; v = tri; } // triangle: leaky integral of the band-limited square
        }
        if (this.ampJitter > 0) { amp += 0.0015 * (this.rng.gauss() - amp); v *= 1 + this.ampJitter * amp * 25; }
        out[i] = v;
        ph += dt; if (ph >= 1) ph -= 1;
      }
      this.phase = ph; this.tri = tri; this.amp = amp;
      return true;
    }
  }

  registerProcessor("analog-drift", DriftSource);
  registerProcessor("analog-osc", AnalogOsc);
})();
