// Agent chat types, shared by the main process and the UI.

/** One piece of the agent's turn, in the order it happened. */
export type AgentPart =
  | { type: "text"; text: string }
  /** Something the agent did in the app, e.g. "Analysed 3 posts". */
  | { type: "step"; label: string; ok: boolean; /** The user said no when asked to approve it. */ declined?: boolean };

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
 * How something in the app is pointed at inside a message. One item:
 * [[post:<id>]], [[idea:<id>]], [[audio:<id>]]. A whole section: [[brand:kit]],
 * [[research:all]] (every saved post), [[ideas:all]] (every saved idea). The
 * agent writes these and the chat shows a named chip (or, for the agent's
 * audio, a player). The user adds them by typing @ and picking.
 */
export const REFERENCE_PATTERN = /\[\[(post|idea|audio|brand|research|ideas|video|series|character):([\w-]+)\]\]/g;
export type ReferenceKind = "post" | "idea" | "audio" | "brand" | "research" | "ideas" | "video" | "series" | "character";

/** An action the agent wants to take that is waiting for the user's yes or no. */
export type AgentApproval = {
  /** Identifies this one request. */
  id: string;
  tool: string;
  /** What the action is, e.g. "Delete a saved post". */
  title: string;
  /** What exactly it would do, in the agent's text format (may hold reference tags). */
  detail: string;
};

export type AgentChatSummary = { id: string; title: string; updatedAt: string };

export type AgentChat = AgentChatSummary & {
  messages: AgentMessage[];
  /** Estimated Claude cost of this chat so far, in US dollars, including what its actions spent. */
  costUsd: number;
  /** Actions waiting for the user's approval; the chat is paused until they are answered. */
  approvals?: AgentApproval[];
};

/** `chat` is included on failure when there is one, so the UI can show how far it got. */
export type AgentReply = { ok: true; chat: AgentChat } | { ok: false; error: string; chat?: AgentChat };

/** What the agent is doing right now in one chat. */
export type AgentProgress = { running: boolean; status: string };

// ---------- What the agent may do without asking ----------

/** "allow": the agent just does it. "ask": the chat pauses and the user approves or declines each time. */
export type ToolPermission = "allow" | "ask";
export type AgentToolGroup = "read" | "create" | "change";
export type AgentToolInfo = { name: string; title: string; description: string; group: AgentToolGroup };
export type AgentPermissions = Record<string, ToolPermission>;

export const AGENT_TOOL_GROUPS: { id: AgentToolGroup; title: string; description: string }[] = [
  { id: "read", title: "Read-only tools", description: "Look at what is in the app. Nothing is changed." },
  { id: "create", title: "Create and generate tools", description: "Add new things. Some use your Claude or ElevenLabs credit." },
  { id: "change", title: "Change and delete tools", description: "Edit or remove what you already have." },
];

/** Every action the agent has, as shown in Settings. */
export const AGENT_TOOLS: AgentToolInfo[] = [
  { name: "get_brand", group: "read", title: "Read your brand kit", description: "Your name, topics, audience, pillars, voice and platforms." },
  { name: "list_research_posts", group: "read", title: "List saved posts", description: "Every post in Research with its numbers, your rating and note." },
  { name: "get_research_post", group: "read", title: "Read a saved post", description: "One post in full: caption, transcript, sound and analysis." },
  { name: "list_ideas", group: "read", title: "List ideas", description: "Your saved ideas with their series, pillar and score." },
  { name: "get_idea", group: "read", title: "Read an idea", description: "One idea in full: opening line, outline, caption and why it scored as it did." },
  { name: "list_generated_audio", group: "read", title: "List generated audio", description: "The voiceovers, sound effects and music already made." },
  { name: "list_voices", group: "read", title: "List ElevenLabs voices", description: "The voices in your ElevenLabs account." },
  { name: "list_cast", group: "read", title: "List characters", description: "Your characters with their personality, look and voice." },
  { name: "list_series", group: "read", title: "List series", description: "Your series and their plans." },
  { name: "list_videos", group: "read", title: "List Studio videos", description: "The videos being made and how far each has got." },
  { name: "get_video", group: "read", title: "Read a Studio video", description: "One video in full: claim, hooks, scenes, lines and results." },
  { name: "get_app_status", group: "read", title: "Check connections", description: "Which services have a key saved, and where your data folder is. Never the keys themselves." },

  { name: "save_research_post", group: "create", title: "Save a post to Research", description: "Downloads a post from an Instagram or YouTube Shorts link." },
  { name: "analyze_research_posts", group: "create", title: "Analyse posts", description: "Has Claude break saved posts down. About $0.06 per post." },
  { name: "generate_ideas", group: "create", title: "Generate ideas", description: "Runs the idea process and shows candidates. About $0.25 a round." },
  { name: "save_generated_ideas", group: "create", title: "Save generated ideas", description: "Keeps the candidates you picked." },
  { name: "create_idea", group: "create", title: "Create an idea", description: "Saves an idea the agent wrote itself." },
  { name: "generate_voiceover", group: "create", title: "Generate a voiceover", description: "Text to speech with an ElevenLabs voice. Uses ElevenLabs credits." },
  { name: "generate_sound_effect", group: "create", title: "Generate a sound effect", description: "A short sound from a description. Uses ElevenLabs credits." },
  { name: "generate_music", group: "create", title: "Generate music", description: "A music track from a description. Uses ElevenLabs credits." },

  { name: "create_character", group: "create", title: "Create a character", description: "Adds a character to your cast." },
  { name: "plan_series", group: "create", title: "Plan a series", description: "Has Claude plan a season: running question, ending and episodes. A few cents." },
  { name: "start_video", group: "create", title: "Start a Studio video", description: "Starts a video from an idea, a saved post, a series episode or a title." },
  { name: "write_video_script", group: "create", title: "Write a video's script", description: "Writes or rewrites the script as scenes. About $0.10. A rewrite needs your approval again." },
  { name: "make_video_voices", group: "create", title: "Make a video's voices", description: "Speaks the AI lines of an approved script. Uses ElevenLabs credits." },
  { name: "record_video_results", group: "create", title: "Record a video's results", description: "Saves the views, saves, shares and follows you tell it." },

  { name: "make_character_picture", group: "create", title: "Make a character's reference picture", description: "Makes a picture of a character from their look. Billed by the picture service." },
  { name: "make_scene_pictures", group: "create", title: "Make storyboard pictures", description: "Makes the storyboard picture for scenes of an approved script: the frame each scene starts on. Billed by the picture service." },
  { name: "make_scene_clip", group: "create", title: "Make a scene's clip", description: "Turns a scene's storyboard picture into a moving clip. The costly step, so it asks first unless you change that." },
  { name: "make_scene_lipsync", group: "create", title: "Lip-sync a scene", description: "Makes the character in a scene's picture speak its recorded line. Asks first unless you change that." },

  { name: "update_character", group: "change", title: "Change a character", description: "Edits a character's personality, way of talking, look or voice." },
  { name: "update_series", group: "change", title: "Change a series plan", description: "Edits a series' premise, running question, ending or episodes." },
  { name: "update_video", group: "change", title: "Change a Studio video", description: "Edits a video's title, a spoken line, or whether a scene is AI or filmed." },
  { name: "approve_video_script", group: "change", title: "Approve a video's script", description: "Marks a script as approved. It can never tick the source check for you." },
  { name: "delete_character", group: "change", title: "Delete a character", description: "Removes a character for good." },
  { name: "delete_series", group: "change", title: "Delete a series", description: "Removes a series plan for good. Its videos stay." },
  { name: "delete_video", group: "change", title: "Delete a Studio video", description: "Removes a video and its script for good." },
  { name: "update_brand", group: "change", title: "Change your brand kit", description: "Edits your name, topics, goals, audience, message, pillars, voice or platforms." },
  { name: "update_idea", group: "change", title: "Change an idea", description: "Edits an idea's title, opening line, outline, caption, series and so on." },
  { name: "rate_research_post", group: "change", title: "Change a post's rating or note", description: "Sets your rating or note on a saved post." },
  { name: "delete_research_post", group: "change", title: "Delete a saved post", description: "Removes a post and its downloaded files for good." },
  { name: "delete_idea", group: "change", title: "Delete an idea", description: "Removes an idea for good." },
  { name: "delete_generated_audio", group: "change", title: "Delete generated audio", description: "Removes a voiceover, sound effect or music track for good." },
];

/** Changes and deletions are asked about unless the user says otherwise; the rest just run. */
export const defaultPermission = (tool: AgentToolInfo): ToolPermission =>
  tool.group === "change" || COSTLY_TOOLS.includes(tool.name) ? "ask" : "allow";

/** Tools that create something but cost enough each time to ask first. */
const COSTLY_TOOLS = ["make_scene_clip", "make_scene_lipsync"];

/** Reads saved permissions, filling in the default for any tool that has none (for example one added later). */
export function parsePermissions(input: unknown): AgentPermissions {
  const saved = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return Object.fromEntries(
    AGENT_TOOLS.map((tool) => {
      const value = saved[tool.name];
      return [tool.name, value === "allow" || value === "ask" ? value : defaultPermission(tool)];
    }),
  );
}
