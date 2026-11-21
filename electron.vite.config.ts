import { spawn } from "child_process";
import { createReadStream, statSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { createHandlers } from "./src/main/handlers";
import { researchFilePath } from "./src/main/research";
import { plainSecrets } from "./src/main/store";

const shared = { "@shared": resolve("src/shared") };

// Earlier versions of the browser stand-in kept saved posts here. Downloaded
// tools (yt-dlp, FFmpeg) still live in its bin folder.
const DEV_DIR = resolve(".dev-data");

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done, fail) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        done(JSON.parse(raw || "{}"));
      } catch (e) {
        fail(e);
      }
    });
    req.on("error", fail);
  });
}

/** Serves a saved file, honouring Range requests so the video player can seek. */
function sendFile(req: IncomingMessage, res: ServerResponse, path: string) {
  const size = statSync(path).size;
  res.setHeader("Content-Type", MEDIA_TYPES[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!range) {
    res.setHeader("Content-Length", size);
    createReadStream(path).pipe(res);
    return;
  }
  const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }
  res.statusCode = 206;
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", end - start + 1);
  createReadStream(path, { start, end }).pipe(res);
}

/** Shows a folder in the system's file manager. */
function openFolder(path: string) {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [path], { detached: true, stdio: "ignore" }).unref();
}

/**
 * Development only: lets the UI work when it is opened in a plain browser,
 * where there is no Electron main process. It runs the same handlers as the
 * desktop app, against the same data folder, and serves saved media files.
 * The desktop app never uses this; it calls the handlers over IPC.
 */
function browserDevApi(): Plugin {
  return {
    name: "browser-dev-api",
    configureServer(server) {
      // Created on first use, so starting the desktop app does not open the data twice.
      let core: ReturnType<typeof createHandlers> | undefined;
      const getCore = () =>
        (core ??= createHandlers({
          toolsDir: resolve(DEV_DIR, "bin"),
          // A plain Node process has no OS keychain, so keys saved from the browser are stored readable.
          secrets: plainSecrets,
          legacyDirs: [DEV_DIR],
          openFolder,
        }));

      server.middlewares.use("/api/rpc", async (req, res) => {
        if (req.method !== "POST") return sendJson(res, 405, { error: "POST only." });
        try {
          const { channel, args } = await readJson(req);
          const handler = getCore().handlers[String(channel)];
          if (!handler) return sendJson(res, 404, { error: `Unknown request: ${channel}` });
          sendJson(res, 200, { result: (await handler(...(Array.isArray(args) ? args : []))) ?? null });
        } catch (e) {
          sendJson(res, 500, { error: e instanceof Error ? e.message : "The request failed." });
        }
      });

      // /media/research/<id>/<file>
      server.middlewares.use("/media/research", (req, res) => {
        const [id, file] = (req.url ?? "").split("?")[0].split("/").filter(Boolean);
        const path = researchFilePath(getCore().dataDir(), id ?? "", file ?? "");
        if (!path) {
          res.statusCode = 404;
          return res.end("Not found");
        }
        sendFile(req, res, path);
      });
    },
  };
}

/** The web page's build settings, shared with vite.web.config.ts. */
export const rendererConfig = {
  resolve: { alias: shared },
  plugins: [react(), tailwindcss(), browserDevApi()],
};

export default defineConfig({
  main: { resolve: { alias: shared } },
  preload: { resolve: { alias: shared } },
  renderer: rendererConfig,
});
