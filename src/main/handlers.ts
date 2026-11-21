// Everything the UI can ask the app to do, as one table of named handlers.
// Plain Node code with relative imports only. The desktop app exposes these
// over IPC; the dev server exposes the same table over HTTP for the browser.
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseBrandKit, type SaveResult } from "../shared/brand";
import type { DataFolderInfo, DataFolderResult } from "../shared/data";
import { checkIsDue, parseIdea, type GenerateOptions, type IdeaResult, type ScriptResult } from "../shared/ideas";
import type { ResearchEdit } from "../shared/research";
import { isApiProvider, type ApiProvider } from "../shared/settings";
import { generateIdeas } from "./generate";
import { adoptLegacyData, copyData, DB_FILE, defaultDataDir, readDataDir, writeDataDir } from "./location";
import {
  addResearch,
  analyzeResearch,
  deleteResearch,
  fetchPostNumbers,
  listResearch,
  refreshResearchAudio,
  setToolsDir,
  transcribeResearch,
  updateResearch,
} from "./research";
import { writeScript } from "./script";
import { openStore, type Secrets, type Store } from "./store";
import { startTelegram, telegramStatus, unlinkTelegram } from "./telegram";

export type HandlerOptions = {
  /** Where downloaded tools (yt-dlp, FFmpeg) are kept. Not user data, so outside the data folder. */
  toolsDir: string;
  secrets: Secrets;
  /** Places earlier versions kept data; their contents are moved into the data folder once. */
  legacyDirs: string[];
  /** Shows a folder in the system's file manager. */
  openFolder: (path: string) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<string, (...args: any[]) => unknown>;

export function createHandlers(options: HandlerOptions) {
  let dataDir = readDataDir();
  let store: Store | null = null;

  setToolsDir(options.toolsDir);
  for (const legacy of options.legacyDirs) adoptLegacyData(legacy, dataDir);

  const db = () => (store ??= openStore(dataDir, options.secrets));
  const key = (provider: ApiProvider) => db().getApiKey(provider);
  const connectTelegram = () => startTelegram(dataDir, key("telegram"), () => key("deepgram"));

  const findIdea = (id: unknown) =>
    db()
      .listIdeas()
      .find((i) => i.id === String(id));

  async function checkIdea(id: string): Promise<IdeaResult> {
    const idea = findIdea(id);
    if (!idea?.posted) return { ok: false, error: "This idea has no published video linked." };
    const numbers = await fetchPostNumbers(dataDir, idea.posted.url);
    if (!numbers.ok) return numbers;
    // Read the idea again: it may have been edited while the numbers were being fetched.
    const current = findIdea(id);
    if (!current?.posted || current.posted.url !== idea.posted.url) return { ok: false, error: "The link was changed." };
    const { likes, comments, views } = numbers;
    const saved = parseIdea({
      ...current,
      posted: {
        ...current.posted,
        checks: [...current.posted.checks, { at: new Date().toISOString(), likes, comments, views }],
      },
    });
    db().saveIdea(saved);
    return { ok: true, idea: saved };
  }

  /** Re-reads the numbers of every published video whose next check is due, one at a time. */
  let checking = false;
  async function checkDuePosts(): Promise<void> {
    if (checking) return;
    checking = true;
    try {
      const due = db()
        .listIdeas()
        .filter((i) => i.posted && checkIsDue(i.posted));
      for (const idea of due) await checkIdea(idea.id).catch(() => undefined);
    } catch {
      // Try again at the next tick.
    } finally {
      checking = false;
    }
  }
  let checkTimer: ReturnType<typeof setInterval> | undefined;

  const dataInfo = (): DataFolderInfo => ({
    path: dataDir,
    defaultPath: defaultDataDir(),
    isDefault: resolve(dataDir) === resolve(defaultDataDir()),
  });

  const handlers: Handlers = {
    "brand:get": () => db().getBrand(),
    "brand:save": (input: unknown): SaveResult => {
      try {
        const brand = parseBrandKit(input);
        db().saveBrand(brand);
        return { ok: true, brand };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Could not save the brand." };
      }
    },

    "ideas:list": () => db().listIdeas(),
    "ideas:save": (input: unknown) => {
      const idea = parseIdea(input);
      db().saveIdea(idea);
      return idea;
    },
    "ideas:delete": (id: unknown) => db().deleteIdea(String(id)),
    "ideas:generate": async (generateOptions: GenerateOptions) => {
      const brand = db().getBrand();
      if (!brand) return { ok: false, error: "Create your brand first." };
      return generateIdeas(
        key("anthropic"),
        brand,
        await listResearch(dataDir),
        generateOptions,
        db().listIdeas(),
      );
    },

    /** Writes a timed script for a saved idea and stores it with the idea. */
    "ideas:script": async (id: unknown): Promise<ScriptResult> => {
      const brand = db().getBrand();
      if (!brand) return { ok: false, error: "Create your brand first." };
      const idea = findIdea(id);
      if (!idea) return { ok: false, error: "That idea no longer exists." };
      const model = idea.modelledOnId
        ? (await listResearch(dataDir)).find((p) => p.id === idea.modelledOnId && p.analysis)
        : undefined;
      const result = await writeScript(key("anthropic"), brand, idea, model);
      if (!result.ok) return result;
      const saved = parseIdea({
        ...idea,
        script: result.script,
        status: idea.status === "idea" ? "scripted" : idea.status,
      });
      db().saveIdea(saved);
      return { ok: true, idea: saved };
    },

    /**
     * Links the user's own published video to an idea and reads its numbers.
     * An empty link removes the video and its history from the idea.
     */
    "ideas:track": async (id: unknown, link: unknown): Promise<IdeaResult> => {
      const idea = findIdea(id);
      if (!idea) return { ok: false, error: "That idea no longer exists." };
      const url = String(link ?? "").trim();
      if (!url) {
        const saved = parseIdea({ ...idea, posted: undefined });
        db().saveIdea(saved);
        return { ok: true, idea: saved };
      }
      const numbers = await fetchPostNumbers(dataDir, url);
      if (!numbers.ok) return numbers;
      const now = new Date().toISOString();
      const { likes, comments, views } = numbers;
      const saved = parseIdea({
        ...idea,
        status: "posted",
        posted: { url, platform: numbers.platform, linkedAt: now, checks: [{ at: now, likes, comments, views }] },
      });
      db().saveIdea(saved);
      return { ok: true, idea: saved };
    },
    /** Reads the numbers of an idea's published video again and adds them to its history. */
    "ideas:check": (id: unknown): Promise<IdeaResult> => checkIdea(String(id)),

    "research:list": () => listResearch(dataDir),
    "research:add": (url: unknown) => addResearch(dataDir, String(url), key("deepgram")),
    "research:transcribe": (id: unknown) => transcribeResearch(dataDir, String(id), key("deepgram")),
    "research:analyze": (id: unknown) => analyzeResearch(dataDir, String(id), key("anthropic")),
    "research:audio": (id: unknown) => refreshResearchAudio(dataDir, String(id)),
    "research:update": (id: unknown, edit: ResearchEdit) => updateResearch(dataDir, String(id), edit ?? {}),
    "research:delete": (id: unknown) => deleteResearch(dataDir, String(id)),

    "telegram:status": () => telegramStatus(),
    "telegram:sync": () => connectTelegram(),
    "telegram:unlink": () => unlinkTelegram(dataDir),

    // A key itself never goes back to the UI, only whether one is saved.
    "settings:hasApiKey": (provider: unknown) => (isApiProvider(provider) ? key(provider) !== "" : false),
    "settings:setApiKey": (provider: unknown, value: unknown) => {
      try {
        if (!isApiProvider(provider)) throw new Error("Unknown service.");
        db().setApiKey(provider, typeof value === "string" ? value.trim() : "");
        // A new or removed bot token takes effect straight away.
        if (provider === "telegram") void connectTelegram();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Could not save the key." };
      }
    },

    "data:info": () => dataInfo(),
    "data:open": () => {
      mkdirSync(dataDir, { recursive: true });
      options.openFolder(dataDir);
    },
    /**
     * Switches to another folder. If that folder already holds app data (for
     * example one copied from another computer) it is used as it is; otherwise
     * the current data is copied into it. The old folder is left untouched.
     */
    "data:change": async (input: unknown): Promise<DataFolderResult> => {
      const typed = String(input ?? "").trim();
      if (!typed || !isAbsolute(typed)) {
        return { ok: false, error: "Enter the full path of a folder, for example D:\\Personal Brand." };
      }
      const target = resolve(typed);
      if (target === resolve(dataDir)) return { ok: true, info: dataInfo(), usedExisting: true };
      try {
        mkdirSync(target, { recursive: true });
      } catch {
        return { ok: false, error: "That folder could not be created. Check the path and that you can write there." };
      }

      const usedExisting = existsSync(join(target, DB_FILE));
      try {
        store?.close();
        store = null;
        if (!usedExisting) copyData(dataDir, target);
        writeDataDir(target);
        dataDir = target;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "The folder could not be used." };
      }
      // The Telegram link is stored in the folder, so the listener restarts on the new one.
      void connectTelegram();
      return { ok: true, info: dataInfo(), usedExisting };
    },
  };

  return {
    handlers,
    /** The folder in use right now (it can change while the app runs). */
    dataDir: () => dataDir,
    /** Starts background work: listening for Telegram links. */
    start: () => {
      void connectTelegram();
      // Shortly after opening, then every hour while the app stays open.
      setTimeout(() => void checkDuePosts(), 20_000).unref?.();
      checkTimer ??= setInterval(() => void checkDuePosts(), 60 * 60 * 1000);
      checkTimer.unref?.();
    },
    close: () => {
      clearInterval(checkTimer);
      checkTimer = undefined;
      store?.close();
      store = null;
    },
  };
}
