// Step B of the rename: after the Prisma relation fields were renamed (factory → supplier, factories → suppliers),
// the type checker reports every use of the old name. This renames the name at each reported place, and only there:
//   x.factory            → x.supplier          (property access, TS2339/2551)
//   { factory: … }       → { supplier: … }     (object literal key, TS2353/2561)
//   { factory }          → { supplier: factory } (shorthand: the local keeps its name)
//   const { factory } = x → const { supplier: factory } = x (destructuring: the local keeps its name)
//   X["factory"]         → X["supplier"]       (indexed access type / element access with a string)
// Usage: node fix-errors.cjs <project dir> [--write]   (runs tsc --noEmit -p tsconfig.json there, repeatedly)
const ts = require("/tmp/stepb/node_modules/typescript");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const dir = path.resolve(process.argv[2]);
const write = process.argv.includes("--write");
const NEW = { factory: "supplier", factories: "suppliers" };
const CODES = new Set([2339, 2551, 2353, 2561, 2552]);

function errors() {
  let out = "";
  try {
    out = cp.execSync("pnpm exec tsc --noEmit -p tsconfig.json", { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = e.stdout || "";
  }
  const rows = [];
  for (const line of out.split("\n")) {
    const m = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    if (!m) continue;
    const code = Number(m[4]);
    if (!CODES.has(code)) continue;
    const word = /'(factory|factories)'/.exec(m[5]);
    if (!word) continue;
    rows.push({ file: path.resolve(dir, m[1]), line: Number(m[2]), col: Number(m[3]), code, word: word[1], text: m[5] });
  }
  return { rows, total: (out.match(/error TS/g) || []).length };
}

function nodeAt(sf, pos) {
  let found = null;
  const visit = (n) => {
    if (pos >= n.getStart(sf) && pos < n.getEnd()) {
      found = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return found;
}

let round = 0;
const done = [];
for (;;) {
  round++;
  const { rows, total } = errors();
  console.log(`round ${round}: ${total} errors, ${rows.length} about factory/factories`);
  if (!rows.length || !write || round > 40) break;
  const byFile = new Map();
  for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) || []), r]);
  let changed = 0;
  for (const [file, list] of byFile) {
    if (/generated\//.test(file) || !fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edits = [];
    for (const r of list) {
      const pos = sf.getPositionOfLineAndCharacter(r.line - 1, r.col - 1);
      const n = nodeAt(sf, pos);
      if (!n) continue;
      const name = ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n) ? n : null;
      if (!name || name.text !== r.word) {
        done.push(`SKIP ${path.relative(dir, file)}:${r.line}:${r.col} not a name: ${r.text.slice(0, 80)}`);
        continue;
      }
      const to = NEW[r.word];
      const p = name.parent;
      const start = name.getStart(sf);
      const end = name.getEnd();
      if (ts.isShorthandPropertyAssignment(p) && p.name === name) edits.push({ start, end, text: `${to}: ${name.text}` });
      else if (ts.isBindingElement(p) && p.name === name && !p.propertyName) edits.push({ start, end, text: `${to}: ${name.text}` });
      else if (ts.isStringLiteral(name)) edits.push({ start: start + 1, end: end - 1, text: to });
      else edits.push({ start, end, text: to });
    }
    const uniq = [...new Map(edits.map((e) => [e.start, e])).values()].sort((a, b) => b.start - a.start);
    for (const e of uniq) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    if (uniq.length) {
      fs.writeFileSync(file, text);
      changed += uniq.length;
      done.push(`${path.relative(dir, file)}: ${uniq.length}`);
    }
  }
  console.log(`  renamed ${changed}`);
  if (!changed) break;
}
fs.writeFileSync(path.join("/tmp", `fix-errors-${path.basename(dir)}.log`), done.join("\n"));
