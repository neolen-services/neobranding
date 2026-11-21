import { contextBridge, ipcRenderer } from "electron";
import type { BrandKit, SaveResult } from "@shared/brand";
import type { DataFolderInfo, DataFolderResult } from "@shared/data";
import type { GenerateOptions, GenerateResult, Idea, IdeaResult, ScriptResult } from "@shared/ideas";
import type { ResearchEdit, ResearchItem, ResearchResult } from "@shared/research";
import type { ApiProvider } from "@shared/settings";
import type { TelegramStatus } from "@shared/telegram";

// The only bridge between the UI and the main process. Channel names match
// the handler table in src/main/handlers.ts.
const api = {
  getBrand: (): Promise<BrandKit | null> => ipcRenderer.invoke("brand:get"),
  saveBrand: (brand: BrandKit): Promise<SaveResult> => ipcRenderer.invoke("brand:save", brand),

  listIdeas: (): Promise<Idea[]> => ipcRenderer.invoke("ideas:list"),
  /** Inserts or replaces an idea (also used to change its status). */
  saveIdea: (idea: Idea): Promise<Idea> => ipcRenderer.invoke("ideas:save", idea),
  deleteIdea: (id: string): Promise<void> => ipcRenderer.invoke("ideas:delete", id),
  generateIdeas: (options: GenerateOptions): Promise<GenerateResult> =>
    ipcRenderer.invoke("ideas:generate", options),
  /** Has Claude write a timed script for a saved idea. Costs money each time. */
  writeScript: (id: string): Promise<ScriptResult> => ipcRenderer.invoke("ideas:script", id),
  /** Links your own published video to an idea and reads its numbers. An empty link removes it. */
  trackIdea: (id: string, url: string): Promise<IdeaResult> => ipcRenderer.invoke("ideas:track", id, url),
  /** Reads the numbers of an idea's published video again. */
  checkIdea: (id: string): Promise<IdeaResult> => ipcRenderer.invoke("ideas:check", id),

  listResearch: (): Promise<ResearchItem[]> => ipcRenderer.invoke("research:list"),
  /** Downloads the post at the link and, if a Deepgram key is saved, transcribes its videos. */
  addResearch: (url: string): Promise<ResearchResult> => ipcRenderer.invoke("research:add", url),
  transcribeResearch: (id: string): Promise<ResearchResult> => ipcRenderer.invoke("research:transcribe", id),
  /** Has Claude break the post down (frames, transcript, caption). Costs money once per post. */
  analyzeResearch: (id: string): Promise<ResearchResult> => ipcRenderer.invoke("research:analyze", id),
  /** Looks up which sound a saved post uses. */
  refreshResearchAudio: (id: string): Promise<ResearchResult> => ipcRenderer.invoke("research:audio", id),
  /** Saves the user's rating and note for a post. */
  updateResearch: (id: string, edit: ResearchEdit): Promise<ResearchResult> =>
    ipcRenderer.invoke("research:update", id, edit),
  deleteResearch: (id: string): Promise<void> => ipcRenderer.invoke("research:delete", id),
  /** Address the UI can load a saved file from. */
  researchFileUrl: (id: string, file: string): string => `media://research/${id}/${file}`,

  telegramStatus: (): Promise<TelegramStatus> => ipcRenderer.invoke("telegram:status"),
  /** (Re)connects with the saved bot token. Call after the token changes and when the app opens. */
  syncTelegram: (): Promise<TelegramStatus> => ipcRenderer.invoke("telegram:sync"),
  unlinkTelegram: (): Promise<TelegramStatus> => ipcRenderer.invoke("telegram:unlink"),

  hasApiKey: (provider: ApiProvider): Promise<boolean> => ipcRenderer.invoke("settings:hasApiKey", provider),
  /** Pass an empty string to remove the saved key. */
  setApiKey: (provider: ApiProvider, key: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("settings:setApiKey", provider, key),

  /** Where all of the user's data is kept. */
  dataFolder: (): Promise<DataFolderInfo> => ipcRenderer.invoke("data:info"),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke("data:open"),
  /** Switches to another folder, using data already there or copying the current data into it. */
  changeDataFolder: (path: string): Promise<DataFolderResult> => ipcRenderer.invoke("data:change", path),
  /** Opens the system's folder chooser and returns the chosen path, or "" if cancelled. */
  browseForFolder: (): Promise<string> => ipcRenderer.invoke("data:browse"),
  /** Whether browseForFolder is available (it is not in a plain browser). */
  canBrowseForFolder: true,
};

export type Api = typeof api;

contextBridge.exposeInMainWorld("api", api);
