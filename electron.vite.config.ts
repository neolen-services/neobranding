import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { generateIdeas } from "./src/main/generate";

const shared = { "@shared": resolve("src/shared") };

/**
 * Development only: lets the UI generate ideas when it is opened in a plain
 * browser, where there is no Electron main process to call Claude. The desktop
 * app never uses this; it calls the same function over IPC.
 */
function browserIdeasApi(): Plugin {
  return {
    name: "browser-ideas-api",
    configureServer(server) {
      server.middlewares.use("/api/generate-ideas", (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return send(405, { ok: false, error: "POST only." });

        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", async () => {
          try {
            const { apiKey, brand, options, existingTitles } = JSON.parse(raw);
            send(200, await generateIdeas(apiKey, brand, options, existingTitles ?? []));
          } catch (e) {
            send(500, { ok: false, error: e instanceof Error ? e.message : "Could not generate ideas." });
          }
        });
      });
    },
  };
}

export default defineConfig({
  main: { resolve: { alias: shared } },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: { alias: shared },
    plugins: [react(), tailwindcss(), browserIdeasApi()],
  },
});
