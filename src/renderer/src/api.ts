import { emptyBrandKit, parseBrandKit, type BrandKit, type SaveResult } from "@shared/brand";

type Api = Window["api"];

// Stand-in used when the UI is opened in a plain browser (for development and
// preview), where the Electron bridge does not exist. It keeps the brand in
// the browser's localStorage, separate from the desktop app's SQLite file.
const STORAGE_KEY = "personal-brand:brand";

const browserApi: Api = {
  async getBrand(): Promise<BrandKit | null> {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...emptyBrandKit(), ...JSON.parse(raw) } : null;
  },
  async saveBrand(input: BrandKit): Promise<SaveResult> {
    try {
      const brand = parseBrandKit(input);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(brand));
      return { ok: true, brand };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not save the brand." };
    }
  },
};

export const api: Api = window.api ?? browserApi;
