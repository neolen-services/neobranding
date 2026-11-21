import { app, safeStorage } from "electron";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyBrandKit, type BrandKit } from "@shared/brand";
import type { Idea } from "@shared/ideas";

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
      );
      CREATE TABLE IF NOT EXISTS ideas (
        id         TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
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

export function listIdeas(): Idea[] {
  const rows = open().prepare("SELECT data FROM ideas ORDER BY created_at DESC").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}

/** Inserts the idea, or replaces it if the id already exists. */
export function saveIdea(idea: Idea): void {
  open()
    .prepare(
      `INSERT INTO ideas (id, data, created_at) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
    )
    .run(idea.id, JSON.stringify(idea), idea.createdAt);
}

export function deleteIdea(id: string): void {
  open().prepare("DELETE FROM ideas WHERE id = ?").run(id);
}

// The Anthropic API key is encrypted with the operating system's keychain
// (DPAPI on Windows) before it is written to the database.
const API_KEY_SETTING = "anthropic_api_key";

export function setApiKey(key: string): void {
  const db = open();
  if (!key) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(API_KEY_SETTING);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("This computer cannot store the key securely.");
  }
  const encrypted = safeStorage.encryptString(key).toString("base64");
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(API_KEY_SETTING, encrypted);
}

export function getApiKey(): string {
  const row = open().prepare("SELECT value FROM settings WHERE key = ?").get(API_KEY_SETTING) as
    | { value: string }
    | undefined;
  if (!row) return "";
  try {
    return safeStorage.decryptString(Buffer.from(row.value, "base64"));
  } catch {
    return "";
  }
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}
