// CI's check job, after the tests ran with COVERAGE=1: one table of how much of each package's src/ the tests
// run, for the job's summary page. Each package's floor is in its vitest config; this only reports.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const rows = [];
for (const group of ["apps", "packages"]) {
  for (const name of fs.readdirSync(path.join(root, group)).sort()) {
    const file = path.join(root, group, name, "coverage", "coverage-summary.json");
    if (!fs.existsSync(file)) continue;
    const total = JSON.parse(fs.readFileSync(file, "utf8")).total;
    const pct = (k) => `${total[k].pct.toFixed(1)}%`;
    rows.push(`| ${group}/${name} | ${pct("lines")} | ${pct("statements")} | ${pct("functions")} | ${pct("branches")} |`);
  }
}
console.log("### Test coverage\n");
if (!rows.length) console.log("No coverage was written (the tests did not run with COVERAGE=1).");
else {
  console.log("| Package | Lines | Statements | Functions | Branches |\n|---|---:|---:|---:|---:|");
  console.log(rows.join("\n"));
  console.log("\nThe web app's pages are checked in a browser (the browser job), not counted here.");
}
