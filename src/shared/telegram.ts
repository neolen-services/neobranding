// Telegram connection types, shared by the main process and the UI.

export type TelegramStatus = {
  /** off: no bot token saved. error: the bot could not be used; see `error`. */
  state: "off" | "connecting" | "running" | "error";
  /** The bot's @username, once Telegram has confirmed the token. */
  botUsername: string;
  /** Name of the chat or channel whose links are saved, or "" if none is linked yet. */
  linkedChat: string;
  error: string;
};

export const TELEGRAM_OFF: TelegramStatus = { state: "off", botUsername: "", linkedChat: "", error: "" };

/** Pulls web links out of a message. Trailing punctuation is not part of the link. */
export function extractLinks(text: string): string[] {
  const links = text.match(/https?:\/\/[^\s<>"]+/g) ?? [];
  return [...new Set(links.map((l) => l.replace(/[.,;:!?)\]]+$/, "")))];
}
