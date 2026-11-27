// Decisions about text strings that hold the bare word.
// Step R1a (names in code): every address and every value stays as it is. They move in R1b (addresses) and R3 (stored values).
module.exports = {
  // Stored values: alerts in the database carry these kinds.
  EXACT: { "reminder.factoryLate": "reminder.factoryLate", "reminder.factoryDue": "reminder.factoryDue" },
  PATTERNS: [],
  KEEP: new Set(),
  KEEP_RE: [/[\s\S]/],
  ROUTE_DIRS: {},
  /** Lists of file paths follow the files. Route keys (page costs) are addresses: kept. */
  json: (file, text, { ren }) => (/guards\.known\.json$|size\.known\.json$/.test(file) ? text.replace(/"((?:[\w.()[\]-]+\/)+[\w.-]*factor(?:y|ies)[\w.-]*\.tsx?)"/gi, (m, p) => `"${ren(p)}"`) : text),
};
