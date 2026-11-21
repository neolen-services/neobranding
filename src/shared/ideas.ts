// Short-video idea types, shared by the main process and the UI.

export const IDEA_STATUSES = ["idea", "scripted", "filmed", "posted"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  idea: "Idea",
  scripted: "Scripted",
  filmed: "Filmed",
  posted: "Posted",
};

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
};

/** A suggestion the user chose to keep. */
export type Idea = IdeaDraft & { id: string; status: IdeaStatus; createdAt: string };

export type GenerateOptions = {
  count: number;
  /** Limit to one pillar, or "" for any. */
  pillar: string;
  /** Limit to one platform, or "" for any. */
  platform: string;
  /** Free-text steer, e.g. "about sleep" or "react to a news story". */
  notes: string;
};

export type GenerateResult = { ok: true; ideas: IdeaDraft[] } | { ok: false; error: string };

export function parseIdea(input: unknown): Idea {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const id = str(i.id);
  const title = str(i.title);
  if (!id || !title) throw new Error("An idea needs an id and a title.");
  const status = IDEA_STATUSES.includes(i.status as IdeaStatus) ? (i.status as IdeaStatus) : "idea";
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
    status,
    createdAt: str(i.createdAt) || new Date().toISOString(),
  };
}
