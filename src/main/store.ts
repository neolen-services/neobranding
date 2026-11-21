// The SQLite database inside the data folder: brand, video ideas and saved keys.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
// Uses the SQLite built into Node, so there is no native module to compile.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyBrandKit, type BrandKit } from "../shared/brand";
import type { Idea } from "../shared/ideas";
import type { ApiProvider } from "../shared/settings";
import { DB_FILE } from "./location";

/**
 * How API keys are protected before they are written to the database.
 * `decrypt` returns "" for a value it cannot read, for example a key that was
 * encrypted on another computer.
 */
export type Secrets = { encrypt(plain: string): string; decrypt(stored: string): string };

export type Store = ReturnType<typeof openStore>;

export function openStore(dataDir: string, secrets: Secrets) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, DB_FILE));
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
    CREATE TABLE IF NOT EXISTS chats (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const settingName = (provider: ApiProvider) => `${provider}_api_key`;

  return {
    /** Returns the saved brand kit, or null if onboarding has not been completed. */
    getBrand(): BrandKit | null {
      const row = db.prepare("SELECT data FROM brand WHERE id = 1").get() as { data: string } | undefined;
      return row ? { ...emptyBrandKit(), ...JSON.parse(row.data) } : null;
    },

    saveBrand(kit: BrandKit): void {
      db.prepare(
        `INSERT INTO brand (id, data) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
      ).run(JSON.stringify(kit));
    },

    listIdeas(): Idea[] {
      const rows = db.prepare("SELECT data FROM ideas ORDER BY created_at DESC").all() as { data: string }[];
      return rows.map((r) => JSON.parse(r.data));
    },

    /** Inserts the idea, or replaces it if the id already exists. */
    saveIdea(idea: Idea): void {
      db.prepare(
        `INSERT INTO ideas (id, data, created_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      ).run(idea.id, JSON.stringify(idea), idea.createdAt);
    },

    deleteIdea(id: string): void {
      db.prepare("DELETE FROM ideas WHERE id = ?").run(id);
    },

    /** Agent chats, newest first. Each is stored whole, as the agent module defines it. */
    listChats<T>(): T[] {
      const rows = db.prepare("SELECT data FROM chats ORDER BY updated_at DESC").all() as { data: string }[];
      return rows.map((r) => JSON.parse(r.data));
    },

    getChat<T>(id: string): T | null {
      const row = db.prepare("SELECT data FROM chats WHERE id = ?").get(id) as { data: string } | undefined;
      return row ? JSON.parse(row.data) : null;
    },

    saveChat(id: string, updatedAt: string, chat: unknown): void {
      db.prepare(
        `INSERT INTO chats (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      ).run(id, JSON.stringify(chat), updatedAt);
    },

    deleteChat(id: string): void {
      db.prepare("DELETE FROM chats WHERE id = ?").run(id);
    },

    /** Pass an empty key to remove it. */
    setApiKey(provider: ApiProvider, key: string): void {
      if (!key) {
        db.prepare("DELETE FROM settings WHERE key = ?").run(settingName(provider));
        return;
      }
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ).run(settingName(provider), secrets.encrypt(key));
    },

    getApiKey(provider: ApiProvider): string {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(settingName(provider)) as
        | { value: string }
        | undefined;
      return row ? secrets.decrypt(row.value) : "";
    },

    close(): void {
      db.close();
    },
  };
}

/** Keys kept readable. Used by the browser dev server, which has no OS keychain. */
export const plainSecrets: Secrets = {
  encrypt: (plain) => `plain:${Buffer.from(plain, "utf8").toString("base64")}`,
  decrypt: (stored) => (stored.startsWith("plain:") ? Buffer.from(stored.slice(6), "base64").toString("utf8") : ""),
};
