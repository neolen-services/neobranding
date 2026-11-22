// What the app has used on the services the user connected, shared by the main process and the UI.

export type UsageService = "claude" | "deepgram" | "elevenlabs" | "media";
export type UsageFeature = "agent" | "analysis" | "ideas" | "script" | "concepts" | "video" | "series" | "transcript" | "voiceover" | "sound_effect" | "music" | "picture" | "clip" | "lipsync";

export const USAGE_SERVICES: Record<UsageService, string> = {
  claude: "Claude",
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs",
  media: "Pictures and video (the service is named on each request)",
};

/** What each kind of use is called on the Usage page, and which service it goes to. */
export const USAGE_FEATURES: Record<UsageFeature, { label: string; service: UsageService }> = {
  agent: { label: "Agent chats", service: "claude" },
  analysis: { label: "Post analysis", service: "claude" },
  ideas: { label: "Idea generation", service: "claude" },
  // Ideas no longer have scripts; this names what was spent on them before.
  script: { label: "Idea scripts (earlier versions)", service: "claude" },
  concepts: { label: "Studio idea options", service: "claude" },
  video: { label: "Studio video scripts", service: "claude" },
  series: { label: "Series plans", service: "claude" },
  transcript: { label: "Transcripts", service: "deepgram" },
  voiceover: { label: "Voiceovers", service: "elevenlabs" },
  sound_effect: { label: "Sound effects", service: "elevenlabs" },
  music: { label: "Music", service: "elevenlabs" },
  picture: { label: "Pictures", service: "media" },
  clip: { label: "Clips", service: "media" },
  lipsync: { label: "Lip-sync", service: "media" },
};

/** One request the app made to a service. One line of usage.jsonl in the data folder. */
export type UsageEvent = {
  /** ISO time of the request. */
  at: string;
  feature: UsageFeature;
  /** What it was for: a post's creator, an idea's title, a chat's title. */
  detail?: string;
  /** Claude: tokens sent, including those read from or written to the cache. */
  inputTokens?: number;
  /** Claude: tokens written back. */
  outputTokens?: number;
  /** Claude: estimated cost in US dollars at list prices. */
  costUsd?: number;
  /** Deepgram: seconds of audio transcribed. */
  seconds?: number;
  /** ElevenLabs: characters of text turned into speech. */
  characters?: number;
  /** ElevenLabs: credits it reported charging, when it says. */
  credits?: number;
  /** True for a use from before the log existed, taken from the cost saved with the result (no token counts). */
  earlier?: boolean;
};

/** Everything of one kind in the period asked for. */
export type UsageRow = {
  feature: UsageFeature;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  seconds: number;
  characters: number;
  credits: number;
};

export type UsageReport = {
  /** One row per kind of use that happened in the period. */
  rows: UsageRow[];
  /** The latest requests in the period, newest first. */
  recent: UsageEvent[];
  /** When the app started keeping this log, or "" if nothing is logged yet. */
  trackedSince: string;
};

export type UsagePeriod = "today" | "week" | "month" | "all";
export const USAGE_PERIODS: Record<UsagePeriod, string> = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  all: "All time",
};
