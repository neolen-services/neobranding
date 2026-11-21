// Agent chat types, shared by the main process and the UI.

/** One piece of the agent's turn, in the order it happened. */
export type AgentPart =
  | { type: "text"; text: string }
  /** Something the agent did in the app, e.g. "Analysed 3 posts". */
  | { type: "step"; label: string; ok: boolean };

export type AgentMessage =
  | { role: "user"; text: string; /** When it was sent, if known. */ at?: string }
  | {
      role: "assistant";
      parts: AgentPart[];
      /** How long the agent worked on this turn, in milliseconds, if known. */
      workedMs?: number;
      /** Short replies the agent offers as buttons after its answer. */
      replies?: string[];
    };

/**
 * In its text the agent refers to a saved post or idea with a tag like
 * [[post:<id>]] or [[idea:<id>]]; the chat shows it as a named chip.
 */
export const REFERENCE_PATTERN = /\[\[(post|idea):([\w-]+)\]\]/g;

export type AgentChatSummary = { id: string; title: string; updatedAt: string };

export type AgentChat = AgentChatSummary & {
  messages: AgentMessage[];
  /** Estimated Claude cost of this chat so far, in US dollars, including what its actions spent. */
  costUsd: number;
};

/** `chat` is included on failure when there is one, so the UI can show how far it got. */
export type AgentReply = { ok: true; chat: AgentChat } | { ok: false; error: string; chat?: AgentChat };

/** What the agent is doing right now in one chat. */
export type AgentProgress = { running: boolean; status: string };
