import { emptyBrandKit, parseBrandKit, type BrandKit, type SaveResult } from "@shared/brand";
import { parseIdea, type GenerateOptions, type GenerateResult, type Idea } from "@shared/ideas";

type Api = Window["api"];

// Stand-in used when the UI is opened in a plain browser (for development and
// preview), where the Electron bridge does not exist. Data lives in the
// browser's localStorage, separate from the desktop app's SQLite file, and
// idea generation goes through the dev server (see electron.vite.config.ts).
const BRAND_KEY = "personal-brand:brand";
const IDEAS_KEY = "personal-brand:ideas";
const API_KEY_KEY = "personal-brand:anthropic-api-key";

const readBrand = (): BrandKit | null => {
  const raw = localStorage.getItem(BRAND_KEY);
  return raw ? { ...emptyBrandKit(), ...JSON.parse(raw) } : null;
};
const readIdeas = (): Idea[] => JSON.parse(localStorage.getItem(IDEAS_KEY) ?? "[]");
const writeIdeas = (ideas: Idea[]) => localStorage.setItem(IDEAS_KEY, JSON.stringify(ideas));

const browserApi: Api = {
  async getBrand() {
    return readBrand();
  },
  async saveBrand(input): Promise<SaveResult> {
    try {
      const brand = parseBrandKit(input);
      localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
      return { ok: true, brand };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not save the brand." };
    }
  },

  async listIdeas() {
    return readIdeas().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async saveIdea(input) {
    const idea = parseIdea(input);
    writeIdeas([idea, ...readIdeas().filter((i) => i.id !== idea.id)]);
    return idea;
  },
  async deleteIdea(id) {
    writeIdeas(readIdeas().filter((i) => i.id !== id));
  },
  async generateIdeas(options: GenerateOptions): Promise<GenerateResult> {
    const brand = readBrand();
    if (!brand) return { ok: false, error: "Create your brand first." };
    try {
      const response = await fetch("/api/generate-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: localStorage.getItem(API_KEY_KEY) ?? "",
          brand,
          options,
          existingTitles: readIdeas().map((i) => i.title),
        }),
      });
      return await response.json();
    } catch {
      return { ok: false, error: "Could not reach the dev server to generate ideas." };
    }
  },

  async hasApiKey() {
    return Boolean(localStorage.getItem(API_KEY_KEY));
  },
  async setApiKey(key) {
    if (key) localStorage.setItem(API_KEY_KEY, key);
    else localStorage.removeItem(API_KEY_KEY);
    return { ok: true };
  },
};

export const api: Api = window.api ?? browserApi;
