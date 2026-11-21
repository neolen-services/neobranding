import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { parseBrandKit, type SaveResult } from "@shared/brand";
import { closeDb, getBrand, saveBrand } from "./db";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#F1F5F9",
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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", closeDb);
