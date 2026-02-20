#!/usr/bin/env node

const Database = require("better-sqlite3");
const path = require("path");
const { runMigrations, rollbackMigration, getMigrationStatus } = require("../services/migrator");

require("dotenv").config();

const dbPath = process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "hackernews.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const command = process.argv[2] || "up";

switch (command) {
  case "up":
    runMigrations(db);
    console.log("All migrations applied.");
    break;
  case "rollback": {
    const result = rollbackMigration(db);
    if (!result) {
      console.log("No migrations to roll back.");
    }
    break;
  }
  case "status": {
    const status = getMigrationStatus(db);
    if (status.length === 0) {
      console.log("No migration files found.");
    } else {
      console.log("Migration Status:");
      for (const m of status) {
        const marker = m.status === "applied" ? "[x]" : "[ ]";
        const time = m.applied_at ? ` (${m.applied_at})` : "";
        console.log(`  ${marker} ${m.name}${time}`);
      }
    }
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage: node scripts/migrate.js [up|rollback|status]");
    process.exit(1);
}

db.close();
