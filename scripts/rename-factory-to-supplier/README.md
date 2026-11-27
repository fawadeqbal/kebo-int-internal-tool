# The tool that renamed "factory" to "supplier" in code (not part of the app; this branch is never merged)

Kept on this branch so the same rename can be applied to an open branch (PR #420 and any other), and so the
later steps can reuse it. Plan and progress: project doc `claude/supplier-rename-and-next-steps.md`.

- `rename.cjs`: run from the repository root. `node …/rename.cjs` is a dry run; `--write` changes the files and
  moves them (`git mv`); `--report file.json` writes what it did, with the old → new name dictionary.
  Then: `prisma format`, `prisma generate`, build, type check.
- `strings-decisions.cjs`: which strings that hold the bare word change, and which stay.
- `census.cjs`: where the word lives (names, strings, comments).
- `golden-compare.cjs before.json after.json report.json`: two recordings of every read endpoint, equal once the
  old names are read as the new ones? (Record with a copy of `apps/api/test/every-endpoint.test.ts` whose `ok()`
  writes every answer to a file.)
- `golden-contains.cjs before.json as-old-phone.json`: does an old phone app still get everything it got?
- `crawl-pages.mjs out.json`: the words of every kind of page, to compare two builds (run inside `apps/web-e2e`).

Step R1a (PR #434) used it as it is here.
