# PR H · Phone + accessibility pass, every page checked

Spec: docs/superpowers/specs/2026-11-03-design-system.md (ten principles). Boards: canvas page 29
(/home/claude/preview/DS29*.png), page 28 for Insights. Built after #95 #97 #99 #98 #100 (and #G when it
merges: Home / Reports — merge main and include them).

1. One automated check over EVERY page (list of routes from apps/web/src/app, with seeded ids): at 1440,
   1100 and 390 px — axe (0 violations), no sideways page scroll at 390, at most one primary button
   visible, every interactive element reachable by Tab with a visible focus ring, dialogs/panels trap
   focus and close on Esc. Put it in apps/web/test/a11y/all-pages.mjs and wire a CI job that runs it
   against a seeded build (the existing CI workflow; keep total CI time reasonable — run on the web app
   started with the API on a fresh seeded DB, as the CI already does for tests if it does; otherwise a
   separate job).
2. Fix everything it finds, page by page (commit per page group). Typical: missing labels, contrast,
   heading order, tables without headers, icon buttons without names, phone overflow, focus traps.
3. Also check against the principles by eye with screenshots: one primary, actions in the right places,
   status = word + colour, empty states with one action, read-only "from X →" links for facts that live
   elsewhere. Fix small deviations; list bigger ones in the PR body as follow-ups.
4. Contact sheet: a screenshot of every page at 1440 and 390 into /home/claude/shots/dsH/ (name =
   route), plus an index.html that shows them in a grid.
