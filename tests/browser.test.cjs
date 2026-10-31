// Headless Chromium checks of the demo page and of the built library (dist/) used as a real ES module.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", types[path.extname(p)] || "application/octet-stream"); res.end(fs.readFileSync(p));
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|fonts\./.test(m.text())) errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(base + "/index.html");

  // --- demo page ---
  const psd = await page.evaluate(() => { const p = window.__demo.psd(); return p && { n: p.total.length, finite: p.total.every(Number.isFinite) }; });
  assert.ok(psd && psd.finite, "spectrum should be computed and finite at load");
  await page.screenshot({ path: "shot-demo-rest.png", fullPage: true });
  await page.click("#start"); await page.waitForTimeout(4000);
  assert.strictEqual(await page.textContent("#status"), "Playing");
  const span = () => page.evaluate(() => window.__demo.traces.map((t) => { const a = t.slice(-20); return Math.max(...a) - Math.min(...a); }));
  const lastAbs = () => page.evaluate(() => window.__demo.traces.map((t) => Math.abs(t[t.length - 1] ?? 0)));
  const driftVals = await lastAbs();
  console.log("drift mode, |deviation| now (cents):", driftVals.map((v) => v.toFixed(2)).join(" "));
  assert.ok(driftVals.some((v) => v > 0.3), "drift mode should show nonzero deviation");
  await page.click('label:has(input[value="clean"])'); await page.waitForTimeout(1500);
  const cleanVals = await lastAbs();
  console.log("clean mode, |deviation| now (cents):", cleanVals.map((v) => v.toFixed(3)).join(" "));
  assert.ok(cleanVals.every((v) => v < 0.05), "clean mode should be pitch-exact");
  await page.click('label:has(input[value="drift"])'); await page.waitForTimeout(1500);
  assert.ok((await lastAbs()).some((v) => v > 0.3), "drift should return after switching back");
  const before = await page.evaluate(() => window.__demo.traces.map((t) => t.length));
  await page.click("#restart"); await page.waitForTimeout(800);
  const after = await page.evaluate(() => window.__demo.traces.map((t) => t.length));
  assert.ok(after.every((n, i) => n < before[i]), "restart should clear the traces");
  await page.screenshot({ path: "shot-demo-play.png", fullPage: true });

  // --- the shipped library, consumed as a real ES module from dist/ ---
  const lib = await page.evaluate(async (base) => {
    const { loadAnalogDrift, createDrift, createOsc, PRESETS } = await import(base + "/dist/analog-drift.js");
    const sr = 48000, secs = 14, n = sr * secs;
    async function render(driftSettings, useNative) {
      const oc = new OfflineAudioContext(1, n, sr);
      await loadAnalogDrift(oc, base + "/dist/analog-drift.worklet.js");
      if (useNative) {
        const osc = new OscillatorNode(oc, { type: "sine", frequency: 1000 });
        const d = createDrift(oc, driftSettings); d.connect(osc.detune); osc.connect(oc.destination); osc.start();
      } else { const o = createOsc(oc, { type: "sine", drift: driftSettings }); o.parameters.get("frequency").value = 1000; o.connect(oc.destination); }
      const out = (await oc.startRendering()).getChannelData(0);
      // spectral concentration around the carrier, from a 2^17 window after the first second
      const N = 1 << 17, start = sr, re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = out[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
      for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
      for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = i + k + len / 2, tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
      const c = Math.round(1000 / (sr / N)); let tot = 0, near = 0; for (let k = 1; k < N / 2; k++) { const p = re[k] ** 2 + im[k] ** 2; tot += p; if (Math.abs(k - c) <= 2) near += p; }
      return { near: near / tot, finite: out.every(Number.isFinite) };
    }
    const strong = { ...PRESETS.unstable, seed: 4 };
    return { cleanNative: await render(PRESETS.clean, true), driftNative: await render(strong, true), cleanOsc: await render(PRESETS.clean, false), driftOsc: await render(strong, false) };
  }, base);
  console.log("carrier-line energy fraction  native+drift node: clean", lib.cleanNative.near.toFixed(3), "-> drift", lib.driftNative.near.toFixed(3),
    "| analog-osc: clean", lib.cleanOsc.near.toFixed(3), "-> drift", lib.driftOsc.near.toFixed(3));
  assert.ok(lib.cleanNative.finite && lib.driftNative.finite && lib.cleanOsc.finite && lib.driftOsc.finite);
  assert.ok(lib.cleanNative.near > 0.9 && lib.driftNative.near < 0.7, "drift node should broaden a native oscillator's line");
  assert.ok(lib.cleanOsc.near > 0.9 && lib.driftOsc.near < 0.7, "analog-osc drift should broaden its line");

  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no horizontal scroll at phone width");
  console.log("page errors:", JSON.stringify(errs)); assert.strictEqual(errs.length, 0);
  console.log("ALL BROWSER CHECKS PASSED");
  await browser.close(); server.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
