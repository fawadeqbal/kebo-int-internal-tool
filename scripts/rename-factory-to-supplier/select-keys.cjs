// Step B: a relation renamed in the Prisma schema is also a key in query objects the type checker does not report
// (a select, include or where written as a plain constant, or passed through Prisma's generic Subset): those
// queries silently select nothing and their results become `never`. This renames a key factory / factories when
// its value is a query argument ({ select … }, { include … }, { where … }, { some … }, …) or `true` beside other
// `true`s (a select). Usage: node select-keys.cjs <dir…> [--write]
const ts = require("/tmp/stepb/node_modules/typescript");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const write = process.argv.includes("--write");
const dirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const NEW = { factory: "supplier", factories: "suppliers" };
const ARG = new Set(["select", "include", "where", "orderBy", "some", "every", "none", "is", "isNot", "take", "skip", "distinct", "omit"]);
let total = 0;
const log = [];
for (const dir of dirs) {
  const files = cp
    .execSync("git ls-files '*.ts' '*.tsx'", { cwd: dir, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !/generated\//.test(f))
    .map((f) => path.join(dir, f));
  for (const file of files) {
    let text = fs.readFileSync(file, "utf8");
    if (!/\bfactor(y|ies)\s*:/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edits = [];
    const visit = (n) => {
      if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && NEW[n.name.text]) {
        const v = n.initializer;
        let query = false;
        if (ts.isObjectLiteralExpression(v)) {
          const keys = v.properties.map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null));
          query = keys.length > 0 && keys.some((k) => k && ARG.has(k));
        } else if (v.kind === ts.SyntaxKind.TrueKeyword && ts.isObjectLiteralExpression(n.parent)) {
          const sibs = n.parent.properties.filter((p) => p !== n && ts.isPropertyAssignment(p));
          query = sibs.length > 0 && sibs.every((p) => p.initializer.kind === ts.SyntaxKind.TrueKeyword || ts.isObjectLiteralExpression(p.initializer));
        }
        // Or any value, directly inside a query's include / select / where / orderBy (`include: { factory: name }`).
        const holder = ts.isObjectLiteralExpression(n.parent) && n.parent.parent && ts.isPropertyAssignment(n.parent.parent) ? n.parent.parent : null;
        if (!query && holder && (ts.isIdentifier(holder.name) || ts.isStringLiteral(holder.name)) && ["include", "select", "where", "orderBy"].includes(holder.name.text)) query = true;
        if (query) {
          const s = n.name.getStart(sf) + (ts.isStringLiteral(n.name) ? 1 : 0);
          edits.push({ start: s, end: s + n.name.text.length, text: NEW[n.name.text], at: sf.getLineAndCharacterOfPosition(s).line + 1 });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!edits.length) continue;
    for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    total += edits.length;
    log.push(`${path.relative(process.cwd(), file)}: ${edits.map((e) => e.at).join(",")}`);
    if (write) fs.writeFileSync(file, text);
  }
}
console.log(log.join("\n"));
console.log("keys", total, write ? "renamed" : "(dry run)");
