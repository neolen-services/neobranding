// Short-video idea types, shared by the main process and the UI.

/** What the model suggests for one video. */
export type IdeaDraft = {
  title: string;
  /** The opening line, spoken in the first three seconds. */
  hook: string;
  /** Beat-by-beat outline of what to say. */
  outline: string[];
  /** Closing call to action. */
  cta: string;
  caption: string;
  hashtags: string[];
  /** One of the brand's content pillars. */
  pillar: string;
  /** The platform it suits best. */
  platform: string;

  // Where the idea came from and how it was judged. Missing on ideas made before the process existed.
  /** Other opening lines that were considered. */
  altHooks?: string[];
  /** The saved post whose structure this idea borrows. */
  modelledOnId?: string;
  /** That post's creator, for display. */
  modelledOnLabel?: string;
  /** A repeatable format this idea belongs to, e.g. "Myth vs fact Mondays". */
  series?: string;
  /** 0 to 100, from a separate judging pass. */
  score?: number;
  scoreReason?: string;
};

/** How many analysed posts are needed before ideas can be generated from them. */
export const MIN_ANALYSED_POSTS = 5;

/** One stretch of a script, with what is said, seen and written on screen. */
export type ScriptBeat = {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
  /** The words spoken, exactly as they should be said. "" if nothing is said. */
  say: string;
  /** What the camera shows. */
  show: string;
  /** Text overlaid on screen, or "". */
  text: string;
};

/** A ready-to-film script for one saved idea. Written once and saved with the idea. */
export type IdeaScript = {
  /** Three opening lines to choose from; the first is the one the beats are written around. */
  hooks: string[];
  beats: ScriptBeat[];
  /** What kind of sound to use, and why. */
  sound: string;
  caption: string;
  hashtags: string[];
  /** Estimated cost of writing it in US dollars. */
  costUsd: number;
  writtenAt: string;
};

/** The public numbers of a posted video at one moment. null: the site did not show that number. */
export type PostCheck = { at: string; likes: number | null; comments: number | null; views: number | null };

/** The user's own published video for an idea, with its numbers over time. */
export type PostedVideo = {
  url: string;
  /** Display name of the site, e.g. "Instagram". */
  platform: string;
  linkedAt: string;
  /** Oldest first. */
  checks: PostCheck[];
};

/** A suggestion the user chose to keep. */
export type Idea = IdeaDraft & {
  id: string;
  createdAt: string;
  script?: IdeaScript;
  posted?: PostedVideo;
};

export type ScriptResult = { ok: true; idea: Idea } | { ok: false; error: string };
export type IdeaResult = ScriptResult;

const HOUR = 60 * 60 * 1000;
/** Numbers are re-read daily for the first two weeks after linking, then weekly. */
export function checkIsDue(posted: PostedVideo, now = Date.now()): boolean {
  const last = posted.checks.at(-1);
  if (!last) return true;
  const sinceLast = now - Date.parse(last.at);
  const sinceLinked = now - Date.parse(posted.linkedAt);
  return sinceLast >= (sinceLinked < 14 * 24 * HOUR ? 24 * HOUR : 7 * 24 * HOUR);
}

/** Words spoken per second at a natural pace, used to check a script fits its time. */
export const WORDS_PER_SECOND = 2.5;

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export type GenerateOptions = {
  count: number;
  /** Limit to one pillar, or "" for any. */
  pillar: string;
  /** Limit to one platform, or "" for any. */
  platform: string;
  /** Free-text steer, e.g. "about sleep" or "react to a news story". */
  notes: string;
  /** Write new episodes of this existing series, or "" for any. */
  series?: string;
};

export type GenerateResult =
  | {
      ok: true;
      ideas: IdeaDraft[];
      /** How many ideas were written before judging cut them down. */
      considered: number;
      /** Estimated cost of this round in US dollars. */
      costUsd: number;
    }
  | { ok: false; error: string };

export function parseIdea(input: unknown): Idea {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const id = str(i.id);
  const title = str(i.title);
  if (!id || !title) throw new Error("An idea needs an id and a title.");
  return {
    id,
    title,
    hook: str(i.hook),
    outline: list(i.outline),
    cta: str(i.cta),
    caption: str(i.caption),
    hashtags: list(i.hashtags),
    pillar: str(i.pillar),
    platform: str(i.platform),
    altHooks: list(i.altHooks),
    modelledOnId: str(i.modelledOnId),
    modelledOnLabel: str(i.modelledOnLabel),
    series: str(i.series),
    score: typeof i.score === "number" ? i.score : undefined,
    scoreReason: str(i.scoreReason),
    createdAt: str(i.createdAt) || new Date().toISOString(),
    script: parseScript(i.script),
    posted: parsePosted(i.posted),
  };
}

function parsePosted(input: unknown): PostedVideo | undefined {
  if (!input || typeof input !== "object") return undefined;
  const p = input as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const url = str(p.url);
  if (!url) return undefined;
  return {
    url,
    platform: str(p.platform),
    linkedAt: str(p.linkedAt) || new Date().toISOString(),
    checks: (Array.isArray(p.checks) ? p.checks : [])
      .map((c): PostCheck => {
        const check = (c ?? {}) as Record<string, unknown>;
        return { at: str(check.at), likes: num(check.likes), comments: num(check.comments), views: num(check.views) };
      })
      .filter((c) => c.at),
  };
}

function parseScript(input: unknown): IdeaScript | undefined {
  if (!input || typeof input !== "object") return undefined;
  const s = input as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const beats = (Array.isArray(s.beats) ? s.beats : []).map((b): ScriptBeat => {
    const beat = (b ?? {}) as Record<string, unknown>;
    return { start: num(beat.start), end: num(beat.end), say: str(beat.say), show: str(beat.show), text: str(beat.text) };
  });
  if (beats.length === 0) return undefined;
  return {
    hooks: list(s.hooks),
    beats,
    sound: str(s.sound),
    caption: str(s.caption),
    hashtags: list(s.hashtags),
    costUsd: num(s.costUsd),
    writtenAt: str(s.writtenAt) || new Date().toISOString(),
  };
}
