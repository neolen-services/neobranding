// Listens to a Telegram bot for links and saves them to Research.
// Plain Node code with relative imports only: it runs in the Electron main
// process and in the dev server's middleware (see electron.vite.config.ts).
//
// The app asks Telegram for new messages (long polling), so nothing has to be
// reachable from the internet. It only works while the app is running;
// Telegram keeps unread messages for about a day, and they are picked up on
// the next start.
//
// Only one chat is listened to: the first chat or channel that messages the
// bot becomes the linked chat, and everything else is ignored until it is
// unlinked in Settings.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectPlatform, SUPPORTED_LINKS_HINT } from "../shared/research";
import { extractLinks, TELEGRAM_OFF, type TelegramStatus } from "../shared/telegram";
import { addResearch } from "./research";

type Saved = { offset: number; chatId: number | null; chatName: string };

type Chat = { id: number; title?: string; first_name?: string; last_name?: string; username?: string };
type Message = { message_id: number; chat: Chat; text?: string; caption?: string };
type Update = { update_id: number; message?: Message; channel_post?: Message };

class TelegramError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// Overridable so the listener can be tested against a stand-in server.
const TELEGRAM_API = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";

let status: TelegramStatus = { ...TELEGRAM_OFF };
let saved: Saved = { offset: 0, chatId: null, chatName: "" };
let running: { token: string; dataDir: string; abort: AbortController } | null = null;

export const telegramStatus = (): TelegramStatus => ({ ...status, linkedChat: saved.chatName });

const stateFile = (dataDir: string) => join(dataDir, "telegram.json");

async function loadSaved(dataDir: string): Promise<void> {
  saved = { offset: 0, chatId: null, chatName: "" };
  if (!existsSync(stateFile(dataDir))) return;
  try {
    saved = { ...saved, ...JSON.parse(await readFile(stateFile(dataDir), "utf8")) };
  } catch {
    // An unreadable file just means starting unlinked.
  }
}

/**
 * Moves past messages another copy of the app on the same data folder has
 * already taken (the desktop app and the browser version open together).
 */
async function adoptStoredOffset(dataDir: string): Promise<void> {
  try {
    const stored = Number(JSON.parse(await readFile(stateFile(dataDir), "utf8")).offset);
    if (stored > saved.offset) saved.offset = stored;
  } catch {
    // No file yet, or it is being written: keep what is in memory.
  }
}

async function storeSaved(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(stateFile(dataDir), JSON.stringify(saved, null, 2));
}

async function call<T>(token: string, method: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await response.json()) as { ok: boolean; result?: T; error_code?: number; description?: string };
  if (!json.ok) throw new TelegramError(json.error_code ?? response.status, json.description ?? "Telegram error");
  return json.result as T;
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

const chatName = (chat: Chat) =>
  chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "Telegram chat";

/**
 * Starts listening with this bot token, replacing any earlier listener.
 * An empty token turns the connection off. `getDeepgramKey` is read at the
 * moment each link is saved, so a key added later is used straight away.
 */
export function startTelegram(dataDir: string, token: string, getDeepgramKey: () => string): Promise<TelegramStatus> {
  // Starts are run one after another. Two overlapping starts would each begin
  // listening, and Telegram allows only one listener per bot.
  const next = startQueue.then(() => startNow(dataDir, token, getDeepgramKey));
  startQueue = next.catch(() => undefined);
  return next;
}

let startQueue: Promise<unknown> = Promise.resolve();

async function startNow(dataDir: string, token: string, getDeepgramKey: () => string): Promise<TelegramStatus> {
  // Already listening with this token on this folder: leave it alone, even if
  // it is between retries after an error.
  if (running && running.token === token && running.dataDir === dataDir) {
    return telegramStatus();
  }
  running?.abort.abort();
  running = null;
  await loadSaved(dataDir);
  if (!token) {
    status = { ...TELEGRAM_OFF };
    return telegramStatus();
  }

  const abort = new AbortController();
  running = { token, dataDir, abort };
  status = { state: "connecting", botUsername: "", linkedChat: "", error: "" };

  // Confirm the token before reporting back, so Settings can show the result at once.
  try {
    const me = await call<{ username: string }>(token, "getMe", {}, abort.signal);
    status = { state: "running", botUsername: me.username, linkedChat: "", error: "" };
  } catch (e) {
    status = { state: "error", botUsername: "", linkedChat: "", error: describe(e) };
    running = null;
    return telegramStatus();
  }

  void listen(dataDir, token, getDeepgramKey, abort.signal);
  return telegramStatus();
}

/** Forgets the linked chat; the next chat to message the bot becomes the linked one. */
export async function unlinkTelegram(dataDir: string): Promise<TelegramStatus> {
  saved = { ...saved, chatId: null, chatName: "" };
  await storeSaved(dataDir);
  return telegramStatus();
}

function describe(e: unknown): string {
  if (e instanceof TelegramError) {
    if (e.code === 401 || e.code === 404) return "Telegram rejected the bot token. Check it and save it again.";
    if (e.code === 409) return "Another program is already reading this bot's messages. Close it, or create a new bot.";
    return `Telegram returned an error: ${e.message}`;
  }
  return "Could not reach Telegram. Check your internet connection.";
}

async function listen(dataDir: string, token: string, getDeepgramKey: () => string, signal: AbortSignal) {
  while (!signal.aborted) {
    let updates: Update[];
    await adoptStoredOffset(dataDir);
    try {
      updates = await call<Update[]>(
        token,
        "getUpdates",
        { offset: saved.offset, timeout: 30, allowed_updates: ["message", "channel_post"] },
        signal,
      );
      if (status.state === "error") status = { ...status, state: "running", error: "" };
    } catch (e) {
      if (signal.aborted) return;
      status = { ...status, state: "error", error: describe(e) };
      // A rejected token will not start working by itself; anything else is retried.
      if (e instanceof TelegramError && (e.code === 401 || e.code === 404)) return;
      await pause(5000, signal);
      continue;
    }

    for (const update of updates) {
      if (signal.aborted) return;
      await adoptStoredOffset(dataDir);
      if (update.update_id < saved.offset) continue;
      // Move past the message first, so one that fails is not retried forever.
      saved.offset = update.update_id + 1;
      await storeSaved(dataDir);
      try {
        await handle(dataDir, token, update, getDeepgramKey, signal);
      } catch {
        // One bad message must not stop the listener.
      }
    }
  }
}

async function handle(
  dataDir: string,
  token: string,
  update: Update,
  getDeepgramKey: () => string,
  signal: AbortSignal,
) {
  const message = update.message ?? update.channel_post;
  if (!message) return;

  const reply = (text: string) =>
    call(
      token,
      "sendMessage",
      { chat_id: message.chat.id, text, reply_parameters: { message_id: message.message_id } },
      signal,
    ).catch(() => {
      // Replies are a courtesy; in a channel the bot may not be allowed to post.
    });

  const text = message.text ?? message.caption ?? "";
  const links = extractLinks(text);

  const justLinked = saved.chatId === null;
  if (justLinked) {
    saved = { ...saved, chatId: message.chat.id, chatName: chatName(message.chat) };
    await storeSaved(dataDir);
    await reply("Linked. Send me Instagram or YouTube Shorts links and I'll save them to Research.");
  }
  // Messages from any other chat are ignored without a reply.
  if (message.chat.id !== saved.chatId) return;

  if (links.length === 0) {
    if (!justLinked && !text.startsWith("/")) await reply("Send me a link to save. " + SUPPORTED_LINKS_HINT);
    return;
  }

  for (const link of links) {
    if (!detectPlatform(link)) {
      await reply(`Not saved: ${link}\n${SUPPORTED_LINKS_HINT}`);
      continue;
    }
    const result = await addResearch(dataDir, link, getDeepgramKey());
    if (result.ok) {
      const { item } = result;
      const what = item.title && item.platform === "youtube" ? item.title : item.author || "post";
      const parts = [`Saved: ${what}`];
      if (item.transcript) parts.push("Transcript ready.");
      else if (item.transcriptError) parts.push(`No transcript: ${item.transcriptError}`);
      await reply(parts.join("\n"));
    } else {
      await reply(`Could not save ${link}\n${result.error}`);
    }
  }
}
