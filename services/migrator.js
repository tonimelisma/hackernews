const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

const ensureMigrationsTable = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
};

const loadMigrationFiles = () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.match(/^\d+-.*\.js$/))
    .sort();
  return files.map(f => {
    const version = parseInt(f.split("-")[0], 10);
    const migration = require(path.join(MIGRATIONS_DIR, f));
    return { version, name: f.replace(/\.js$/, ""), up: migration.up, down: migration.down };
  });
};

const runMigrations = (db) => {
  ensureMigrationsTable(db);
  const migrations = loadMigrationFiles();
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map(r => r.version)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
        ).run(migration.version, migration.name, new Date().toISOString());
      })();
      console.log(`Migration ${migration.name} applied`);
    }
  }
};

const rollbackMigration = (db) => {
  ensureMigrationsTable(db);
  const last = db.prepare(
    "SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1"
  ).get();
  if (!last) return null;

  const migrations = loadMigrationFiles();
  const migration = migrations.find(m => m.version === last.version);
  if (!migration) {
    throw new Error(`Migration file for version ${last.version} (${last.name}) not found`);
  }

  db.transaction(() => {
    migration.down(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(last.version);
  })();
  console.log(`Migration ${migration.name} rolled back`);
  return last;
};

const getMigrationStatus = (db) => {
  ensureMigrationsTable(db);
  const applied = new Map(
    db.prepare("SELECT version, applied_at FROM schema_migrations").all()
      .map(r => [r.version, r.applied_at])
  );
  const migrations = loadMigrationFiles();
  return migrations.map(m => ({
    version: m.version,
    name: m.name,
    status: applied.has(m.version) ? "applied" : "pending",
    applied_at: applied.get(m.version) || null,
  }));
};

module.exports = { runMigrations, rollbackMigration, getMigrationStatus, ensureMigrationsTable };
