#!/usr/bin/env node
// factory → supplier in code. Run from the repository root:  node rename.cjs [--write] [--report file]
//
// Renamed: every identifier (so properties and JSON fields too), compound names inside strings (factoryId),
// addresses and keys listed in STRINGS, module paths, file names, comments. Prisma models, fields and the enum
// type are renamed with the database names kept (@map / @@map).
// Kept: snake_case names (database names and stored values), the bare word inside strings unless STRINGS says
// otherwise, prose about a real factory (PROTECT), NEVER, old migrations, generated code, docs, the phone app.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const root = process.cwd();
const ts = require(path.join(root, "node_modules/typescript"));
const WRITE = process.argv.includes("--write");
const reportAt = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : null;
const decisions = require("./strings-decisions.cjs");

const NEVER = new Set(["NestFactory", "useFactory", "splashFactory", "factoryname", "factoryaddress"]);
/** Prose about a real factory: the place, the trade term, the test done there. */
const PROTECT = [
  /factory[- ]acceptance[- ]tests?/gi,
  /factory[- ]tests?/gi,
  /FAT at the factory/gi,
  /EXW factory/gi,
  /ex[- ]factory/gi,
  /at (?:their|the|a) factory/gi,
  /factory visits?/gi,
  /visits? to the factory/gi,
  /(?:from|to) the (?:film )?factory/gi,
  /film factory/gi,
  /factory[- ]borne/gi,
  /\b[A-Z][a-z]+ (?:[A-Z][a-z]+ )*Factory\b(?! (?:test|Test))/g, // a company's name: "Jinan Filling Factory"
];
const WORD = /[A-Za-z0-9_$]*(?:factory|Factory|FACTORY|factories|Factories|FACTORIES)[A-Za-z0-9_$]*/g;
const HAS = /factor(?:y|ies)/i;
const ren = (s) =>
  s
    .replace(/FACTORIES/g, "SUPPLIERS")
    .replace(/FACTORY/g, "SUPPLIER")
    .replace(/Factories/g, "Suppliers")
    .replace(/Factory/g, "Supplier")
    .replace(/factories/g, "suppliers")
    .replace(/factory/g, "supplier");
const isBare = (w) => /^(factory|factories|Factory|Factories|FACTORY|FACTORIES)$/.test(w);
/** A database name or a stored value: lower snake_case. Prisma's compound key names are code. */
const isSnake = (w) => w.includes("_") && !/^[A-Z0-9_$]+$/.test(w) && !/^[a-z][A-Za-z0-9]*Id_[a-z][A-Za-z0-9]*$/.test(w) && !/^_+[A-Za-z0-9$]+$/.test(w);
const renIdent = (w) => (NEVER.has(w) || isSnake(w) ? w : ren(w));

/** Text with the protected phrases hidden from `fn`, then put back. */
function shielded(text, fn) {
  const kept = [];
  let t = text;
  for (const re of PROTECT) t = t.replace(re, (m) => (HAS.test(m) ? `\u0001${kept.push(m) - 1}\u0002` : m));
  t = fn(t);
  return t.replace(/\u0001(\d+)\u0002/g, (_, i) => kept[Number(i)]);
}
/** Prose (comments, docs): every form of the word, but not snake_case names, NEVER, or the protected phrases. */
const prose = (text) => shielded(text, (t) => t.replace(WORD, (w) => renIdent(w)));
/** Inside a string: compound names only (factoryId, FactoryQuoteView, FACTORY_FIELDS); the bare word stays. */
const compound = (text) => shielded(text, (t) => t.replace(WORD, (w) => (isBare(w) || NEVER.has(w) || isSnake(w) ? w : ren(w))));

const report = { files: 0, identifiers: 0, strings: 0, comments: 0, moved: [], names: {}, undecided: {}, kept: {} };
const note = (bag, key, file) => {
  bag[key] = bag[key] || { n: 0, f: file };
  bag[key].n++;
};

function stringText(original, file) {
  if (!HAS.test(original)) return original;
  if (Object.prototype.hasOwnProperty.call(decisions.EXACT, original)) return decisions.EXACT[original];
  let t = compound(original);
  for (const [re, to] of decisions.PATTERNS) t = t.replace(re, to);
  if (HAS.test(t.replace(/[A-Za-z0-9_$]*factor(?:y|ies)[A-Za-z0-9_$]*/gi, (w) => (isSnake(w) || NEVER.has(w) ? "" : w)))) {
    const sqlish = /\b(select|from|join|where|insert into|update|group by)\b/i.test(t);
    const proseish = /\s/.test(t.trim()) && !sqlish;
    if (!proseish && !decisions.KEEP.has(original) && !decisions.KEEP_RE.some((re) => re.test(original))) note(report.undecided, original, file);
    else note(report.kept, original.slice(0, 90), file);
  }
  return t;
}

function tsEdits(file, text) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.(mjs|cjs|js)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  // Names another library gave (lucide's Factory icon): theirs, kept in this file.
  const foreign = new Set();
  const foreignNodes = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (/^(\.|@\/|@kebo\/)/.test(st.moduleSpecifier.text)) continue;
    const c = st.importClause;
    if (!c) continue;
    if (c.name && HAS.test(c.name.text)) foreign.add(c.name.text);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings))
      for (const e of c.namedBindings.elements) {
        if (e.propertyName) foreignNodes.add(e.propertyName); // { Factory as FactoryIcon }: their name stays, ours is ours
        else if (HAS.test(e.name.text)) foreign.add(e.name.text);
      }
  }
  const moduleSpec = (n) => {
    const p = n.parent;
    if (!p) return false;
    if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n) return true;
    if (ts.isExternalModuleReference(p)) return true;
    if (ts.isLiteralTypeNode(p) && p.parent && ts.isImportTypeNode(p.parent)) return true;
    if (ts.isCallExpression(p) && p.arguments[0] === n) {
      const c = p.expression.getText(sf);
      return p.expression.kind === ts.SyntaxKind.ImportKeyword || /^(require|vi\.(mock|doMock|unmock|importActual|importMock)|jest\.mock)$/.test(c);
    }
    return false;
  };
  /** "property": the identifier names a member; "shorthand": it is a member and a local name at once; else "name". */
  const propertyRole = (n) => {
    const p = n.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === n) return "property";
    if (ts.isQualifiedName(p) && p.right === n) return "property";
    if (ts.isShorthandPropertyAssignment(p) && p.name === n) return "shorthand";
    if (ts.isBindingElement(p)) {
      if (p.propertyName === n) return "property";
      if (p.name === n && !p.propertyName && ts.isObjectBindingPattern(p.parent) && !p.dotDotDotToken) return "shorthand";
      return "name";
    }
    if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodSignature(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p) || ts.isJsxAttribute(p)) && p.name === n) return "property";
    if (ts.isParameter(p) && p.name === n && ts.isConstructorDeclaration(p.parent) && (ts.getCombinedModifierFlags(p) & (ts.ModifierFlags.Public | ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Readonly))) return "property";
    return "name";
  };
  const visit = (n) => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
      const w = n.text;
      if (HAS.test(w)) {
        const to = foreign.has(w) || foreignNodes.has(n) ? w : renIdent(w);
        const start = n.getStart(sf);
        // An identifier written with escapes would not match its text; there are none, but do not guess.
        if (to !== w && text.slice(start, start + w.length) === w) {
          // The bare word as a property (a field, or a key of a table looked up by a stored value) waits for the
          // step that tells the two apart. As a local name it is renamed, and a shorthand keeps its key.
          const role = isBare(w) ? propertyRole(n) : "name";
          if (role === "name") {
            edits.push([start, start + w.length, to]);
            report.identifiers++;
            report.names[w] = to;
          } else if (role === "shorthand") {
            edits.push([start, start + w.length, `${w}: ${to}`]);
            report.identifiers++;
            report.shorthand = (report.shorthand || 0) + 1;
          } else report.bareProps = (report.bareProps || 0) + 1;
        }
      }
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (HAS.test(n.text)) {
        const start = n.getStart(sf) + 1, end = n.getEnd() - 1;
        const raw = text.slice(start, end);
        const to = moduleSpec(n) && /^(\.|@\/|\.\.)/.test(raw) ? ren(raw) : stringText(raw, file);
        if (to !== raw) edits.push([start, end, to]), report.strings++;
      }
    } else if (n.kind === ts.SyntaxKind.TemplateHead || n.kind === ts.SyntaxKind.TemplateMiddle || n.kind === ts.SyntaxKind.TemplateTail) {
      if (HAS.test(n.text)) {
        const s = n.getStart(sf) + 1; // after ` or }
        const e = n.getEnd() - (n.kind === ts.SyntaxKind.TemplateTail ? 1 : 2); // before ` or ${
        const raw = text.slice(s, e);
        const to = stringText(raw, file);
        if (to !== raw) edits.push([s, e, to]), report.strings++;
      }
    } else if (ts.isJsxText(n)) {
      if (HAS.test(n.text)) note(report.kept, "JSX: " + n.text.trim().slice(0, 80), file);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // Comments
  const seen = new Set();
  const comment = (pos, end) => {
    if (seen.has(pos)) return;
    seen.add(pos);
    const raw = text.slice(pos, end);
    if (!HAS.test(raw)) return;
    const to = prose(raw);
    if (to !== raw) edits.push([pos, end, to]), report.comments++;
  };
  const trivia = (n) => {
    for (const r of ts.getLeadingCommentRanges(text, n.getFullStart()) || []) comment(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(text, n.getEnd()) || []) comment(r.pos, r.end);
    ts.forEachChild(n, trivia);
  };
  trivia(sf);
  for (const r of ts.getLeadingCommentRanges(text, sf.endOfFileToken.getFullStart()) || []) comment(r.pos, r.end);
  // JSX comments {/* … */} and comments before closing tokens are trivia of tokens: sweep every token's leading trivia.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, kind === ts.ScriptKind.TSX ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  // (The scanner cannot rescan JSX and templates on its own; it is used only as a second net over plain files.)
  if (kind !== ts.ScriptKind.TSX && !/`/.test(text)) {
    let t;
    while ((t = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) if (t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia) comment(scanner.getTokenPos(), scanner.getTextPos());
  }
  return edits;
}

function apply(text, edits) {
  edits.sort((a, b) => a[0] - b[0]);
  let out = "", at = 0;
  for (const [s, e, to] of edits) {
    if (s < at) continue; // nested (a string inside a comment range cannot happen; a guard all the same)
    out += text.slice(at, s) + to;
    at = e;
  }
  return out + text.slice(at);
}

/** schema.prisma: names renamed, database names kept. */
function prismaText(text) {
  const out = [];
  let model = null, isEnum = false, mapped = false, renamedBlock = false, oldName = null;
  for (const line of text.split("\n")) {
    const open = line.match(/^(model|enum)\s+(\w+)\s*\{/);
    if (open) {
      model = open[2];
      isEnum = open[1] === "enum";
      mapped = false;
      oldName = model;
      renamedBlock = HAS.test(model);
      out.push(line.replace(model, ren(model)));
      continue;
    }
    if (model && /^\}/.test(line)) {
      // A renamed enum type keeps its name in the database; a renamed model must already say its table.
      if (renamedBlock && !mapped) {
        if (isEnum) out.push(`\n  @@map("${oldName}")`);
        else throw new Error(`model ${oldName} has no @@map: its table would be renamed`);
      }
      model = null;
      out.push(line);
      continue;
    }
    if (!model) {
      out.push(/^\s*\/\//.test(line) ? prose(line) : line);
      continue;
    }
    if (/@@map\(/.test(line)) mapped = true;
    if (/^\s*\/\//.test(line)) {
      out.push(prose(line));
      continue;
    }
    if (isEnum) {
      out.push(line.replace(/\/\/.*$/, (c) => prose(c))); // values are stored: kept
      continue;
    }
    // A field or an @@ line. Split off a trailing comment.
    const cut = line.search(/\s\/\/\/?\s/);
    const code = cut >= 0 ? line.slice(0, cut) : line;
    const tail = cut >= 0 ? prose(line.slice(cut)) : "";
    const field = code.match(/^(\s*)(\w+)(\s+)(\w+)(\[\]|\?)?(.*)$/);
    if (field && !/^\s*@@/.test(code)) {
      const [, ind, name, sp, type, mod = "", rest] = field;
      const scalar = !/@relation\(/.test(rest) && !/^[A-Z]/.test(type) ? true : /^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)$/.test(type);
      const isRelationField = /^[A-Z]/.test(type) && !/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)$/.test(type) && !enumNames.has(type);
      const newName = HAS.test(name) && !isBare(name) ? ren(name) : name;
      if (newName !== name && !isRelationField && !/@map\(/.test(rest)) throw new Error(`${model}.${name} has no @map: its column would be renamed`);
      void scalar;
      // In the attributes: field lists and relation names are code; @map("…") and map: "…" are database names.
      const attrs = rest.replace(/@map\("[^"]*"\)|map:\s*"[^"]*"/g, (m) => `\u0003${Buffer.from(m).toString("base64")}\u0004`).replace(WORD, (w) => (isSnake(w) ? w : ren(w))).replace(/\u0003([^\u0004]*)\u0004/g, (_, b) => Buffer.from(b, "base64").toString());
      out.push(`${ind}${newName}${sp}${HAS.test(type) ? ren(type) : type}${mod}${attrs}${tail}`);
      continue;
    }
    // @@unique([orderId, factoryId]), @@index([...], map: "…"), @@map("…")
    out.push(code.replace(/@@map\("[^"]*"\)|map:\s*"[^"]*"/g, (m) => `\u0003${Buffer.from(m).toString("base64")}\u0004`).replace(WORD, (w) => (isSnake(w) ? w : ren(w))).replace(/\u0003([^\u0004]*)\u0004/g, (_, b) => Buffer.from(b, "base64").toString()) + tail);
  }
  return out.join("\n");
}
let enumNames = new Set();

const SKIP = /(^|\/)(migrations|generated|node_modules|\.next|dist)\/|^docs\/|^apps\/phone\/|pnpm-lock\.yaml$|CHANGELOG\.md$|^deploy\//;
/** Web routes are addresses: their folders move only where STRINGS decided the address moves. */
const ROUTE_DIRS = decisions.ROUTE_DIRS;
const tracked = cp.execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && !SKIP.test(f));

for (const file of tracked) {
  const abs = path.join(root, file);
  if (!/\.(ts|tsx|mjs|cjs|js|prisma|json)$/.test(file)) continue;
  const text = fs.readFileSync(abs, "utf8");
  if (!HAS.test(text)) continue;
  let next = text;
  if (/\.prisma$/.test(file)) {
    enumNames = new Set([...text.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]));
    next = prismaText(text);
  } else if (/\.json$/.test(file)) {
    next = decisions.json(file, text, { ren, compound });
  } else next = apply(text, tsEdits(file, text));
  if (next !== text) {
    report.files++;
    if (WRITE) fs.writeFileSync(abs, next);
  }
}

// File names (not route folders, which are addresses).
for (const file of tracked) {
  const rel = file.split("/");
  const to = rel
    .map((seg, i) => {
      const dir = rel.slice(0, i + 1).join("/");
      if (!HAS.test(seg)) return seg;
      if (/^apps\/web\/src\/app\//.test(dir + "/") && i < rel.length - 1) return ROUTE_DIRS[dir] ? path.basename(ROUTE_DIRS[dir]) : seg; // a route folder
      return ren(seg);
    })
    .join("/");
  if (to !== file) {
    report.moved.push([file, to]);
    if (WRITE) {
      if (fs.existsSync(path.join(root, to))) throw new Error(`cannot move ${file}: ${to} exists`);
      fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
      cp.execFileSync("git", ["mv", file, to], { cwd: root });
    }
  }
}

if (reportAt) fs.writeFileSync(reportAt, JSON.stringify(report, null, 1));
const und = Object.keys(report.undecided);
console.log(`${WRITE ? "written" : "dry run"}: files ${report.files}, identifiers ${report.identifiers} (shorthand kept ${report.shorthand || 0}; bare properties left ${report.bareProps || 0}), strings ${report.strings}, comments ${report.comments}, moved ${report.moved.length}, distinct names ${Object.keys(report.names).length}, strings kept ${Object.keys(report.kept).length}, UNDECIDED strings ${und.length}`);
