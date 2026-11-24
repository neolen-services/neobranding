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
import { editOps, exportProgress } from "./edit";
import { clearEditChat, editAgentProgress, getEditChat, sendToEditor, undoEditorTurn } from "./editAgent";
import { generateIdeas } from "./generate";
import { copyData, DB_FILE, defaultDataDir, readDataDir, writeDataDir } from "./location";
import {
  addResearch,
  analyzeResearch,
  groupResearch,
  styleResearch,
  onPostSaved,
  deleteResearch,
  listResearch,
  refreshResearchAudio,
  setToolsDir,
  transcribeResearch,
  updateResearch,
} from "./research";
import { openStore, type Secrets, type Store } from "./store";
import { studioOps } from "./studioOps";
import type { NewVideo, SeriesStart } from "../shared/studio";
import type { UploadedFile } from "../shared/media";
import { startTelegram, telegramStatus, unlinkTelegram } from "./telegram";
import { readUsage, setUsageDir } from "./usage";

const SUGGESTIONS_SETTING = "idea_suggestions";
/** "off" when the creator has turned automatic analysis of new posts off; anything else means on. */
const AUTO_ANALYSE_SETTING = "auto_analyse";

export type HandlerOptions = {
  /** Where downloaded tools (yt-dlp, FFmpeg) are kept. Not user data, so outside the data folder. */
  toolsDir: string;
  secrets: Secrets;
  /** Shows a folder in the system's file manager. */
  openFolder: (path: string) => void;
  /** Renders an animation page to an MP4. Only the desktop app has a way to; left out elsewhere. */
  renderAnimation?: (page: string, seconds: number, ffmpeg: string) => Promise<Buffer>;
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

  const db = () => (store ??= openStore(dataDir, options.secrets));
  const key = (provider: ApiProvider) => db().getApiKey(provider);
  const connectTelegram = async () =>
    options.listenToTelegram ? startTelegram(dataDir, key("telegram"), () => key("deepgram")) : telegramStatus();

  const agent: AgentContext = { dataDir: () => dataDir, store: db, key, render: options.renderAnimation };

  // A post that has just been saved (pasted, sent through Telegram, or saved by the agent) is analysed on its own,
  // which also puts it in its concept group. One at a time, so each sees the groups the one before it made.
  const autoAnalyse = () => db().getSetting(AUTO_ANALYSE_SETTING) !== "off";
  const waitingForAnalysis = new Set<string>();
  let analysisQueue: Promise<void> = Promise.resolve();
  onPostSaved((item) => {
    if (!autoAnalyse() || !key("anthropic")) return;
    waitingForAnalysis.add(item.id);
    analysisQueue = analysisQueue.then(async () => {
      try {
        // Skipped if the Analyse button or the agent got to it first.
        const now = (await listResearch(dataDir)).find((i) => i.id === item.id);
        if (now && !now.analysis) await analyzeResearch(dataDir, item.id, key("anthropic"));
      } catch {
        // The post stays unanalysed, and the Analyse button is still there for it.
      } finally {
        waitingForAnalysis.delete(item.id);
      }
    });
  });

  const suggestions = (): IdeaSuggestion[] => {
    try {
      const saved: unknown = JSON.parse(db().getSetting(SUGGESTIONS_SETTING) || "[]");
      return Array.isArray(saved) ? saved.filter((s) => s && typeof s.key === "string" && typeof s.title === "string") : [];
    } catch {
      return [];
    }
  };


  const dataInfo = (): DataFolderInfo => ({
    path: dataDir,
    defaultPath: defaultDataDir(),
    isDefault: resolve(dataDir) === resolve(defaultDataDir()),
  });

  // The cast, series and videos. The agent uses the same operations.
  const studio = studioOps(agent);
  // The video editor: projects made from files or Studio videos, edited by the creator and by its own agent.
  const edits = editOps(agent);

  const handlers: Handlers = {
    "cast:list": () => studio.cast(),
    "cast:save": (input: unknown) => studio.saveCharacter(input),
    "cast:delete": (id: unknown) => studio.deleteCharacter(id),

    "series:list": () => studio.series(),
    "series:save": (input: unknown) => studio.saveSeries(input),
    "series:delete": (id: unknown) => studio.deleteSeries(id),

    "series:create": (input: SeriesStart) => studio.createSeries(input),
    "series:planSeason": (id: unknown) => studio.planSeason(id),

    "videos:list": () => studio.videos(),
    "videos:create": (input: NewVideo) => studio.createVideo(input),
    "videos:save": (input: unknown) => studio.saveVideo(input),
    /** Gives a role in a video to another character, or to a new one ("new"). */
    "videos:recast": (videoId: unknown, fromId: unknown, toId: unknown) => studio.recast(videoId, fromId, toId),
    "videos:delete": (id: unknown) => studio.deleteVideo(id),
    "videos:write": (id: unknown, note: unknown) => studio.writeScript(id, note),
    "videos:approve": (id: unknown) => studio.approve(id),
    /** Has Claude read the script for continuity, completing each place's set. */
    "videos:checkScript": (id: unknown) => studio.checkScript(id),
    "videos:voices": (id: unknown) => studio.voices(id),
    /** Has Claude plan the music (or change it as the feedback says) and makes the tracks. Uses Claude and ElevenLabs credits. */
    "videos:music": (id: unknown, feedback: unknown) => studio.music(id, feedback),
    /** Makes any music tracks still missing. Uses ElevenLabs credits. */
    "videos:makeMusic": (id: unknown) => studio.makeMusic(id),
    /** true approves the music, false takes it back, "none" chooses no music. */
    "videos:approveMusic": (id: unknown, approved: unknown) => studio.approveMusic(id, approved),
    "videos:results": (id: unknown, results: unknown) => studio.recordResults(id, results),
    // Pictures, clips and lip-sync. `choice` picks the service for this one request; without it the Settings default is used.
    "media:settings": () => studio.mediaSettings(),
    "media:setSettings": (input: unknown) => studio.setMediaSettings(input),
    "cast:picture": (id: unknown, choice: unknown) => studio.characterPicture(id, choice),
    /** Makes a character's sheet (front, back and face in one picture), or with `remove` takes it away. */
    "cast:sheet": (id: unknown, choice: unknown, remove: unknown) => studio.characterSheet(id, choice, remove),
    "cast:addPicture": (id: unknown, file: UploadedFile) => studio.addCharacterPicture(id, file),
    "cast:changePicture": (id: unknown, takeId: unknown, action: unknown) => studio.changeCharacterPicture(id, takeId, action),
    "scene:picture": (videoId: unknown, sceneId: unknown, choice: unknown, note: unknown) => studio.scenePicture(videoId, sceneId, choice, note),
    "scene:clip": (videoId: unknown, sceneId: unknown, choice: unknown) => studio.sceneClip(videoId, sceneId, choice),
    "scene:lipsync": (videoId: unknown, sceneId: unknown, choice: unknown) => studio.sceneLipSync(videoId, sceneId, choice),
    /** Has Claude look at a video's storyboards (or one scene's) and say whether each is good to make the video from. */
    "storyboard:review": (videoId: unknown, sceneId: unknown) => studio.storyboardReview(videoId, sceneId),
    /** Has Claude animate one scene of a motion graphics video; with a note, changes its current animation. */
    "scene:animate": (videoId: unknown, sceneId: unknown, note: unknown) => studio.sceneAnimation(videoId, sceneId, note),
    /** The creator approves the storyboard a scene has in use (true), or takes the approval back (false). */
    "scene:approve": (videoId: unknown, sceneId: unknown, approved: unknown) => studio.sceneApprove(videoId, sceneId, approved),
    /** Says whether a scene carries straight on from the one before it (true) or is a new shot (false). */
    "scene:flow": (videoId: unknown, sceneId: unknown, continues: unknown) => studio.sceneFlow(videoId, sceneId, continues),
    "scene:addFile": (videoId: unknown, sceneId: unknown, file: UploadedFile) => studio.addSceneFile(videoId, sceneId, file),
    "scene:changeTake": (videoId: unknown, sceneId: unknown, takeId: unknown, action: unknown) => studio.changeTake(videoId, sceneId, takeId, action),

    "edits:list": () => edits.list(),
    "edits:get": (id: unknown) => edits.find(id) ?? null,
    "edits:create": (title: unknown) => edits.create(title),
    /** Saves the creator's own change to a project's timeline. */
    "edits:update": (project: unknown) => edits.update(project),
    "edits:delete": (id: unknown) => edits.remove(id),
    /** Adds files ({ name, file }[]) to a project. */
    "edits:import": (id: unknown, files: unknown) => edits.importFiles(id, files),
    /** Starts a project from a Studio video's clips, voices and on-screen text. */
    "edits:fromVideo": (videoId: unknown) => edits.fromVideo(videoId),
    "edits:transcribe": (id: unknown, assetId: unknown) => edits.transcribe(id, assetId, key("deepgram")),
    /** Makes the MP4. `overlays` are the captions and text drawn by the interface. */
    "edits:export": (id: unknown, overlays: unknown) => edits.exportVideo(id, overlays),
    "edits:exportProgress": (id: unknown) => exportProgress(String(id)),
    "edits:chat": (id: unknown) => getEditChat(agent, String(id)),
    /** Runs the editing agent on the creator's message until it has answered. */
    "edits:send": (id: unknown, text: unknown) => sendToEditor(agent, String(id), String(text ?? "")),
    "edits:agentProgress": (id: unknown) => editAgentProgress(String(id)),
    "edits:clearChat": (id: unknown) => clearEditChat(agent, String(id)),
    /** Puts the timeline back as it was before one of the AI editor's turns. */
    "edits:undoTurn": (id: unknown, checkpoint: unknown) => undoEditorTurn(agent, String(id), String(checkpoint)),
    /** Makes any frame strips and waveforms a project's files are missing. */
    "edits:prepare": (id: unknown) => edits.prepare(id),
    "edits:captions": (id: unknown, maxWords: unknown) => edits.remakeCaptions(id, maxWords),
    /** Makes music with ElevenLabs and puts it under the video. Uses ElevenLabs credits. */
    "edits:music": (id: unknown, description: unknown) => edits.makeMusic(id, description, key("elevenlabs")),

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
    /** Whether new posts are analysed on their own, and which are being analysed or waiting right now. */
    "research:auto": () => ({ on: autoAnalyse(), analysing: [...waitingForAnalysis] }),
    "research:setAuto": (on: unknown) => {
      db().setSetting(AUTO_ANALYSE_SETTING, on === false ? "off" : "on");
      return autoAnalyse();
    },
    /** Sorts analysed posts into groups of similar videos: only those without a group, or all of them afresh. */
    /** Adds the visual style to a post analysed before styles were recorded. A fraction of the cost of analysing it again. */
    "research:style": (id: unknown) => styleResearch(dataDir, String(id), key("anthropic")),
    "research:group": (all: unknown) => groupResearch(dataDir, key("anthropic"), all === true),
    "research:audio": (id: unknown) => refreshResearchAudio(dataDir, String(id)),
    "research:update": (id: unknown, edit: ResearchEdit) => updateResearch(dataDir, String(id), edit ?? {}),
    "research:delete": (id: unknown) => deleteResearch(dataDir, String(id)),

    /** What the app has used since `since` (an ISO time, or "" for everything). */
    "usage:get": async (since: unknown) =>
      readUsage(dataDir, typeof since === "string" ? since : ""),

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
    /** Shows, in the file manager, the folder of one video's or one character's files, or the folder of voice lines. */
    "assets:open": (folder: unknown, id: unknown) => {
      const inside = folder === "audio" ? ["audio"] : (folder === "videos" || folder === "cast" || folder === "edits") && typeof id === "string" && /^[\w-]{1,64}$/.test(id) ? [folder, id] : null;
      if (!inside) return;
      const path = join(dataDir, ...inside);
      mkdirSync(path, { recursive: true });
      options.openFolder(path);
    },
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
