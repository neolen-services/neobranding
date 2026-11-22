// Research types, shared by the main process and the UI.
import type { PostAnalysis } from "./analysis";

export type ResearchPlatform = "instagram" | "youtube";

/** Sites the research tool accepts today, by hostname. */
const PLATFORM_HOSTS: Record<ResearchPlatform, string[]> = {
  instagram: ["instagram.com", "instagr.am"],
  youtube: ["youtube.com"],
};

/** What to tell someone whose link is not accepted. */
export const SUPPORTED_LINKS_HINT =
  "Paste an Instagram link (reel, video, photo or carousel) or a YouTube Shorts link. Other links are not supported yet.";

export const PLATFORM_LABELS: Record<ResearchPlatform, string> = {
  instagram: "Instagram",
  youtube: "YouTube Shorts",
};

/** One file of a saved post. A carousel has several. */
export type ResearchMedia = {
  kind: "video" | "image";
  /** File name inside the post's folder. */
  file: string;
  /** Poster image for a video, or "". */
  posterFile: string;
};

/** The sound a video uses: a licensed song, or the creator's own recording. */
export type ResearchAudio = {
  kind: "music" | "original";
  /** Song title, or the name of the original sound (often just "Original audio"). */
  title: string;
  /** The song's artist, or the account the original sound belongs to. */
  artist: string;
  /** Whether the site marks this sound as trending. */
  trending: boolean;
  /** A page listing other videos that use the same sound, or "". */
  url: string;
};

/** A post saved for research: its videos and pictures, with the text published alongside. */
export type ResearchItem = {
  id: string;
  platform: ResearchPlatform;
  /** The link the user pasted. */
  sourceUrl: string;
  /** The canonical link reported by the site. */
  pageUrl: string;
  title: string;
  /** The post's caption or description, as published. */
  caption: string;
  hashtags: string[];
  author: string;
  authorHandle: string;
  /** ISO date the post was published, or "" if unknown. */
  publishedAt: string;
  durationSeconds: number | null;
  likeCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  /** The post's videos and pictures, in the order they appear. */
  media: ResearchMedia[];
  /** What is said in the post's videos, from speech-to-text. "" until transcribed. */
  transcript: string;
  /** Why the last transcription attempt failed, or "". */
  transcriptError: string;
  /** The sound used. null: none found. Missing: saved before the app looked for it. */
  audio?: ResearchAudio | null;
  /** Claude's breakdown of the post. Missing until it has been analysed. */
  analysis?: PostAnalysis;
  /** The concept group it belongs to, shared by posts built on the same concept. Set when it is analysed; the user can change it. Missing or "" until then. */
  group?: string;
  /** The user's own score from 0 to 5, or null if not rated yet. */
  rating: number | null;
  /** The user's own note about the post. */
  note: string;
  savedAt: string;
};

/** The parts of a saved post the user can edit. */
export type ResearchEdit = { rating?: number | null; note?: string; /** Moves the post to this concept group; "" takes it out of any. */ group?: string };

/** What grouping posts by concept did. */
export type GroupingResult = { ok: true; items: ResearchItem[]; grouped: number } | { ok: false; error: string };

/** A group's name as it is kept: single spaces, no stray punctuation at the ends, at most 60 characters. */
export const cleanGroupName = (name: unknown) =>
  (typeof name === "string" ? name : "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”.\s]+|["'“”.\s]+$/g, "")
    .slice(0, 60);

export type ResearchResult = { ok: true; item: ResearchItem } | { ok: false; error: string };

/**
 * Names the post a link points to, so two links to the same post compare equal
 * whatever tracking was added to them: "instagram:<code>" or "youtube:<id>".
 * A link whose shape is not recognised falls back to its address without the
 * query. Returns null for something that is not a link.
 */
export function postKey(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const platform = detectPlatform(url);
  // Instagram: /reel/<code>, /reels/<code>, /p/<code>, /tv/<code>, optionally after the account name.
  const instagram = /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]+)/.exec(parsed.pathname);
  if (platform === "instagram" && instagram) return `instagram:${instagram[1]}`;
  const shorts = /^\/shorts\/([\w-]+)/.exec(parsed.pathname);
  if (platform === "youtube" && shorts) return `youtube:${shorts[1]}`;
  const host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, "");
  return `${host}${parsed.pathname.replace(/\/+$/, "")}`;
}

/** Returns the platform for a link, or null if the link is not supported yet. */
export function detectPlatform(url: string): ResearchPlatform | null {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, "");
    path = parsed.pathname;
  } catch {
    return null;
  }
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    // On YouTube only Shorts are accepted for now, not regular videos.
    if (platform === "youtube" && !/^\/shorts\/[\w-]+/.test(path)) return null;
    return platform as ResearchPlatform;
  }
  return null;
}
