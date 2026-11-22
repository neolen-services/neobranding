// Runs only the web page, for working on the UI in a browser (npm run dev:web).
// Unlike `electron-vite dev`, this does not start the desktop app, so there is
// exactly one copy of the app using the data folder and the Telegram bot.
import { defineConfig } from "vite";
import { rendererConfig } from "./electron.vite.config";

export default defineConfig({
  ...rendererConfig(true),
  root: "src/renderer",
  server: { port: 5173, strictPort: true },
});
