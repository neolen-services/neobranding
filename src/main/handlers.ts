// Everything the UI can ask the app to do, as one table of named handlers.
// Plain Node code with relative imports only. The desktop app exposes these
// over IPC; the dev server exposes the same table over HTTP for the browser.
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseBrandKit, type SaveResult } from "../shared/brand";
import type { DataFolderInfo, DataFolderResult } from "../shared/data";
import { randomUUID } from "node:crypto";
import { MAX_SUGGESTIONS, parseIdea, type GenerateOptions, type IdeaSuggestion } from "../shared/ideas";
import type { ResearchEdit } from "../shared/research";
import { isApiProvider, type ApiProvider } from "../shared/settings";
import {
  agentProgress,
  decideAgent,
  deleteAgentChat,
  getAgentChat,
  getAgentPermissions,
  listAgentChats,
  sendToAgent,
  setAgentPermissions,
  type AgentContext,
} from "./agent";
import { listAudio, listVoices, voicePreview } from "./audio";
import { generateIdeas } from "./generate";
import { adoptLegacyData, copyData, DB_FILE, defaultDataDir, readDataDir, writeDataDir } from "./location";
import {
  addResearch,
  analyzeResearch,
  deleteResearch,
  listResearch,
  refreshResearchAudio,
  setToolsDir,
  transcribeResearch,
  updateResearch,
} from "./research";
import { openStore, type Secrets, type Store } from "./store";
import { studioOps } from "./studioOps";
import type { NewSeries, NewVideo, SeriesStart } from "../shared/studio";
import type { UploadedFile } from "../shared/media";
import { startTelegram, telegramStatus, unlinkTelegram } from "./telegram";
import { readUsage, setUsageDir } from "./usage";

const SUGGESTIONS_SETTING = "idea_suggestions";

export type HandlerOptions = {
  /** Where downloaded tools (yt-dlp, FFmpeg) are kept. Not user data, so outside the data folder. */
  toolsDir: string;
  secrets: Secrets;
  /** Places earlier versions kept data; their contents are moved into the data folder once. */
  legacyDirs: string[];
  /** Shows a folder in the system's file manager. */
  openFolder: (path: string) => void;
  /**
   * False when another copy of the app on the same data folder is the one
   * reading the Telegram bot. Two readers would each save the same link.
   */
  listenToTelegram: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<string, (...args: any[]) => unknown>;

export function createHandlers(options: HandlerOptions) {
  let dataDir = readDataDir();
  let store: Store | null = null;

  setToolsDir(options.toolsDir);
  // The folder can change while the app runs, so the log asks for it each time.
  setUsageDir(() => dataDir);
  for (const legacy of options.legacyDirs) adoptLegacyData(legacy, dataDir);

  const db = () => (store ??= openStore(dataDir, options.secrets));
  const key = (provider: ApiProvider) => db().getApiKey(provider);
  const connectTelegram = async () =>
    options.listenToTelegram ? startTelegram(dataDir, key("telegram"), () => key("deepgram")) : telegramStatus();

  const agent: AgentContext = { dataDir: () => dataDir, store: db, key };

  const suggestions = (): IdeaSuggestion[] => {
    try {
      const saved: unknown = JSON.parse(db().getSetting(SUGGESTIONS_SETTING) || "[]");
      return Array.isArray(saved) ? saved.filter((s) => s && typeof s.key === "string" && typeof s.title === "string") : [];
    } catch {
      return [];
    }
  };
  const findIdea = (id: unknown) =>
    db()
      .listIdeas()
      .find((i) => i.id === String(id));

  const dataInfo = (): DataFolderInfo => ({
    path: dataDir,
    defaultPath: defaultDataDir(),
    isDefault: resolve(dataDir) === resolve(defaultDataDir()),
  });

  // The cast, series and videos. The agent uses the same operations.
  const studio = studioOps(agent);

  const handlers: Handlers = {
    "cast:list": () => studio.cast(),
    "cast:save": (input: unknown) => studio.saveCharacter(input),
    "cast:delete": (id: unknown) => studio.deleteCharacter(id),

    "series:list": () => studio.series(),
    "series:save": (input: unknown) => studio.saveSeries(input),
    "series:delete": (id: unknown) => studio.deleteSeries(id),
    "series:plan": (title: unknown, about: unknown, options?: NewSeries) => studio.plan(title, about, options),

    "series:create": (input: SeriesStart) => studio.createSeries(input),
    "series:planSeason": (id: unknown) => studio.planSeason(id),
    /** The idea step, for a video or a series: suggest ideas (or change one), and settle on one. */
    "studio:suggest": (kind: unknown, id: unknown, note: unknown, conceptId: unknown) => studio.suggest(kind, id, note, conceptId),
    "studio:approveIdea": (kind: unknown, id: unknown, conceptId: unknown) => studio.approveIdea(kind, id, conceptId),

    "videos:list": () => studio.videos(),
    "videos:create": (input: NewVideo) => studio.createVideo(input),
    "videos:save": (input: unknown) => studio.saveVideo(input),
    "videos:delete": (id: unknown) => studio.deleteVideo(id),
    "videos:write": (id: unknown, note: unknown) => studio.writeScript(id, note),
    "videos:approve": (id: unknown) => studio.approve(id),
    "videos:voices": (id: unknown) => studio.voices(id),
    "videos:results": (id: unknown, results: unknown) => studio.recordResults(id, results),
    // Pictures, clips and lip-sync. `choice` picks the service for this one request; without it the Settings default is used.
    "media:settings": () => studio.mediaSettings(),
    "media:setSettings": (input: unknown) => studio.setMediaSettings(input),
    "cast:picture": (id: unknown, choice: unknown) => studio.characterPicture(id, choice),
    "cast:addPicture": (id: unknown, file: UploadedFile) => studio.addCharacterPicture(id, file),
    "cast:changePicture": (id: unknown, takeId: unknown, action: unknown) => studio.changeCharacterPicture(id, takeId, action),
    "scene:picture": (videoId: unknown, sceneId: unknown, choice: unknown, note: unknown) => studio.scenePicture(videoId, sceneId, choice, note),
    "scene:clip": (videoId: unknown, sceneId: unknown, choice: unknown) => studio.sceneClip(videoId, sceneId, choice),
    "scene:lipsync": (videoId: unknown, sceneId: unknown, choice: unknown) => studio.sceneLipSync(videoId, sceneId, choice),
    "scene:addFile": (videoId: unknown, sceneId: unknown, file: UploadedFile) => studio.addSceneFile(videoId, sceneId, file),
    "scene:changeTake": (videoId: unknown, sceneId: unknown, takeId: unknown, action: unknown) => studio.changeTake(videoId, sceneId, takeId, action),

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
    /** Runs a round of ideas. What comes back is also kept as suggestions waiting for the creator, so leaving the page loses nothing. */
    "ideas:generate": async (generateOptions: GenerateOptions) => {
      const brand = db().getBrand();
      if (!brand) return { ok: false, error: "Create your brand first." };
      const result = await generateIdeas(
        key("anthropic"),
        brand,
        await listResearch(dataDir),
        generateOptions,
        db().listIdeas(),
      );
      if (result.ok) {
        const suggestedAt = new Date().toISOString();
        const fresh = result.ideas.map((idea): IdeaSuggestion => ({ ...idea, key: randomUUID(), suggestedAt }));
        db().setSetting(SUGGESTIONS_SETTING, JSON.stringify([...fresh, ...suggestions()].slice(0, MAX_SUGGESTIONS)));
      }
      return result;
    },
    /** The suggestions the creator has neither saved nor dismissed, newest round first. */
    "ideas:suggestions": () => suggestions(),
    /** Takes suggestions off the waiting list (after saving them as ideas, or to throw them away). Returns what is left. */
    "ideas:dismiss": (keys: unknown) => {
      const gone = new Set(Array.isArray(keys) ? keys.map(String) : []);
      const left = suggestions().filter((s) => !gone.has(s.key));
      db().setSetting(SUGGESTIONS_SETTING, JSON.stringify(left));
      return left;
    },

    "agent:list": () => listAgentChats(agent),
    "agent:get": (id: unknown) => getAgentChat(agent, String(id)),
    /** Runs until the agent has answered, which can take minutes if it analyses posts or writes ideas. */
    "agent:send": (chatId: unknown, text: unknown) => sendToAgent(agent, String(chatId), String(text ?? "")),
    /** Answers the approvals a chat is paused on (approval id to true or false) and carries on. */
    "agent:decide": (chatId: unknown, decisions: unknown) => decideAgent(agent, String(chatId), decisions),
    "agent:progress": (chatId: unknown) => agentProgress(String(chatId)),
    "agent:permissions": () => getAgentPermissions(agent),
    "agent:setPermissions": (changes: unknown) => setAgentPermissions(agent, changes),
    "agent:delete": (id: unknown) => deleteAgentChat(agent, String(id)),

    "audio:list": () => listAudio(dataDir),
    "audio:voices": () => listVoices(key("elevenlabs")),
    "audio:voicePreview": (voiceId: unknown) => voicePreview(key("elevenlabs"), String(voiceId)),

    "research:list": () => listResearch(dataDir),
    "research:add": (url: unknown) => addResearch(dataDir, String(url), key("deepgram")),
    "research:transcribe": (id: unknown) => transcribeResearch(dataDir, String(id), key("deepgram")),
    "research:analyze": (id: unknown) => analyzeResearch(dataDir, String(id), key("anthropic")),
    "research:audio": (id: unknown) => refreshResearchAudio(dataDir, String(id)),
    "research:update": (id: unknown, edit: ResearchEdit) => updateResearch(dataDir, String(id), edit ?? {}),
    "research:delete": (id: unknown) => deleteResearch(dataDir, String(id)),

    /** What the app has used since `since` (an ISO time, or "" for everything). */
    "usage:get": async (since: unknown) =>
      readUsage(dataDir, typeof since === "string" ? since : "", { posts: await listResearch(dataDir), ideas: db().listIdeas() }),

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
    start: () => void connectTelegram(),
    close: () => {
      store?.close();
      store = null;
    },
  };
}
