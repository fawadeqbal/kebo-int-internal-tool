// Two recordings of every read endpoint: equal once the old names are read as the new ones?
// node golden-compare.cjs before.json after.json [names.json]   (names: old -> new, from the rename tool's report)
const fs = require("fs");
const [a, b, namesAt] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(a, "utf8")), B = JSON.parse(fs.readFileSync(b, "utf8"));
const all = namesAt ? JSON.parse(fs.readFileSync(namesAt, "utf8")).names : {};
// The bare word is still a property in this step: only compound names changed on the wire.
const names = Object.fromEntries(Object.entries(all).filter(([k]) => !/^(factory|factories|Factory|Factories|FACTORY|FACTORIES)$/.test(k)));
const renamePath = (p) => p.replace(/[A-Za-z0-9_$]*[Ff]actor(?:y|ies)[A-Za-z0-9_$]*/g, (w) => (Object.prototype.hasOwnProperty.call(names, w) ? names[w] : w));
for (const k of Object.keys(A)) { const n = renamePath(k); if (n !== k) { A[n] = A[k]; delete A[k]; } }
const renameKeys = (v) => Array.isArray(v) ? v.map(renameKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [Object.prototype.hasOwnProperty.call(names, k) ? names[k] : k, renameKeys(x)])) : v;
const diffs = [];
const walk = (x, y, at, out) => {
  if (out.length > 3) return;
  if (x === y) return;
  if (Array.isArray(x) && Array.isArray(y)) { if (x.length !== y.length) return out.push(`${at}: ${x.length} items, then ${y.length}`); x.forEach((v, i) => walk(v, y[i], `${at}[${i}]`, out)); return; }
  if (x && y && typeof x === "object" && typeof y === "object") {
    const kx = Object.keys(x), ky = Object.keys(y);
    const gone = kx.filter((k) => !(k in y)), added = ky.filter((k) => !(k in x));
    if (gone.length || added.length) out.push(`${at}: keys gone [${gone.slice(0, 6)}] added [${added.slice(0, 6)}]`);
    if (JSON.stringify(kx.filter((k) => k in y)) !== JSON.stringify(ky.filter((k) => k in x))) out.push(`${at}: key order differs`);
    for (const k of kx) if (k in y) walk(x[k], y[k], `${at}.${k}`, out);
    return;
  }
  out.push(`${at}: ${JSON.stringify(x)?.slice(0, 60)} -> ${JSON.stringify(y)?.slice(0, 60)}`);
};
let same = 0;
const paths = new Set([...Object.keys(A), ...Object.keys(B)]);
for (const p of paths) {
  if (!(p in A) || !(p in B)) { diffs.push([p, [p in A ? "only before" : "only after"]]); continue; }
  const out = [];
  if (A[p].status !== B[p].status) out.push(`status ${A[p].status} -> ${B[p].status}`);
  walk(renameKeys(A[p].body), B[p].body, "", out);
  if (out.length) diffs.push([p, out]); else same++;
}
console.log(`answers ${paths.size}, same ${same}, different ${diffs.length}`);
const byShape = {};
for (const [p, out] of diffs) { const k = p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\?.*/, "") + " :: " + out[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\[\d+\]/g, "[]").slice(0, 110); byShape[k] = (byShape[k] || 0) + 1; }
console.log(Object.entries(byShape).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, n]) => `${n}× ${k}`).join("\n"));
process.exit(diffs.length ? 1 : 0);
