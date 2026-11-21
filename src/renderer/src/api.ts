import type { BrandKit } from "@shared/brand";
import type { Idea } from "@shared/ideas";
import { API_PROVIDERS } from "@shared/settings";

type Api = Window["api"];

// Stand-in used when the UI is opened in a plain browser (for development and
// preview), where the Electron bridge does not exist. Every call goes to the
// dev server, which runs the same handlers as the desktop app against the same
// data folder (see electron.vite.config.ts and src/main/handlers.ts).
async function rpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, args }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "The request failed.");
  return body.result as T;
}

/**
 * Earlier versions of the browser stand-in kept the brand, ideas and keys in
 * this browser's localStorage. Move them into the data folder once.
 */
const MIGRATED_FLAG = "personal-brand:moved-to-data-folder";
async function moveBrowserData(): Promise<void> {
  if (localStorage.getItem(MIGRATED_FLAG)) return;
  try {
    const brand = localStorage.getItem("personal-brand:brand");
    if (brand && !(await rpc<BrandKit | null>("brand:get"))) await rpc("brand:save", JSON.parse(brand));

    const ideas: Idea[] = JSON.parse(localStorage.getItem("personal-brand:ideas") ?? "[]");
    const saved = new Set((await rpc<Idea[]>("ideas:list")).map((i) => i.id));
    for (const idea of ideas) if (!saved.has(idea.id)) await rpc("ideas:save", idea);

    for (const provider of API_PROVIDERS) {
      const name = `personal-brand:${provider}-api-key`;
      const key = localStorage.getItem(name);
      if (key && !(await rpc<boolean>("settings:hasApiKey", provider))) {
        const result = await rpc<{ ok: boolean }>("settings:setApiKey", provider, key);
        if (!result.ok) throw new Error("A key could not be moved."); // Keep it here and retry next time.
      }
      localStorage.removeItem(name);
    }
    localStorage.setItem(MIGRATED_FLAG, new Date().toISOString());
  } catch {
    // Try again next time the app is opened.
  }
}

/** Calls are held until the one-time move has finished, so nothing reads half-moved data. */
let ready: Promise<void> | undefined;
const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  (ready ??= moveBrowserData()).then(() => rpc<T>(channel, ...args));

const browserApi: Api = {
  getBrand: () => call("brand:get"),
  saveBrand: (brand) => call("brand:save", brand),

  listIdeas: () => call("ideas:list"),
  saveIdea: (idea) => call("ideas:save", idea),
  deleteIdea: (id) => call("ideas:delete", id),
  generateIdeas: (options) => call("ideas:generate", options),
  writeScript: (id) => call("ideas:script", id),

  listAgentChats: () => call("agent:list"),
  getAgentChat: (id) => call("agent:get", id),
  sendToAgent: (chatId, text) => call("agent:send", chatId, text),
  agentProgress: (chatId) => call("agent:progress", chatId),
  deleteAgentChat: (id) => call("agent:delete", id),

  listResearch: () => call("research:list"),
  addResearch: (url) => call("research:add", url),
  transcribeResearch: (id) => call("research:transcribe", id),
  analyzeResearch: (id) => call("research:analyze", id),
  refreshResearchAudio: (id) => call("research:audio", id),
  updateResearch: (id, edit) => call("research:update", id, edit),
  deleteResearch: (id) => call("research:delete", id),
  researchFileUrl: (id, file) => `/media/research/${id}/${file}`,

  telegramStatus: () => call("telegram:status"),
  syncTelegram: () => call("telegram:sync"),
  unlinkTelegram: () => call("telegram:unlink"),

  hasApiKey: (provider) => call("settings:hasApiKey", provider),
  setApiKey: (provider, key) => call("settings:setApiKey", provider, key),

  dataFolder: () => call("data:info"),
  openDataFolder: () => call("data:open"),
  changeDataFolder: (path) => call("data:change", path),
  browseForFolder: async () => "",
  canBrowseForFolder: false,
};

export const api: Api = window.api ?? browserApi;
