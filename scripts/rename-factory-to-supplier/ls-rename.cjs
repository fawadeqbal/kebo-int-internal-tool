// Rename a property declaration with the TypeScript language service (every place linked to it by type, as an
// editor's "Rename symbol"), within one project. Usage:
//   node ls-rename.cjs <project dir> <file>:<line>:<name>=<new> … [--write]
// Locals keep their names: a shorthand { factory } becomes { supplier: factory }.
const ts = require("/tmp/stepb/node_modules/typescript");
const fs = require("fs");
const path = require("path");
const dir = path.resolve(process.argv[2]);
const write = process.argv.includes("--write");
const asks = process.argv.slice(3).filter((a) => !a.startsWith("--"));

const cfgPath = path.join(dir, "tsconfig.json");
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, dir);
const files = new Map(cfg.fileNames.map((f) => [path.resolve(f), { v: 0, text: fs.readFileSync(f, "utf8") }]));
const host = {
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (f) => String(files.get(path.resolve(f))?.v ?? 0),
  getScriptSnapshot: (f) => {
    const own = files.get(path.resolve(f));
    const text = own ? own.text : fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined;
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getCurrentDirectory: () => dir,
  getCompilationSettings: () => cfg.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
const edits = new Map();
for (const ask of asks) {
  const m = /^(.+):(\d+):(\w+)=(\w+)$/.exec(ask);
  if (!m) throw new Error(`bad ask ${ask}`);
  const file = path.resolve(dir, m[1]);
  const text = files.get(file)?.text ?? fs.readFileSync(file, "utf8");
  const lineStart = text.split("\n").slice(0, Number(m[2]) - 1).join("\n").length + (Number(m[2]) > 1 ? 1 : 0);
  const lineText = text.split("\n")[Number(m[2]) - 1];
  const col = new RegExp(`\\b${m[3]}\\b`).exec(lineText);
  if (!col) throw new Error(`${m[3]} not on ${ask}`);
  const locs = ls.findRenameLocations(file, lineStart + col.index, false, false, { providePrefixAndSuffixTextForRename: true }) || [];
  let n = 0;
  for (const l of locs) {
    if (/node_modules|\/generated\/|\/dist\//.test(l.fileName)) continue;
    const list = edits.get(l.fileName) || [];
    list.push({ start: l.textSpan.start, end: l.textSpan.start + l.textSpan.length, text: `${l.prefixText || ""}${m[4]}${l.suffixText || ""}` });
    edits.set(l.fileName, list);
    n++;
  }
  console.log(`${ask}: ${n} places`);
}
let total = 0;
for (const [file, list] of edits) {
  let text = fs.readFileSync(file, "utf8");
  const uniq = [...new Map(list.map((e) => [e.start, e])).values()].sort((a, b) => b.start - a.start);
  for (const e of uniq) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  total += uniq.length;
  console.log(`  ${path.relative(dir, file)}: ${uniq.length}`);
  if (write) fs.writeFileSync(file, text);
}
console.log(`${total} edits${write ? "" : " (dry run)"}`);
