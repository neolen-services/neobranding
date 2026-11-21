import { app } from "electron";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyBrandKit, type BrandKit } from "@shared/brand";

// One SQLite file in the user's app-data folder. Uses the SQLite built into
// Electron's Node runtime, so there is no native module to compile.
let db: DatabaseSync | undefined;

function open(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(join(app.getPath("userData"), "personal-brand.db"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS brand (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        data       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
  return db;
}

/** Returns the saved brand kit, or null if onboarding has not been completed. */
export function getBrand(): BrandKit | null {
  const row = open().prepare("SELECT data FROM brand WHERE id = 1").get() as
    | { data: string }
    | undefined;
  return row ? { ...emptyBrandKit(), ...JSON.parse(row.data) } : null;
}

export function saveBrand(kit: BrandKit): void {
  open()
    .prepare(
      `INSERT INTO brand (id, data) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    )
    .run(JSON.stringify(kit));
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}
