import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { parseBrandKit, type SaveResult } from "@shared/brand";
import { parseIdea, type GenerateOptions, type GenerateResult } from "@shared/ideas";
import {
  closeDb,
  deleteIdea,
  getApiKey,
  getBrand,
  listIdeas,
  saveBrand,
  saveIdea,
  setApiKey,
} from "./db";
import { generateIdeas } from "./generate";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0A0908",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
    },
  });

  win.once("ready-to-show", () => win.show());

  // Open links in the user's browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  // electron-vite serves the UI from a dev server in development.
  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("brand:get", () => getBrand());

  ipcMain.handle("brand:save", (_event, input: unknown): SaveResult => {
    try {
      const brand = parseBrandKit(input);
      saveBrand(brand);
      return { ok: true, brand };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not save the brand." };
    }
  });

  ipcMain.handle("ideas:list", () => listIdeas());
  ipcMain.handle("ideas:save", (_event, input: unknown) => {
    const idea = parseIdea(input);
    saveIdea(idea);
    return idea;
  });
  ipcMain.handle("ideas:delete", (_event, id: unknown) => deleteIdea(String(id)));

  ipcMain.handle(
    "ideas:generate",
    async (_event, options: GenerateOptions): Promise<GenerateResult> => {
      const brand = getBrand();
      if (!brand) return { ok: false, error: "Create your brand first." };
      return generateIdeas(getApiKey(), brand, options, listIdeas().map((i) => i.title));
    },
  );

  // The key itself never goes back to the UI, only whether one is saved.
  ipcMain.handle("settings:hasApiKey", () => getApiKey() !== "");
  ipcMain.handle("settings:setApiKey", (_event, key: unknown) => {
    try {
      setApiKey(typeof key === "string" ? key.trim() : "");
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Could not save the key." };
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", closeDb);
