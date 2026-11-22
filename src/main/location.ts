// Where the user's data lives.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
//
// Everything the user creates is kept in ONE folder so it can be copied to
// another computer:
//   personal-brand.db   brand, video ideas and saved keys (SQLite)
//   research/           saved posts: videos, pictures, captions, transcripts, ratings, notes
//   audio/              audio made with ElevenLabs: voiceovers, sound effects, music
//   telegram.json       which Telegram chat is linked
//   videos/             pictures and clips made for scenes
//   cast/               characters' reference pictures
//   usage.jsonl         a log of what the app used on the user's services (tokens, cost)
//
// The folder defaults to Documents/Personal Brand. If the user picks another
// folder, its path is remembered in a small pointer file in their home folder.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DB_FILE = "personal-brand.db";
/** The files and folders that make up the user's data. */
export const DATA_ENTRIES = [DB_FILE, "research", "audio", "telegram.json", "usage.jsonl", "videos", "cast"];

const POINTER_FILE = join(homedir(), ".personal-brand.json");

export const defaultDataDir = () => join(homedir(), "Documents", "Personal Brand");

/**
 * For demos, screenshots and tests: run the app on another folder without
 * touching the user's real one, by setting this environment variable.
 */
const OVERRIDE = process.env.PERSONAL_BRAND_DATA_DIR?.trim();

export function readDataDir(): string {
  if (OVERRIDE) return resolve(OVERRIDE);
  try {
    const { dataDir } = JSON.parse(readFileSync(POINTER_FILE, "utf8"));
    if (typeof dataDir === "string" && dataDir) return dataDir;
  } catch {
    // No pointer file means the default folder.
  }
  return defaultDataDir();
}

export function writeDataDir(dataDir: string): void {
  // A demo run must never repoint the user's real app.
  if (OVERRIDE) return;
  writeFileSync(POINTER_FILE, JSON.stringify({ dataDir }, null, 2));
}

/**
 * Moves data from a place an earlier version of the app kept it into the data
 * folder. Nothing already in the data folder is overwritten.
 */
export function adoptLegacyData(from: string, dataDir: string): void {
  try {
    if (!existsSync(from) || resolve(from) === resolve(dataDir)) return;
    mkdirSync(dataDir, { recursive: true });

    for (const name of [DB_FILE, "telegram.json"]) {
      const source = join(from, name);
      if (existsSync(source) && !existsSync(join(dataDir, name))) {
        cpSync(source, join(dataDir, name));
        rmSync(source, { force: true });
      }
    }

    // Saved posts are merged one by one, so posts from two places can be combined.
    const posts = join(from, "research");
    if (existsSync(posts)) {
      mkdirSync(join(dataDir, "research"), { recursive: true });
      for (const id of readdirSync(posts)) {
        const target = join(dataDir, "research", id);
        if (existsSync(target)) continue;
        cpSync(join(posts, id), target, { recursive: true });
        rmSync(join(posts, id), { recursive: true, force: true });
      }
    }
  } catch {
    // Old data that cannot be moved is left where it is.
  }
}

/** Copies the user's data into another folder, leaving the original in place. */
export function copyData(from: string, to: string): void {
  for (const name of DATA_ENTRIES) {
    const source = join(from, name);
    if (existsSync(source)) cpSync(source, join(to, name), { recursive: true });
  }
}
