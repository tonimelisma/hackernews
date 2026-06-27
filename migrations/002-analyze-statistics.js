// Generate SQLite query-planner statistics (sqlite_stat1).
//
// Without stats, the planner has no row-count estimates and defaults to scanning
// idx_stories_score top-to-bottom for every /stories query, filtering `time > ?`
// row by row. For selective windows that is pathological: the "Day" window has a
// few hundred matching rows scattered across 150k+ rows by score, so the planner
// claws through nearly the whole table to collect 500 matches. Measured on
// production (152k rows): "Day" ran at ~125ms median with a ~27s worst case, and
// since better-sqlite3 is synchronous that worst case freezes the entire process.
//
// With stats present the planner switches to idx_stories_time for the selective
// (Day/Week) windows — dropping "Day" to single-digit ms — while still using
// idx_stories_score for the broad (Month/Year/All) windows. Best of both indexes,
// chosen per query. Stats are refreshed each worker sync cycle (see worker.js) so
// they stay accurate as the table grows.
const up = (db) => {
  db.exec("ANALYZE");
};

const down = (db) => {
  db.exec("DROP TABLE IF EXISTS sqlite_stat1");
};

module.exports = { up, down };
