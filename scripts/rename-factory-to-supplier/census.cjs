// Where the word lives in TypeScript: names, strings, templates, JSX words, comments.
const ts = require("/home/claude/kebo-int-internal-tool/node_modules/typescript");
const fs = require("fs"), path = require("path"), cp = require("child_process");
const root = "/home/claude/kebo-int-internal-tool";
const files = cp.execSync("git ls-files '*.ts' '*.tsx' '*.mjs' '*.cjs' '*.js'", { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && !/generated\/|migrations\/|node_modules|\.next\//.test(f));
const RE = /factor(y|ies)/i;
const out = { ident: 0, string: 0, template: 0, jsx: 0, comment: 0, files: 0 };
const strings = new Map(), idents = new Map(), jsx = new Map(), where = new Map();
for (const f of files) {
  const text = fs.readFileSync(path.join(root, f), "utf8");
  if (!RE.test(text)) continue;
  out.files++;
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (m, k) => { m.set(k, (m.get(k) || 0) + 1); if (!where.has(k)) where.set(k, f); };
  const visit = (n) => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) { if (RE.test(n.text)) { out.ident++; add(idents, n.text); } }
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (RE.test(n.text)) { out.string++; add(strings, n.text); } }
    else if (n.kind === ts.SyntaxKind.TemplateHead || n.kind === ts.SyntaxKind.TemplateMiddle || n.kind === ts.SyntaxKind.TemplateTail) { if (RE.test(n.text)) { out.template++; add(strings, "`" + n.text.trim().slice(0, 140) + "`"); } }
    else if (ts.isJsxText(n)) { if (RE.test(n.text)) { out.jsx++; add(jsx, n.text.trim().replace(/\s+/g, " ").slice(0, 140)); } }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // comments: what is left of the matches once code tokens are taken away (rough: count matches in comment ranges)
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, f.endsWith("x") ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  let t; while ((t = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) { if (t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia) { const m = scanner.getTokenText().match(/factor(y|ies)/gi); if (m) out.comment += m.length; } }
}
fs.writeFileSync("/home/claude/review-tools/rename/strings.json", JSON.stringify([...strings].sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ s, n, f: where.get(s) })), null, 0));
fs.writeFileSync("/home/claude/review-tools/rename/jsx.json", JSON.stringify([...jsx].map(([s, n]) => ({ s, n, f: where.get(s) })), null, 0));
fs.writeFileSync("/home/claude/review-tools/rename/idents.json", JSON.stringify([...idents].sort((a, b) => b[1] - a[1]), null, 0));
console.log(JSON.stringify(out), "distinct strings", strings.size, "distinct names", idents.size, "distinct JSX texts", jsx.size);
