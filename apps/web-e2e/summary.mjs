// The browser checks for the CI job's summary page: how many passed, what failed or was skipped, and the slowest
// page loads. Reads Playwright's JSON report (test-results/results.json); prints Markdown.
import fs from "node:fs";
import path from "node:path";

const file = path.join(import.meta.dirname, "test-results", "results.json");
if (!fs.existsSync(file)) {
  console.log("### Browser checks\n\nNo report: the checks did not run (see the job's log).");
  process.exit(0);
}
const report = JSON.parse(fs.readFileSync(file, "utf8"));

/** Every test with its full name ("laptop 1280px › /orders/[id]"). */
const tests = [];
const walk = (suite, names) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) tests.push({ name: [...names, spec.title].join(" › "), project: t.projectName, test: t });
  }
  for (const child of suite.suites ?? []) walk(child, [...names, child.title]);
};
for (const s of report.suites ?? []) walk(s, []);

const by = (status) => tests.filter((t) => t.test.status === status);
const failed = by("unexpected");
const flaky = by("flaky");
const skipped = by("skipped");
const notes = (t) => [...(t.test.annotations ?? []), ...(t.test.results ?? []).flatMap((r) => r.annotations ?? [])];
const seconds = Math.round((report.stats?.duration ?? 0) / 1000);

const out = ["### Browser checks", ""];
out.push(
  `${tests.length} checks in ${Math.floor(seconds / 60)} min ${seconds % 60} s: ${by("expected").length} passed, ${failed.length} failed, ${flaky.length} passed only on a second try, ${skipped.length} skipped.`,
);
if (failed.length) out.push("", "**Failed**", "", ...failed.map((t) => `- ${t.project}: ${t.name}`));
if (flaky.length) out.push("", "**Passed only on a second try** (look at these)", "", ...flaky.map((t) => `- ${t.project}: ${t.name}`));
if (skipped.length) {
  out.push("", "**Skipped**", "");
  for (const t of skipped)
    out.push(
      `- ${t.name}${notes(t).find((a) => a.type === "skip")?.description ? `: ${notes(t).find((a) => a.type === "skip").description}` : ""}`,
    );
}
const loads = tests
  .map((t) => ({
    name: t.name,
    ms: Number(
      notes(t)
        .find((a) => a.type === "load")
        ?.description?.replace(/\D/g, ""),
    ),
  }))
  .filter((l) => Number.isFinite(l.ms) && l.ms > 0)
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 8);
if (loads.length) {
  out.push("", "**Slowest page loads** (a shared CI machine: compare runs, not single numbers)", "", "| Page | Load |", "|---|---:|");
  for (const l of loads) out.push(`| ${l.name} | ${(l.ms / 1000).toFixed(1)} s |`);
}
console.log(out.join("\n"));
