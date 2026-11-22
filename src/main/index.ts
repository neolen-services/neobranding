import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { audioFilePath } from "./audio";
import { mediaFilePath } from "./media";
import { createHandlers } from "./handlers";
import { researchFilePath } from "./research";
import type { Secrets } from "./store";

// Saved posts are served to the UI as media://research/<id>/<file>.
protocol.registerSchemesAsPrivileged([
  { scheme: "media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

/**
 * API keys are encrypted with the operating system's keychain (DPAPI on
 * Windows). A key encrypted on one computer cannot be read on another, so
 * after moving the data folder the keys have to be entered again.
 */
const osSecrets: Secrets = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer cannot store the key securely.");
    return `os:${safeStorage.encryptString(plain).toString("base64")}`;
  },
  decrypt(stored) {
    try {
      // "plain:" values were saved by the browser version of the app.
      if (stored.startsWith("plain:")) return Buffer.from(stored.slice(6), "base64").toString("utf8");
      // Values without a prefix were saved before prefixes existed.
      const encrypted = stored.startsWith("os:") ? stored.slice(3) : stored;
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return "";
    }
  },
};

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
  const userData = app.getPath("userData");
  const core = createHandlers({
    toolsDir: join(userData, "bin"),
    secrets: osSecrets,
    listenToTelegram: true,
    // Earlier versions kept the database and saved posts in the app's own folder.
    legacyDirs: [userData],
    openFolder: (path) => void shell.openPath(path),
  });

  for (const [channel, handler] of Object.entries(core.handlers)) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args));
  }

  // Lets the user pick a data folder with the system's folder chooser.
  ipcMain.handle("data:browse", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose your data folder",
      defaultPath: core.dataDir(),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? "" : (result.filePaths[0] ?? "");
  });

  protocol.handle("media", (request) => {
    const url = new URL(request.url);
    const [id, file] = url.pathname.split("/").filter(Boolean);
    // media://research/<id>/<file> is a saved post's file; media://audio/<file> is generated audio;
    // media://studio/videos/<video id>/<file> and media://studio/cast/<character id>/<file> are pictures and clips.
    const path =
      url.hostname === "research"
        ? researchFilePath(core.dataDir(), id ?? "", file ?? "")
        : url.hostname === "audio"
          ? audioFilePath(core.dataDir(), id ?? "")
          : url.hostname === "studio"
            ? mediaFilePath(core.dataDir(), url.pathname.split("/").filter(Boolean).join("/"))
            : null;
    if (!path) return new Response("Not found", { status: 404 });
    // Forward the request headers so the player can seek with Range requests.
    return net.fetch(pathToFileURL(path).toString(), { headers: request.headers });
  });

  core.start();
  app.on("will-quit", core.close);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
