// Builds dist/ (the library) and index.html (the demo, fully self-contained).
import fs from "node:fs";
const root = new URL("../", import.meta.url), r = (p) => fs.readFileSync(new URL(p, root), "utf8");
const core = r("src/core.js"), worklet = r("src/worklet.js");
for (const [n, s] of [["core", core], ["worklet", worklet]]) if (/<\/script/i.test(s)) throw new Error(n + ".js must not contain </script");
fs.mkdirSync(new URL("dist/", root), { recursive: true });
fs.writeFileSync(new URL("dist/analog-drift.worklet.js", root), core + "\n" + worklet);
fs.copyFileSync(new URL("src/analog-drift.js", root), new URL("dist/analog-drift.js", root));
const page = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  + r("demo/template.html").replace("/*__CORE__*/", () => core).replace("/*__WORKLET__*/", () => worklet) + "\n</html>\n";
fs.writeFileSync(new URL("index.html", root), page);
console.log("wrote dist/analog-drift.worklet.js, dist/analog-drift.js and index.html (" + page.length + " bytes)");
