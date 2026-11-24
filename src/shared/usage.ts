// What the app has used on the services the user connected, shared by the main process and the UI.

export type UsageService = "claude" | "deepgram" | "elevenlabs" | "media";
export type UsageFeature = "agent" | "analysis" | "ideas" | "script" | "concepts" | "video" | "script_check" | "storyboard" | "animation" | "series" | "transcript" | "voiceover" | "sound_effect" | "music" | "picture" | "clip" | "lipsync" | "editor" | "music_plan";

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
  // Studio no longer suggests ideas to choose from; this names what was spent on that before.
  concepts: { label: "Studio idea options (earlier versions)", service: "claude" },
  video: { label: "Studio video scripts", service: "claude" },
  script_check: { label: "Script continuity checks", service: "claude" },
  storyboard: { label: "Storyboard checks", service: "claude" },
  animation: { label: "Motion graphics", service: "claude" },
  series: { label: "Series plans", service: "claude" },
  transcript: { label: "Transcripts", service: "deepgram" },
  voiceover: { label: "Voiceovers", service: "elevenlabs" },
  sound_effect: { label: "Sound effects", service: "elevenlabs" },
  music: { label: "Music", service: "elevenlabs" },
  picture: { label: "Pictures", service: "media" },
  clip: { label: "Clips", service: "media" },
  lipsync: { label: "Lip-sync", service: "media" },
  editor: { label: "Video editor (AI editing)", service: "claude" },
  music_plan: { label: "Music plans", service: "claude" },
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
  /** Estimated cost in US dollars at list prices: Claude from its tokens, pictures and clips from the service's price for one. */
  costUsd?: number;
  /** Deepgram: seconds of audio transcribed. */
  seconds?: number;
  /** ElevenLabs: characters of text turned into speech. */
  characters?: number;
  /** ElevenLabs: credits it reported charging, when it says. */
  credits?: number;
  /** Pictures, clips and lip-sync: the service that made it ("fal", "google" or "elevenlabs") and the model. */
  provider?: string;
  model?: string;
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

/** What one service made in the period, and what that is estimated to have cost. */
export type MediaSpend = {
  /** "fal", "google" or "elevenlabs"; "" when an older line does not say. */
  provider: string;
  pictures: number;
  clips: number;
  costUsd: number;
  /** How many of them have no price to estimate from. */
  unpriced: number;
};

export type UsageReport = {
  /** One row per kind of use that happened in the period. */
  rows: UsageRow[];
  /** Pictures, clips and lip-sync in the period, totalled for each service that made them. */
  media: MediaSpend[];
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
