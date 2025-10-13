import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

const dbPath = resolve(process.cwd(), process.env.SOURCE_DB_PATH || "./data/sources.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  embedding_provider TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  last_triggered_at TEXT,
  ingest_status TEXT,
  ingest_error TEXT,
  last_ingest_at TEXT
);

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  allow_keywords TEXT,
  deny_keywords TEXT,
  context_limit INTEGER
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS ingest_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  status TEXT DEFAULT 'triggered',
  detail TEXT
);
`);

const sourceColumns = db.prepare("PRAGMA table_info(sources)").all() as { name: string }[];
const ensureSourceColumn = (name: string, ddl: string) => {
  if (!sourceColumns.some((col) => col.name === name)) {
    db.exec(ddl);
  }
};

ensureSourceColumn("ingest_status", "ALTER TABLE sources ADD COLUMN ingest_status TEXT");
ensureSourceColumn("ingest_error", "ALTER TABLE sources ADD COLUMN ingest_error TEXT");
ensureSourceColumn("last_ingest_at", "ALTER TABLE sources ADD COLUMN last_ingest_at TEXT");

const historyColumns = db.prepare("PRAGMA table_info(ingest_history)").all() as { name: string }[];
if (!historyColumns.some((col) => col.name === "detail")) {
  db.exec("ALTER TABLE ingest_history ADD COLUMN detail TEXT");
}

export function serializeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return null;
  return JSON.stringify(metadata);
}

export function deserializeMetadata(raw: string | null) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return undefined;
  }
}
