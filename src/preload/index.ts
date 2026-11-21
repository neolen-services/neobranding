import { contextBridge, ipcRenderer } from "electron";
import type { BrandKit, SaveResult } from "@shared/brand";
import type { GenerateOptions, GenerateResult, Idea } from "@shared/ideas";

// The only bridge between the UI and the main process.
const api = {
  getBrand: (): Promise<BrandKit | null> => ipcRenderer.invoke("brand:get"),
  saveBrand: (brand: BrandKit): Promise<SaveResult> => ipcRenderer.invoke("brand:save", brand),

  listIdeas: (): Promise<Idea[]> => ipcRenderer.invoke("ideas:list"),
  /** Inserts or replaces an idea (also used to change its status). */
  saveIdea: (idea: Idea): Promise<Idea> => ipcRenderer.invoke("ideas:save", idea),
  deleteIdea: (id: string): Promise<void> => ipcRenderer.invoke("ideas:delete", id),
  generateIdeas: (options: GenerateOptions): Promise<GenerateResult> =>
    ipcRenderer.invoke("ideas:generate", options),

  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke("settings:hasApiKey"),
  /** Pass an empty string to remove the saved key. */
  setApiKey: (key: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("settings:setApiKey", key),
};

export type Api = typeof api;

contextBridge.exposeInMainWorld("api", api);
