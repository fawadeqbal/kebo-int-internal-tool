// An old phone app: does every answer still hold everything it held before the rename (same names, same values)?
const fs = require("fs");
const [a, b] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(a, "utf8")), B = JSON.parse(fs.readFileSync(b, "utf8"));
const NOISE = /^(checkedAt|now|lastLoginAt)$/;
const missing = [];
const walk = (x, y, at, out) => {
  if (out.length > 2 || x === y) return;
  if (Array.isArray(x) && Array.isArray(y)) { if (x.length !== y.length) return out.push(`${at}: ${x.length} items, then ${y.length}`); x.forEach((v, i) => walk(v, y[i], `${at}[${i}]`, out)); return; }
  if (x && y && typeof x === "object" && typeof y === "object") { for (const k of Object.keys(x)) { if (NOISE.test(k)) continue; if (!(k in y)) out.push(`${at}.${k}: gone`); else walk(x[k], y[k], `${at}.${k}`, out); } return; }
  out.push(`${at}: ${JSON.stringify(x)?.slice(0, 50)} -> ${JSON.stringify(y)?.slice(0, 50)}`);
};
let same = 0, total = 0;
for (const p of Object.keys(A)) {
  total++;
  // The old app asks with its old names in the address: the recording after the rename was asked with the new ones.
  const q = p in B ? p : p.replace(/factoryId=/g, "supplierId=");
  if (!(q in B)) { missing.push([p, ["not asked after"]]); continue; }
  const out = [];
  if (A[p].status !== B[q].status) out.push(`status ${A[p].status} -> ${B[q].status}`);
  walk(A[p].body, B[q].body, "", out);
  if (out.length) missing.push([p, out]); else same++;
}
console.log(`answers before ${total}; an old phone app still gets everything in ${same}; something missing or changed in ${missing.length}`);
const by = {};
for (const [p, out] of missing) { const k = p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\?.*/, "") + " :: " + out[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\[\d+\]/g, "[]").slice(0, 100); by[k] = (by[k] || 0) + 1; }
console.log(Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, n]) => `${n}× ${k}`).join("\n"));
